/**
 * App Config Route — singleton configuration (id=1).
 *
 * GET    /api/app-config            — read singleton
 * PUT    /api/app-config            — update fields
 * POST   /api/app-config/onboarding — one-time onboarding choice
 *
 * @module server/routes/app-config
 */

const express = require('express');
const router = express.Router();
const { runAsync, getAsync } = require('../utils/db-helpers');

const WRITABLE_FIELDS = [
  'photography_mode',
  'default_import_dir',
  'auto_organize',
  'duplicate_detection',
  'onboarding_completed',
  'default_source_filter',
  'show_film_section',
  'show_digital_section',
  'digital_enabled',
];

// GET /api/app-config
router.get('/', async (req, res, next) => {
  try {
    let row = await getAsync('SELECT * FROM app_config WHERE id = 1');
    if (!row) {
      await runAsync('INSERT OR IGNORE INTO app_config (id, photography_mode) VALUES (1, ?)', ['all']);
      row = await getAsync('SELECT * FROM app_config WHERE id = 1');
    }
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// PUT /api/app-config  body: { photography_mode?, default_import_dir?, ... }
router.put('/', async (req, res, next) => {
  try {
    const sets = [];
    const params = [];
    for (const f of WRITABLE_FIELDS) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        params.push(req.body[f]);
      }
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    sets.push("updated_at = CURRENT_TIMESTAMP");
    params.push(1);
    await runAsync(`UPDATE app_config SET ${sets.join(', ')} WHERE id = ?`, params);
    const row = await getAsync('SELECT * FROM app_config WHERE id = 1');
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// POST /api/app-config/onboarding  body: { choice, default_source_filter, show_film_section, show_digital_section, digital_enabled }
router.post('/onboarding', async (req, res, next) => {
  try {
    const { choice } = req.body;
    const modeMap = { film: 'film', digital: 'digital', both: 'all' };
    const mode = modeMap[choice];
    if (!mode) {
      return res.status(400).json({ error: "choice must be 'film', 'digital', or 'both'" });
    }
    const sets = [
      'photography_mode = ?',
      'default_source_filter = ?',
      'show_film_section = ?',
      'show_digital_section = ?',
      'digital_enabled = ?',
      'onboarding_completed = 1',
      'updated_at = CURRENT_TIMESTAMP',
    ];
    const params = [
      mode,
      req.body.default_source_filter ?? mode,
      req.body.show_film_section ?? 1,
      req.body.show_digital_section ?? 1,
      req.body.digital_enabled ?? 1,
    ];
    params.push(1);
    await runAsync(`UPDATE app_config SET ${sets.join(', ')} WHERE id = ?`, params);
    const row = await getAsync('SELECT * FROM app_config WHERE id = 1');
    res.json(row);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
