/**
 * Relax photos.roll_id NOT NULL Migration
 *
 * Databases created by early versions of the app have
 * `roll_id INTEGER NOT NULL` on the photos table. Digital photos have no
 * roll (roll_id IS NULL), so every digital import fails with
 * "SQLITE_CONSTRAINT: NOT NULL constraint failed: photos.roll_id".
 *
 * SQLite cannot drop a NOT NULL constraint via ALTER TABLE, so the table
 * is rebuilt: rename-copy-swap with the constraint relaxed, preserving all
 * columns (including ALTER-added ones), indexes, and triggers.
 * Idempotent: skips when roll_id is already nullable.
 */

const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');
const { getDbPath } = require('../config/db-config');

function log(msg) {
  const logPath = path.join(path.dirname(getDbPath()), 'schema-migration.log');
  const ts = new Date().toISOString();
  fs.appendFileSync(logPath, `[${ts}] ${msg}\n`);
  console.log(`[SCHEMA] ${msg}`);
}

function runRelaxPhotosRollId(dbPathOverride) {
  return new Promise(async (resolve, reject) => {
    const dbPath = dbPathOverride || getDbPath();
    log(`Starting photos.roll_id NOT NULL relaxation on: ${dbPath}`);

    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        log(`Failed to open DB: ${err.message}`);
        return reject(err);
      }
    });

    const run = (sql, params = []) => new Promise((res, rej) => {
      db.run(sql, params, function (err) {
        if (err) rej(err);
        else res(this);
      });
    });
    const all = (sql, params = []) => new Promise((res, rej) => {
      db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows)));
    });
    const get = (sql, params = []) => new Promise((res, rej) => {
      db.get(sql, params, (err, row) => (err ? rej(err) : res(row)));
    });

    try {
      const cols = await all('PRAGMA table_info(photos)');
      const rollIdCol = cols.find((c) => c.name === 'roll_id');
      if (!rollIdCol) {
        throw new Error('photos.roll_id column not found — unexpected schema');
      }
      if (rollIdCol.notnull === 0) {
        log('photos.roll_id is already nullable. Nothing to do.');
        db.close();
        return resolve();
      }

      // Capture dependent objects before the rebuild (indexes are dropped
      // with the table; triggers too). sql IS NULL for auto-indexes.
      const indexes = await all(
        `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='photos' AND sql IS NOT NULL`
      );
      const triggers = await all(
        `SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='photos' AND sql IS NOT NULL`
      );

      const master = await get(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='photos'`
      );
      if (!master || !master.sql) {
        throw new Error('photos table definition not found in sqlite_master');
      }

      let newSql = master.sql
        .replace(/CREATE TABLE\s+("photos"|\[photos\]|`photos`|photos)/i, 'CREATE TABLE photos_new')
        .replace(/roll_id\s+INTEGER\s+NOT\s+NULL/i, 'roll_id INTEGER');

      if (!/CREATE TABLE\s+photos_new/i.test(newSql) || /roll_id\s+INTEGER\s+NOT\s+NULL/i.test(newSql)) {
        throw new Error(`Failed to derive relaxed table definition from: ${master.sql}`);
      }

      await run('PRAGMA foreign_keys=OFF');
      await run('BEGIN');
      try {
        await run(newSql);
        await run('INSERT INTO photos_new SELECT * FROM photos');
        await run('DROP TABLE photos');
        await run('ALTER TABLE photos_new RENAME TO photos');
        for (const ix of indexes) {
          await run(ix.sql);
        }
        for (const t of triggers) {
          await run(t.sql);
        }
        await run('COMMIT');
      } catch (e) {
        await run('ROLLBACK');
        throw e;
      }
      await run('PRAGMA foreign_keys=ON');

      const verify = await all('PRAGMA table_info(photos)');
      const verified = verify.find((c) => c.name === 'roll_id');
      if (!verified || verified.notnull !== 0) {
        throw new Error('Post-rebuild verification failed: roll_id still NOT NULL');
      }
      const count = await get('SELECT COUNT(*) AS cnt FROM photos');
      log(`photos table rebuilt: roll_id nullable, ${count.cnt} rows preserved, ${indexes.length} indexes + ${triggers.length} triggers recreated.`);

      db.close();
      resolve();
    } catch (err) {
      log(`Migration error: ${err.message}`);
      db.close();
      reject(err);
    }
  });
}

module.exports = { runRelaxPhotosRollId };
