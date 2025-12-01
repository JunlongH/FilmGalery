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
          params TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
        )`
      ];

      for (const sql of tables) {
        await run(sql);
      }

      // 2. Ensure Columns
      const columns = [
        // Rolls - Basic
        { table: 'rolls', col: 'cover_photo', type: 'TEXT' },
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

        // Photos - Paths
        { table: 'photos', col: 'original_rel_path', type: 'TEXT' },
        { table: 'photos', col: 'positive_rel_path', type: 'TEXT' },
        { table: 'photos', col: 'full_rel_path', type: 'TEXT' },
        { table: 'photos', col: 'negative_rel_path', type: 'TEXT' },
        { table: 'photos', col: 'thumb_rel_path', type: 'TEXT' },
        { table: 'photos', col: 'positive_thumb_rel_path', type: 'TEXT' },
        { table: 'photos', col: 'negative_thumb_rel_path', type: 'TEXT' },
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

        // Films
        { table: 'films', col: 'category', type: 'TEXT' },
        { table: 'films', col: 'thumbPath', type: 'TEXT' },
        { table: 'films', col: 'updatedAt', type: 'DATETIME' }
      ];

      for (const { table, col, type } of columns) {
        await run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      }

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
