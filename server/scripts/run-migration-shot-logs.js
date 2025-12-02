const { up } = require('../migrations/2025-12-02-add-shot-logs');
const path = require('path');

if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(__dirname, '../film.db');
}

(async () => {
  try {
    await up();
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
})();
