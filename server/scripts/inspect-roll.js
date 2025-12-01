const sqlite3 = require('sqlite3');
const path = require('path');

// Use the active DB path (OneDrive)
const dbPath = 'C:\\Users\\JunlongHuang\\OneDrive\\FilmGallery\\film.db';
const db = new sqlite3.Database(dbPath);

const rollId = 33;

db.serialize(() => {
    console.log(`--- Inspecting Roll ${rollId} ---`);
    db.get('SELECT * FROM rolls WHERE id = ?', [rollId], (err, row) => {
        if (err) console.error(err);
        else console.log('Roll Data:', row);
        
        if (row && row.film_id) {
            console.log(`--- Inspecting Film ${row.film_id} ---`);
            db.get('SELECT * FROM films WHERE id = ?', [row.film_id], (err, film) => {
                if (err) console.error(err);
                else console.log('Film Data:', film);
            });
        } else {
            console.log('No film_id found for this roll.');
        }
    });
    
    console.log('--- Checking all films ---');
    db.all('SELECT * FROM films LIMIT 5', (err, rows) => {
        if (err) console.error(err);
        else console.log('Sample Films:', rows);
    });
});

// db.close() is called inside serialize or after, but async nature might be tricky. 
// Let's just wait a bit.
setTimeout(() => db.close(), 1000);
