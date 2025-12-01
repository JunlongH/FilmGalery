const sqlite3 = require('sqlite3');
const path = require('path');
const { getDbPath } = require('./config/db-config');

const dbPath = getDbPath();
console.log("Checking DB at:", dbPath);
const db = new sqlite3.Database(dbPath);

db.get("SELECT COUNT(*) as count FROM locations", (err, row) => {
    if (err) console.error(err);
    else console.log("Locations count:", row.count);
});
