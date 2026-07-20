const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { uploadFilm } = require('../config/multer');
const { uploadsDir } = require('../config/paths');
const { runAsync, allAsync, getAsync } = require('../utils/db-helpers');
const { FILM_CATEGORIES, FILM_FORMATS, KNOWN_BRANDS, PROCESS_TYPES } = require('../constants/film');

// Get film constants (for dropdowns)
router.get('/constants', (req, res) => {
  res.json({
    categories: FILM_CATEGORIES,
    formats: FILM_FORMATS,
    brands: KNOWN_BRANDS,
    processTypes: PROCESS_TYPES
  });
});

// create a film
router.post('/', uploadFilm.single('thumb'), async (req, res, next) => {
  try {
    const { name, iso, category, brand, format, process } = req.body || {};
    if (!name || !iso || !category) {
      return res.status(400).json({ error: 'name, iso and category are required' });
    }
    const thumbPath = req.file ? `/uploads/films/${req.file.filename}` : null;

    const result = await runAsync(
      'INSERT INTO films (name, iso, category, thumbPath, brand, format, process, thumbnail_url) VALUES (?,?,?,?,?,?,?,?)',
      [name, Number(iso), category, thumbPath, brand || null, format || '135', process || null, thumbPath]
    );
    
    const film = await getAsync('SELECT * FROM films WHERE id = ?', [result.lastID]);
    res.status(201).json(film);
  } catch (err) {
    console.error('POST /api/films error', err);
    next(err);
  }
});

// list films (exclude soft-deleted)
router.get('/', async (req, res, next) => {
  try {
    const includeDeleted = req.query.includeDeleted === 'true';
    const whereClause = includeDeleted ? '' : 'WHERE deleted_at IS NULL';
    const rows = await allAsync(`SELECT * FROM films ${whereClause} ORDER BY brand, name`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// soft delete film (set deleted_at)
router.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const hard = req.query.hard === 'true';
    
    if (hard) {
      // Hard delete: remove thumbnail file and delete record
      const row = await getAsync('SELECT thumbPath FROM films WHERE id = ?', [id]);
      if (row && row.thumbPath) {
        const rel = row.thumbPath.replace(/^\/uploads\//, '');
        const filePath = path.join(uploadsDir, rel);
        fs.unlink(filePath, () => { /* ignore error */ });
      }
      const result = await runAsync('DELETE FROM films WHERE id = ?', [id]);
      res.json({ deleted: result.changes, hard: true });
    } else {
      // Soft delete: set deleted_at timestamp
      const result = await runAsync('UPDATE films SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
      res.json({ deleted: result.changes, soft: true });
    }
  } catch (err) {
    next(err);
  }
});

// restore soft-deleted film
router.post('/:id/restore', async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await runAsync('UPDATE films SET deleted_at = NULL WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'film_not_found' });
    }
    const row = await getAsync('SELECT * FROM films WHERE id = ?', [id]);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// update film (name, iso, category, brand, format, process, optional new thumb)
router.put('/:id', uploadFilm.single('thumb'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const filmRow = await getAsync('SELECT * FROM films WHERE id = ?', [id]);
    if (!filmRow) {
      return res.status(404).json({ error: 'film_not_found' });
    }

    const { name, iso, category, brand, format, process } = req.body || {};
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (iso !== undefined) updates.iso = Number(iso);
    if (category !== undefined) updates.category = category;
    if (brand !== undefined) updates.brand = brand || null;
    if (format !== undefined) updates.format = format || '135';
    if (process !== undefined) updates.process = process || null;

    // handle thumb replacement
    if (req.file) {
      const newThumbPath = `/uploads/films/${req.file.filename}`;
      updates.thumbPath = newThumbPath;
      updates.thumbnail_url = newThumbPath;
    }

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      const fresh = await getAsync('SELECT * FROM films WHERE id = ?', [id]);
      return res.json(fresh);
    }

    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => updates[k]);
    await runAsync(`UPDATE films SET ${setClause} WHERE id = ?`, [...values, id]);
    
    // delete old thumb if replaced
    if (req.file && filmRow.thumbPath && filmRow.thumbPath !== updates.thumbPath) {
      const rel = filmRow.thumbPath.replace(/^\/uploads\//, '');
      const oldPath = path.join(uploadsDir, rel);
      fs.unlink(oldPath, () => { /* ignore error */ });
    }
    
    const updated = await getAsync('SELECT * FROM films WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Upload/update film thumbnail image (standalone endpoint)
router.post('/:id/thumb', uploadFilm.single('thumb'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const filmRow = await getAsync('SELECT * FROM films WHERE id = ?', [id]);
    if (!filmRow) {
      return res.status(404).json({ error: 'film_not_found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'no file uploaded' });
    }

    const newThumbPath = `/uploads/films/${req.file.filename}`;
    
    // Update database
    await runAsync(
      'UPDATE films SET thumbPath = ?, thumbnail_url = ? WHERE id = ?',
      [newThumbPath, newThumbPath, id]
    );

    // Delete old thumb if exists
    if (filmRow.thumbPath) {
      const rel = filmRow.thumbPath.replace(/^\/uploads\//, '');
      const oldPath = path.join(uploadsDir, rel);
      fs.unlink(oldPath, () => { /* ignore error */ });
    }

    const updated = await getAsync('SELECT * FROM films WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    console.error('POST /api/films/:id/thumb error', err);
    next(err);
  }
});

module.exports = router;
