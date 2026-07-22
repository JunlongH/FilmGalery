const db = require('../db');

const runAsync = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const maxRetries = 3;
    
    const attempt = () => {
      db.run(sql, params, function(err) {
        if (err) {
          if (err.code === 'SQLITE_BUSY' && retries < maxRetries) {
            retries++;
            console.warn(`[DB] SQLITE_BUSY, retrying (${retries}/${maxRetries})...`);
            setTimeout(attempt, 200);
            return;
          }
          return reject(err);
        }
        resolve(this);
      });
    };
    attempt();
  });
};

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

/**
 * Y.1 (P0-3): Opt-in pagination helper for list endpoints.
 *
 * Returns either:
 *   - When `req.query.page` is absent: { paginated: false, rows } — caller
 *     res.json(rows) for backward compatibility.
 *   - When `req.query.page` is present: { paginated: true, payload } where
 *     payload = { data, total, page, pageSize, hasMore }.
 *
 * The total count is computed by wrapping the base SQL in
 * `SELECT COUNT(*) FROM (<baseSql>)`. We strip the trailing ORDER BY clause
 * from the count subquery to avoid wasted work.
 *
 * @param {string} baseSql - SQL with WHERE/JOIN/ORDER BY but NO LIMIT
 * @param {Array} params - bound parameters for the WHERE clause
 * @param {object} query - req.query (express)
 * @param {number} [defaultPageSize=1000] - page size when pageSize omitted
 * @returns {Promise<{paginated: boolean, rows?: Array, payload?: object}>}
 */
async function paginateQuery(baseSql, params, query, defaultPageSize = 1000) {
  const pageRaw = parseInt(query.page, 10);
  if (!Number.isFinite(pageRaw) || pageRaw < 1) {
    // Backward compat: no pagination requested.
    const rows = await allAsync(baseSql, params);
    return { paginated: false, rows };
  }
  let pageSize = parseInt(query.pageSize, 10);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = defaultPageSize;
  // Hard cap to prevent abuse
  if (pageSize > 5000) pageSize = 5000;
  const offset = (pageRaw - 1) * pageSize;

  // v4-review: previously this stripped trailing ORDER BY via regex, but the
  // regex was fragile (matched first occurrence, not last, breaking on
  // subqueries containing ORDER BY). SQLite accepts `SELECT COUNT(*) FROM
  // (<sql with ORDER BY>)` — the ORDER BY is a no-op inside a COUNT subquery
  // (verified via direct SQLite test). So we just wrap the base SQL as-is.
  // This eliminates the regex entirely — no edge cases, no future landmines.
  const countSql = `SELECT COUNT(*) AS cnt FROM (${baseSql})`;
  const countRow = await getAsync(countSql, params);
  const total = countRow ? countRow.cnt : 0;

  const pageSql = `${baseSql} LIMIT ? OFFSET ?`;
  const data = await allAsync(pageSql, [...params, pageSize, offset]);

  return {
    paginated: true,
    payload: {
      data,
      total,
      page: pageRaw,
      pageSize,
      hasMore: offset + data.length < total,
    },
  };
}

module.exports = { runAsync, allAsync, getAsync, validatePhotoUpdate, paginateQuery };
