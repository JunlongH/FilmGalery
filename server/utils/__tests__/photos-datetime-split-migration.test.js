const os = require('os');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');

const { runPhotoDatetimeSplit } = require('../photos-datetime-split-migration');

function openDb(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((res, rej) => {
    db.run(sql, params, function (err) {
      if (err) rej(err);
      else res(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((res, rej) => {
    db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows)));
  });
}

describe('photos-datetime-split-migration', () => {
  let tmpDir;
  let dbPath;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fg-dtsplit-'));
    dbPath = path.join(tmpDir, 'film.db');
    const db = await openDb(dbPath);
    await run(db, `CREATE TABLE photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      date_taken DATE,
      time_taken TIME
    )`);
    await run(db, `INSERT INTO photos (filename, date_taken, time_taken) VALUES
      ('space.jpg',  '2026-08-06 10:40:00',      NULL),
      ('iso.jpg',    '2026-08-06T10:40:00.000Z', NULL),
      ('pure.jpg',   '2026-08-06',               NULL),
      ('conflict.jpg','2026-08-06 10:40:00',     '08:00:00'),
      ('nodate.jpg', NULL,                       NULL)`);
    await new Promise((r) => db.close(r));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  test('splits embedded time into date_taken/time_taken', async () => {
    const res = await runPhotoDatetimeSplit(dbPath);
    expect(res.skipped).toBe(false);
    expect(res.repaired).toBe(3);

    const db = await openDb(dbPath);
    const rows = await all(db, `SELECT filename, date_taken, time_taken FROM photos ORDER BY id`);
    await new Promise((r) => db.close(r));

    const byName = Object.fromEntries(rows.map((r) => [r.filename, r]));
    expect(byName['space.jpg'].date_taken).toBe('2026-08-06');
    expect(byName['space.jpg'].time_taken).toBe('10:40:00');
    expect(byName['iso.jpg'].date_taken).toBe('2026-08-06');
    expect(byName['iso.jpg'].time_taken).toBe('10:40:00');
    expect(byName['pure.jpg'].date_taken).toBe('2026-08-06');
    expect(byName['pure.jpg'].time_taken).toBe(null);
    expect(byName['conflict.jpg'].date_taken).toBe('2026-08-06');
    expect(byName['conflict.jpg'].time_taken).toBe('08:00:00');
    expect(byName['nodate.jpg'].date_taken).toBe(null);
    expect(byName['nodate.jpg'].time_taken).toBe(null);
  });

  test('is idempotent — second run repairs nothing', async () => {
    await runPhotoDatetimeSplit(dbPath);
    const second = await runPhotoDatetimeSplit(dbPath);
    expect(second.repaired).toBe(0);
    expect(second.skipped).toBe(true);
  });

  test('skips when time_taken column is missing', async () => {
    const db = await openDb(dbPath);
    await run(db, `ALTER TABLE photos RENAME TO photos_old`);
    await run(db, `CREATE TABLE photos (id INTEGER PRIMARY KEY, date_taken DATE)`);
    await new Promise((r) => db.close(r));

    const res = await runPhotoDatetimeSplit(dbPath);
    expect(res).toEqual({ repaired: 0, skipped: true });
  });
});
