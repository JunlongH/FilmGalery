const sqlite3 = require('sqlite3');
const path = require('path');

// Use the active DB path (OneDrive)
const dbPath = 'C:\\Users\\JunlongHuang\\OneDrive\\FilmGallery\\film.db';
const db = new sqlite3.Database(dbPath);

db.all('SELECT id, path, filename FROM photos LIMIT 5', (err, rows) => {
  if (err) {
    console.error(err);
  } else {
    console.log('Sample Photos:', rows);
  }
  db.close();
});
