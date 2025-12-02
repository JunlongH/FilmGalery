const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

// Configuration
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../film.db');

console.log(`---------------------------------------------------`);
console.log(`Target Database Path: "${DB_PATH}"`);
console.log(`Resolved Absolute Path: "${path.resolve(DB_PATH)}"`);

if (!fs.existsSync(DB_PATH)) {
  console.error(`\n[ERROR] Database file NOT FOUND at: ${DB_PATH}`);
  console.error(`Please check the path. If using OneDrive, ensure the file is downloaded/available locally.`);
  process.exit(1);
}
console.log(`File exists. Proceeding with migration...`);
console.log(`---------------------------------------------------`);

const db = new sqlite3.Database(DB_PATH);

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) return reject(err);
    resolve(this);
  });
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows);
  });
});

async function migrate() {
  try {
    // 1. Ensure film_items table exists
    console.log('Checking schema...');
    await run(`
      CREATE TABLE IF NOT EXISTS film_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        film_id INTEGER NOT NULL,
        roll_id INTEGER,
        status TEXT NOT NULL DEFAULT 'in_stock',
        label TEXT,
        purchase_channel TEXT,
        purchase_vendor TEXT,
        purchase_order_id TEXT,
        purchase_price REAL,
        purchase_currency TEXT,
        purchase_date TEXT,
        expiry_date TEXT,
        batch_number TEXT,
        purchase_shipping_share REAL,
        purchase_note TEXT,
        develop_lab TEXT,
        develop_process TEXT,
        develop_price REAL,
        develop_shipping REAL,
        develop_date TEXT,
        develop_channel TEXT,
        develop_note TEXT,
        loaded_camera TEXT,
        loaded_at TEXT,
        shot_at TEXT,
        sent_to_lab_at TEXT,
        developed_at TEXT,
        archived_at TEXT,
        negative_archived INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        deleted_at DATETIME,
        FOREIGN KEY(film_id) REFERENCES films(id)
      )
    `);

    // 2. Ensure rolls has film_item_id column
    try {
      await run(`ALTER TABLE rolls ADD COLUMN film_item_id INTEGER`);
      console.log('Added film_item_id column to rolls.');
    } catch (e) {
      // Ignore if already exists
      if (!e.message.includes('duplicate column name')) {
        console.log('film_item_id column likely exists or error:', e.message);
      }
    }

    // 3. Find legacy rolls without film_item_id
    const rolls = await all(`SELECT * FROM rolls WHERE film_item_id IS NULL`);
    console.log(`Found ${rolls.length} rolls to migrate.`);

    if (rolls.length === 0) {
      console.log('No rolls to migrate.');
      return;
    }

    await run('BEGIN TRANSACTION');

    for (const roll of rolls) {
      // Determine status
      // If it has a develop date or cost, it's developed. Otherwise, if it has photos, it's likely developed/shot.
      // Since these are legacy rolls, we assume they are at least 'developed'.
      const status = 'developed';

      // Map fields
      // Note: roll.start_date is used as purchase_date proxy if available, otherwise created_at
      const purchaseDate = roll.start_date || roll.created_at ? new Date(roll.start_date || roll.created_at).toISOString().split('T')[0] : null;
      
      // Insert into film_items
      const result = await run(`
        INSERT INTO film_items (
          film_id,
          roll_id,
          status,
          purchase_price,
          purchase_channel,
          purchase_date,
          develop_lab,
          develop_process,
          develop_price,
          develop_date,
          develop_note,
          loaded_camera,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        roll.filmId || null, // Some legacy rolls might have null filmId if deleted? Hopefully not.
        roll.id,
        status,
        roll.purchase_cost || 0,
        roll.purchase_channel || null,
        purchaseDate,
        roll.develop_lab || null,
        roll.develop_process || null,
        roll.develop_cost || 0,
        roll.develop_date || null,
        roll.develop_note || null,
        roll.camera || null,
        roll.created_at || new Date().toISOString(),
        new Date().toISOString()
      ]);

      const newItemId = result.lastID;

      // Update roll with new film_item_id
      await run(`UPDATE rolls SET film_item_id = ? WHERE id = ?`, [newItemId, roll.id]);
      
      process.stdout.write('.');
    }

    await run('COMMIT');
    console.log('\nMigration completed successfully.');

  } catch (err) {
    console.error('Migration failed:', err);
    try { await run('ROLLBACK'); } catch (e) {}
  } finally {
    db.close();
  }
}

migrate();
