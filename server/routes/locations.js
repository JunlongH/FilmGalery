const express = require('express');
const router = express.Router();
const db = require('../db');
const { allAsync, runAsync, getAsync } = require('../utils/db-helpers');

// GET /api/locations/countries
router.get('/countries', async (req, res) => {
  try {
    const sql = `SELECT DISTINCT country_code, country_name FROM locations WHERE country_code IS NOT NULL ORDER BY country_name`;
    const rows = await allAsync(sql);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/locations/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  try {
    const row = await getAsync('SELECT * FROM locations WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/locations?country=CN&query=shang
router.get('/', async (req, res) => {
  const { country, query, hasRecords, withCounts } = req.query;
  const params = [];
  const where = [];
  if (country) { where.push('l.country_code = ?'); params.push(country); }
  if (query) { where.push('(l.city_name LIKE ? OR l.country_name LIKE ?)'); params.push(`%${query}%`, `%${query}%`); }

  // If hasRecords is truthy, only include locations that appear in photos or roll_locations
  if (hasRecords) {
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
    const rows = await allAsync(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/locations
router.post('/', async (req, res) => {
  const { country_code, country_name, city_name, city_lat, city_lng } = req.body || {};
  if (!city_name) return res.status(400).json({ error: 'city_name required' });
  try {
    const exists = await getAsync('SELECT id FROM locations WHERE country_code=? AND city_name=?', [country_code || null, city_name]);
    if (exists) return res.json({ id: exists.id, ok: true, existed: true });
    const result = await new Promise((resolve, reject) => {
      db.run('INSERT INTO locations (country_code, country_name, city_name, city_lat, city_lng) VALUES (?,?,?,?,?)', [country_code || null, country_name || null, city_name, city_lat || null, city_lng || null], function(err){
        if (err) reject(err); else resolve(this.lastID);
      });
    });
    res.status(201).json({ id: result, ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
