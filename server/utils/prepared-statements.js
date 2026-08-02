// Prepared statements cache for SQLite3
// Centralizes frequently-used queries for better performance and maintainability

const db = require('../db');

// Statement cache with lazy initialization
const stmtCache = new Map();

// Statement registry - defines all prepared statements upfront
const STATEMENTS = {
  // Film Items
  'film_items.getById': 'SELECT * FROM film_items WHERE id = ? LIMIT 1',
  'film_items.getByRollId': 'SELECT * FROM film_items WHERE roll_id = ? AND deleted_at IS NULL',
  'film_items.listActive': 'SELECT * FROM film_items WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?',
  'film_items.listByStatus': 'SELECT * FROM film_items WHERE status = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?',
  'film_items.updateStatus': 'UPDATE film_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  'film_items.softDelete': 'UPDATE film_items SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL',
  'film_items.hardDelete': 'DELETE FROM film_items WHERE id = ?',
  
  // Rolls
  'rolls.getById': 'SELECT * FROM rolls WHERE id = ?',
  'rolls.getByFilmItemId': 'SELECT * FROM rolls WHERE film_item_id = ?',
  'rolls.listAll': 'SELECT * FROM rolls ORDER BY display_seq DESC, start_date DESC LIMIT ? OFFSET ?',
  'rolls.updateCover': 'UPDATE rolls SET cover_photo = ? WHERE id = ?',
  'rolls.countPhotos': 'SELECT COUNT(*) AS cnt FROM photos WHERE roll_id = ? AND deleted_at IS NULL',
  'rolls.maxFrameNumber': 'SELECT MAX(CAST(frame_number AS INTEGER)) AS max_frame FROM photos WHERE roll_id = ?',
  
  // Photos
  'photos.getById': 'SELECT * FROM photos WHERE id = ?',
  'photos.getByIdWithPaths': 'SELECT id, roll_id, filename, original_rel_path, positive_rel_path, full_rel_path, negative_rel_path, thumb_rel_path, positive_thumb_rel_path, negative_thumb_rel_path FROM photos WHERE id = ?',
  'photos.listByRoll': 'SELECT p.*, COALESCE(l.country_name, p.country) AS country_name, COALESCE(l.city_name, p.city) AS city_name, l.country_code, l.city_lat AS location_lat, l.city_lng AS location_lng FROM photos p LEFT JOIN locations l ON p.location_id = l.id WHERE p.roll_id = ? AND p.deleted_at IS NULL ORDER BY p.frame_number',
  'photos.getByRollSimple': 'SELECT id, roll_id, source_type, frame_number, full_rel_path, thumb_rel_path, positive_rel_path, positive_thumb_rel_path FROM photos WHERE id = ?',
  'photos.updateRating': 'UPDATE photos SET rating = ? WHERE id = ?',
  'photos.delete': 'UPDATE photos SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
  'photos.hardDelete': 'DELETE FROM photos WHERE id = ?', // Caller MUST delete photo_tags first (no FK cascade)
  'photos.checkHash': 'SELECT id, source_type FROM photos WHERE content_hash = ? AND deleted_at IS NULL',
  
  // Tags
  'tags.getAll': 'SELECT * FROM tags ORDER BY name',
  'tags.getByName': 'SELECT * FROM tags WHERE name = ?',
  'tags.insert': 'INSERT OR IGNORE INTO tags (name) VALUES (?)',
  
  // Photo Tags (junction)
  'photo_tags.getByPhoto': 'SELECT tag_id FROM photo_tags WHERE photo_id = ?',
  'photo_tags.insert': 'INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?, ?)',
  'photo_tags.deleteByPhoto': 'DELETE FROM photo_tags WHERE photo_id = ?',
  
  // Locations
  'locations.getById': 'SELECT * FROM locations WHERE id = ?',
  'locations.findByCountryCity': 'SELECT id FROM locations WHERE country_code = ? AND city_name = ?',
  
  // Roll Gear
  'roll_gear.getByRoll': 'SELECT type, value FROM roll_gear WHERE roll_id = ?',
  'roll_gear.insert': 'INSERT OR IGNORE INTO roll_gear (roll_id, type, value) VALUES (?, ?, ?)',
  'roll_gear.deleteByRoll': 'DELETE FROM roll_gear WHERE roll_id = ?',
  
  // Films
  'films.getById': 'SELECT * FROM films WHERE id = ?',
  'films.listAll': 'SELECT * FROM films ORDER BY name',
  'films.getThumb': 'SELECT thumbPath FROM films WHERE id = ?',

  // Digital Sessions
  'digitalSessions.list': `
    SELECT ds.*, c.brand || ' ' || c.model AS camera_name,
           (SELECT thumb_rel_path FROM photos
            WHERE session_id = ds.id AND deleted_at IS NULL
            ORDER BY date_taken DESC LIMIT 1) AS cover_thumb
    FROM digital_sessions ds
    LEFT JOIN equip_cameras c ON ds.camera_id = c.id
    WHERE ds.deleted_at IS NULL AND (? IS NULL OR ds.import_batch = ?)
    ORDER BY ds.session_date DESC NULLS LAST, ds.id DESC`,

  'digitalSessions.getByBatchId': `
    SELECT * FROM digital_sessions WHERE import_batch = ? AND deleted_at IS NULL`,

  'digitalSessions.getById': `
    SELECT ds.*, c.brand || ' ' || c.model AS camera_name
    FROM digital_sessions ds
    LEFT JOIN equip_cameras c ON ds.camera_id = c.id
    WHERE ds.id = ? AND ds.deleted_at IS NULL`,

  // Albums
  // Params: [includeDeleted(0|1), parentId, parentId]
  'albums.list': `
    WITH RECURSIVE tree(ancestor_id, album_id) AS (
      SELECT id, id FROM albums
      UNION
      SELECT tree.ancestor_id, a.id FROM albums a JOIN tree ON a.parent_id = tree.album_id
    )
    SELECT a.*,
           (SELECT thumb_rel_path FROM photos WHERE id = a.cover_photo_id) AS cover_thumb,
           COUNT(p.id) AS photo_count,
           COALESCE(t.total, 0) AS total_photo_count,
           MIN(p.date_taken) AS date_range_start,
           MAX(p.date_taken) AS date_range_end
    FROM albums a
    LEFT JOIN album_photos ap ON ap.album_id = a.id
    LEFT JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
    LEFT JOIN (
      SELECT tree.ancestor_id, COUNT(DISTINCT ap2.photo_id) AS total
      FROM tree
      JOIN album_photos ap2 ON ap2.album_id = tree.album_id
      JOIN photos p2 ON p2.id = ap2.photo_id AND p2.deleted_at IS NULL
      GROUP BY tree.ancestor_id
    ) t ON t.ancestor_id = a.id
    WHERE (? = 1 OR a.deleted_at IS NULL) AND (? IS NULL OR a.parent_id = ?)
     GROUP BY a.id
     ORDER BY a.sort_order, a.title COLLATE NOCASE, a.id`,

  'albums.getById': `
    SELECT a.*
    FROM albums a
    WHERE a.id = ? AND a.deleted_at IS NULL`,

  'albums.photos': `
    SELECT p.*, ap.sort_order AS album_sort_order, ap.added_at AS album_added_at,
           r.title AS roll_title,
           ds.label AS session_label, ds.session_date
    FROM album_photos ap
    JOIN photos p ON ap.photo_id = p.id
    LEFT JOIN rolls r ON p.roll_id = r.id
    LEFT JOIN digital_sessions ds
      ON p.session_id = ds.id AND ds.deleted_at IS NULL
    WHERE ap.album_id = ? AND p.deleted_at IS NULL
    ORDER BY ap.sort_order, ap.added_at`,

  // Photos (digital-aware)
  'photos.listDigital': `
    SELECT p.*, ds.label AS session_label, ds.session_date,
           c.brand || ' ' || c.model AS camera_name
    FROM photos p
    LEFT JOIN digital_sessions ds
      ON p.session_id = ds.id AND ds.deleted_at IS NULL
    LEFT JOIN equip_cameras c ON p.camera_equip_id = c.id
    WHERE p.source_type = 'digital' AND p.deleted_at IS NULL
    ORDER BY p.date_taken DESC NULLS LAST, p.id DESC`,
};

/**
 * Get or create a prepared statement
 * @param {string} key - Statement key from STATEMENTS registry
 * @returns {sqlite3.Statement}
 */
function getStatement(key) {
  const sql = STATEMENTS[key];
  if (!sql) {
    throw new Error(`Unknown prepared statement: ${key}`);
  }
  
  if (!stmtCache.has(key)) {
    try {
      const stmt = db.prepare(sql);
      stmtCache.set(key, stmt);
      console.log(`[STMT] Prepared: ${key}`);
    } catch (err) {
      console.error(`[STMT] Failed to prepare ${key}:`, err.message);
      throw err;
    }
  }
  
  return stmtCache.get(key);
}

/**
 * Execute a prepared statement and return a single row
 * @param {string} key - Statement key
 * @param {Array} params - Query parameters
 * @returns {Promise<Object|null>}
 */
function getAsync(key, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const stmt = getStatement(key);
      stmt.get(...params, (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Execute a prepared statement and return all rows
 * @param {string} key - Statement key
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>}
 */
function allAsync(key, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const stmt = getStatement(key);
      stmt.all(...params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Execute a prepared statement (for INSERT/UPDATE/DELETE)
 * @param {string} key - Statement key
 * @param {Array} params - Query parameters
 * @returns {Promise<{changes: number, lastID: number}>}
 */
function runAsync(key, params = []) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const maxRetries = 3;
    
    const attempt = () => {
      try {
        const stmt = getStatement(key);
        stmt.run(...params, function(err) {
          if (err) {
            if (err.code === 'SQLITE_BUSY' && retries < maxRetries) {
              retries++;
              console.warn(`[STMT] SQLITE_BUSY for ${key}, retrying (${retries}/${maxRetries})...`);
              setTimeout(attempt, 200);
              return;
            }
            return reject(err);
          }
          resolve({ changes: this.changes, lastID: this.lastID });
        });
      } catch (err) {
        reject(err);
      }
    };
    
    attempt();
  });
}

/**
 * Finalize all prepared statements (call on shutdown)
 */
function finalizeAll() {
  console.log(`[STMT] Finalizing ${stmtCache.size} prepared statements...`);
  for (const [key, stmt] of stmtCache) {
    try {
      stmt.finalize();
    } catch (err) {
      console.error(`[STMT] Error finalizing ${key}:`, err.message);
    }
  }
  stmtCache.clear();
  console.log('[STMT] ✅ All statements finalized');
}

/**
 * Finalize all statements and ensure WAL checkpoint
 * This is the proper shutdown sequence for WAL mode
 */
async function finalizeAllWithCheckpoint() {
  console.log('[STMT] Starting graceful shutdown...');
  
  // 1. Finalize all prepared statements first
  finalizeAll();
  
  // 2. Force WAL checkpoint to merge all changes into main DB
  // TRUNCATE mode: merge and remove WAL file
  const dbModule = require('../db');
  try {
    await dbModule.walCheckpoint();
    console.log('[STMT] ✅ WAL checkpoint completed');
  } catch (err) {
    console.error('[STMT] ⚠️  WAL checkpoint failed:', err.message);
  }
  
  // 3. Stop WAL checkpoint scheduler
  if (dbModule.stopCheckpointScheduler) {
    dbModule.stopCheckpointScheduler();
  }
}

/**
 * Get cache statistics
 */
function getStats() {
  return {
    cachedStatements: stmtCache.size,
    registeredStatements: Object.keys(STATEMENTS).length,
    statements: Array.from(stmtCache.keys()),
  };
}

// Clean up on process exit (synchronous version for 'exit' event)
process.on('exit', () => {
  console.log('[STMT] Process exiting, finalizing statements...');
  for (const [key, stmt] of stmtCache) {
    try {
      stmt.finalize();
    } catch (err) {
      // Ignore errors during exit
    }
  }
  stmtCache.clear();
});

module.exports = {
  getStatement,
  getAsync,
  allAsync,
  runAsync,
  finalizeAll,
  finalizeAllWithCheckpoint,
  getStats,
  STATEMENTS, // Export for documentation/testing
};
