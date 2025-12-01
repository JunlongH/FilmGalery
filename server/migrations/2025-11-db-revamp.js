const db = require('../db');

const runAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) return reject(err);
    resolve(this);
  });
});

async function up() {
  await runAsync('BEGIN');
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY,
        country_code TEXT,
        country_name TEXT,
        city_name TEXT NOT NULL,
        city_lat REAL,
        city_lng REAL
      );
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS roll_locations (
        roll_id INTEGER NOT NULL,
        location_id INTEGER NOT NULL,
        PRIMARY KEY (roll_id, location_id)
      );
    `);

    try { await runAsync(`ALTER TABLE rolls ADD COLUMN develop_lab TEXT`); } catch {}
    try { await runAsync(`ALTER TABLE rolls ADD COLUMN develop_process TEXT`); } catch {}
    try { await runAsync(`ALTER TABLE rolls ADD COLUMN develop_date TEXT`); } catch {}
    try { await runAsync(`ALTER TABLE rolls ADD COLUMN purchase_cost REAL`); } catch {}
    try { await runAsync(`ALTER TABLE rolls ADD COLUMN develop_cost REAL`); } catch {}
    try { await runAsync(`ALTER TABLE rolls ADD COLUMN purchase_channel TEXT`); } catch {}
    try { await runAsync(`ALTER TABLE rolls ADD COLUMN batch_number TEXT`); } catch {}
    try { await runAsync(`ALTER TABLE rolls ADD COLUMN develop_note TEXT`); } catch {}

    try { await runAsync(`ALTER TABLE photos ADD COLUMN date_taken TEXT`); } catch {}
    try { await runAsync(`ALTER TABLE photos ADD COLUMN time_taken TEXT`); } catch {}
    try { await runAsync(`ALTER TABLE photos ADD COLUMN location_id INTEGER`); } catch {}
    try { await runAsync(`ALTER TABLE photos ADD COLUMN detail_location TEXT`); } catch {}
    try { await runAsync(`ALTER TABLE photos ADD COLUMN latitude REAL`); } catch {}
    try { await runAsync(`ALTER TABLE photos ADD COLUMN longitude REAL`); } catch {}

    await runAsync('COMMIT');
  } catch (e) {
    try { await runAsync('ROLLBACK'); } catch {}
    throw e;
  }
}

async function down() {
  await runAsync('BEGIN');
  try {
    await runAsync('DROP TABLE IF EXISTS roll_locations');
    await runAsync('DROP TABLE IF EXISTS locations');
    // Columns drop omitted for safety in rollback.
    await runAsync('COMMIT');
  } catch (e) {
    try { await runAsync('ROLLBACK'); } catch {}
    throw e;
  }
}

module.exports = { up, down };
