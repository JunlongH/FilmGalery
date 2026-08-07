/**
 * Integration tests for the unified migration runner (Phase 2C.1).
 *
 * Strategy: set DB_PATH to a fresh temp file BEFORE requiring anything that
 * transitively loads server/db.js (which opens the sqlite handle at module
 * load). The runner then operates against an empty DB.
 *
 * Locks:
 *   - runAllMigrations() on a fresh DB creates the _migrations table with
 *     exactly 3 rows (schema + equipment + film-struct).
 *   - The key tables (photos/rolls/film_items/...) exist post-migration.
 *   - The 2C.1.2 idx_photos_location index exists.
 *   - The 2C.1.3 consolidation column (photos.positive_source) exists —
 *     previously only added by a now-deleted orphan migration.
 *   - Second run is idempotent (everything skipped, no new _migrations rows).
 *   - Backup file is created on first run (pending); not created on second
 *     (all skipped).
 *   - start_date column exists (proves ensureStartDateColumn runtime
 *     fallback is no longer needed).
 *
 * These tests touch the real sqlite3 + real migration code paths. They are
 * slower than unit tests (~100-200ms each) but catch integration drift.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// Each test gets a fresh DB file. We isolate by changing DB_PATH per test
// and busting the require cache between.
function freshDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-migration-test-'));
  return path.join(dir, 'film.db');
}

function loadRunWithDb(dbPath) {
  process.env.DB_PATH = dbPath;
  jest.resetModules();
  return require('../run-all-migrations');
}

function openReadOnly(dbPath) {
  // Use the same sqlite3 the server ships with.
  const sqlite3 = require('sqlite3').verbose();
  return new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
}

function queryAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function cleanupBackups(dbPath) {
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

describe('runAllMigrations — fresh DB integration', () => {
  let dbPath;

  beforeEach(() => { dbPath = freshDbPath(); });
  afterEach(() => {
    delete process.env.DB_PATH;
    jest.resetModules();
    cleanupBackups(dbPath);
  });

  test('first run executes all registered migrations and records them', async () => {
    const { runAllMigrations } = loadRunWithDb(dbPath);
    const result = await runAllMigrations();
    const expectedNames = [
      '20240101_core_schema',
      '20241001_equipment_tables',
      '20241101_film_structure',
      '20260701_digital_mode',
      '20260726_digital_rating_like_only',
      '20260726_normalize_photo_path_separators',
      '20260726_relax_photos_roll_id',
      '20260807_digital_date_wallclock',
      '20260807_photo_datetime_split',
      '20260807_photos_fileinfo_columns',
    ];
    expect(result.total).toBe(expectedNames.length);
    expect(result.executed).toBe(expectedNames.length);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);

    const db = openReadOnly(dbPath);
    try {
      const rows = await queryAll(db, "SELECT name, success FROM _migrations ORDER BY name");
      expect(rows.map(r => r.name)).toEqual(expectedNames);
      expect(rows.every(r => r.success === 1)).toBe(true);
    } finally {
      await new Promise(r => db.close(r));
    }
  });

  test('core schema creates the key tables', async () => {
    const { runAllMigrations } = loadRunWithDb(dbPath);
    await runAllMigrations();

    const db = openReadOnly(dbPath);
    try {
      const rows = await queryAll(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
      const tables = rows.map(r => r.name);
      // Spot-check the high-traffic tables — these are the ones the route
      // layer queries against. If any are missing the whole app crashes.
      for (const expected of ['films', 'rolls', 'photos', 'tags', 'photo_tags',
                              'film_items', 'presets', 'sessions', 'auth_config', 'equip_cameras']) {
        expect(tables).toContain(expected);
      }
    } finally {
      await new Promise(r => db.close(r));
    }
  });

  test('photos(positive_source) column exists (2C.1.3 consolidation)', async () => {
    // This column was previously added by the deleted orphan
    // 2026-01-16-add-positive-source.js; the consolidation moved it into
    // schema-migration.js. If it's missing, import-service.js crashes.
    const { runAllMigrations } = loadRunWithDb(dbPath);
    await runAllMigrations();

    const db = openReadOnly(dbPath);
    try {
      const cols = await queryAll(db, "PRAGMA table_info(photos)");
      const names = cols.map(c => c.name);
      expect(names).toContain('positive_source');
    } finally {
      await new Promise(r => db.close(r));
    }
  });

  test('rolls.start_date column exists (no more runtime fallback needed)', async () => {
    // Pre-2C.1.3: roll-service.js ran `ensureStartDateColumn()` at every
    // startup because the column wasn't in any active migration. Now it's
    // in schema-migration.js column list.
    const { runAllMigrations } = loadRunWithDb(dbPath);
    await runAllMigrations();

    const db = openReadOnly(dbPath);
    try {
      const cols = await queryAll(db, "PRAGMA table_info(rolls)");
      expect(cols.map(c => c.name)).toContain('start_date');
      expect(cols.map(c => c.name)).toContain('display_seq');
    } finally {
      await new Promise(r => db.close(r));
    }
  });

  test('idx_photos_location index exists (2C.1.2 — only truly missing index)', async () => {
    const { runAllMigrations } = loadRunWithDb(dbPath);
    await runAllMigrations();

    const db = openReadOnly(dbPath);
    try {
      const indexes = await queryAll(db, "SELECT name FROM pragma_index_list('photos')");
      const names = indexes.map(i => i.name);
      // The new index from 2C.1.2.
      expect(names).toContain('idx_photos_location');
      // Plus the indexes the plan initially misidentified as missing
      // (proving they were already there in schema-migration.js).
      expect(names).toContain('idx_photos_roll');
      expect(names).toContain('idx_photos_date_taken');
    } finally {
      await new Promise(r => db.close(r));
    }
  });

  test('second run is idempotent (all skipped, no new _migrations rows)', async () => {
    const first = loadRunWithDb(dbPath);
    const firstResult = await first.runAllMigrations();
    const count = firstResult.total;

    // Re-load to simulate a fresh boot.
    const second = loadRunWithDb(dbPath);
    const result = await second.runAllMigrations();

    expect(result.executed).toBe(0);
    expect(result.skipped).toBe(count);
    expect(result.failed).toBe(0);

    const db = openReadOnly(dbPath);
    try {
      const rows = await queryAll(db, "SELECT COUNT(*) AS n FROM _migrations WHERE success = 1");
      expect(rows[0].n).toBe(count);
    } finally {
      await new Promise(r => db.close(r));
    }
  });

  test('backup is created on first run', async () => {
    // For an empty DB (no _migrations table yet) the runner should create
    // a backup since all migrations are pending.
    const { runAllMigrations } = loadRunWithDb(dbPath);
    await runAllMigrations();

    const dir = path.dirname(dbPath);
    const backups = fs.readdirSync(dir).filter(f => /^film\.db\.backup-/.test(f));
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  test('backup is NOT created on second run (all migrations already applied)', async () => {
    const first = loadRunWithDb(dbPath);
    await first.runAllMigrations();
    // Count backups after first run.
    const dir = path.dirname(dbPath);
    const backupsAfterFirst = fs.readdirSync(dir).filter(f => /^film\.db\.backup-/.test(f)).length;

    const second = loadRunWithDb(dbPath);
    await second.runAllMigrations();
    const backupsAfterSecond = fs.readdirSync(dir).filter(f => /^film\.db\.backup-/.test(f)).length;

    expect(backupsAfterSecond).toBe(backupsAfterFirst);
  });
});
