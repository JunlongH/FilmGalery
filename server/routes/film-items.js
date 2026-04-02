const express = require('express');
const router = express.Router();

const { getAsync } = require('../utils/db-helpers');
const {
  createFilmItemsFromPurchase,
  listFilmItems,
  getFilmItemById,
  updateFilmItem,
  softDeleteFilmItem,
  hardDeleteFilmItem,
} = require('../services/film/film-item-service');

// Batch purchase: create multiple film_items from a single order
router.post('/purchase-batch', async (req, res) => {
  try {
    const batch = req.body || {};
    const created = await createFilmItemsFromPurchase(batch);
    res.json({ ok: true, items: created });
  } catch (err) {
    console.error('[film-items] purchase-batch error', err);
    res.status(400).json({ ok: false, error: err.message || 'Failed to create film items batch' });
  }
});

// List film items
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const filters = {
      status: req.query.status ? req.query.status.split(',') : undefined,
      film_id: req.query.film_id,
      includeDeleted: req.query.includeDeleted === 'true',
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    };
    let items = await listFilmItems(filters);
    
    // Enrich items with film data using batch query (fixes N+1 problem)
    const filmIds = [...new Set(items.map(item => item.film_id).filter(Boolean))];
    if (filmIds.length > 0) {
      try {
        const { allAsync } = require('../utils/db-helpers');
        const placeholders = filmIds.map(() => '?').join(',');
        const filmRows = await allAsync(
          `SELECT id, name, brand, iso, format, category FROM films WHERE id IN (${placeholders})`,
          filmIds
        );
        const filmMap = new Map(filmRows.map(f => [f.id, f]));
        
        items = items.map(item => {
          const filmData = filmMap.get(item.film_id);
          if (filmData) {
            item.film_name = filmData.name || undefined;
            item.film_brand = filmData.brand || undefined;
            item.film_format = filmData.format || undefined;
            item.film_category = filmData.category || undefined;
            item.iso = filmData.iso || undefined;
          }
          return item;
        });
      } catch (e) {
        console.warn('[film-items] failed to batch fetch film data:', e.message);
      }
    }
    
    const duration = Date.now() - startTime;
    if (duration > 100) {
      console.warn(`[PERF] GET /api/film-items took ${duration}ms - consider optimization`);
    }
    res.json({ ok: true, items });
  } catch (err) {
    console.error('[film-items] list error', err);
    res.status(500).json({ ok: false, error: 'Failed to list film items' });
  }
});

// Get single film item
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await getFilmItemById(id);
    if (!item) return res.status(404).json({ ok: false, error: 'Film item not found' });

    // Fetch film details from films table if available
    if (item.film_id) {
      try {
        const filmRow = await getAsync('SELECT name, brand, iso, format, category FROM films WHERE id = ?', [item.film_id]);
        if (filmRow) {
          item.film_name = filmRow.name || undefined;
          item.film_brand = filmRow.brand || undefined;
          item.film_format = filmRow.format || undefined;
          item.film_category = filmRow.category || undefined;
          item.iso = filmRow.iso || undefined;
        }
      } catch (e) {
        console.warn('[film-items] failed to fetch film details', e);
      }
    }

    res.json({ ok: true, item });
  } catch (err) {
    console.error('[film-items] get error', err);
    res.status(500).json({ ok: false, error: 'Failed to get film item' });
  }
});

// Export shot logs as CSV
router.get('/:id/shot-logs/export', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await getFilmItemById(id);
    if (!item) return res.status(404).json({ ok: false, error: 'Film item not found' });

    let filmIso = null;
    if (item.film_id) {
      try {
        const row = await getAsync('SELECT iso FROM films WHERE id = ?', [item.film_id]);
        filmIso = row && row.iso ? row.iso : null;
      } catch (isoErr) {
        console.warn('[film-items] export iso lookup failed', isoErr.message || isoErr);
      }
    }

    const raw = item.shot_logs;
    if (!raw) return res.status(204).end();

    let logs = [];
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) logs = parsed;
    } catch (e) {
      console.error('[film-items] export parse error', e.message);
      return res.status(500).json({ ok: false, error: 'Invalid shot_logs format' });
    }

    const escapeCsv = (val) => {
      const v = val === undefined || val === null ? '' : String(val);
      if (v.includes('"') || v.includes(',') || v.includes('\n')) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    };

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="shot-logs-${id}.csv"`);
    res.write('date,shot_time,count,lens,focal_length,aperture,shutter_speed,country,city,detail_location,latitude,longitude,iso,caption\r\n');
    for (const entry of logs) {
      const date = entry.date || '';
      const shot_time = entry.shot_time || '';
      const count = entry.count || entry.shots || 0;
      const lens = entry.lens || '';
      const focal_length = entry.focal_length ?? '';
      const aperture = entry.aperture ?? '';
      const shutter = entry.shutter_speed || '';
      const country = entry.country || '';
      const city = entry.city || '';
      const detail = entry.detail_location || '';
      const latitude = entry.latitude ?? '';
      const longitude = entry.longitude ?? '';
      const iso = filmIso ?? '';
      const caption = entry.caption || '';

      res.write([
        escapeCsv(date),
        escapeCsv(shot_time),
        escapeCsv(count),
        escapeCsv(lens),
        escapeCsv(focal_length),
        escapeCsv(aperture),
        escapeCsv(shutter),
        escapeCsv(country),
        escapeCsv(city),
        escapeCsv(detail),
        escapeCsv(latitude),
        escapeCsv(longitude),
        escapeCsv(iso),
        escapeCsv(caption)
      ].join(',') + '\r\n');
    }
    res.end();
  } catch (err) {
    console.error('[film-items] export error', err);
    res.status(500).json({ ok: false, error: 'Failed to export shot logs' });
  }
});

// Update film item
router.put('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const id = Number(req.params.id);
    await updateFilmItem(id, req.body || {});
    const item = await getFilmItemById(id);
    const duration = Date.now() - startTime;
    if (duration > 100) {
      console.warn(`[PERF] PUT /api/film-items/${id} took ${duration}ms`);
    }
    res.json({ ok: true, item });
  } catch (err) {
    console.error('[film-items] update error', err);
    res.status(400).json({ ok: false, error: err.message || 'Failed to update film item' });
  }
});

// Delete film item (soft by default, hard if ?hard=true)
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const hardDelete = req.query.hard === 'true';
    
    if (hardDelete) {
      await hardDeleteFilmItem(id);
    } else {
      await softDeleteFilmItem(id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[film-items] delete error', err);
    res.status(400).json({ ok: false, error: err.message || 'Failed to delete film item' });
  }
});

module.exports = router;
