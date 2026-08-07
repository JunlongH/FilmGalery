/**
 * Photos File-Info Columns Migration
 *
 * width/height/file_size were added to the digital-mode migration in a later
 * release. Databases that had already recorded 20260701_digital_mode as
 * successful never re-ran it, so their photos table lacks these columns and
 * digital import fails with "table photos has no column named width".
 *
 * Idempotent: columns are only added when missing (pragma_table_info check).
 */

const sqlite3 = require('sqlite3');
const { getDbPath } = require('../config/db-config');

const COLUMNS = [
  { col: 'width', type: 'INTEGER' },
  { col: 'height', type: 'INTEGER' },
  { col: 'file_size', type: 'INTEGER' },
];

function runPhotosFileinfoColumns(dbPathOverride) {
  return new Promise((resolve, reject) => {
    const dbPath = dbPathOverride || getDbPath();
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
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
      const added = [];
      for (const { col, type } of COLUMNS) {
        if (existing.has(col)) continue;
        await run(`ALTER TABLE photos ADD COLUMN ${col} ${type}`);
        added.push(col);
      }
      if (added.length) {
        console.log(`[MIGRATION] photos file-info columns added: ${added.join(', ')}`);
      }
      db.close();
      resolve({ added });
    })().catch((e) => {
      db.close();
      reject(e);
    });
  });
}

module.exports = { runPhotosFileinfoColumns };
