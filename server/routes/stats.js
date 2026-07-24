const express = require('express');
const router = express.Router();
const { allAsync, getAsync } = require('../utils/db-helpers');

// GET /api/stats/summary
router.get('/summary', async (req, res, next) => {
  try {
    const { normalizeMode } = require('../../packages/shared/photographyMode');
    const mode = normalizeMode(req.query.mode);
    let photoCondition = '';
    if (mode === 'film') {
      photoCondition = "AND (p.source_type = 'film' OR p.source_type IS NULL)";
    } else if (mode === 'digital') {
      photoCondition = "AND p.source_type = 'digital'";
    }
    const sql = `
      SELECT 
        (SELECT COUNT(*) FROM rolls) as total_rolls,
        (SELECT COUNT(*) FROM photos p WHERE p.roll_id IN (SELECT id FROM rolls)${photoCondition}) as total_photos,
        (SELECT COUNT(*) FROM photos p WHERE p.source_type = 'digital') as total_digital_photos,
        (SELECT COUNT(*) FROM film_items WHERE deleted_at IS NULL AND status = 'in_stock') as inventory_in_stock,
        (SELECT COUNT(*) FROM film_items WHERE deleted_at IS NULL) as inventory_total,
        (
          -- Inventory Purchase
          (SELECT COALESCE(SUM(purchase_price + COALESCE(purchase_shipping_share, 0)), 0) FROM film_items WHERE deleted_at IS NULL)
          +
          -- Inventory Develop
          (SELECT COALESCE(SUM(develop_price + COALESCE(develop_shipping, 0)), 0) FROM film_items WHERE deleted_at IS NULL)
          +
          -- Legacy Rolls (not linked to inventory)
          (SELECT COALESCE(SUM(purchase_cost + develop_cost), 0) FROM rolls WHERE film_item_id IS NULL)
        ) as total_cost
    `;
    const row = await getAsync(sql);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/gear
// Statistics are based on PHOTO count (not roll count)
router.get('/gear', async (req, res, next) => {
  try {
    const { normalizeMode } = require('../../packages/shared/photographyMode');
    const mode = normalizeMode(req.query.mode);
    const sourceTypeCondition = mode === 'film'
      ? "(p.source_type = 'film' OR p.source_type IS NULL)"
      : mode === 'digital'
        ? "p.source_type = 'digital'"
        : '1=1';

    // Camera statistics - count photos per camera
    // Priority: photo.camera > roll.camera (equipment or text)
    const sqlCameras = `
      SELECT camera_name as name, COUNT(*) as count FROM (
        SELECT COALESCE(
          (SELECT brand || ' ' || model FROM equip_cameras WHERE id = p.camera_equip_id),
          p.camera,
          (SELECT brand || ' ' || model FROM equip_cameras WHERE id = r.camera_equip_id),
          r.camera
        ) as camera_name
        FROM photos p
        LEFT JOIN rolls r ON p.roll_id = r.id
        WHERE ${sourceTypeCondition}
      ) 
      WHERE camera_name IS NOT NULL AND camera_name != '' AND camera_name NOT IN ('-', '--', '—')
      GROUP BY camera_name
    `;

    // Lens statistics - count photos per lens
    // For fixed-lens cameras: always use camera's built-in lens description (ignore lens_equip_id)
    // For interchangeable lens cameras: use lens_equip_id or text
    const sqlLenses = `
      SELECT lens_name as name, COUNT(*) as count FROM (
        SELECT 
          CASE 
            -- Check if roll's camera is a fixed-lens camera
            WHEN EXISTS (
              SELECT 1 FROM equip_cameras c 
              WHERE c.id = COALESCE(p.camera_equip_id, r.camera_equip_id) 
              AND c.has_fixed_lens = 1
            ) THEN (
              -- Fixed lens camera: build full description from camera data
              SELECT 
                c.brand || ' ' || c.model || ' ' || 
                CAST(CAST(c.fixed_lens_focal_length AS INTEGER) AS TEXT) || 'mm f/' || 
                c.fixed_lens_max_aperture
              FROM equip_cameras c 
              WHERE c.id = COALESCE(p.camera_equip_id, r.camera_equip_id)
            )
            ELSE COALESCE(
              -- Photo's own lens
              (SELECT name FROM equip_lenses WHERE id = p.lens_equip_id),
              p.lens,
              -- Roll's lens
              (SELECT name FROM equip_lenses WHERE id = r.lens_equip_id),
              r.lens
            )
          END as lens_name
        FROM photos p
        LEFT JOIN rolls r ON p.roll_id = r.id
        WHERE ${sourceTypeCondition}
      )
      WHERE lens_name IS NOT NULL AND lens_name != '' AND lens_name NOT IN ('-', '--', '—')
      GROUP BY lens_name
    `;

    // Film statistics - count photos per film stock
    const sqlFilms = `
      SELECT f.name, COUNT(p.id) as count 
      FROM photos p
      LEFT JOIN rolls r ON p.roll_id = r.id
      JOIN films f ON r.filmId = f.id
      WHERE ${sourceTypeCondition}
      GROUP BY f.name
    `;

    const [cameras, lenses, films] = await Promise.all([
      allAsync(sqlCameras),
      allAsync(sqlLenses),
      allAsync(sqlFilms)
    ]);

    // Normalize lens name for deduplication
    // Handles: "35.0mm" → "35mm", "f/3.50" → "f/3.5"
    const normalizeLensName = (name) => {
      if (!name) return '';
      return name
        // Normalize decimal focal lengths: 35.0mm → 35mm
        .replace(/(\d+)\.0+mm/g, '$1mm')
        // Normalize decimal apertures: f/3.50 → f/3.5
        .replace(/f\/(\d+)\.0+$/g, 'f/$1')
        // Trim extra spaces
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Merge duplicates with normalization for lenses
    const merge = (arr, normalize = false) => {
      const map = {};
      arr.forEach(item => {
        if (!item.name) return;
        const key = normalize ? normalizeLensName(item.name) : item.name;
        map[key] = (map[key] || 0) + item.count;
      });
      return Object.entries(map)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    };

    res.json({
      cameras: merge(cameras).slice(0, 10),
      lenses: merge(lenses, true).slice(0, 10),
      films: films.sort((a, b) => b.count - a.count).slice(0, 10)
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/activity
router.get('/activity', async (req, res, next) => {
  try {
    const sql = `
      SELECT strftime('%Y-%m', start_date) as month, COUNT(*) as count 
      FROM rolls 
      WHERE start_date IS NOT NULL 
      GROUP BY month 
      ORDER BY month ASC
    `;
    const rows = await allAsync(sql);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/costs
router.get('/costs', async (req, res, next) => {
  try {
    const summary = `
      SELECT 
        (
          (SELECT COALESCE(SUM(purchase_price + COALESCE(purchase_shipping_share, 0)), 0) FROM film_items WHERE deleted_at IS NULL)
          +
          (SELECT COALESCE(SUM(purchase_cost), 0) FROM rolls WHERE film_item_id IS NULL)
        ) as total_purchase,
        (
          (SELECT COALESCE(SUM(develop_price + COALESCE(develop_shipping, 0)), 0) FROM film_items WHERE deleted_at IS NULL)
          +
          (SELECT COALESCE(SUM(develop_cost), 0) FROM rolls WHERE film_item_id IS NULL)
        ) as total_develop,
        0 as avg_purchase,
        0 as avg_develop,
        (SELECT COUNT(*) FROM rolls) as roll_count
    `;
    
    const monthly = `
      WITH monthly_data AS (
        SELECT 
          strftime('%Y-%m', COALESCE(purchase_date, created_at)) as month,
          SUM(purchase_price + COALESCE(purchase_shipping_share, 0)) as purchase,
          0 as develop
        FROM film_items
        WHERE deleted_at IS NULL
        GROUP BY month

        UNION ALL

        SELECT 
          strftime('%Y-%m', develop_date) as month,
          0 as purchase,
          SUM(develop_price + COALESCE(develop_shipping, 0)) as develop
        FROM film_items
        WHERE deleted_at IS NULL AND develop_date IS NOT NULL
        GROUP BY month

        UNION ALL

        SELECT 
          strftime('%Y-%m', start_date) as month,
          SUM(purchase_cost) as purchase,
          SUM(develop_cost) as develop
        FROM rolls
        WHERE film_item_id IS NULL AND start_date IS NOT NULL
        GROUP BY month
      )
      SELECT 
        month,
        SUM(purchase) as purchase,
        SUM(develop) as develop
      FROM monthly_data
      WHERE month IS NOT NULL
      GROUP BY month
      ORDER BY month ASC
    `;
    
    const byFilm = `
      WITH film_costs AS (
        SELECT 
          f.name,
          COUNT(*) as count,
          SUM(fi.purchase_price + COALESCE(fi.purchase_shipping_share, 0)) as purchase,
          SUM(fi.develop_price + COALESCE(fi.develop_shipping, 0)) as develop
        FROM film_items fi
        JOIN films f ON fi.film_id = f.id
        WHERE fi.deleted_at IS NULL
        GROUP BY f.name

        UNION ALL

        SELECT 
          f.name,
          COUNT(*) as count,
          SUM(r.purchase_cost) as purchase,
          SUM(r.develop_cost) as develop
        FROM rolls r
        JOIN films f ON r.filmId = f.id
        WHERE r.film_item_id IS NULL
        GROUP BY f.name
      )
      SELECT 
        name,
        SUM(count) as rolls,
        SUM(purchase) as purchase,
        SUM(develop) as develop
      FROM film_costs
      GROUP BY name
      ORDER BY purchase DESC
    `;

    const [summaryRow, monthlyRows, filmRows] = await Promise.all([
      getAsync(summary),
      allAsync(monthly),
      allAsync(byFilm)
    ]);

    res.json({
      summary: summaryRow,
      monthly: monthlyRows,
      byFilm: filmRows
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/ratings
router.get('/ratings', async (req, res, next) => {
  try {
    const distribution = `
      SELECT rating, COUNT(*) as count
      FROM photos
      WHERE rating IS NOT NULL AND rating > 0
      GROUP BY rating
      ORDER BY rating ASC
    `;
    
    const avgByMonth = `
      SELECT 
        strftime('%Y-%m', taken_at) as month,
        AVG(rating) as avg_rating,
        COUNT(*) as count
      FROM photos
      WHERE taken_at IS NOT NULL AND rating IS NOT NULL AND rating > 0
      GROUP BY month
      ORDER BY month ASC
    `;
    
    const avgByCamera = `
      SELECT 
        camera,
        AVG(rating) as avg_rating,
        COUNT(*) as count
      FROM photos
      WHERE camera IS NOT NULL AND camera != '' AND rating IS NOT NULL AND rating > 0
      GROUP BY camera
      ORDER BY avg_rating DESC
      LIMIT 10
    `;

    const [distRows, monthRows, cameraRows] = await Promise.all([
      allAsync(distribution),
      allAsync(avgByMonth),
      allAsync(avgByCamera)
    ]);

    res.json({
      distribution: distRows,
      byMonth: monthRows,
      byCamera: cameraRows
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/locations
router.get('/locations', async (req, res, next) => {
  try {
    // Combine locations from both:
    // 1. photos linked to locations table (via location_id)
    // 2. photos with direct city/country fields
    const sql = `
      WITH combined_locations AS (
        -- Photos linked to locations table
        SELECT 
          l.city_name as city_name,
          l.country_name as country_name,
          p.id as photo_id,
          p.roll_id as roll_id
        FROM photos p
        JOIN locations l ON p.location_id = l.id
        WHERE p.location_id IS NOT NULL AND l.city_name IS NOT NULL AND l.city_name != ''
        
        UNION ALL
        
        -- Photos with direct city field (not linked to locations table or different city)
        SELECT 
          p.city as city_name,
          p.country as country_name,
          p.id as photo_id,
          p.roll_id as roll_id
        FROM photos p
        WHERE p.city IS NOT NULL AND p.city != ''
          AND (p.location_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM locations l 
            WHERE l.id = p.location_id AND l.city_name = p.city
          ))
      )
      SELECT 
        city_name,
        country_name,
        COUNT(DISTINCT photo_id) as photo_count,
        COUNT(DISTINCT roll_id) as roll_count
      FROM combined_locations
      WHERE city_name IS NOT NULL AND city_name != ''
      GROUP BY city_name
      ORDER BY photo_count DESC
      LIMIT 30
    `;
    
    const rows = await allAsync(sql);
    res.json(rows);
  } catch (err) {
    console.warn('Error fetching locations:', err.message);
    res.json([]);
  }
});

// GET /api/stats/temporal
router.get('/temporal', async (req, res, next) => {
  try {
    const dayOfWeek = `
      SELECT 
        CAST(strftime('%w', taken_at) AS INTEGER) as day,
        COUNT(*) as count
      FROM photos
      WHERE taken_at IS NOT NULL
      GROUP BY day
      ORDER BY day ASC
    `;
    
    const hourOfDay = `
      SELECT 
        CAST(strftime('%H', taken_at) AS INTEGER) as hour,
        COUNT(*) as count
      FROM photos
      WHERE taken_at IS NOT NULL
      GROUP BY hour
      ORDER BY hour ASC
    `;

    const [dayRows, hourRows] = await Promise.all([
      allAsync(dayOfWeek),
      allAsync(hourOfDay)
    ]);

    res.json({
      byDay: dayRows,
      byHour: hourRows
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/themes
router.get('/themes', async (req, res, next) => {
  try {
    const sql = `
      SELECT 
        t.name,
        COUNT(pt.photo_id) as photo_count
      FROM tags t
      LEFT JOIN photo_tags pt ON t.id = pt.tag_id
      GROUP BY t.id
      HAVING photo_count > 0
      ORDER BY photo_count DESC
      LIMIT 15
    `;
    
    const rows = await allAsync(sql);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/inventory
router.get('/inventory', async (req, res, next) => {
  try {
    const sqlValue = `
      SELECT 
        SUM(purchase_price + COALESCE(purchase_shipping_share, 0)) as total_value,
        COUNT(*) as total_count
      FROM film_items 
      WHERE status = 'in_stock' AND deleted_at IS NULL
    `;

    const sqlExpiring = `
      SELECT f.name as film_name, fi.* 
      FROM film_items fi
      LEFT JOIN films f ON fi.film_id = f.id
      WHERE fi.status = 'in_stock' 
        AND fi.deleted_at IS NULL 
        AND fi.expiry_date IS NOT NULL 
        AND fi.expiry_date < date('now', '+180 days')
      ORDER BY fi.expiry_date ASC
    `;

    const sqlChannel = `
      SELECT purchase_channel, COUNT(*) as count, SUM(purchase_price) as total_spend
      FROM film_items
      WHERE deleted_at IS NULL
      GROUP BY purchase_channel
      ORDER BY total_spend DESC
    `;

    const [valueRow, expiringRows, channelRows] = await Promise.all([
      getAsync(sqlValue),
      allAsync(sqlExpiring),
      allAsync(sqlChannel)
    ]);

    res.json({
      value: valueRow,
      expiring: expiringRows,
      channels: channelRows
    });
  } catch (err) {
    next(err);
  }
});

// ─── Digital-only statistics ───

router.get('/digital/cameras', async (req, res, next) => {
  try {
    const rows = await allAsync(`
      SELECT COALESCE(
        (SELECT brand || ' ' || model FROM equip_cameras WHERE id = p.camera_equip_id),
        p.camera
      ) as camera_name, COUNT(*) as count
      FROM photos p
      WHERE p.source_type = 'digital' AND p.deleted_at IS NULL
      GROUP BY camera_name
      HAVING camera_name IS NOT NULL AND camera_name != ''
      ORDER BY count DESC
      LIMIT 20
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/digital/focal-lengths', async (req, res, next) => {
  try {
    const rows = await allAsync(`
      SELECT
        CASE
          WHEN p.focal_length IS NULL THEN 'unknown'
          WHEN p.focal_length < 18 THEN '< 18mm'
          WHEN p.focal_length < 28 THEN '18-27mm'
          WHEN p.focal_length < 50 THEN '28-49mm'
          WHEN p.focal_length < 85 THEN '50-84mm'
          WHEN p.focal_length < 135 THEN '85-134mm'
          WHEN p.focal_length < 300 THEN '135-299mm'
          ELSE '>= 300mm'
        END as focal_range, COUNT(*) as count
      FROM photos p
      WHERE p.source_type = 'digital' AND p.deleted_at IS NULL
      GROUP BY focal_range
      ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/digital/monthly', async (req, res, next) => {
  try {
    const rows = await allAsync(`
      SELECT strftime('%Y-%m', date_taken) as month, COUNT(*) as count
      FROM photos
      WHERE source_type = 'digital' AND deleted_at IS NULL AND date_taken IS NOT NULL
      GROUP BY month
      ORDER BY month ASC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/digital/sensors', async (req, res, next) => {
  try {
    const rows = await allAsync(`
      SELECT ec.sensor_format as format, COUNT(*) as count
      FROM photos p
      JOIN equip_cameras ec ON p.camera_equip_id = ec.id
      WHERE p.source_type = 'digital' AND p.deleted_at IS NULL AND ec.sensor_format IS NOT NULL
      GROUP BY ec.sensor_format
      ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
