const sqlite3 = require('sqlite3');
const { getDbPath } = require('../config/db-config');

const EMBEDDED_TIME_WHERE = `
  date_taken IS NOT NULL
  AND length(date_taken) >= 19
  AND substr(date_taken, 11, 1) IN (' ', 'T')
  AND substr(date_taken, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr(date_taken, 12, 8) GLOB '[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
`;

const MATCH_SQL = `SELECT COUNT(*) AS n FROM photos WHERE ${EMBEDDED_TIME_WHERE}`;

const SPLIT_SQL = `
  UPDATE photos
  SET time_taken = substr(date_taken, 12, 8),
      date_taken = substr(date_taken, 1, 10)
  WHERE ${EMBEDDED_TIME_WHERE}
    AND (time_taken IS NULL OR time_taken = '')
`;

const STRIP_SQL = `
  UPDATE photos
  SET date_taken = substr(date_taken, 1, 10)
  WHERE ${EMBEDDED_TIME_WHERE}
    AND time_taken IS NOT NULL AND time_taken != ''
`;

function runPhotoDatetimeSplit(dbPathOverride) {
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
      const hasTimeTaken = cols.some(c => c.name === 'time_taken');
      if (!hasTimeTaken) {
        console.log('[MIGRATION] photos table has no time_taken column — skipping datetime split repair');
        db.close();
        resolve({ repaired: 0, skipped: true });
        return;
      }
      const [{ n }] = await all(MATCH_SQL);
      if (n === 0) {
        console.log('[MIGRATION] no photos with embedded time in date_taken — skipping datetime split repair');
        db.close();
        resolve({ repaired: 0, skipped: true });
        return;
      }
      const splitRes = await run(SPLIT_SQL);
      const stripRes = await run(STRIP_SQL);
      const repaired = splitRes.changes + stripRes.changes;
      console.log(`[MIGRATION] photos datetime split repaired: ${repaired} (split ${splitRes.changes}, stripped ${stripRes.changes})`);
      db.close();
      resolve({ repaired, skipped: false });
    })().catch((e) => {
      db.close();
      reject(e);
    });
  });
}

module.exports = { runPhotoDatetimeSplit };
