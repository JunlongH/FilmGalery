/**
 * Normalize Photo Path Separators Migration
 *
 * On Windows, early digital imports stored relative paths with backslashes
 * (e.g. "digital\2026-07\thumb\1_thumb.jpg") because the shard path was
 * built with path.join(). Backslashes break CSS url() (map markers render
 * black) and URL building on the client. The on-disk layout uses the same
 * separators, so normalizing the stored strings to forward slashes matches
 * the real file layout on every platform.
 *
 * Idempotent: rows without backslashes are untouched.
 */

const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');
const { getDbPath } = require('../config/db-config');

const PATH_COLUMNS = [
  'original_rel_path',
  'positive_rel_path',
  'full_rel_path',
  'negative_rel_path',
  'thumb_rel_path',
  'positive_thumb_rel_path',
  'negative_thumb_rel_path',
];

function log(msg) {
  const logPath = path.join(path.dirname(getDbPath()), 'schema-migration.log');
  const ts = new Date().toISOString();
  fs.appendFileSync(logPath, `[${ts}] ${msg}\n`);
  console.log(`[SCHEMA] ${msg}`);
}

function runNormalizePhotoPathSeparators(dbPathOverride) {
  return new Promise((resolve, reject) => {
    const dbPath = dbPathOverride || getDbPath();
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

    (async () => {
      await run('PRAGMA busy_timeout = 30000');
      const cols = await all(`SELECT name FROM pragma_table_info('photos')`);
      const existing = new Set(cols.map(c => c.name));
      let totalChanges = 0;
      for (const col of PATH_COLUMNS) {
        if (!existing.has(col)) continue;
        const r = await run(
          `UPDATE photos SET ${col} = REPLACE(${col}, char(92), '/') WHERE instr(${col}, char(92)) > 0`
        );
        if (r.changes > 0) {
          log(`Normalized ${r.changes} row(s) in photos.${col}`);
          totalChanges += r.changes;
        }
      }
      if (totalChanges === 0) {
        log('Photo path separators already normalized — nothing to do.');
      } else {
        log(`Path separator normalization complete: ${totalChanges} value(s) updated.`);
      }
      db.close();
      resolve({ updated: totalChanges });
    })().catch((e) => {
      log(`Path separator normalization failed: ${e.message}`);
      db.close();
      reject(e);
    });
  });
}

module.exports = { runNormalizePhotoPathSeparators };
