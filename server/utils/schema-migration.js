const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');
const { getDbPath } = require('../config/db-config');
const { rollsDir } = require('../config/paths');

function log(msg) {
  const logPath = path.join(path.dirname(getDbPath()), 'schema-migration.log');
  const ts = new Date().toISOString();
  fs.appendFileSync(logPath, `[${ts}] ${msg}\n`);
  console.log(`[SCHEMA] ${msg}`);
}

function runSchemaMigration() {
  return new Promise(async (resolve, reject) => {
    const dbPath = getDbPath();
    log(`Starting schema migration on: ${dbPath}`);
    
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        log(`Failed to open DB: ${err.message}`);
        return reject(err);
      }
    });

    const run = (sql, params = []) => new Promise((res, rej) => {
      db.run(sql, params, function(err) {
        if (err) res(err); // Resolve with error to avoid crashing, just log it
        else res(null);
      });
    });

    const all = (sql, params = []) => new Promise((res, rej) => {
      db.all(sql, params, (err, rows) => {
        if (err) rej(err);
        else res(rows);
      });
    });

    try {
      // 1. Ensure Tables
      const tables = [
        `CREATE TABLE IF NOT EXISTS films (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          iso INTEGER,
          format TEXT,
          type TEXT,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS rolls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          film_id INTEGER,
          camera_id INTEGER,
          date_loaded DATE,
          date_finished DATE,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(film_id) REFERENCES films(id)
        )`,
        `CREATE TABLE IF NOT EXISTS photos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          roll_id INTEGER,
          filename TEXT NOT NULL,
          path TEXT,
          aperture REAL,
          shutter_speed TEXT,
          iso INTEGER,
          focal_length REAL,
          rating INTEGER DEFAULT 0,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(roll_id) REFERENCES rolls(id)
        )`,
        `CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS photo_tags (
          photo_id INTEGER,
          tag_id INTEGER,
          PRIMARY KEY (photo_id, tag_id),
          FOREIGN KEY(photo_id) REFERENCES photos(id),
          FOREIGN KEY(tag_id) REFERENCES tags(id)
        )`,
        `CREATE TABLE IF NOT EXISTS presets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          category TEXT,
          description TEXT,
          params TEXT,
          params_json TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME
        )`,
        `CREATE TABLE IF NOT EXISTS roll_gear (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          roll_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          value TEXT NOT NULL,
          UNIQUE(roll_id, type, value),
          FOREIGN KEY(roll_id) REFERENCES rolls(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS locations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          country_code TEXT,
          country_name TEXT,
          city_name TEXT,
          city_lat REAL,
          city_lng REAL,
          UNIQUE(country_code, city_name)
        )`,
        `CREATE TABLE IF NOT EXISTS roll_locations (
          roll_id INTEGER,
          location_id INTEGER,
          PRIMARY KEY(roll_id, location_id),
          FOREIGN KEY(roll_id) REFERENCES rolls(id),
          FOREIGN KEY(location_id) REFERENCES locations(id)
        )`,
        // Film items (inventory). Columns defined here are the single source
        // of truth — the legacy standalone migration scripts have been removed
        // (consolidated into this file by 2C.1).
        `CREATE TABLE IF NOT EXISTS film_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          film_id INTEGER NOT NULL,
          roll_id INTEGER,
          status TEXT NOT NULL DEFAULT 'in_stock',
          label TEXT,
          purchase_channel TEXT,
          purchase_vendor TEXT,
          purchase_order_id TEXT,
          purchase_price REAL,
          purchase_currency TEXT,
          purchase_date TEXT,
          expiry_date TEXT,
          batch_number TEXT,
          purchase_shipping_share REAL,
          purchase_note TEXT,
          develop_lab TEXT,
          develop_process TEXT,
          develop_price REAL,
          develop_shipping REAL,
          develop_date TEXT,
          develop_channel TEXT,
          develop_note TEXT,
          loaded_camera TEXT,
          loaded_at TEXT,
          loaded_date TEXT,
          finished_date TEXT,
          shot_at TEXT,
          sent_to_lab_at TEXT,
          developed_at TEXT,
          scan_date TEXT,
          archived_at TEXT,
          negative_archived INTEGER DEFAULT 0,
          shot_logs TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME,
          deleted_at DATETIME,
          FOREIGN KEY(film_id) REFERENCES films(id),
          FOREIGN KEY(roll_id) REFERENCES rolls(id)
        )`
      ];

      for (const sql of tables) {
        await run(sql);
      }

      // 1b. Columns added BEFORE indexes (2C bug found by migration test).
      // Previously indexes ran before columns, so any index referencing an
      // ALTER-added column (date_taken, location_id, rating-related, etc.)
      // silently failed — the `run` helper resolves with err to keep going.
      // Moving indexes after columns guarantees all referenced columns exist.
      const columns = [
        // Rolls - Basic
        { table: 'rolls', col: 'cover_photo', type: 'TEXT' },
        { table: 'rolls', col: 'coverPath', type: 'TEXT' },
        { table: 'rolls', col: 'folderName', type: 'TEXT' },
        { table: 'rolls', col: 'title', type: 'TEXT' },
        { table: 'rolls', col: 'start_date', type: 'DATE' },
        { table: 'rolls', col: 'end_date', type: 'DATE' },
        { table: 'rolls', col: 'camera', type: 'TEXT' },
        { table: 'rolls', col: 'lens', type: 'TEXT' },
        { table: 'rolls', col: 'photographer', type: 'TEXT' },
        { table: 'rolls', col: 'filmId', type: 'INTEGER' },
        { table: 'rolls', col: 'film_type', type: 'TEXT' },
        { table: 'rolls', col: 'exposures', type: 'INTEGER' },
        { table: 'rolls', col: 'iso', type: 'INTEGER' },
        { table: 'rolls', col: 'preset_json', type: 'TEXT' },
        // Rolls - Costs & Dev
        { table: 'rolls', col: 'purchase_cost', type: 'REAL' },
        { table: 'rolls', col: 'develop_cost', type: 'REAL' },
        { table: 'rolls', col: 'develop_date', type: 'DATE' },
        { table: 'rolls', col: 'develop_lab', type: 'TEXT' },
        { table: 'rolls', col: 'develop_process', type: 'TEXT' },
        { table: 'rolls', col: 'develop_note', type: 'TEXT' },
        { table: 'rolls', col: 'purchase_channel', type: 'TEXT' },
        { table: 'rolls', col: 'batch_number', type: 'TEXT' },
        // Rolls - link to film_items inventory
        { table: 'rolls', col: 'film_item_id', type: 'INTEGER' },
        
        // Missing columns added 2026-01-18
        { table: 'rolls', col: 'display_seq', type: 'INTEGER DEFAULT 0' },
        { table: 'rolls', col: 'camera_equip_id', type: 'INTEGER' },
        { table: 'rolls', col: 'lens_equip_id', type: 'INTEGER' },
        { table: 'rolls', col: 'flash_equip_id', type: 'INTEGER' },
        { table: 'rolls', col: 'film_back_equip_id', type: 'INTEGER' },
        { table: 'rolls', col: 'scanner_equip_id', type: 'INTEGER' },
        { table: 'rolls', col: 'scan_resolution', type: 'INTEGER' },
        { table: 'rolls', col: 'scan_software', type: 'TEXT' },
        { table: 'rolls', col: 'scan_lab', type: 'TEXT' },
        { table: 'rolls', col: 'scan_date', type: 'DATE' },
        { table: 'rolls', col: 'scan_cost', type: 'REAL' },
        { table: 'rolls', col: 'scan_notes', type: 'TEXT' },
        { table: 'rolls', col: 'format', type: 'TEXT' },

        // Film Items - usage tracking
        { table: 'film_items', col: 'negative_archived', type: 'INTEGER DEFAULT 0' },
        { table: 'film_items', col: 'loaded_date', type: 'TEXT' },
        { table: 'film_items', col: 'finished_date', type: 'TEXT' },
        { table: 'film_items', col: 'shot_logs', type: 'TEXT' },
        { table: 'film_items', col: 'scan_date', type: 'TEXT' },

        // Photos - Paths
        { table: 'photos', col: 'original_rel_path', type: 'TEXT' },
        { table: 'photos', col: 'positive_rel_path', type: 'TEXT' },
        { table: 'photos', col: 'full_rel_path', type: 'TEXT' },
        { table: 'photos', col: 'negative_rel_path', type: 'TEXT' },
        { table: 'photos', col: 'thumb_rel_path', type: 'TEXT' },
        { table: 'photos', col: 'positive_thumb_rel_path', type: 'TEXT' },
        { table: 'photos', col: 'negative_thumb_rel_path', type: 'TEXT' },
        { table: 'photos', col: 'is_negative_source', type: 'INTEGER DEFAULT 0' },
        { table: 'photos', col: 'positive_source', type: 'TEXT DEFAULT NULL' },
        // Photos - Metadata
        { table: 'photos', col: 'display_seq', type: 'INTEGER DEFAULT 0' },
        { table: 'photos', col: 'photographer', type: 'TEXT' },
        { table: 'photos', col: 'location_id', type: 'INTEGER' },
        { table: 'photos', col: 'date_taken', type: 'DATE' },
        { table: 'photos', col: 'time_taken', type: 'TIME' },
        { table: 'photos', col: 'detail_location', type: 'TEXT' },
        { table: 'photos', col: 'latitude', type: 'REAL' },
        { table: 'photos', col: 'longitude', type: 'REAL' },
        { table: 'photos', col: 'frame_number', type: 'INTEGER' },
        { table: 'photos', col: 'caption', type: 'TEXT' },
        { table: 'photos', col: 'taken_at', type: 'DATETIME' },
        { table: 'photos', col: 'camera', type: 'TEXT' },
        { table: 'photos', col: 'lens', type: 'TEXT' },
        // Photos - Exposure/EXIF (added 2026-01-27)
        { table: 'photos', col: 'aperture', type: 'REAL' },
        { table: 'photos', col: 'shutter_speed', type: 'TEXT' },
        { table: 'photos', col: 'iso', type: 'INTEGER' },
        { table: 'photos', col: 'focal_length', type: 'REAL' },
        // Photos - Equipment IDs
        { table: 'photos', col: 'camera_equip_id', type: 'INTEGER' },
        { table: 'photos', col: 'lens_equip_id', type: 'INTEGER' },
        { table: 'photos', col: 'flash_equip_id', type: 'INTEGER' },
        { table: 'photos', col: 'scanner_equip_id', type: 'INTEGER' },
        // Photos - Scan info
        { table: 'photos', col: 'scan_resolution', type: 'INTEGER' },
        { table: 'photos', col: 'scan_software', type: 'TEXT' },
        { table: 'photos', col: 'scan_lab', type: 'TEXT' },
        { table: 'photos', col: 'scan_date', type: 'DATE' },
        { table: 'photos', col: 'scan_cost', type: 'REAL' },
        { table: 'photos', col: 'scan_notes', type: 'TEXT' },
        // Photos - Location
        { table: 'photos', col: 'altitude', type: 'REAL' },
        { table: 'photos', col: 'location_name', type: 'TEXT' },
        { table: 'photos', col: 'country', type: 'TEXT' },
        { table: 'photos', col: 'city', type: 'TEXT' },
        // Photos - Timestamps
        { table: 'photos', col: 'updated_at', type: 'DATETIME' },

        // Films
        { table: 'films', col: 'category', type: 'TEXT' },
        { table: 'films', col: 'thumbPath', type: 'TEXT' },
        { table: 'films', col: 'updatedAt', type: 'DATETIME' },
        
        // Presets
        { table: 'presets', col: 'category', type: 'TEXT' },
        { table: 'presets', col: 'description', type: 'TEXT' },
        { table: 'presets', col: 'params', type: 'TEXT' },
        { table: 'presets', col: 'params_json', type: 'TEXT' },
        { table: 'presets', col: 'updated_at', type: 'DATETIME' }
      ];

      for (const { table, col, type } of columns) {
        await run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      }

      // 2b. Indexes created AFTER columns (2C bug fix).
      // Any index referencing an ALTER-added column now finds the column
      // present. CREATE INDEX IF NOT EXISTS keeps this idempotent across
      // re-runs. The `run` helper still swallows errors so an unexpected
      // schema drift doesn't abort the whole migration.
      const indexes = [
        // Photo indexes
        `CREATE INDEX IF NOT EXISTS idx_photos_roll ON photos(roll_id)`,
        `CREATE INDEX IF NOT EXISTS idx_photos_date_taken ON photos(date_taken)`,
        `CREATE INDEX IF NOT EXISTS idx_photos_rating ON photos(rating)`,
        `CREATE INDEX IF NOT EXISTS idx_photo_tags_photo ON photo_tags(photo_id)`,
        `CREATE INDEX IF NOT EXISTS idx_photo_tags_tag ON photo_tags(tag_id)`,
        // Roll indexes
        `CREATE INDEX IF NOT EXISTS idx_rolls_start ON rolls(start_date)`,
        `CREATE INDEX IF NOT EXISTS idx_rolls_end ON rolls(end_date)`,
        `CREATE INDEX IF NOT EXISTS idx_rolls_film ON rolls(filmId)`,
        // Film items indexes (for inventory queries)
        `CREATE INDEX IF NOT EXISTS idx_film_items_roll_id ON film_items(roll_id)`,
        `CREATE INDEX IF NOT EXISTS idx_film_items_status ON film_items(status)`,
        `CREATE INDEX IF NOT EXISTS idx_film_items_film_id ON film_items(film_id)`,
        `CREATE INDEX IF NOT EXISTS idx_film_items_deleted ON film_items(deleted_at)`,
        // Compound indexes for common filters/orderings
        `CREATE INDEX IF NOT EXISTS idx_photos_date_id ON photos(date_taken, id)`,
        `CREATE INDEX IF NOT EXISTS idx_photos_roll_date_id ON photos(roll_id, date_taken, id)`,
        `CREATE INDEX IF NOT EXISTS idx_photos_rating_id ON photos(rating, id)`,
        // Location filter (added 2026-02-15; previously missing — 2C.1.2)
        `CREATE INDEX IF NOT EXISTS idx_photos_location ON photos(location_id)`,
        // Film items compound index for status queries
        `CREATE INDEX IF NOT EXISTS idx_film_items_status_deleted ON film_items(status, deleted_at)`
      ];
      for (const idx of indexes) { await run(idx); }

      // 3. Data Fixes
      await run(`UPDATE rolls SET filmId = film_id WHERE filmId IS NULL AND film_id IS NOT NULL`);
      await run(`UPDATE rolls SET start_date = date_loaded WHERE start_date IS NULL AND date_loaded IS NOT NULL`);
      await run(`UPDATE rolls SET end_date = date_finished WHERE end_date IS NULL AND date_finished IS NOT NULL`);

      // Fix: Initialize display_seq
      const photos = await all("SELECT id, roll_id FROM photos WHERE display_seq = 0 OR display_seq IS NULL ORDER BY roll_id, filename");
      if (photos.length > 0) {
        let currentRoll = -1;
        let seq = 0;
        await run("BEGIN TRANSACTION");
        for (const r of photos) {
            if (r.roll_id !== currentRoll) { currentRoll = r.roll_id; seq = 0; }
            seq++;
            await run("UPDATE photos SET display_seq = ? WHERE id = ?", [seq, r.id]);
        }
        await run("COMMIT");
        log(`Updated display_seq for ${photos.length} photos`);
      }

      // Fix: Migrate Gear
      log("Starting Gear Migration...");
      const rolls = await all("SELECT id, camera, lens, photographer FROM rolls");
      log(`Found ${rolls.length} rolls to check.`);
      
      const gearRows = await all("SELECT roll_id, type, value FROM roll_gear");
      const existingGear = new Set();
      gearRows.forEach(g => existingGear.add(`${g.roll_id}|${g.type}|${g.value}`));

      let migratedCount = 0;
      await run("BEGIN TRANSACTION");
      for (const row of rolls) {
          if (row.camera && !existingGear.has(`${row.id}|camera|${row.camera}`)) {
              await run("INSERT INTO roll_gear (roll_id, type, value) VALUES (?, ?, ?)", [row.id, 'camera', row.camera]);
              existingGear.add(`${row.id}|camera|${row.camera}`);
              migratedCount++;
          }
          if (row.lens && !existingGear.has(`${row.id}|lens|${row.lens}`)) {
              await run("INSERT INTO roll_gear (roll_id, type, value) VALUES (?, ?, ?)", [row.id, 'lens', row.lens]);
              existingGear.add(`${row.id}|lens|${row.lens}`);
              migratedCount++;
          }
          if (row.photographer && !existingGear.has(`${row.id}|photographer|${row.photographer}`)) {
              await run("INSERT INTO roll_gear (roll_id, type, value) VALUES (?, ?, ?)", [row.id, 'photographer', row.photographer]);
              existingGear.add(`${row.id}|photographer|${row.photographer}`);
              migratedCount++;
          }
      }
      await run("COMMIT");
      log(`Migrated ${migratedCount} gear items.`);

      // Fix: Ensure folderName
      await run(`UPDATE rolls SET folderName = CAST(id AS TEXT) WHERE folderName IS NULL OR folderName = ''`);

      // Migrate old presets.params to presets.params_json
      log("Checking presets migration...");
      try {
        const oldPresets = await all("SELECT id, params FROM presets WHERE params IS NOT NULL AND params_json IS NULL");
        if (oldPresets.length > 0) {
          log(`Migrating ${oldPresets.length} presets from params to params_json`);
          for (const p of oldPresets) {
            await run("UPDATE presets SET params_json = ? WHERE id = ?", [p.params, p.id]);
          }
        }
      } catch (e) {
        // Column doesn't exist or other error, ignore
        log(`Presets migration note: ${e.message}`);
      }

      // ========================================
      // Fix: Repair Fixed Lens Camera Data (2026-01-24)
      // ========================================
      // Standardize lens text format for PS cameras: "Brand Model Xmm f/Y"
      await repairFixedLensData(run, all, log);

      // ========================================
      // Backfill: original_rel_path + is_negative_source (2026-02-08)
      // ========================================
      // Photos added via single-upload (uploadSinglePhoto) had NULL
      // original_rel_path. Re-derive from roll_id + frame_number by scanning
      // the originals/ directory. Idempotent: only touches NULL rows.
      await backfillOriginalRelPath(run, all, log);

      // Seed default presets if none exist
      await seedDefaultPresets(run, all, log);

      log('Schema migration completed.');
      db.close();
      resolve();

    } catch (err) {
      log(`Migration error: ${err.message}`);
      db.close();
      reject(err);
    }
  });
}

module.exports = { runSchemaMigration };

// ============================================================================
// original_rel_path Backfill (2026-02-08, consolidated into schema-migration 2C.1)
// ============================================================================
// Photos added via uploadSinglePhoto left original_rel_path NULL. Re-derive
// by scanning rolls/<id>/originals/ for the file matching {rollId}_{frame}_original*.
// Also fixes is_negative_source NULLs by inferring from negative_rel_path.
// Idempotent — only touches rows where the target column IS NULL.
// ============================================================================
async function backfillOriginalRelPath(run, all, log) {
  try {
    const nullOriginals = await all(
      `SELECT id, roll_id, frame_number FROM photos WHERE original_rel_path IS NULL`
    );
    if (nullOriginals.length === 0) {
      log('original_rel_path backfill: nothing to do.');
      return;
    }
    log(`original_rel_path backfill: scanning ${nullOriginals.length} photos.`);

    let updated = 0;
    let skipped = 0;
    for (const photo of nullOriginals) {
      const frame = String(photo.frame_number).padStart(2, '0');
      const originalsDir = path.join(rollsDir, String(photo.roll_id), 'originals');
      if (!fs.existsSync(originalsDir)) { skipped++; continue; }

      const prefix = `${photo.roll_id}_${frame}_original`;
      let match = null;
      try {
        match = fs.readdirSync(originalsDir).find(f => f.startsWith(prefix));
      } catch { /* unreadable dir — skip */ }

      if (match) {
        const relPath = `rolls/${photo.roll_id}/originals/${match}`;
        await run('UPDATE photos SET original_rel_path = ? WHERE id = ?', [relPath, photo.id]);
        updated++;
      } else {
        skipped++;
      }
    }
    log(`original_rel_path backfill: ${updated} updated, ${skipped} skipped (no file on disk).`);

    // Infer is_negative_source from negative_rel_path where NULL.
    // Note: the `run` helper in this module resolves with null on success
    // (it discards `this.changes`); we log presence only.
    await run(`
      UPDATE photos
      SET is_negative_source = CASE
        WHEN negative_rel_path IS NOT NULL THEN 1
        ELSE 0
      END
      WHERE is_negative_source IS NULL
    `);
    log('is_negative_source NULLs inferred.');
  } catch (e) {
    log(`original_rel_path backfill note: ${e.message}`);
    // Non-fatal — don't crash migration over a backfill.
  }
}

// ============================================================================
// Default FilmLab Presets (seeded on first run)
// ============================================================================
async function seedDefaultPresets(run, all, log) {
  try {
    const existing = await all("SELECT COUNT(*) as cnt FROM presets");
    if (existing[0].cnt > 0) {
      log(`Presets table already has ${existing[0].cnt} presets, skipping seed.`);
      return;
    }
  } catch (e) {
    log(`Cannot check presets count: ${e.message}`);
    return;
  }

  log("Seeding default FilmLab presets...");

  // Base params template (neutral starting point for positive film)
  const basePositiveParams = {
    inverted: false,
    inversionMode: 'linear',
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temp: 0,
    tint: 0,
    red: 1,
    green: 1,
    blue: 1,
    saturation: 0,
    baseMode: 'linear',
    baseRed: 1, baseGreen: 1, baseBlue: 1,
    baseDensityR: 0, baseDensityG: 0, baseDensityB: 0,
    curves: {
      rgb: [{x:0,y:0},{x:255,y:255}],
      red: [{x:0,y:0},{x:255,y:255}],
      green: [{x:0,y:0},{x:255,y:255}],
      blue: [{x:0,y:0},{x:255,y:255}]
    },
    hslParams: {
      hue: { red: 0, orange: 0, yellow: 0, green: 0, cyan: 0, blue: 0, purple: 0, magenta: 0 },
      saturation: { red: 0, orange: 0, yellow: 0, green: 0, cyan: 0, blue: 0, purple: 0, magenta: 0 },
      luminance: { red: 0, orange: 0, yellow: 0, green: 0, cyan: 0, blue: 0, purple: 0, magenta: 0 }
    },
    splitToning: {
      highlights: { hue: 30, saturation: 0 },
      midtones:   { hue: 0,  saturation: 0 },
      shadows:    { hue: 220, saturation: 0 },
      balance: 0
    },
    filmCurveEnabled: false,
    filmCurveProfile: 'default',
    lut1: null,
    lut2: null
  };

  const defaultPresets = [
    {
      name: 'Neutral',
      category: 'positive',
      description: 'No adjustments - clean starting point',
      params: { ...basePositiveParams }
    },
    {
      name: 'Vivid Colors',
      category: 'positive',
      description: 'Enhanced saturation and contrast for vibrant images',
      params: {
        ...basePositiveParams,
        contrast: 15,
        highlights: -10,
        shadows: 10,
        hslParams: {
          ...basePositiveParams.hslParams,
          saturation: { red: 15, orange: 20, yellow: 15, green: 15, cyan: 10, blue: 20, purple: 15, magenta: 10 }
        }
      }
    },
    {
      name: 'Soft Portrait',
      category: 'positive',
      description: 'Flattering skin tones with soft contrast',
      params: {
        ...basePositiveParams,
        contrast: -10,
        highlights: -15,
        shadows: 15,
        temp: 8,
        hslParams: {
          ...basePositiveParams.hslParams,
          saturation: { red: -10, orange: -5, yellow: 0, green: 0, aqua: 0, blue: 0, purple: 0, magenta: 0 },
          luminance: { red: 5, orange: 10, yellow: 0, green: 0, aqua: 0, blue: 0, purple: 0, magenta: 0 }
        }
      }
    },
    {
      name: 'Warm Sunset',
      category: 'positive',
      description: 'Warm golden hour tones',
      params: {
        ...basePositiveParams,
        temp: 25,
        tint: 5,
        contrast: 10,
        highlights: -20,
        shadows: 5,
        splitToning: {
          highlights: { hue: 45, saturation: 20 },
          midtones:   { hue: 0,  saturation: 0 },
          shadows:    { hue: 30, saturation: 15 },
          balance: 10
        }
      }
    },
    {
      name: 'Cool Blue Hour',
      category: 'positive',
      description: 'Cool blue tones for twilight scenes',
      params: {
        ...basePositiveParams,
        temp: -20,
        tint: -5,
        contrast: 5,
        blacks: 5,
        splitToning: {
          highlights: { hue: 210, saturation: 15 },
          midtones:   { hue: 0,   saturation: 0 },
          shadows:    { hue: 240, saturation: 20 },
          balance: -10
        }
      }
    },
    {
      name: 'Classic Film Look',
      category: 'positive',
      description: 'Lifted blacks and faded highlights for vintage feel',
      params: {
        ...basePositiveParams,
        contrast: -5,
        blacks: -15,
        highlights: -10,
        curves: {
          rgb: [{x:0,y:20},{x:30,y:40},{x:225,y:235},{x:255,y:245}],
          red: [{x:0,y:0},{x:255,y:255}],
          green: [{x:0,y:0},{x:255,y:255}],
          blue: [{x:0,y:5},{x:255,y:250}]
        }
      }
    },
    {
      name: 'High Contrast B&W',
      category: 'positive',
      description: 'Desaturated with punchy contrast',
      params: {
        ...basePositiveParams,
        contrast: 30,
        highlights: -10,
        shadows: -10,
        whites: 10,
        blacks: 10,
        hslParams: {
          ...basePositiveParams.hslParams,
          saturation: { red: -100, orange: -100, yellow: -100, green: -100, cyan: -100, blue: -100, purple: -100, magenta: -100 }
        }
      }
    },
    {
      name: 'Matte Film',
      category: 'positive',
      description: 'Modern matte look with lifted shadows',
      params: {
        ...basePositiveParams,
        contrast: 5,
        blacks: -20,
        shadows: 15,
        curves: {
          rgb: [{x:0,y:25},{x:60,y:70},{x:255,y:255}],
          red: [{x:0,y:0},{x:255,y:255}],
          green: [{x:0,y:0},{x:255,y:255}],
          blue: [{x:0,y:0},{x:255,y:255}]
        }
      }
    },
    {
      name: 'Cross Process',
      category: 'positive',
      description: 'Cross-processed color shift effect',
      params: {
        ...basePositiveParams,
        contrast: 15,
        curves: {
          rgb: [{x:0,y:0},{x:255,y:255}],
          red: [{x:0,y:10},{x:128,y:140},{x:255,y:245}],
          green: [{x:0,y:0},{x:128,y:128},{x:255,y:255}],
          blue: [{x:0,y:20},{x:128,y:115},{x:255,y:235}]
        },
        hslParams: {
          ...basePositiveParams.hslParams,
          saturation: { red: 10, orange: 5, yellow: 10, green: -10, cyan: 15, blue: 20, purple: 5, magenta: 0 }
        }
      }
    },
    {
      name: 'Cinematic Teal & Orange',
      category: 'positive',
      description: 'Hollywood-style color grading',
      params: {
        ...basePositiveParams,
        contrast: 10,
        highlights: -5,
        shadows: 5,
        splitToning: {
          highlights: { hue: 40, saturation: 25 },
          midtones:   { hue: 0,  saturation: 0 },
          shadows:    { hue: 200, saturation: 30 },
          balance: 0
        },
        hslParams: {
          ...basePositiveParams.hslParams,
          hue: { red: 0, orange: -5, yellow: 0, green: 0, cyan: 10, blue: 5, purple: 0, magenta: 0 },
          saturation: { red: 0, orange: 15, yellow: 0, green: -20, cyan: 20, blue: 15, purple: 0, magenta: 0 }
        }
      }
    }
  ];

  for (const preset of defaultPresets) {
    try {
      const paramsJson = JSON.stringify(preset.params);
      // Write to both params and params_json for compatibility with old schema
      await run(
        "INSERT INTO presets (name, category, description, params, params_json) VALUES (?, ?, ?, ?, ?)",
        [preset.name, preset.category, preset.description, paramsJson, paramsJson]
      );
      log(`  Created preset: ${preset.name}`);
    } catch (e) {
      log(`  Failed to create preset ${preset.name}: ${e.message}`);
    }
  }

  log(`Seeded ${defaultPresets.length} default presets.`);
}

// ============================================================================
// Fixed Lens Camera Data Repair (2026-01-24)
// ============================================================================
// Standardizes lens text format for PS (Point & Shoot) cameras to:
// "Brand Model Xmm f/Y" (e.g., "Konica bigmini 201 35mm f/3.5")
// ============================================================================
async function repairFixedLensData(run, all, log) {
  log('Checking fixed-lens camera data consistency...');

  try {
    // Find all rolls with fixed-lens cameras
    const affectedRolls = await all(`
      SELECT 
        r.id as roll_id,
        r.lens as current_lens,
        c.brand,
        c.model,
        c.fixed_lens_focal_length,
        c.fixed_lens_max_aperture
      FROM rolls r
      JOIN equip_cameras c ON r.camera_equip_id = c.id
      WHERE c.has_fixed_lens = 1
    `);

    if (affectedRolls.length === 0) {
      log('No fixed-lens camera rolls found.');
      return;
    }

    let repaired = 0;
    let gearCleaned = 0;

    for (const roll of affectedRolls) {
      // Build expected lens description: "Brand Model Xmm f/Y"
      const focal = roll.fixed_lens_focal_length;
      const aperture = roll.fixed_lens_max_aperture;
      
      if (!focal) continue;
      
      const lensSpec = aperture ? `${focal}mm f/${aperture}` : `${focal}mm`;
      const cameraPrefix = [roll.brand, roll.model].filter(Boolean).join(' ').trim();
      const expectedLens = cameraPrefix ? `${cameraPrefix} ${lensSpec}` : lensSpec;

      // Update rolls.lens if needed
      if (roll.current_lens !== expectedLens) {
        await run('UPDATE rolls SET lens = ? WHERE id = ?', [expectedLens, roll.roll_id]);
        repaired++;
      }

      // Clean up roll_gear: remove fragmented entries, ensure canonical exists
      const existingGear = await all(
        'SELECT id, value FROM roll_gear WHERE roll_id = ? AND type = ?',
        [roll.roll_id, 'lens']
      );

      let hasCanonical = false;

      for (const gear of existingGear) {
        if (gear.value === expectedLens) {
          hasCanonical = true;
          continue;
        }

        // Check if this is a partial lens spec that should be removed
        const isPartial = (
          expectedLens.toLowerCase().includes(gear.value.toLowerCase()) ||
          /^\d+mm\s*(f\/[\d.]+)?$/i.test(gear.value)
        );

        if (isPartial) {
          await run('DELETE FROM roll_gear WHERE id = ?', [gear.id]);
          gearCleaned++;
        }
      }

      // Ensure canonical lens exists
      if (!hasCanonical) {
        await run(
          'INSERT OR IGNORE INTO roll_gear (roll_id, type, value) VALUES (?, ?, ?)',
          [roll.roll_id, 'lens', expectedLens]
        );
      }
    }

    if (repaired > 0 || gearCleaned > 0) {
      log(`Fixed-lens data repair: ${repaired} rolls updated, ${gearCleaned} gear entries cleaned.`);
    } else {
      log('All fixed-lens data is already consistent.');
    }

  } catch (e) {
    log(`Fixed-lens data repair note: ${e.message}`);
    // Non-fatal - don't throw, just log
  }
}
