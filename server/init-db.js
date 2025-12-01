// init-db.js
const fs = require('fs');
const path = require('path');
const db = require('./db');

// allow optional seed file in same dir
const seedPath = path.join(__dirname, 'seed.sql');

const schema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS films (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  iso INTEGER NOT NULL,
  category TEXT NOT NULL,
  thumbPath TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rolls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  start_date TEXT,
  end_date TEXT,
  camera TEXT,
  lens TEXT,
  photographer TEXT,
  filmId INTEGER,
  film_type TEXT,
  exposures INTEGER,
  cover_photo TEXT,
  coverPath TEXT,
  folderName TEXT,
  iso INTEGER,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  display_seq INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (filmId) REFERENCES films(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roll_id INTEGER NOT NULL,
  frame_number TEXT,
  filename TEXT,
  full_rel_path TEXT,
  thumb_rel_path TEXT,
  caption TEXT,
  taken_at TEXT,
  rating INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (roll_id) REFERENCES rolls(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS photo_tags (
  photo_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (photo_id, tag_id),
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS roll_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rollId INTEGER NOT NULL,
  filename TEXT NOT NULL,
  relPath TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rollId) REFERENCES rolls(id) ON DELETE CASCADE
);
`;

db.serialize(() => {
  db.exec(schema, async (err) => {
    if (err) {
      console.error('Failed to initialize DB schema', err);
      process.exit(1);
    }
    console.log('Database schema initialized.');

    // Ensure legacy databases get new columns used by seed.sql and app code
    const run = (sql) => new Promise((resolve) => db.run(sql, [], () => resolve()));
    const ensureColumns = async () => {
      const filmAlters = [
        `ALTER TABLE films ADD COLUMN category TEXT`,
        `ALTER TABLE films ADD COLUMN thumbPath TEXT`,
        `ALTER TABLE films ADD COLUMN createdAt DATETIME DEFAULT CURRENT_TIMESTAMP`,
        `ALTER TABLE films ADD COLUMN updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP`
      ];
      const rollAlters = [
        `ALTER TABLE rolls ADD COLUMN title TEXT`,
        `ALTER TABLE rolls ADD COLUMN start_date TEXT`,
        `ALTER TABLE rolls ADD COLUMN end_date TEXT`,
        `ALTER TABLE rolls ADD COLUMN camera TEXT`,
        `ALTER TABLE rolls ADD COLUMN lens TEXT`,
        `ALTER TABLE rolls ADD COLUMN photographer TEXT`,
        `ALTER TABLE rolls ADD COLUMN filmId INTEGER`,
        `ALTER TABLE rolls ADD COLUMN film_type TEXT`,
        `ALTER TABLE rolls ADD COLUMN exposures INTEGER`,
        `ALTER TABLE rolls ADD COLUMN coverPath TEXT`,
        `ALTER TABLE rolls ADD COLUMN folderName TEXT`,
        `ALTER TABLE rolls ADD COLUMN notes TEXT`
      ];
      const photoAlters = [
        `ALTER TABLE photos ADD COLUMN frame_number TEXT`,
        `ALTER TABLE photos ADD COLUMN full_rel_path TEXT`,
        `ALTER TABLE photos ADD COLUMN thumb_rel_path TEXT`,
        `ALTER TABLE photos ADD COLUMN caption TEXT`,
        `ALTER TABLE photos ADD COLUMN taken_at TEXT`,
        `ALTER TABLE photos ADD COLUMN rating INTEGER`
      ];
      for (const a of [...filmAlters, ...rollAlters, ...photoAlters]) {
        try { await run(a); } catch (_) { /* ignore if exists */ }
      }
    };

    try { await ensureColumns(); } catch (_) {}

    if (fs.existsSync(seedPath)) {
      const sql = fs.readFileSync(seedPath, 'utf8');
      db.exec(sql, (e) => {
        if (e) {
          console.error('Failed to run seed.sql', e);
          process.exit(1);
        }
        console.log('Seed data inserted.');
        db.close();
      });
    } else {
      db.close();
    }
  });
});