const db = require('../db');

const runAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) return reject(err);
    resolve(this);
  });
});

const getAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) return reject(err);
    resolve(row);
  });
});

async function up() {
  console.log('[MIGRATION] Renaming shooter column to photographer in rolls table...');
  
  // Check if photographer column already exists
  const tableInfo = await new Promise((resolve, reject) => {
    db.all("PRAGMA table_info(rolls)", (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
  
  const hasPhotographer = tableInfo.some(col => col.name === 'photographer');
  const hasShooter = tableInfo.some(col => col.name === 'shooter');
  
  if (hasPhotographer && !hasShooter) {
    console.log('[MIGRATION] Column already renamed, skipping.');
    return;
  }
  
  if (!hasShooter) {
    console.log('[MIGRATION] No shooter column found, adding photographer column.');
    await runAsync('ALTER TABLE rolls ADD COLUMN photographer TEXT');
    return;
  }
  
  await runAsync('BEGIN');
  try {
    // SQLite doesn't support RENAME COLUMN before version 3.25.0
    // We need to recreate the table
    
    // 1. Create new table with photographer instead of shooter
    await runAsync(`
      CREATE TABLE rolls_new (
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
        develop_lab TEXT,
        develop_process TEXT,
        develop_date TEXT,
        purchase_cost REAL,
        develop_cost REAL,
        purchase_channel TEXT,
        batch_number TEXT,
        develop_note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (filmId) REFERENCES films(id) ON DELETE SET NULL
      )
    `);
    
    // 2. Copy data from old table to new table
    await runAsync(`
      INSERT INTO rolls_new 
      SELECT 
        id, title, start_date, end_date, camera, lens, 
        shooter as photographer,
        filmId, film_type, exposures, cover_photo, coverPath, folderName, iso, notes,
        develop_lab, develop_process, develop_date, purchase_cost, develop_cost,
        purchase_channel, batch_number, develop_note, created_at
      FROM rolls
    `);
    
    // 3. Drop old table
    await runAsync('DROP TABLE rolls');
    
    // 4. Rename new table to rolls
    await runAsync('ALTER TABLE rolls_new RENAME TO rolls');
    
    await runAsync('COMMIT');
    console.log('[MIGRATION] Successfully renamed shooter to photographer');
  } catch (e) {
    try { await runAsync('ROLLBACK'); } catch {}
    console.error('[MIGRATION] Failed to rename column:', e);
    throw e;
  }
}

async function down() {
  console.log('[MIGRATION] Rolling back: renaming photographer to shooter...');
  
  await runAsync('BEGIN');
  try {
    // Recreate with shooter column
    await runAsync(`
      CREATE TABLE rolls_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        start_date TEXT,
        end_date TEXT,
        camera TEXT,
        lens TEXT,
        shooter TEXT,
        filmId INTEGER,
        film_type TEXT,
        exposures INTEGER,
        cover_photo TEXT,
        coverPath TEXT,
        folderName TEXT,
        iso INTEGER,
        notes TEXT,
        develop_lab TEXT,
        develop_process TEXT,
        develop_date TEXT,
        purchase_cost REAL,
        develop_cost REAL,
        purchase_channel TEXT,
        batch_number TEXT,
        develop_note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (filmId) REFERENCES films(id) ON DELETE SET NULL
      )
    `);
    
    await runAsync(`
      INSERT INTO rolls_new 
      SELECT 
        id, title, start_date, end_date, camera, lens, 
        photographer as shooter,
        filmId, film_type, exposures, cover_photo, coverPath, folderName, iso, notes,
        develop_lab, develop_process, develop_date, purchase_cost, develop_cost,
        purchase_channel, batch_number, develop_note, created_at
      FROM rolls
    `);
    
    await runAsync('DROP TABLE rolls');
    await runAsync('ALTER TABLE rolls_new RENAME TO rolls');
    
    await runAsync('COMMIT');
    console.log('[MIGRATION] Rollback complete');
  } catch (e) {
    try { await runAsync('ROLLBACK'); } catch {}
    throw e;
  }
}

module.exports = { up, down };
