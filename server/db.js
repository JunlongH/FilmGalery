// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const conflictResolver = require('./conflict-resolver');
const { getDbPath } = require('./config/db-config');

const dbPath = getDbPath();

// Detect OneDrive path
const isOneDrivePath = dbPath.toLowerCase().includes('onedrive');

// OneDrive write-through mode: ensure changes land in the main DB file immediately (no WAL lag)
// Auto-enable for OneDrive paths to avoid WAL sync issues
const writeThrough = process.env.DB_WRITE_THROUGH === '1' 
  || process.env.DB_ONEDRIVE_WRITE_THROUGH === '1'
  || (isOneDrivePath && process.env.DB_WRITE_THROUGH !== '0');

if (isOneDrivePath) {
  console.log('[DB] OneDrive path detected, write-through mode:', writeThrough ? 'ENABLED' : 'disabled');
}

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
    
    // For OneDrive paths: checkpoint any existing WAL before switching modes
    if (isOneDrivePath && writeThrough) {
      db.run('PRAGMA busy_timeout = 30000', () => {
        db.run('PRAGMA wal_checkpoint(TRUNCATE)', (checkpointErr) => {
          if (checkpointErr) {
            console.warn('[DB] Pre-checkpoint warning:', checkpointErr.message);
          } else {
            console.log('[DB] Pre-mode-switch checkpoint done');
          }
        });
      });
    }
  }
});

// Ensure tables exist
db.serialize(() => {
    // Always set busy_timeout first to handle OneDrive sync delays
    db.run('PRAGMA busy_timeout = 30000');
    
    if (writeThrough) {
      // Write-through mode: keep changes in main DB file immediately, avoid WAL/SHM reliance
      // First, try to checkpoint any existing WAL data
      db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
        if (err) console.warn('[DB] Initial checkpoint warning:', err.message);
      });
      
      // Then switch journal mode (with retry on SQLITE_BUSY)
      const setTruncateMode = (retries = 3) => {
        db.run('PRAGMA journal_mode = TRUNCATE', function(err) {
          if (err && err.code === 'SQLITE_BUSY' && retries > 0) {
            console.warn(`[DB] Journal mode switch busy, retrying in 1s... (${retries} left)`);
            setTimeout(() => setTruncateMode(retries - 1), 1000);
          } else if (err) {
            console.error('[DB] Failed to set TRUNCATE journal mode:', err);
            console.log('[DB] Continuing with current journal mode (likely WAL)');
          } else {
            console.log('[DB] ✅ Write-through mode: TRUNCATE journal');
          }
        });
      };
      setTruncateMode();
      
      db.run('PRAGMA synchronous = FULL', (err) => {
        if (err) console.error('[DB] Synchronous FULL failed:', err);
      });
      db.run('PRAGMA locking_mode = NORMAL');
      db.run('PRAGMA busy_timeout = 15000'); // Increased for OneDrive sync delays
      db.run('PRAGMA temp_store = MEMORY');
      db.run('PRAGMA foreign_keys = ON');
      db.run('PRAGMA page_size = 4096');
      db.run('PRAGMA cache_size = -16000'); // smaller cache to reduce write lag on cloud drives
      db.run('PRAGMA mmap_size = 134217728'); // 128MB
      db.run('PRAGMA journal_size_limit = 1048576'); // cap journal to 1MB
    } else {
      // WAL mode: optimized for concurrency and OneDrive-friendly sync (main DB readable)
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
    
      // Increased timeout for OneDrive sync delays (15 seconds)
      db.run('PRAGMA busy_timeout = 15000');
    
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
    
      // WAL autocheckpoint: merge WAL to main DB after N pages
      // For OneDrive: more aggressive (100 pages = ~400KB) to minimize WAL size
      // For local: standard (1000 pages = ~4MB)
      const autocheckpointPages = isOneDrivePath ? 100 : 1000;
      db.run(`PRAGMA wal_autocheckpoint = ${autocheckpointPages}`, (err) => {
        if (err) console.error('[DB] WAL autocheckpoint failed:', err);
        else console.log(`[DB] ✅ WAL autocheckpoint set to ${autocheckpointPages} pages`);
      });
    }

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
  
  // Add presets table (with category/description for preset organization)
  db.run(`CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    params TEXT,
    params_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME
  )`);
  
  // Film curve profiles table for custom gamma/dMin/dMax configurations
  db.run(`CREATE TABLE IF NOT EXISTS film_curve_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    gamma REAL NOT NULL DEFAULT 0.6,
    d_min REAL NOT NULL DEFAULT 0.1,
    d_max REAL NOT NULL DEFAULT 3.0,
    category TEXT DEFAULT 'custom',
    is_builtin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME
  )`);

  // Phase 2B #1 — auth sessions (pairing tokens).
  // See docs/phase2-roadmap/phase-2b-security.md §「sessions 表 schema」.
  // Token is stored as sha256 hex hash; plaintext is returned exactly once at
  // issuance. UNIQUE(device_fp, device_kind) makes re-pairing overwrite the
  // previous session for the same device. issued_by chains watch tokens to
  // their issuing mobile session for cascade revocation.
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash    TEXT    NOT NULL UNIQUE,
    device_name   TEXT    NOT NULL,
    device_kind   TEXT    NOT NULL,
    device_fp     TEXT    NOT NULL,
    issued_at     INTEGER NOT NULL,
    expires_at    INTEGER,
    last_seen_at  INTEGER NOT NULL,
    revoked_at    INTEGER,
    issued_by     INTEGER,
    UNIQUE(device_fp, device_kind)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_device_fp ON sessions(device_fp, device_kind)`);
});

// [ONEDRIVE-SYNC] Periodic WAL checkpoint for OneDrive sync (only in WAL mode)
// Run checkpoint more frequently for OneDrive paths to ensure data is synced
const WAL_CHECKPOINT_INTERVAL = isOneDrivePath ? 60 * 1000 : 5 * 60 * 1000; // 1 min for OneDrive, 5 min otherwise
let checkpointInterval = null;

function startWalCheckpoint() {
  if (writeThrough) return; // not needed in write-through mode
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
  // Allow the Node process to exit even if the scheduler is still ticking
  // (otherwise test workers and one-shot CLI scripts hang on shutdown).
  checkpointInterval.unref();
  
  console.log('[DB] ✅ WAL checkpoint scheduler started (every 5 minutes)');
}

function stopWalCheckpoint() {
  if (checkpointInterval) {
    clearInterval(checkpointInterval);
    checkpointInterval = null;
    console.log('[DB] WAL checkpoint scheduler stopped');
  }
}

// Start checkpoint scheduler after tables are created (only in WAL mode)
setTimeout(() => {
  startWalCheckpoint();
}, 5000); // Start after 5 seconds

// Export additional functions for cleanup
db.walCheckpoint = () => {
  return new Promise((resolve, reject) => {
    if (writeThrough) {
      // In write-through mode, WAL is unused; return a no-op result
      return resolve({ changes: 0, mode: 'write-through' });
    }
    db.run('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes, mode: 'wal' });
    });
  });
};

db.stopCheckpointScheduler = stopWalCheckpoint;

// Expose meta info for health endpoints
db.meta = {
  writeThrough,
  mode: writeThrough ? 'TRUNCATE' : 'WAL'
};

module.exports = db;
