const { up } = require('../migrations/2025-12-02-add-load-dates');
const path = require('path');

// Ensure DB_PATH is set if not provided
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
