const db = require('../db');

const runAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) return reject(err);
    resolve(this);
  });
});

const allAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows || []);
  });
});

const getAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) return reject(err);
    resolve(row || null);
  });
});

async function validatePhotoUpdate(photoId, body) {
  const row = await getAsync('SELECT p.id, p.roll_id, r.start_date, r.end_date FROM photos p JOIN rolls r ON r.id=p.roll_id WHERE p.id=?', [photoId]);
  if (!row) throw new Error('Photo not found');
  const date_taken = body.date_taken;
  if (date_taken) {
    const d = new Date(date_taken);
    const s = row.start_date ? new Date(row.start_date) : null;
    const e = row.end_date ? new Date(row.end_date) : null;
    if (s && d < s) throw new Error('date_taken before roll start');
    if (e && d > e) throw new Error('date_taken after roll end');
  }
  let latitude = body.latitude, longitude = body.longitude;
  let location_id = body.location_id;
  if (location_id && (latitude === undefined || longitude === undefined)) {
    const loc = await getAsync('SELECT city_lat, city_lng FROM locations WHERE id=?', [location_id]);
    if (loc) { latitude = latitude ?? loc.city_lat; longitude = longitude ?? loc.city_lng; }
  }
  return {
    date_taken,
    time_taken: body.time_taken,
    location_id,
    detail_location: body.detail_location,
    latitude,
    longitude,
  };
}

module.exports = { runAsync, allAsync, getAsync, validatePhotoUpdate };
