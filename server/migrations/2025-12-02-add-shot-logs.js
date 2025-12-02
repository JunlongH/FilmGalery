const db = require('../db');
const { runAsync } = require('../utils/db-helpers');

async function up() {
  console.log('Running migration: 2025-12-02-add-shot-logs');
  try {
    await runAsync(`ALTER TABLE film_items ADD COLUMN shot_logs TEXT`);
    console.log('Added shot_logs column');
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
}

async function down() {
  console.log('Down migration not implemented');
}

module.exports = { up, down };
