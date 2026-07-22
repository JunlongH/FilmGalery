const express = require('express');
const router = express.Router();
const db = require('../db');
const { allAsync, runAsync, getAsync } = require('../utils/db-helpers');
const PreparedStmt = require('../utils/prepared-statements');
const { isValidLatLng, isValidLatitude, isValidLongitude } = require('@filmgallery/shared/mapUtils');

// GET /api/locations/countries
router.get('/countries', async (req, res, next) => {
  try {
    const sql = `SELECT DISTINCT country_code, country_name FROM locations WHERE country_code IS NOT NULL ORDER BY country_name`;
    const rows = await allAsync(sql);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// GET /api/locations/:id
router.get('/:id', async (req, res, next) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  try {
    const row = await PreparedStmt.getAsync('locations.getById', [id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

// GET /api/locations?country=CN&query=shang
router.get('/', async (req, res, next) => {
  const { country, query, hasRecords, withCounts, includeUserCities } = req.query;
  const params = [];
  const where = [];
  if (country) { where.push('l.country_code = ?'); params.push(country); }
  if (query) { where.push('(l.city_name LIKE ? OR l.country_name LIKE ?)'); params.push(`%${query}%`, `%${query}%`); }

  // If hasRecords is 'true', only include locations that appear in photos or roll_locations
  // Fix: checking explicitly for 'true' string because req.query values are strings
  if (hasRecords === 'true') {
    where.push(`(
      EXISTS (SELECT 1 FROM photos p WHERE p.location_id = l.id)
      OR EXISTS (SELECT 1 FROM roll_locations rl WHERE rl.location_id = l.id)
    )`);
  }

  // Base select
  let select = `SELECT l.id, l.country_code, l.country_name, l.city_name, l.city_lat, l.city_lng`;

  // Optional counts for maintainability / future UI
  if (withCounts) {
    select += `,
      (SELECT COUNT(1) FROM photos p WHERE p.location_id = l.id) AS photo_count,
      (
        SELECT COUNT(DISTINCT rl.roll_id)
        FROM roll_locations rl
        WHERE rl.location_id = l.id
      ) AS roll_count`;
  }

  const sql = `
    ${select}
    FROM locations l
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY l.country_name, l.city_name
  `;
  try {
    let rows = await allAsync(sql, params);
    
    // Include user-entered cities from photos.city field
    // These are cities that users typed directly and aren't in the locations table
    if (includeUserCities === 'true' || hasRecords === 'true') {
      const userCitiesSql = `
        SELECT DISTINCT p.city as city_name
        FROM photos p
        WHERE p.city IS NOT NULL 
          AND p.city != ''
          AND p.location_id IS NULL
          ${query ? 'AND p.city LIKE ?' : ''}
      `;
      const userCityParams = query ? [`%${query}%`] : [];
      const userCities = await allAsync(userCitiesSql, userCityParams);
      
      // Add user-entered cities as virtual location entries with negative IDs
      // Using format "city::user" to distinguish from location table entries
      userCities.forEach((uc, idx) => {
        // Check if this city name already exists in the locations result
        const exists = rows.some(r => r.city_name?.toLowerCase() === uc.city_name?.toLowerCase());
        if (!exists && uc.city_name) {
          rows.push({
            id: `user::${uc.city_name}`,  // Special ID format for user-entered cities
            country_code: null,
            country_name: null,
            city_name: uc.city_name,
            city_lat: null,
            city_lng: null,
            is_user_city: true  // Flag to identify user-entered cities
          });
        }
      });
      
      // Re-sort to include new entries
      rows.sort((a, b) => {
        const aName = a.city_name || '';
        const bName = b.city_name || '';
        return aName.localeCompare(bName);
      });
    }
    
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// POST /api/locations
router.post('/', async (req, res, next) => {
  const { country_code, country_name, city_name, city_lat, city_lng } = req.body || {};
  if (!city_name) return res.status(400).json({ error: 'city_name required' });
  // Validate coordinates if provided (null is allowed — city may not have coords yet)
  if (!isValidLatLng(city_lat ?? null, city_lng ?? null)) {
    return res.status(400).json({ error: 'invalid city_lat/city_lng (must be both null or both in range)' });
  }
  try {
    const exists = await getAsync('SELECT id FROM locations WHERE country_code=? AND city_name=?', [country_code ?? null, city_name]);
    if (exists) return res.json({ id: exists.id, ok: true, existed: true });
    const result = await new Promise((resolve, reject) => {
      db.run('INSERT INTO locations (country_code, country_name, city_name, city_lat, city_lng) VALUES (?,?,?,?,?)', [country_code ?? null, country_name ?? null, city_name, city_lat ?? null, city_lng ?? null], function(err){
        if (err) reject(err); else resolve(this.lastID);
      });
    });
    res.status(201).json({ id: result, ok: true });
  } catch (e) {
    next(e);
  }
});

// PUT /api/locations/:id — update city coordinates/name
router.put('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  const { country_code, country_name, city_name, city_lat, city_lng } = req.body || {};
  if (!city_name) return res.status(400).json({ error: 'city_name required' });
  if (!isValidLatLng(city_lat ?? null, city_lng ?? null)) {
    return res.status(400).json({ error: 'invalid city_lat/city_lng (must be both null or both in range)' });
  }
  try {
    const result = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE locations SET country_code=?, country_name=?, city_name=?, city_lat=?, city_lng=? WHERE id=?`,
        [country_code ?? null, country_name ?? null, city_name, city_lat ?? null, city_lng ?? null, id],
        function(err){ if (err) reject(err); else resolve(this.changes); }
      );
    });
    if (result === 0) return res.status(404).json({ error: 'not found' });
    res.json({ id, ok: true });
  } catch (e) { next(e); }
});

// DELETE /api/locations/:id — refuse if referenced by photos or roll_locations
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  try {
    const refCount = await getAsync(
      `SELECT (SELECT COUNT(*) FROM photos WHERE location_id=?) + (SELECT COUNT(*) FROM roll_locations WHERE location_id=?) AS c`,
      [id, id]
    );
    if (refCount && refCount.c > 0) {
      return res.status(409).json({ error: 'location in use', refCount: refCount.c });
    }
    const result = await new Promise((resolve, reject) => {
      db.run('DELETE FROM locations WHERE id=?', [id], function(err){ if (err) reject(err); else resolve(this.changes); });
    });
    if (result === 0) return res.status(404).json({ error: 'not found' });
    res.json({ id, ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
