const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/metadata/options
// Returns distinct cameras, lenses, and photographers from both rolls and photos tables
router.get('/options', (req, res) => {
  const queries = {
    cameras: `
      SELECT DISTINCT camera as value FROM rolls WHERE camera IS NOT NULL AND camera != ""
      UNION
      SELECT DISTINCT camera as value FROM photos WHERE camera IS NOT NULL AND camera != ""
      ORDER BY value
    `,
    lenses: `
      SELECT DISTINCT lens as value FROM rolls WHERE lens IS NOT NULL AND lens != ""
      UNION
      SELECT DISTINCT lens as value FROM photos WHERE lens IS NOT NULL AND lens != ""
      ORDER BY value
    `,
    photographers: `
      SELECT DISTINCT photographer as value FROM rolls WHERE photographer IS NOT NULL AND photographer != ""
      UNION
      SELECT DISTINCT photographer as value FROM photos WHERE photographer IS NOT NULL AND photographer != ""
      ORDER BY value
    `,
    years: `
      SELECT DISTINCT strftime('%Y', start_date) AS value FROM rolls WHERE start_date IS NOT NULL AND start_date != ""
      UNION
      SELECT DISTINCT strftime('%Y', date_taken) AS value FROM photos WHERE date_taken IS NOT NULL AND date_taken != ""
      ORDER BY value DESC
    `
  };

  const results = {};
  let completed = 0;
  const keys = Object.keys(queries);

  if (keys.length === 0) return res.json({});

  keys.forEach(key => {
    db.all(queries[key], (err, rows) => {
      if (err) {
        console.error(`Error fetching ${key}`, err);
        results[key] = [];
      } else {
        results[key] = rows.map(r => r.value);
      }
      completed++;
      if (completed === keys.length) {
        res.json(results);
      }
    });
  });
});

module.exports = router;
