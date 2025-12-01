const sqlite3 = require('sqlite3');
const path = require('path');
const { getDbPath } = require('./config/db-config');

const dbPath = getDbPath();
const db = new sqlite3.Database(dbPath);

db.get("SELECT COUNT(*) as count FROM locations", (err, row) => {
    if (err) console.error(err);
    else console.log("Locations count:", row.count);
});

db.all("SELECT * FROM locations LIMIT 5", (err, rows) => {
    if (err) console.error(err);
    else console.log("Sample locations:", rows);
});
