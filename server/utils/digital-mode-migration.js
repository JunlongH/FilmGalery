/**
 * Digital Mode Migration
 *
 * Adds the digital-photo-album data model alongside the existing film schema.
 * Non-destructive: every operation is idempotent (CREATE ... IF NOT EXISTS,
 * ALTER TABLE ADD COLUMN with error-as-result, CREATE INDEX IF NOT EXISTS).
 *
 * Changes:
 *   - New tables: app_config, digital_sessions, albums, album_photos
 *   - photos: 12 new columns (source_type, session_id, content_hash, etc.)
 *   - equip_cameras: 7 new columns (is_digital, sensor_type, etc.)
 *   - 13 new indexes for digital-mode query performance
 *   - Backfill: existing photos → source_type = 'film'
 *
 * See docs/digital-mode-design/03-data-model-and-migration.md
 */

const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');
const { getDbPath } = require('../config/db-config');

function log(msg) {
  const logPath = path.join(path.dirname(getDbPath()), 'digital-mode-migration.log');
  const ts = new Date().toISOString();
  fs.appendFileSync(logPath, `[${ts}] ${msg}\n`);
  console.log(`[DIGITAL-MIGRATION] ${msg}`);
}

/**
 * Run the digital-mode migration.
 * @returns {Promise<void>}
 */
function runDigitalModeMigration(dbPathOverride) {
  return new Promise(async (resolve, reject) => {
    const dbPath = dbPathOverride || getDbPath();
    log(`Starting digital-mode migration on: ${dbPath}`);

    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        log(`Failed to open DB: ${err.message}`);
        return reject(err);
      }
    });

    // Resolve-with-error pattern: used ONLY for ALTER TABLE ADD COLUMN so
    // duplicate-column errors (idempotent re-runs) are swallowed.
    const run = (sql, params = []) => new Promise((res) => {
      db.run(sql, params, function (err) {
        if (err) res(err);
        else res(null);
      });
    });

    // Strict variant: rejects on ANY error. Used for critical operations
    // (CREATE TABLE/INDEX, UPDATE backfill, INSERT seed) where a failure
    // must abort the migration rather than be silently recorded as success.
    const runStrict = (sql, params = []) => new Promise((res, rej) => {
      db.run(sql, params, function (err) {
        if (err) rej(err);
        else res(this);
      });
    });

    const all = (sql, params = []) => new Promise((res, rej) => {
      db.all(sql, params, (err, rows) => {
        if (err) rej(err);
        else res(rows);
      });
    });

    try {
      // ================================================================
      // 1. New Tables
      // ================================================================

      const tables = [
        // app_config — singleton (id=1) for global preferences
        `CREATE TABLE IF NOT EXISTS app_config (
          id INTEGER PRIMARY KEY DEFAULT 1,
          photography_mode TEXT NOT NULL DEFAULT 'all',
          default_import_dir TEXT,
          auto_organize INTEGER NOT NULL DEFAULT 1,
          duplicate_detection INTEGER NOT NULL DEFAULT 1,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT singleton CHECK (id = 1)
        )`,

        // digital_sessions — an import batch or shooting day
        `CREATE TABLE IF NOT EXISTS digital_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          import_batch TEXT NOT NULL,
          session_date DATE,
          camera_id INTEGER,
          label TEXT,
          notes TEXT,
          file_count INTEGER NOT NULL DEFAULT 0,
          total_size_bytes INTEGER DEFAULT 0,
          import_source TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME,
          deleted_at DATETIME,
          FOREIGN KEY (camera_id) REFERENCES equip_cameras(id)
        )`,

        // albums — curated M2M collections (independent from rolls)
        `CREATE TABLE IF NOT EXISTS albums (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT,
          parent_id INTEGER,
          cover_photo_id INTEGER,
          date_start DATE,
          date_end DATE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_smart INTEGER NOT NULL DEFAULT 0,
          smart_rule_json TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME,
          deleted_at DATETIME,
          FOREIGN KEY (parent_id) REFERENCES albums(id),
          FOREIGN KEY (cover_photo_id) REFERENCES photos(id)
        )`,

        // album_photos — junction table for album↔photo M2M
        `CREATE TABLE IF NOT EXISTS album_photos (
          album_id INTEGER NOT NULL,
          photo_id INTEGER NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (album_id, photo_id),
          FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
          FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
        )`,
      ];

      for (const sql of tables) {
        await runStrict(sql);
      }
      log('Tables ensured: app_config, digital_sessions, albums, album_photos.');

      // ================================================================
      // 2. New Columns
      // ================================================================

      const photoColumns = [
        { col: 'source_type', type: 'TEXT' },
        { col: 'session_id', type: 'INTEGER' },
        { col: 'content_hash', type: 'TEXT' },
        { col: 'deleted_at', type: 'TEXT' },
        { col: 'media_type', type: "TEXT DEFAULT 'image'" },
        { col: 'stack_id', type: 'TEXT' },
        { col: 'stack_role', type: "TEXT DEFAULT 'cover'" },
        { col: 'white_balance', type: 'TEXT' },
        { col: 'color_space', type: 'TEXT' },
        { col: 'original_filename', type: 'TEXT' },
        { col: 'develop_params_json', type: 'TEXT' },
        { col: 'scene_id', type: 'TEXT' },
      ];

      const cameraColumns = [
        { col: 'is_digital', type: 'INTEGER NOT NULL DEFAULT 0' },
        { col: 'sensor_type', type: 'TEXT' },
        { col: 'sensor_width_mm', type: 'REAL' },
        { col: 'sensor_height_mm', type: 'REAL' },
        { col: 'megapixels', type: 'REAL' },
        { col: 'crop_factor', type: 'REAL' },
        { col: 'sensor_format', type: 'TEXT' },
      ];

      // equip_lenses.is_digital — three-state:
      //   0 = film-only, 1 = digital-only, NULL = universal (default)
      // NULL default preserves backward compatibility: existing lenses remain
      // visible in both workflows until the user explicitly classifies them.
      const lensColumns = [
        { col: 'is_digital', type: 'INTEGER' },
      ];

      for (const { col, type } of photoColumns) {
        const err = await run(`ALTER TABLE photos ADD COLUMN ${col} ${type}`);
        if (err && !/duplicate column/i.test(err.message)) {
          throw new Error(`Failed adding photos.${col}: ${err.message}`);
        }
      }

      for (const { col, type } of cameraColumns) {
        const err = await run(`ALTER TABLE equip_cameras ADD COLUMN ${col} ${type}`);
        if (err && !/duplicate column/i.test(err.message)) {
          throw new Error(`Failed adding equip_cameras.${col}: ${err.message}`);
        }
      }

      for (const { col, type } of lensColumns) {
        const err = await run(`ALTER TABLE equip_lenses ADD COLUMN ${col} ${type}`);
        if (err && !/duplicate column/i.test(err.message)) {
          throw new Error(`Failed adding equip_lenses.${col}: ${err.message}`);
        }
      }

      // app_config — columns added after initial release (frontend expects these
      // for onboarding + sidebar section visibility). photography_mode is kept
      // for backward compat; default_source_filter is the frontend-canonical field.
      const appConfigColumns = [
        { col: 'onboarding_completed', type: 'INTEGER NOT NULL DEFAULT 0' },
        { col: 'default_source_filter', type: "TEXT NOT NULL DEFAULT 'all'" },
        { col: 'show_film_section', type: 'INTEGER NOT NULL DEFAULT 1' },
        { col: 'show_digital_section', type: 'INTEGER NOT NULL DEFAULT 1' },
        { col: 'digital_enabled', type: 'INTEGER NOT NULL DEFAULT 1' },
      ];
      for (const { col, type } of appConfigColumns) {
        const err = await run(`ALTER TABLE app_config ADD COLUMN ${col} ${type}`);
        if (err && !/duplicate column/i.test(err.message)) {
          throw new Error(`Failed adding app_config.${col}: ${err.message}`);
        }
      }
      log('Columns ensured: photos (+12), equip_cameras (+7), equip_lenses (+1), app_config (+5).');

      // ================================================================
      // 3. Indexes
      // ================================================================

      const indexes = [
        // photos indexes
        `CREATE INDEX IF NOT EXISTS idx_photos_source_type ON photos(source_type)`,
        `CREATE INDEX IF NOT EXISTS idx_photos_session ON photos(session_id)`,
        `CREATE INDEX IF NOT EXISTS idx_photos_content_hash ON photos(content_hash)`,
        `CREATE INDEX IF NOT EXISTS idx_photos_deleted ON photos(deleted_at)`,
        `CREATE INDEX IF NOT EXISTS idx_photos_scene ON photos(scene_id)`,
        // digital_sessions indexes
        `CREATE INDEX IF NOT EXISTS idx_digital_sessions_import_batch ON digital_sessions(import_batch)`,
        `CREATE INDEX IF NOT EXISTS idx_digital_sessions_date ON digital_sessions(session_date)`,
        `CREATE INDEX IF NOT EXISTS idx_digital_sessions_deleted ON digital_sessions(deleted_at)`,
        // albums indexes
        `CREATE INDEX IF NOT EXISTS idx_albums_parent ON albums(parent_id)`,
        `CREATE INDEX IF NOT EXISTS idx_albums_deleted ON albums(deleted_at)`,
        `CREATE INDEX IF NOT EXISTS idx_albums_date_start ON albums(date_start)`,
        // album_photos indexes
        `CREATE INDEX IF NOT EXISTS idx_album_photos_photo ON album_photos(photo_id)`,
        `CREATE INDEX IF NOT EXISTS idx_album_photos_album_sort ON album_photos(album_id, sort_order)`,
      ];

      for (const idx of indexes) {
        await runStrict(idx);
      }
      log(`Indexes ensured: ${indexes.length} indexes.`);

      // ================================================================
      // 4. Backfill: source_type = 'film' for all existing photos
      // ================================================================

      // Backfill is critical: failure leaves photos with NULL source_type,
      // which would silently break film-mode filtering. Abort the migration
      // (so it is NOT recorded as successful and retries on next startup)
      // rather than recording a false success.
      await runStrict(
        `UPDATE photos SET source_type = 'film' WHERE source_type IS NULL`
      );
      const remaining = await all(
        `SELECT COUNT(*) as cnt FROM photos WHERE source_type IS NULL`
      );
      if (remaining[0].cnt > 0) {
        throw new Error(
          `Backfill incomplete: ${remaining[0].cnt} photos still have NULL source_type`
        );
      }
      log('Backfill complete. 0 NULL source_type remaining.');

      // ================================================================
      // 5. Seed app_config singleton (id=1) if absent
      // ================================================================

      await runStrict(
        `INSERT OR IGNORE INTO app_config (id, photography_mode) VALUES (1, 'all')`
      );
      log('app_config singleton ensured (id=1).');

      log('Digital-mode migration completed.');
      db.close();
      resolve();
    } catch (err) {
      log(`Migration error: ${err.message}`);
      db.close();
      reject(err);
    }
  });
}

module.exports = { runDigitalModeMigration };
