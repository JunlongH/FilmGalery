const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/metadata/options
// Returns distinct cameras, lenses, and photographers from rolls/photos + lenses found in film_items.shot_logs
router.get('/options', async (req, res) => {
  const queries = {
    cameras: `
      SELECT DISTINCT camera as value FROM rolls WHERE camera IS NOT NULL AND camera != "" AND camera NOT IN ('-','--','—')
      UNION
      SELECT DISTINCT camera as value FROM photos WHERE camera IS NOT NULL AND camera != "" AND camera NOT IN ('-','--','—')
      ORDER BY value
    `,
    lenses: `
      SELECT DISTINCT lens as value FROM rolls WHERE lens IS NOT NULL AND lens != "" AND lens NOT IN ('-','--','—')
      UNION
      SELECT DISTINCT lens as value FROM photos WHERE lens IS NOT NULL AND lens != "" AND lens NOT IN ('-','--','—')
      ORDER BY value
    `,
    photographers: `
      SELECT DISTINCT photographer as value FROM rolls WHERE photographer IS NOT NULL AND photographer != "" AND photographer NOT IN ('-','--','—')
      UNION
      SELECT DISTINCT photographer as value FROM photos WHERE photographer IS NOT NULL AND photographer != "" AND photographer NOT IN ('-','--','—')
      ORDER BY value
    `,
    years: `
      SELECT DISTINCT strftime('%Y', start_date) AS value FROM rolls WHERE start_date IS NOT NULL AND start_date != ""
      UNION
      SELECT DISTINCT strftime('%Y', date_taken) AS value FROM photos WHERE date_taken IS NOT NULL AND date_taken != ""
      ORDER BY value DESC
    `
  };

  const runAll = (sql) => new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

  const parseShotLogLenses = (rows) => {
    const lensSet = new Set();
    for (const row of rows) {
      if (!row || !row.shot_logs) continue;
      try {
        const parsed = typeof row.shot_logs === 'string' ? JSON.parse(row.shot_logs) : row.shot_logs;
        if (!Array.isArray(parsed)) continue;
        for (const entry of parsed) {
          const lens = (entry && entry.lens ? String(entry.lens).trim() : '');
          if (lens) lensSet.add(lens);
        }
      } catch (err) {
        console.warn('[metadata] Failed to parse shot_logs lens', err.message);
      }
    }
    return Array.from(lensSet);
  };

  try {
    const [cameraRows, lensRows, photographerRows, yearRows, shotLogRows] = await Promise.all([
      runAll(queries.cameras),
      runAll(queries.lenses),
      runAll(queries.photographers),
      runAll(queries.years),
      runAll(`SELECT shot_logs FROM film_items WHERE shot_logs IS NOT NULL AND shot_logs != ''`)
    ]);

    const lensSet = new Set(lensRows.map(r => r.value));
    parseShotLogLenses(shotLogRows).forEach(l => lensSet.add(l));
    const lenses = Array.from(lensSet).sort((a, b) => a.localeCompare(b));

    res.json({
      cameras: cameraRows.map(r => r.value),
      lenses,
      photographers: photographerRows.map(r => r.value),
      years: yearRows.map(r => r.value)
    });
  } catch (err) {
    console.error('[metadata] Error fetching options', err);
    res.status(500).json({ error: 'Failed to load metadata options' });
  }
});

module.exports = router;
