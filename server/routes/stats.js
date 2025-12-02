const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/stats/summary
router.get('/summary', (req, res) => {
  const sql = `
    SELECT 
      (SELECT COUNT(*) FROM rolls) as total_rolls,
      (SELECT COUNT(*) FROM photos WHERE roll_id IN (SELECT id FROM rolls)) as total_photos,
      (
        -- Inventory Purchase
        (SELECT COALESCE(SUM(purchase_price + COALESCE(purchase_shipping_share, 0)), 0) FROM film_items WHERE deleted_at IS NULL)
        +
        -- Inventory Develop
        (SELECT COALESCE(SUM(develop_price), 0) FROM film_items WHERE deleted_at IS NULL)
        +
        -- Legacy Rolls (not linked to inventory)
        (SELECT COALESCE(SUM(purchase_cost + develop_cost), 0) FROM rolls WHERE film_item_id IS NULL)
      ) as total_cost
  `;
  db.get(sql, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row);
  });
});

// GET /api/stats/gear
router.get('/gear', (req, res) => {
  // Aggregate from both legacy columns and new roll_gear table
  // This is a bit complex, so we'll do two queries and merge in JS or use a UNION
  
  const sqlCameras = `
    SELECT value as name, COUNT(*) as count FROM roll_gear WHERE type='camera' AND value NOT IN ('', '-', '--', '—') GROUP BY value
    UNION ALL
    SELECT camera as name, COUNT(*) as count FROM rolls WHERE camera IS NOT NULL AND camera != '' AND camera NOT IN ('-','--','—') GROUP BY camera
  `;

  const sqlLenses = `
    SELECT value as name, COUNT(*) as count FROM roll_gear WHERE type='lens' AND value NOT IN ('', '-', '--', '—') GROUP BY value
    UNION ALL
    SELECT lens as name, COUNT(*) as count FROM rolls WHERE lens IS NOT NULL AND lens != '' AND lens NOT IN ('-','--','—') GROUP BY lens
  `;

  const sqlFilms = `
    SELECT f.name, COUNT(r.id) as count 
    FROM rolls r 
    JOIN films f ON r.filmId = f.id 
    GROUP BY f.name
  `;

  db.all(sqlCameras, (err, cameras) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.all(sqlLenses, (err2, lenses) => {
      if (err2) return res.status(500).json({ error: err2.message });

      db.all(sqlFilms, (err3, films) => {
        if (err3) return res.status(500).json({ error: err3.message });

        // Merge duplicates (e.g. "Nikon FM2" from legacy and "Nikon FM2" from gear table)
        const merge = (arr) => {
          const map = {};
          arr.forEach(item => {
            if (!item.name) return;
            map[item.name] = (map[item.name] || 0) + item.count;
          });
          return Object.entries(map)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
        };

        res.json({
          cameras: merge(cameras).slice(0, 10),
          lenses: merge(lenses).slice(0, 10),
          films: films.sort((a, b) => b.count - a.count).slice(0, 10)
        });
      });
    });
  });
});

// GET /api/stats/activity
router.get('/activity', (req, res) => {
  const sql = `
    SELECT strftime('%Y-%m', start_date) as month, COUNT(*) as count 
    FROM rolls 
    WHERE start_date IS NOT NULL 
    GROUP BY month 
    ORDER BY month ASC
  `;
  db.all(sql, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// GET /api/stats/costs
router.get('/costs', (req, res) => {
  // Costs are now aggregated from film_items (for inventory/spending accuracy)
  // plus legacy rolls that are not linked to film_items.
  
  const summary = `
    SELECT 
      (
        (SELECT COALESCE(SUM(purchase_price + COALESCE(purchase_shipping_share, 0)), 0) FROM film_items WHERE deleted_at IS NULL)
        +
        (SELECT COALESCE(SUM(purchase_cost), 0) FROM rolls WHERE film_item_id IS NULL)
      ) as total_purchase,
      (
        (SELECT COALESCE(SUM(develop_price), 0) FROM film_items WHERE deleted_at IS NULL)
        +
        (SELECT COALESCE(SUM(develop_cost), 0) FROM rolls WHERE film_item_id IS NULL)
      ) as total_develop,
      0 as avg_purchase, -- Deprecated or needs complex calc
      0 as avg_develop,  -- Deprecated
      (SELECT COUNT(*) FROM rolls) as roll_count
  `;
  
  const monthly = `
    WITH monthly_data AS (
      -- 1. Inventory Purchases
      SELECT 
        strftime('%Y-%m', COALESCE(purchase_date, created_at)) as month,
        SUM(purchase_price + COALESCE(purchase_shipping_share, 0)) as purchase,
        0 as develop
      FROM film_items
      WHERE deleted_at IS NULL
      GROUP BY month

      UNION ALL

      -- 2. Inventory Development
      SELECT 
        strftime('%Y-%m', develop_date) as month,
        0 as purchase,
        SUM(develop_price) as develop
      FROM film_items
      WHERE deleted_at IS NULL AND develop_date IS NOT NULL
      GROUP BY month

      UNION ALL

      -- 3. Legacy Rolls (Purchase & Develop)
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
      -- Inventory Items
      SELECT 
        f.name,
        COUNT(*) as count,
        SUM(fi.purchase_price + COALESCE(fi.purchase_shipping_share, 0)) as purchase,
        SUM(fi.develop_price) as develop
      FROM film_items fi
      JOIN films f ON fi.film_id = f.id
      WHERE fi.deleted_at IS NULL
      GROUP BY f.name

      UNION ALL

      -- Legacy Rolls
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

  db.get(summary, (err, summaryRow) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.all(monthly, (err2, monthlyRows) => {
      if (err2) return res.status(500).json({ error: err2.message });
      
      db.all(byFilm, (err3, filmRows) => {
        if (err3) return res.status(500).json({ error: err3.message });
        
        res.json({
          summary: summaryRow,
          monthly: monthlyRows,
          byFilm: filmRows
        });
      });
    });
  });
});

// GET /api/stats/ratings
router.get('/ratings', (req, res) => {
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

  db.all(distribution, (err, distRows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.all(avgByMonth, (err2, monthRows) => {
      if (err2) return res.status(500).json({ error: err2.message });
      
      db.all(avgByCamera, (err3, cameraRows) => {
        if (err3) return res.status(500).json({ error: err3.message });
        
        res.json({
          distribution: distRows,
          byMonth: monthRows,
          byCamera: cameraRows
        });
      });
    });
  });
});

// GET /api/stats/locations
router.get('/locations', (req, res) => {
  // Check if locations table exists
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='locations'", [], (checkErr, tableExists) => {
    if (!tableExists) {
      return res.json([]);
    }
    
    const sql = `
      SELECT 
        l.city_name,
        l.country_name,
        COUNT(DISTINCT p.id) as photo_count,
        COUNT(DISTINCT p.roll_id) as roll_count
      FROM photos p
      JOIN locations l ON p.location_id = l.id
      WHERE p.location_id IS NOT NULL
      GROUP BY l.id
      ORDER BY photo_count DESC
      LIMIT 15
    `;
    
    db.all(sql, (err, rows) => {
      if (err) {
        console.warn('Error fetching locations:', err.message);
        return res.json([]);
      }
      res.json(rows);
    });
  });
});

// GET /api/stats/temporal
router.get('/temporal', (req, res) => {
  // Day of week pattern (0=Sunday, 6=Saturday)
  const dayOfWeek = `
    SELECT 
      CAST(strftime('%w', taken_at) AS INTEGER) as day,
      COUNT(*) as count
    FROM photos
    WHERE taken_at IS NOT NULL
    GROUP BY day
    ORDER BY day ASC
  `;
  
  // Hour of day pattern
  const hourOfDay = `
    SELECT 
      CAST(strftime('%H', taken_at) AS INTEGER) as hour,
      COUNT(*) as count
    FROM photos
    WHERE taken_at IS NOT NULL
    GROUP BY hour
    ORDER BY hour ASC
  `;

  db.all(dayOfWeek, (err, dayRows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.all(hourOfDay, (err2, hourRows) => {
      if (err2) return res.status(500).json({ error: err2.message });
      
      res.json({
        byDay: dayRows,
        byHour: hourRows
      });
    });
  });
});

// GET /api/stats/themes
router.get('/themes', (req, res) => {
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
  
  db.all(sql, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// GET /api/stats/inventory
router.get('/inventory', (req, res) => {
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

  db.get(sqlValue, (err, valueRow) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.all(sqlExpiring, (err2, expiringRows) => {
      if (err2) return res.status(500).json({ error: err2.message });

      db.all(sqlChannel, (err3, channelRows) => {
        if (err3) return res.status(500).json({ error: err3.message });

        res.json({
          value: valueRow,
          expiring: expiringRows,
          channels: channelRows
        });
      });
    });
  });
});

module.exports = router;
