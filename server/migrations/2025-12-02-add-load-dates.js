const db = require('../db');

const runAsync = (sql) => new Promise((resolve, reject) => {
  db.run(sql, [], function(err) {
    if (err) return reject(err);
    resolve(this);
  });
});

async function up() {
  console.log('Running migration: 2025-12-02-add-load-dates');
  try {
    await runAsync(`ALTER TABLE film_items ADD COLUMN loaded_date TEXT`);
    console.log('Added loaded_date column');
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
  }

  try {
    await runAsync(`ALTER TABLE film_items ADD COLUMN finished_date TEXT`);
    console.log('Added finished_date column');
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
}

async function down() {
  // SQLite does not support DROP COLUMN easily in older versions, 
  // and usually we don't need to drop columns for "down" in this context.
  console.log('Down migration not implemented for adding columns in SQLite');
}

module.exports = { up, down };
