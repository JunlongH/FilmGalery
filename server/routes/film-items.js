const express = require('express');
const router = express.Router();

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
    const items = await listFilmItems(filters);
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
    res.json({ ok: true, item });
  } catch (err) {
    console.error('[film-items] get error', err);
    res.status(500).json({ ok: false, error: 'Failed to get film item' });
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
