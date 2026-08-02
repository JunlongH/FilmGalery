/**
 * SQL-level contract test for the 'albums.list' prepared statement.
 *
 * Locks the AlbumCard contract: every listed album row must carry
 *   - photo_count       (non-deleted photos joined via album_photos)
 *   - total_photo_count (non-deleted photos across the whole subtree,
 *                        counted once per photo via DISTINCT)
 *   - date_range_start  (MIN photos.date_taken, non-deleted)
 *   - date_range_end    (MAX photos.date_taken, non-deleted)
 *
 * Regression: pre-fix the SELECT returned neither photo_count nor the date
 * range, so AlbumCard always rendered "0 photos".
 *
 * Strategy mirrors run-all-migrations.test.js: fresh temp DB via DB_PATH,
 * real migrations, real prepared-statements module against that DB.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

function freshDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-albums-list-test-'));
  return path.join(dir, 'film.db');
}

function cleanup(dbPath) {
  const dir = path.dirname(dbPath);
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/^film\.db\.backup-/.test(f) || /^film\.db($|-shm|-wal)/.test(f)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
      }
    }
    fs.rmdirSync(dir);
  } catch (_) {}
}

describe("prepared statement 'albums.list' — photo_count / date_range contract", () => {
  let dbPath;
  let PreparedStmt;
  let runAsync;

  beforeEach(async () => {
    dbPath = freshDbPath();
    process.env.DB_PATH = dbPath;
    jest.resetModules();
    const { runAllMigrations } = require('../run-all-migrations');
    await runAllMigrations();
    PreparedStmt = require('../prepared-statements');
    ({ runAsync } = require('../db-helpers'));
  });

  afterEach(() => {
    delete process.env.DB_PATH;
    jest.resetModules();
    cleanup(dbPath);
  });

  async function seed() {
    const albumIns = await runAsync('INSERT INTO albums (title) VALUES (?)', ['旅行']);
    const albumId = albumIns.lastID;
    // Two live photos + one soft-deleted photo in the album
    const p1 = await runAsync(
      "INSERT INTO photos (filename, date_taken) VALUES ('a.jpg', '2025-03-10T08:00:00.000Z')",
      []
    );
    const p2 = await runAsync(
      "INSERT INTO photos (filename, date_taken) VALUES ('b.jpg', '2025-06-20T09:00:00.000Z')",
      []
    );
    const p3 = await runAsync(
      "INSERT INTO photos (filename, date_taken, deleted_at) VALUES ('c.jpg', '2024-01-01T00:00:00.000Z', CURRENT_TIMESTAMP)",
      []
    );
    for (const photoId of [p1.lastID, p2.lastID, p3.lastID]) {
      await runAsync('INSERT INTO album_photos (album_id, photo_id) VALUES (?, ?)', [albumId, photoId]);
    }
    return albumId;
  }

  test('returns photo_count excluding soft-deleted photos', async () => {
    await seed();
    const rows = await PreparedStmt.allAsync('albums.list', [0, null, null]);
    expect(rows).toHaveLength(1);
    expect(rows[0].photo_count).toBe(2);
  });

  test('returns date_range_start / date_range_end from non-deleted photos', async () => {
    await seed();
    const rows = await PreparedStmt.allAsync('albums.list', [0, null, null]);
    expect(rows[0].date_range_start).toBe('2025-03-10T08:00:00.000Z');
    expect(rows[0].date_range_end).toBe('2025-06-20T09:00:00.000Z');
  });

  test('empty album yields photo_count 0 and null date range', async () => {
    await runAsync('INSERT INTO albums (title) VALUES (?)', ['空相册']);
    const rows = await PreparedStmt.allAsync('albums.list', [0, null, null]);
    expect(rows).toHaveLength(1);
    expect(rows[0].photo_count).toBe(0);
    expect(rows[0].date_range_start).toBeNull();
    expect(rows[0].date_range_end).toBeNull();
  });

  test('total_photo_count aggregates photos across the subtree (deduped)', async () => {
    const a = await runAsync('INSERT INTO albums (title) VALUES (?)', ['父相册']);
    const b = await runAsync("INSERT INTO albums (title, parent_id) VALUES (?, ?)", ['子相册', a.lastID]);
    const c = await runAsync("INSERT INTO albums (title, parent_id) VALUES (?, ?)", ['孙相册', b.lastID]);
    const p1 = await runAsync("INSERT INTO photos (filename) VALUES ('x.jpg')", []);
    const p2 = await runAsync("INSERT INTO photos (filename) VALUES ('y.jpg')", []);
    const p3 = await runAsync("INSERT INTO photos (filename) VALUES ('z.jpg')", []);
    await runAsync('INSERT INTO album_photos (album_id, photo_id) VALUES (?, ?)', [b.lastID, p1.lastID]);
    await runAsync('INSERT INTO album_photos (album_id, photo_id) VALUES (?, ?)', [c.lastID, p2.lastID]);
    await runAsync('INSERT INTO album_photos (album_id, photo_id) VALUES (?, ?)', [c.lastID, p3.lastID]);
    // p1 in all three albums — must count once per ancestor (DISTINCT)
    await runAsync('INSERT INTO album_photos (album_id, photo_id) VALUES (?, ?)', [a.lastID, p1.lastID]);
    await runAsync('INSERT INTO album_photos (album_id, photo_id) VALUES (?, ?)', [c.lastID, p1.lastID]);

    const rows = await PreparedStmt.allAsync('albums.list', [0, null, null]);
    const byTitle = Object.fromEntries(rows.map((r) => [r.title, r]));
    // A subtree = {A,B,C}: p1 (deduped across A/B/C) + p2 + p3
    expect(byTitle['父相册'].photo_count).toBe(1); // direct: p1 only
    expect(byTitle['父相册'].total_photo_count).toBe(3);
    // B subtree = {B,C}: p1 + p2 + p3
    expect(byTitle['子相册'].photo_count).toBe(1);
    expect(byTitle['子相册'].total_photo_count).toBe(3);
    // C subtree = {C}: p1 + p2 + p3
    expect(byTitle['孙相册'].photo_count).toBe(3);
    expect(byTitle['孙相册'].total_photo_count).toBe(3);
  });
});
