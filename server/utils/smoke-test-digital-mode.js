'use strict';

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');

const SRC_DB = path.join(__dirname, '..', 'film.db');
const TMP_DB = path.join(__dirname, '..', '..', 'tmp', 'smoke-test-digital.db');
const TMP_DIR = path.dirname(TMP_DB);

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
fs.copyFileSync(SRC_DB, TMP_DB);

function log(label, value) {
  console.log(`  ${(label + ':').padEnd(40)} ${value}`);
}

function allAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function getAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function runAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
}

async function snapshot(db, label) {
  const tables = (await allAsync(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).map(r => r.name);
  const photoCount = (await getAsync(db, 'SELECT COUNT(*) AS cnt FROM photos')).cnt;
  const rollCount = (await getAsync(db, 'SELECT COUNT(*) AS cnt FROM rolls')).cnt;
  console.log(`\n=== ${label} ===`);
  log('tables count', tables.length);
  log('photo count', photoCount);
  log('roll count', rollCount);
  return { tables, photoCount, rollCount };
}

async function main() {
  let db;
  let pass = 0, fail = 0;
  const expect = (cond, msg) => { cond ? pass++ : fail++; console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${msg}`); };

  try {
    console.log('\n=========================================');
    console.log('  Digital Mode Migration — Smoke Test');
    console.log('=========================================');
    console.log('Source DB:', SRC_DB);
    console.log('Temp DB  :', TMP_DB);

    db = new sqlite3.Database(TMP_DB);
    await new Promise((res, rej) => db.serialize(() => db.run('PRAGMA journal_mode=WAL', err => err ? rej(err) : res())));

    const before = await snapshot(db, 'BEFORE migration');
    const srcTables = new Set(before.tables);

    // Run migration directly
    console.log('\n--- Running digital-mode-migration (run #1) ---');
    const { runDigitalModeMigration } = require('./digital-mode-migration');
    const t0 = Date.now();
    await runDigitalModeMigration(TMP_DB);
    console.log(`  Migration completed in ${Date.now() - t0}ms`);

    const after1 = await snapshot(db, 'AFTER migration #1');

    // --- Verify new tables ---
    console.log('\n--- Verifying new tables ---');
    for (const t of ['app_config', 'digital_sessions', 'albums', 'album_photos']) {
      expect(after1.tables.includes(t), `table ${t} exists`);
      expect(!srcTables.has(t), `table ${t} is new (not in source)`);
    }

    // --- Verify new columns on photos ---
    console.log('\n--- Verifying photos columns ---');
    const photoCols = (await allAsync(db, 'PRAGMA table_info(photos)')).map(c => c.name);
    for (const col of ['source_type', 'session_id', 'content_hash', 'deleted_at', 'media_type',
                       'stack_id', 'stack_role', 'white_balance', 'color_space',
                       'original_filename', 'develop_params_json', 'scene_id']) {
      expect(photoCols.includes(col), `photos.${col} exists`);
    }

    // --- Verify new columns on equip_cameras ---
    console.log('\n--- Verifying equip_cameras columns ---');
    const camCols = (await allAsync(db, 'PRAGMA table_info(equip_cameras)')).map(c => c.name);
    for (const col of ['is_digital', 'sensor_type', 'sensor_width_mm', 'sensor_height_mm',
                       'megapixels', 'crop_factor', 'sensor_format']) {
      expect(camCols.includes(col), `equip_cameras.${col} exists`);
    }

    // --- Verify indexes ---
    console.log('\n--- Verifying indexes ---');
    const indexes = (await allAsync(db, "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")).map(r => r.name);
    for (const idx of ['idx_photos_source_type', 'idx_photos_session', 'idx_photos_content_hash',
                       'idx_photos_deleted', 'idx_photos_scene',
                       'idx_digital_sessions_import_batch', 'idx_digital_sessions_date', 'idx_digital_sessions_deleted',
                       'idx_albums_parent', 'idx_albums_deleted', 'idx_albums_date_start',
                       'idx_album_photos_photo', 'idx_album_photos_album_sort']) {
      expect(indexes.includes(idx), `index ${idx} exists`);
    }

    // --- Verify source_type backfill ---
    console.log('\n--- Verifying source_type backfill ---');
    const nullSrc = (await getAsync(db, "SELECT COUNT(*) AS cnt FROM photos WHERE source_type IS NULL")).cnt;
    const filmSrc = (await getAsync(db, "SELECT COUNT(*) AS cnt FROM photos WHERE source_type = 'film'")).cnt;
    expect(nullSrc === 0, `no NULL source_type (got ${nullSrc})`);
    expect(filmSrc === after1.photoCount, `all photos source_type='film' (${filmSrc}/${after1.photoCount})`);

    // --- Verify app_config seed ---
    console.log('\n--- Verifying app_config seed ---');
    const cfg = await getAsync(db, 'SELECT * FROM app_config WHERE id = 1');
    expect(!!cfg, 'app_config row id=1 exists');
    expect(cfg && cfg.photography_mode === 'all', `app_config.photography_mode='all' (got ${cfg && cfg.photography_mode})`);

    // --- Verify no data loss ---
    console.log('\n--- Verifying zero data loss ---');
    expect(after1.photoCount === before.photoCount, `photo count unchanged (${before.photoCount} → ${after1.photoCount})`);
    expect(after1.rollCount === before.rollCount, `roll count unchanged (${before.rollCount} → ${after1.rollCount})`);

    // --- Verify existing tables untouched ---
    console.log('\n--- Verifying original tables preserved ---');
    for (const t of ['photos', 'rolls', 'films', 'locations', 'film_items', 'tags', 'photo_tags',
                     'equip_cameras', 'equip_lenses', '_migrations']) {
      expect(srcTables.has(t) && after1.tables.includes(t), `original table ${t} preserved`);
    }

    // --- Idempotency: run again ---
    console.log('\n--- Running migration again (idempotency check, run #2) ---');
    const t1 = Date.now();
    await runDigitalModeMigration(TMP_DB);
    console.log(`  Re-run completed in ${Date.now() - t1}ms`);

    const after2 = await snapshot(db, 'AFTER migration #2');
    expect(after2.photoCount === before.photoCount, `photo count still unchanged after re-run`);
    expect(after2.tables.length === after1.tables.length, `table count unchanged after re-run (${after2.tables.length})`);

    // Spot-check a few photos
    const sample = await allAsync(db, 'SELECT id, filename, roll_id, source_type FROM photos LIMIT 5');
    console.log('\n--- Sample photos (first 5) ---');
    sample.forEach(p => console.log(`  id=${p.id} roll=${p.roll_id} src=${p.source_type} file=${p.filename}`));

    console.log(`\n=========================================`);
    console.log(`  RESULT: ${pass} passed, ${fail} failed`);
    console.log(`=========================================\n`);

    db.close();
    fs.unlinkSync(TMP_DB);
    // Also clean up WAL/SHM if present
    for (const ext of ['-wal', '-shm']) {
      const f = TMP_DB + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }

    process.exit(fail === 0 ? 0 : 1);
  } catch (err) {
    console.error('\n[SMOKE TEST ERROR]', err);
    if (db) db.close();
    process.exit(2);
  }
}

main();
