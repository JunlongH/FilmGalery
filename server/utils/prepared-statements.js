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
  'rolls.countPhotos': 'SELECT COUNT(*) AS cnt FROM photos WHERE roll_id = ?',
  
  // Photos
  'photos.getById': 'SELECT * FROM photos WHERE id = ?',
  'photos.getByIdWithPaths': 'SELECT id, roll_id, filename, original_rel_path, positive_rel_path, full_rel_path, negative_rel_path, thumb_rel_path, positive_thumb_rel_path, negative_thumb_rel_path FROM photos WHERE id = ?',
  'photos.listByRoll': 'SELECT * FROM photos WHERE roll_id = ? ORDER BY frame_number',
  'photos.getByRollSimple': 'SELECT id, roll_id, frame_number, full_rel_path, thumb_rel_path FROM photos WHERE id = ?',
  'photos.updateRating': 'UPDATE photos SET rating = ? WHERE id = ?',
  'photos.delete': 'DELETE FROM photos WHERE id = ?',
  
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
