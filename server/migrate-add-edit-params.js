const db = require('./db');

const sql = `
  ALTER TABLE photos ADD COLUMN edit_params TEXT;
`;

db.serialize(() => {
  db.run(sql, (err) => {
    if (err) {
      if (err.message.includes('duplicate column name')) {
        console.log('Column edit_params already exists.');
      } else {
        console.error('Failed to add edit_params column:', err);
      }
    } else {
      console.log('Added edit_params column to photos table.');
    }
    db.close();
  });
});
