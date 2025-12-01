const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

// Config
const dbPath = 'C:\\Users\\JunlongHuang\\OneDrive\\FilmGallery\\film.db';
const uploadsDir = 'C:\\Users\\JunlongHuang\\OneDrive\\FilmGallery\\uploads';

console.log('Checking files in:', uploadsDir);

if (!fs.existsSync(dbPath)) {
    console.error('DB not found at', dbPath);
    process.exit(1);
}

const db = new sqlite3.Database(dbPath);

db.all('SELECT id, full_rel_path, thumb_rel_path FROM photos LIMIT 10', (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }

    rows.forEach(row => {
        const fullPath = row.full_rel_path ? path.join(uploadsDir, row.full_rel_path) : null;
        const thumbPath = row.thumb_rel_path ? path.join(uploadsDir, row.thumb_rel_path) : null;

        console.log(`Photo ${row.id}:`);
        if (fullPath) {
            console.log(`  Full: ${fullPath} -> ${fs.existsSync(fullPath) ? 'OK' : 'MISSING'}`);
        }
        if (thumbPath) {
            console.log(`  Thumb: ${thumbPath} -> ${fs.existsSync(thumbPath) ? 'OK' : 'MISSING'}`);
        }
    });
    db.close();
});
