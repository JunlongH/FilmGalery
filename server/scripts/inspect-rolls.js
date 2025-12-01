const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = 'C:\\Users\\JunlongHuang\\OneDrive\\FilmGallery\\film.db';
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  console.log('--- ROLLS (First 5) ---');
  db.all('SELECT * FROM rolls LIMIT 5', (err, rows) => {
    if (err) console.error(err);
    else console.log(rows);
  });

  console.log('--- FILMS (All) ---');
  db.all('SELECT * FROM films', (err, rows) => {
    if (err) console.error(err);
    else console.log(rows);
  });
  
  console.log('--- SCHEMA: ROLLS ---');
  db.all("PRAGMA table_info(rolls)", (err, rows) => {
      if (err) console.error(err);
      else console.log(rows.map(r => r.name));
  });
});

// db.close() is called automatically when script ends? No, need to close.
// But serialize is async-ish. Let's put close in a timeout or callback chain.
setTimeout(() => db.close(), 1000);
