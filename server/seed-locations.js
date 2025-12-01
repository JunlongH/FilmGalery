// Seed locations from local JSON if table empty
const fs = require('fs');
const path = require('path');
const db = require('./db');

function seedLocations() {
  return new Promise((resolve) => {
    db.get('SELECT COUNT(*) AS cnt FROM locations', (err, row) => {
      if (err) { console.error('[SEED] locations count failed', err.message); return resolve(false); }
      if (row && row.cnt > 0) { console.log('[SEED] locations already populated'); return resolve(true); }
      const file = path.join(__dirname, 'seed-locations.json');
      if (!fs.existsSync(file)) { console.warn('[SEED] seed-locations.json missing'); return resolve(false); }
      let data = [];
      try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('[SEED] parse JSON failed', e.message); }
      if (!Array.isArray(data) || data.length === 0) { console.warn('[SEED] empty seed data'); return resolve(false); }
      const stmt = db.prepare('INSERT INTO locations (country_code, country_name, city_name, city_lat, city_lng) VALUES (?,?,?,?,?)');
      for (const r of data) {
        stmt.run(r.country_code || null, r.country_name || null, r.city_name, r.city_lat || null, r.city_lng || null);
      }
      stmt.finalize((e) => {
        if (e) console.error('[SEED] finalize error', e.message); else console.log('[SEED] locations seeded', data.length);
        resolve(true);
      });
    });
  });
}

module.exports = { seedLocations };
