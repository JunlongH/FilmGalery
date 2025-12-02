// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const conflictResolver = require('./conflict-resolver');
const { getDbPath } = require('./config/db-config');

const dbPath = getDbPath();

// Auto-cleanup OneDrive conflict copies before opening DB
const dataDir = path.dirname(dbPath);
console.log('[DB] Checking for OneDrive conflict copies in', dataDir);
conflictResolver.autoCleanup(dataDir).catch(err => {
  console.error('[DB] Conflict cleanup error:', err.message);
});

// [MIGRATION] Logic moved to server/utils/migration.js and called from server.js startup
// This file now assumes the DB is ready to be opened.

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    console.log('Connected to database at', dbPath);
  }
});

// Ensure tables exist
db.serialize(() => {
  // [ONEDRIVE-OPTIMIZED] WAL mode configuration for cloud sync compatibility
  // WAL (Write-Ahead Logging) advantages:
  // 1. Readers don't block writers, writers don't block readers
  // 2. OneDrive can sync .db file while app is running (WAL is separate)
  // 3. Better crash recovery
  // 4. Faster writes (no need to modify main DB immediately)
  db.run('PRAGMA journal_mode = WAL', (err, result) => {
    if (err) {
      console.error('[DB] Failed to enable WAL mode:', err);
    } else {
      console.log('[DB] ✅ WAL mode enabled');
    }
  });
  
  // Synchronous mode: NORMAL is safe for WAL mode and much faster than FULL
  // Data is written to WAL immediately, but checkpoints are less frequent
  db.run('PRAGMA synchronous = NORMAL', (err) => {
    if (err) console.error('[DB] Synchronous setting failed:', err);
  });
  
  // Increased timeout for OneDrive sync delays (5 seconds)
  db.run('PRAGMA busy_timeout = 5000');
  
  // Memory-mapped I/O for faster reads (256MB) - safe with WAL
  db.run('PRAGMA mmap_size = 268435456');
  
  // NORMAL locking mode (not EXCLUSIVE) to allow OneDrive file access
  // This is crucial for cloud sync - EXCLUSIVE would lock out OneDrive
  db.run('PRAGMA locking_mode = NORMAL');
  
  // Larger cache (32MB for better query performance)
  db.run('PRAGMA cache_size = -32000');
  
  db.run('PRAGMA temp_store = MEMORY');
  db.run('PRAGMA foreign_keys = ON');
  
  // Optimize page size for SSD (4KB is optimal for modern drives)
  db.run('PRAGMA page_size = 4096');
  
  // WAL autocheckpoint: merge WAL to main DB every 1000 pages (~4MB)
  // This keeps WAL file small and allows OneDrive to sync regularly
  db.run('PRAGMA wal_autocheckpoint = 1000', (err) => {
    if (err) console.error('[DB] WAL autocheckpoint failed:', err);
    else console.log('[DB] ✅ WAL autocheckpoint set to 1000 pages');
  });

  db.run(`CREATE TABLE IF NOT EXISTS films (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    iso INTEGER,
    format TEXT,
    type TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    film_id INTEGER,
    camera_id INTEGER,
    date_loaded DATE,
    date_finished DATE,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(film_id) REFERENCES films(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS photos (
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
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS photo_tags (
    photo_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (photo_id, tag_id),
    FOREIGN KEY(photo_id) REFERENCES photos(id),
    FOREIGN KEY(tag_id) REFERENCES tags(id)
  )`);
  
  // Add presets table
  db.run(`CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    params TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// [ONEDRIVE-SYNC] Periodic WAL checkpoint for OneDrive sync
// Run checkpoint every 5 minutes to merge WAL into main DB
// This ensures OneDrive can sync the latest data regularly
const WAL_CHECKPOINT_INTERVAL = 5 * 60 * 1000; // 5 minutes
let checkpointInterval = null;

function startWalCheckpoint() {
  if (checkpointInterval) return; // Already started
  
  checkpointInterval = setInterval(() => {
    db.run('PRAGMA wal_checkpoint(PASSIVE)', (err) => {
      if (err) {
        console.error('[DB] WAL checkpoint error:', err.message);
      } else {
        console.log('[DB] 🔄 WAL checkpoint completed');
      }
    });
  }, WAL_CHECKPOINT_INTERVAL);
  
  console.log('[DB] ✅ WAL checkpoint scheduler started (every 5 minutes)');
}

function stopWalCheckpoint() {
  if (checkpointInterval) {
    clearInterval(checkpointInterval);
    checkpointInterval = null;
    console.log('[DB] WAL checkpoint scheduler stopped');
  }
}

// Start checkpoint scheduler after tables are created
setTimeout(() => {
  startWalCheckpoint();
}, 5000); // Start after 5 seconds

// Export additional functions for cleanup
db.walCheckpoint = () => {
  return new Promise((resolve, reject) => {
    db.run('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  });
};

db.stopCheckpointScheduler = stopWalCheckpoint;

module.exports = db;
