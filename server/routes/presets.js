const express = require('express');
const { runAsync, allAsync } = require('../utils/db-helpers');
const { FILM_PROFILES } = require('../../packages/shared/filmLabConstants');

const router = express.Router();

// List all presets (optionally filter by category)
router.get('/', async (req, res, next) => {
  try {
    const { category } = req.query;
    const queryParams = [];
    // Read from both params_json (new) and params (old) for compatibility
    let sql = 'SELECT id, name, category, description, params_json, params, created_at, updated_at FROM presets';
    if (category) {
      sql += ' WHERE category = ?';
      queryParams.push(category);
    }
    sql += ' ORDER BY created_at DESC';

    const rows = await allAsync(sql, queryParams);
    const presets = rows.map(r => ({
      id: r.id,
      name: r.name,
      category: r.category || null,
      description: r.description || '',
      // Prefer params_json, fallback to params for old data
      params: safeParseJSON(r.params_json, null) || safeParseJSON(r.params, {}),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
    res.json({ presets });
  } catch (err) {
    console.error('Failed to list presets', err.message);
    next(err);
  }
});

// Create a new preset
router.post('/', async (req, res, next) => {
  try {
    const { name, category, description, params } = req.body || {};
    if (!name || !params) {
      return res.status(400).json({ error: 'name and params are required' });
    }
    const paramsJson = JSON.stringify(params);
    // Write to both params and params_json for backward compatibility with old schema
    const sql = 'INSERT INTO presets (name, category, description, params, params_json) VALUES (?, ?, ?, ?, ?)';
    const result = await runAsync(sql, [name, category || null, description || null, paramsJson, paramsJson]);
    res.json({
      ok: true,
      id: result.lastID,
      name,
      category: category || null,
      description: description || '',
      params,
    });
  } catch (err) {
    console.error('Failed to create preset', err.message);
    next(err);
  }
});

// Update an existing preset
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, category, description, params } = req.body || {};
    if (!name || !params) {
      return res.status(400).json({ error: 'name and params are required' });
    }
    const paramsJson = JSON.stringify(params);
    // Write to both params and params_json for backward compatibility
    const sql = 'UPDATE presets SET name = ?, category = ?, description = ?, params = ?, params_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
    await runAsync(sql, [name, category || null, description || null, paramsJson, paramsJson, id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to update preset', err.message);
    next(err);
  }
});

// Delete a preset
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const sql = 'DELETE FROM presets WHERE id = ?';
    await runAsync(sql, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete preset', err.message);
    next(err);
  }
});

function safeParseJSON(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// ============================================================================
// Film Curve Profiles API
// ============================================================================

// List all film curve profiles (built-in from constants + custom from database)
router.get('/film-curves', async (req, res, next) => {
  try {
    // 1. Built-in profiles from constants
    const builtinProfiles = Object.entries(FILM_PROFILES).map(([key, profile]) => ({
      id: null,
      key,
      name: profile.name,
      gamma: profile.gamma,
      dMin: profile.dMin,
      dMax: profile.dMax,
      category: key.includes('tri') || key.includes('tmax') || key.includes('hp5') || key.includes('delta') || key.includes('acros') ? 'bw_negative' : 'color_negative',
      isBuiltin: true,
      createdAt: null,
      updatedAt: null,
    }));
    
    // 2. Custom profiles from database
    const sql = 'SELECT id, key, name, gamma, d_min, d_max, category, is_builtin, created_at, updated_at FROM film_curve_profiles ORDER BY name ASC';
    const rows = await allAsync(sql, []);
    const customProfiles = rows.map(r => ({
      id: r.id,
      key: r.key,
      name: r.name,
      gamma: r.gamma,
      dMin: r.d_min,
      dMax: r.d_max,
      category: r.category || 'custom',
      isBuiltin: r.is_builtin === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    
    // 3. Merge: built-in first, then custom
    const allProfiles = [...builtinProfiles, ...customProfiles];
    res.json(allProfiles);
  } catch (err) {
    console.error('Failed to list film curve profiles', err.message);
    next(err);
  }
});

// Create a new film curve profile
router.post('/film-curves', async (req, res, next) => {
  try {
    const { name, gamma, dMin, dMax, category } = req.body || {};
    if (!name || gamma === undefined || dMin === undefined || dMax === undefined) {
      return res.status(400).json({ error: 'name, gamma, dMin, dMax are required' });
    }
    // Generate key from name (lowercase, replace spaces with underscores, prefix with custom_)
    const key = 'custom_' + name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    
    const sql = 'INSERT INTO film_curve_profiles (key, name, gamma, d_min, d_max, category, is_builtin) VALUES (?, ?, ?, ?, ?, ?, 0)';
    const result = await runAsync(sql, [key, name, gamma, dMin, dMax, category || 'custom']);
    res.json({
      ok: true,
      id: result.lastID,
      key,
      name,
      gamma,
      dMin,
      dMax,
      category: category || 'custom',
      isBuiltin: false,
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'A profile with this name already exists' });
    }
    console.error('Failed to create film curve profile', err.message);
    next(err);
  }
});

// Update an existing film curve profile
router.put('/film-curves/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, gamma, dMin, dMax, category } = req.body || {};
    if (!name || gamma === undefined || dMin === undefined || dMax === undefined) {
      return res.status(400).json({ error: 'name, gamma, dMin, dMax are required' });
    }
    // Regenerate key from name
    const key = 'custom_' + name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    
    const sql = 'UPDATE film_curve_profiles SET key = ?, name = ?, gamma = ?, d_min = ?, d_max = ?, category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_builtin = 0';
    const result = await runAsync(sql, [key, name, gamma, dMin, dMax, category || 'custom', id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Profile not found or is built-in' });
    }
    res.json({ ok: true, key });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'A profile with this name already exists' });
    }
    console.error('Failed to update film curve profile', err.message);
    next(err);
  }
});

// Delete a film curve profile
router.delete('/film-curves/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    // Only allow deleting non-builtin profiles
    const sql = 'DELETE FROM film_curve_profiles WHERE id = ? AND is_builtin = 0';
    const result = await runAsync(sql, [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Profile not found or is built-in' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete film curve profile', err.message);
    next(err);
  }
});

module.exports = router;
