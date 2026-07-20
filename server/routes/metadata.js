const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/metadata/options
// Returns distinct cameras, lenses, and photographers
// Lenses come from: 1) equip_lenses table, 2) fixed-lens cameras (virtual lenses)
router.get('/options', async (req, res, next) => {
  const queries = {
    cameras: `
      SELECT DISTINCT camera as value FROM rolls WHERE camera IS NOT NULL AND camera != "" AND camera NOT IN ('-','--','—')
      UNION
      SELECT DISTINCT camera as value FROM photos WHERE camera IS NOT NULL AND camera != "" AND camera NOT IN ('-','--','—')
      ORDER BY value
    `,
    // Get lenses from equipment table only (not from rolls/photos to avoid duplicates)
    equipLenses: `
      SELECT name as value FROM equip_lenses 
      WHERE deleted_at IS NULL AND name IS NOT NULL AND name != ''
      ORDER BY name
    `,
    // Get fixed-lens cameras to generate virtual lens entries
    fixedLensCameras: `
      SELECT name, fixed_lens_focal_length, fixed_lens_max_aperture 
      FROM equip_cameras 
      WHERE has_fixed_lens = 1 AND deleted_at IS NULL
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

  // Generate virtual lens name from fixed-lens camera info
  const formatFixedLens = (camera) => {
    const focal = camera.fixed_lens_focal_length ? `${Math.round(camera.fixed_lens_focal_length)}mm` : '';
    const aperture = camera.fixed_lens_max_aperture ? `f/${camera.fixed_lens_max_aperture}` : '';
    const specs = [focal, aperture].filter(Boolean).join(' ');
    return specs ? `${camera.name} ${specs}` : camera.name;
  };

  try {
    const [cameraRows, equipLensRows, fixedLensCameraRows, photographerRows, yearRows] = await Promise.all([
      runAll(queries.cameras),
      runAll(queries.equipLenses),
      runAll(queries.fixedLensCameras),
      runAll(queries.photographers),
      runAll(queries.years)
    ]);

    // Combine equipment lenses + virtual lenses from fixed-lens cameras
    const lensSet = new Set(equipLensRows.map(r => r.value));
    
    // Add virtual lenses from fixed-lens cameras
    for (const cam of fixedLensCameraRows) {
      const virtualLens = formatFixedLens(cam);
      lensSet.add(virtualLens);
    }
    
    const lenses = Array.from(lensSet).sort((a, b) => a.localeCompare(b));

    res.json({
      cameras: cameraRows.map(r => r.value),
      lenses,
      photographers: photographerRows.map(r => r.value),
      years: yearRows.map(r => r.value)
    });
  } catch (err) {
    console.error('[metadata] Error fetching options', err);
    next(err);
  }
});

module.exports = router;
