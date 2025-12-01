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
  // Pragmas: safe performance improvements
  // WAL improves concurrency; NORMAL keeps durability reasonable
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
  // negative cache_size sets size in KB (here ~16MB)
  db.run('PRAGMA cache_size = -16000');
  db.run('PRAGMA temp_store = MEMORY');
  db.run('PRAGMA foreign_keys = ON');

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

module.exports = db;
