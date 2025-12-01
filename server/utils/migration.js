const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { getDbPath } = require('../config/db-config');

// Simple file logger for packaged app debugging
function log(msg) {
  const logPath = path.join(path.dirname(getDbPath()), 'migration.log');
  const ts = new Date().toISOString();
  fs.appendFileSync(logPath, `[${ts}] ${msg}\n`);
  console.log(`[MIGRATION] ${msg}`);
}

function getPhotoCount(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
    });
    db.get('SELECT COUNT(*) as c FROM photos', (err, row) => {
      db.close();
      if (err) return reject(err);
      resolve(row ? row.c : 0);
    });
  });
}

async function runMigration() {
  const targetDbPath = getDbPath();
  log(`Target DB Path: ${targetDbPath}`);

  // 1. Identify Legacy Candidates
  const legacyCandidates = [
    'd:\\Program Files\\FilmGalery\\film.db', // Explicit user path
    path.join(process.cwd(), 'film.db'),
    path.join(__dirname, '../../film.db')
  ];

  let sourceDbPath = null;
  for (const cand of legacyCandidates) {
    if (fs.existsSync(cand) && cand.toLowerCase() !== targetDbPath.toLowerCase()) {
      sourceDbPath = cand;
      break;
    }
  }

  if (!sourceDbPath) {
    log('No legacy DB found. Skipping migration.');
    return;
  }

  log(`Found Legacy DB: ${sourceDbPath}`);

  // 2. Check Target State
  let targetPhotos = 0;
  let targetExists = fs.existsSync(targetDbPath);
  
  if (targetExists) {
    try {
      targetPhotos = await getPhotoCount(targetDbPath);
      log(`Target DB has ${targetPhotos} photos.`);
    } catch (e) {
      log(`Error reading target DB: ${e.message}. Assuming corrupted/empty.`);
      targetPhotos = 0;
    }
  } else {
    log('Target DB does not exist.');
  }

  // 3. Check Source State
  let sourcePhotos = 0;
  try {
    sourcePhotos = await getPhotoCount(sourceDbPath);
    log(`Source DB has ${sourcePhotos} photos.`);
  } catch (e) {
    log(`Error reading source DB: ${e.message}`);
    return; // Cannot migrate from broken source
  }

  // 4. Decision
  if (targetPhotos === 0 && sourcePhotos > 0) {
    log('CONDITION MET: Target has 0 photos, Source has data. Overwriting...');
    try {
      // Ensure target directory exists
      const targetDir = path.dirname(targetDbPath);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

      // Copy
      fs.copyFileSync(sourceDbPath, targetDbPath);
      log('Migration SUCCESS: DB file copied.');
    } catch (e) {
      log(`Migration FAILED: ${e.message}`);
    }
  } else {
    log('Migration SKIPPED: Conditions not met (Target not empty or Source empty).');
  }
}

module.exports = { runMigration };
