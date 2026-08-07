/**
 * Photos Digital Date Wallclock Migration
 *
 * Digital photos imported before this fix stored date_taken as UTC ISO
 * ("2026-08-06T10:40:00.000Z") instead of the camera wall clock. This
 * converts those values to local wall clock "YYYY-MM-DD HH:MM:SS" using
 * strftime with the 'localtime' modifier.
 *
 * Only rows from August 2026 onwards are touched (user requirement).
 *
 * Idempotent: the UPDATE only runs when the photos table has a source_type
 * column (pragma_table_info check) AND at least one matching row exists;
 * re-running is a no-op because already-converted values no longer match
 * the `date_taken LIKE '%Z'` filter.
 */

const sqlite3 = require('sqlite3');
const { getDbPath } = require('../config/db-config');

const UPDATE_SQL = `
  UPDATE photos
  SET date_taken = strftime('%Y-%m-%d %H:%M:%S', date_taken, 'localtime')
  WHERE source_type = 'digital'
    AND date_taken LIKE '%Z'
    AND date_taken >= '2026-08-01'
`;

const MATCH_SQL = `
  SELECT COUNT(*) AS n FROM photos
  WHERE source_type = 'digital'
    AND date_taken LIKE '%Z'
    AND date_taken >= '2026-08-01'
`;

function runDigitalDateWallclock(dbPathOverride) {
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
      const hasSourceType = cols.some(c => c.name === 'source_type');
      if (!hasSourceType) {
        console.log('[MIGRATION] photos table has no source_type column — skipping date wallclock repair');
        db.close();
        resolve({ repaired: 0, skipped: true });
        return;
      }
      const [{ n }] = await all(MATCH_SQL);
      if (n === 0) {
        console.log('[MIGRATION] no matching digital photos with UTC date_taken — skipping date wallclock repair');
        db.close();
        resolve({ repaired: 0, skipped: true });
        return;
      }
      const res = await run(UPDATE_SQL);
      console.log(`[MIGRATION] photos digital date wallclock repaired: ${res.changes}`);
      db.close();
      resolve({ repaired: res.changes, skipped: false });
    })().catch((e) => {
      db.close();
      reject(e);
    });
  });
}

module.exports = { runDigitalDateWallclock };
