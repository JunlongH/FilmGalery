const db = require('../db');

const runAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) return reject(err);
    resolve(this);
  });
});

async function up() {
  await runAsync('BEGIN');
  try {
    await runAsync(`
      CREATE TABLE IF NOT EXISTS film_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        film_id INTEGER NOT NULL,
        roll_id INTEGER,
        status TEXT NOT NULL DEFAULT 'in_stock',
        label TEXT,
        -- Purchase information
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
        -- Develop information (centralized here, rolls may cache)
        develop_lab TEXT,
        develop_process TEXT,
        develop_price REAL,
        develop_shipping REAL,
        develop_date TEXT,
        develop_channel TEXT,
        develop_note TEXT,
        -- State metadata
        loaded_camera TEXT,
        loaded_at TEXT,
        shot_at TEXT,
        sent_to_lab_at TEXT,
        developed_at TEXT,
        archived_at TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        deleted_at DATETIME,
        FOREIGN KEY(film_id) REFERENCES films(id),
        FOREIGN KEY(roll_id) REFERENCES rolls(id)
      );
    `);

    // Add film_item_id to rolls if not exists
    try {
      await runAsync('ALTER TABLE rolls ADD COLUMN film_item_id INTEGER');
    } catch (e) {
      // ignore if already exists
    }

    await runAsync('COMMIT');
  } catch (e) {
    try { await runAsync('ROLLBACK'); } catch {}
    throw e;
  }
}

async function down() {
  await runAsync('BEGIN');
  try {
    await runAsync('DROP TABLE IF EXISTS film_items');
    // Do not drop rolls.film_item_id for safety
    await runAsync('COMMIT');
  } catch (e) {
    try { await runAsync('ROLLBACK'); } catch {}
    throw e;
  }
}

module.exports = { up, down };
