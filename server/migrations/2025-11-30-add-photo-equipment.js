const db = require('../db');

module.exports = {
  up: () => {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // Add columns if they don't exist. SQLite doesn't support IF NOT EXISTS for ADD COLUMN directly in all versions,
        // but we can try adding them one by one. If they exist, it might throw, so we can wrap or just run.
        // A safer way in simple migration scripts without a framework is to just run it and ignore specific errors,
        // or check pragma table_info. For simplicity here, we'll run alter table.
        
        const columns = [
          'ALTER TABLE photos ADD COLUMN camera TEXT',
          'ALTER TABLE photos ADD COLUMN lens TEXT',
          'ALTER TABLE photos ADD COLUMN photographer TEXT'
        ];

        let completed = 0;
        columns.forEach(sql => {
          db.run(sql, (err) => {
            // Ignore error if column exists (duplicate column name)
            if (err && !err.message.includes('duplicate column name')) {
              console.error('Migration error:', err);
            }
            completed++;
            if (completed === columns.length) resolve();
          });
        });
      });
    });
  }
};
