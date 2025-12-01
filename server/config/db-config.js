const path = require('path');
const fs = require('fs');

function getDbPath() {
  let dbPath;
  if (process.env.DATA_ROOT) {
    // Highest priority: custom data root
    dbPath = path.join(process.env.DATA_ROOT, 'film.db');
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } else if (process.env.USER_DATA) {
    // prefer electron userData folder if provided via env
    dbPath = path.join(process.env.USER_DATA, 'film.db');
    // ensure folder exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } else {
    dbPath = path.join(__dirname, '../film.db');
  }
  return dbPath;
}

module.exports = {
  getDbPath
};
