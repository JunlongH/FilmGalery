const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
sharp.cache(false);
const { buildPipeline } = require('../services/filmlab-service');
const { runAsync, allAsync, getAsync, validatePhotoUpdate } = require('../utils/db-helpers');
const { savePhotoTags, attachTagsToPhotos } = require('../services/tag-service');
const { uploadsDir } = require('../config/paths');
const { uploadDefault } = require('../config/multer');
const { moveFileSync } = require('../utils/file-helpers');

// Helpers for tone and curves (mirror preview implementation)
function buildToneLUT({ exposure = 0, contrast = 0, highlights = 0, shadows = 0, whites = 0, blacks = 0 }) {
  const lut = new Uint8Array(256);
  const expFactor = Math.pow(2, (Number(exposure) || 0) / 50);
  const ctr = Number(contrast) || 0;
  const contrastFactor = (259 * (ctr + 255)) / (255 * (259 - ctr));
  const blackPoint = -(Number(blacks) || 0) * 0.002;
  const whitePoint = 1 - (Number(whites) || 0) * 0.002;
  const sFactor = (Number(shadows) || 0) * 0.005;
  const hFactor = (Number(highlights) || 0) * 0.005;
  for (let i = 0; i < 256; i++) {
    let val = i / 255;
    val *= expFactor;
    val = (val - 0.5) * contrastFactor + 0.5;
    if (whitePoint !== blackPoint) val = (val - blackPoint) / (whitePoint - blackPoint);
    if (sFactor !== 0) val += sFactor * Math.pow(1 - val, 2) * val * 4;
    if (hFactor !== 0) val += hFactor * Math.pow(val, 2) * (1 - val) * 4;
    lut[i] = Math.min(255, Math.max(0, Math.round(val * 255)));
  }
  return lut;
}

function createSpline(xs, ys) {
  const n = xs.length;
  const dys = [], dxs = [], ms = [];
  for (let i = 0; i < n - 1; i++) { dxs.push(xs[i + 1] - xs[i]); dys.push(ys[i + 1] - ys[i]); ms.push(dys[i] / dxs[i]); }
  const c1s = [ms[0]];
  for (let i = 0; i < n - 2; i++) {
    const m = ms[i], mNext = ms[i + 1];
    if (m * mNext <= 0) c1s.push(0);
    else {
      const dx = dxs[i], dxNext = dxs[i + 1];
      const common = dx + dxNext;
      c1s.push((3 * common) / ((common + dxNext) / m + (common + dx) / mNext));
    }
  }
  c1s.push(ms[ms.length - 1]);
  const c2s = [], c3s = [];
  for (let i = 0; i < n - 1; i++) {
    const c1 = c1s[i], m = ms[i], invDx = 1 / dxs[i];
    const common = c1 + c1s[i + 1] - 2 * m;
    c2s.push((m - c1 - common) * invDx);
    c3s.push(common * invDx * invDx);
  }
  return (x) => {
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const diff = x - xs[i];
    return ys[i] + c1s[i] * diff + c2s[i] * diff * diff + c3s[i] * diff * diff * diff;
  };
}

function buildCurveLUT(points) {
  const lut = new Uint8Array(256);
  const sorted = Array.isArray(points) ? [...points].sort((a, b) => a.x - b.x) : [{ x: 0, y: 0 }, { x: 255, y: 255 }];
  if (sorted.length < 2) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }
  const xs = sorted.map(p => p.x); const ys = sorted.map(p => p.y); const spline = createSpline(xs, ys);
  for (let i = 0; i < 256; i++) {
    if (i <= sorted[0].x) lut[i] = sorted[0].y;
    else if (i >= sorted[sorted.length - 1].x) lut[i] = sorted[sorted.length - 1].y;
    else lut[i] = Math.min(255, Math.max(0, Math.round(spline(i))));
  }
  return lut;
}

// Get all photos with optional filtering
router.get('/', async (req, res) => {
  const { camera, lens, photographer, location_id, film, year, month, ym } = req.query;

  const toArray = (v) => {
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string' && v.includes(',')) return v.split(',').map(s=>s.trim()).filter(Boolean);
    return v === '' ? [] : [v];
  };

  const cameras = toArray(camera);
  const lenses = toArray(lens);
  const photographers = toArray(photographer);
  const locations = toArray(location_id).map(v => String(v).split('::')[0]);
  const years = toArray(year);
  const months = toArray(month);
  const yms = toArray(ym);
  const films = toArray(film);

  // Check if locations table exists
  const locationsTableExists = await new Promise((resolve) => {
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='locations'", [], (err, row) => {
      resolve(!!row);
    });
  });

  let sql = locationsTableExists ? `
    SELECT p.*, r.title as roll_title, l.city_name, l.country_name, COALESCE(f.name, r.film_type) AS film_name
    FROM photos p
    JOIN rolls r ON p.roll_id = r.id
    LEFT JOIN locations l ON p.location_id = l.id
    LEFT JOIN films f ON r.filmId = f.id
    WHERE 1=1
  ` : `
    SELECT p.*, r.title as roll_title, NULL as city_name, NULL as country_name, COALESCE(f.name, r.film_type) AS film_name
    FROM photos p
    JOIN rolls r ON p.roll_id = r.id
    LEFT JOIN films f ON r.filmId = f.id
    WHERE 1=1
  `;
  const params = [];

  if (cameras.length) {
    const cs = cameras.map(() => `p.camera = ?`).join(' OR ');
    sql += ` AND (${cs})`;
    cameras.forEach(c => { params.push(c); });
  }

  if (lenses.length) {
    const ls = lenses.map(() => `p.lens = ?`).join(' OR ');
    sql += ` AND (${ls})`;
    lenses.forEach(l => { params.push(l); });
  }

  if (photographers.length) {
    const ps = photographers.map(() => `p.photographer = ?`).join(' OR ');
    sql += ` AND (${ps})`;
    photographers.forEach(pv => { params.push(pv); });
  }

  if (locations.length) {
    const placeholders = locations.map(()=>'?').join(',');
    sql += ` AND p.location_id IN (${placeholders})`;
    params.push(...locations);
  }

  if (films.length) {
    const fs = films.map(() => `(
      r.filmId = ? OR f.name = ? OR r.film_type = ?
    )`).join(' OR ');
    sql += ` AND (${fs})`;
    films.forEach(fv => { params.push(fv, fv, fv); });
  }

  if (years.length || months.length || yms.length) {
    const parts = [];
    if (yms.length) {
      parts.push(`strftime('%Y-%m', p.date_taken) IN (${yms.map(()=>'?').join(',')})`); params.push(...yms);
    } else {
      if (years.length) { parts.push(`strftime('%Y', p.date_taken) IN (${years.map(()=>'?').join(',')})`); params.push(...years); }
      if (months.length) { parts.push(`strftime('%m', p.date_taken) IN (${months.map(()=>'?').join(',')})`); params.push(...months); }
    }
    if (parts.length) sql += ` AND (${parts.join(' OR ')})`;
  }

  sql += ` ORDER BY p.date_taken DESC, p.id DESC`;

  try {
    const rows = await allAsync(sql, params);
    // Normalize paths: prefer positive_rel_path when present
    const normalized = (rows || []).map(r => {
      const fullPath = r.positive_rel_path || r.full_rel_path || null;
      const thumbPath = r.positive_thumb_rel_path || r.thumb_rel_path || null;
      return Object.assign({}, r, {
        full_rel_path: fullPath,
        thumb_rel_path: thumbPath,
      });
    });
    const withTags = await attachTagsToPhotos(normalized);
    res.json(withTags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get random photos for hero section
router.get('/random', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const sql = `
    SELECT p.*, r.title as roll_title 
    FROM photos p
    JOIN rolls r ON p.roll_id = r.id
    WHERE p.full_rel_path IS NOT NULL
    ORDER BY RANDOM() 
    LIMIT ?
  `;
  try {
    const rows = await allAsync(sql, [limit]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get liked photos
router.get('/favorites', async (req, res) => {
  console.log('[GET] /api/photos/favorites');
  const sql = `
    SELECT p.*, COALESCE(f.name, r.film_type) AS film_name, r.title AS roll_title
    FROM photos p
    JOIN rolls r ON r.id = p.roll_id
    LEFT JOIN films f ON f.id = r.filmId
    WHERE IFNULL(CAST(p.rating AS INTEGER), 0) <> 0
    ORDER BY p.id DESC
  `;
  try {
    const rows = await allAsync(sql, []);
    console.log(`[GET] Favorites found: ${rows.length}`);
    const withTags = await attachTagsToPhotos(rows);
    res.json(withTags);
  } catch (err) {
    console.error('[GET] Favorites error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get negative source photos (original scanned negatives)
router.get('/negatives', async (req, res) => {
  console.log('[GET] /api/photos/negatives');
  const sql = `
    SELECT p.*, COALESCE(f.name, r.film_type) AS film_name, r.title AS roll_title
    FROM photos p
    JOIN rolls r ON r.id = p.roll_id
    LEFT JOIN films f ON f.id = r.filmId
    WHERE IFNULL(CAST(p.is_negative_source AS INTEGER), 0) = 1
    ORDER BY p.id DESC
  `;
  try {
    const rows = await allAsync(sql, []);
    const withTags = await attachTagsToPhotos(rows);
    res.json(withTags);
  } catch (err) {
    console.error('[GET] Negatives error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// update photo (adds tags support)
router.put('/:id', async (req, res) => {
  const id = req.params.id;
  const { frame_number, caption, taken_at, rating, tags, date_taken, time_taken, location_id, detail_location, latitude, longitude, camera, lens, photographer } = req.body;
  console.log(`[PUT] Update photo ${id}`, req.body);

  const updates = [];
  const params = [];
  if (frame_number !== undefined) { updates.push('frame_number=?'); params.push(frame_number); }
  if (caption !== undefined) { updates.push('caption=?'); params.push(caption); }
  if (taken_at !== undefined) { updates.push('taken_at=?'); params.push(taken_at); }
  if (rating !== undefined) { updates.push('rating=?'); params.push(parseInt(rating)); }
  if (date_taken !== undefined) { updates.push('date_taken=?'); params.push(date_taken); }
  if (time_taken !== undefined) { updates.push('time_taken=?'); params.push(time_taken); }
  if (location_id !== undefined) { updates.push('location_id=?'); params.push(location_id); }
  if (detail_location !== undefined) { updates.push('detail_location=?'); params.push(detail_location); }
  if (latitude !== undefined) { updates.push('latitude=?'); params.push(latitude); }
  if (longitude !== undefined) { updates.push('longitude=?'); params.push(longitude); }
  if (camera !== undefined) { updates.push('camera=?'); params.push(camera); }
  if (lens !== undefined) { updates.push('lens=?'); params.push(lens); }
  if (photographer !== undefined) { updates.push('photographer=?'); params.push(photographer); }

  if (!updates.length && tags === undefined) {
    return res.json({ updated: 0 });
  }

  try {
    // Validate and initialize missing lat/lng from location city
    const v = await validatePhotoUpdate(id, req.body);
    let updated = 0;
    if (updates.length) {
      params.push(id);
      const sql = `UPDATE photos SET ${updates.join(', ')} WHERE id=?`;
      const result = await runAsync(sql, params);
      updated = result && typeof result.changes === 'number' ? result.changes : 0;
    }

    let appliedTags;
    if (tags !== undefined) {
      appliedTags = await savePhotoTags(id, Array.isArray(tags) ? tags : []);
    }

    // Auto-add location to roll if missing
    if (v.location_id) {
      const row = await getAsync('SELECT roll_id FROM photos WHERE id = ?', [id]);
      if (row && row.roll_id) {
        await runAsync('INSERT OR IGNORE INTO roll_locations (roll_id, location_id) VALUES (?, ?)', [row.roll_id, v.location_id]);
      }
    }

    // Add gear values to roll_gear with intelligent deduplication
    if (camera || lens || photographer) {
      const { addOrUpdateGear } = require('../services/gear-service');
      const photo = await getAsync('SELECT roll_id FROM photos WHERE id = ?', [id]);
      if (photo && photo.roll_id) {
        if (camera) await addOrUpdateGear(photo.roll_id, 'camera', camera).catch(e => console.error('Add camera failed', e));
        if (lens) await addOrUpdateGear(photo.roll_id, 'lens', lens).catch(e => console.error('Add lens failed', e));
        if (photographer) await addOrUpdateGear(photo.roll_id, 'photographer', photographer).catch(e => console.error('Add photographer failed', e));
      }
    }

    res.json({ ok: true, updated, tags: appliedTags });
  } catch (err) {
    console.error('[PUT] Update photo error', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update positive image from negative (FilmLab save)
router.put('/:id/update-positive', uploadDefault.single('image'), async (req, res) => {
  const id = req.params.id;
  if (!req.file) return res.status(400).json({ error: 'image file required' });

  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT roll_id, frame_number, full_rel_path, thumb_rel_path FROM photos WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!row) return res.status(404).json({ error: 'Photo not found' });

    // If full_rel_path is null (negative only), we need to create a path for the positive
    // Even if it exists, we ALWAYS create a new versioned filename to avoid OneDrive/OS file locking issues.
    
    const rollId = row.roll_id;
    const frameNum = row.frame_number || '00';
    const folderName = String(rollId);
    
    // Ensure full directory exists
    const fullDir = path.join(uploadsDir, 'rolls', folderName, 'full');
    if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });

    // Generate new unique filename: rollID_frame.jpg (stable filename to avoid proliferation)
    const newFileName = `${rollId}_${frameNum}.jpg`;
    const newFullRelPath = path.join('rolls', folderName, 'full', newFileName).replace(/\\/g, '/');
    const newFullPath = path.join(fullDir, newFileName);

    // Move uploaded file to new path
    try {
        console.log(`[UPDATE-POSITIVE] Moving file from ${req.file.path} to ${newFullPath}`);
        // Direct overwrite using moveFileSync. Do NOT unlink beforehand to prevent data loss if move fails.
        moveFileSync(req.file.path, newFullPath);
    } catch (moveErr) {
        console.error('[UPDATE-POSITIVE] Move failed:', moveErr);
        return res.status(500).json({ error: 'Failed to save file to disk: ' + moveErr.message });
    }

    // Update DB with new path
    try {
        await runAsync('UPDATE photos SET full_rel_path = ? WHERE id = ?', [newFullRelPath, id]);
    } catch (dbErr) {
        console.error('[UPDATE-POSITIVE] DB update failed:', dbErr);
        return res.status(500).json({ error: 'Failed to update database: ' + dbErr.message });
    }

    // Try to delete the old file if it existed and is different from new file
    if (row.full_rel_path) {
        try {
            const oldFullPath = path.join(uploadsDir, row.full_rel_path);
            if (oldFullPath !== newFullPath && fs.existsSync(oldFullPath)) {
                // Attempt delete, ignore if locked
                fs.unlinkSync(oldFullPath);
            }
        } catch (e) {
            console.warn('[UPDATE-POSITIVE] Could not delete old file (locked?), leaving as orphan:', e.message);
        }
    }

    // Update variables for thumbnail generation
    const fullPath = newFullPath;
    const thumbPath = row.thumb_rel_path ? path.join(uploadsDir, row.thumb_rel_path) : null;

    // Regenerate thumbnail
    if (thumbPath) {
      try {
        console.log(`[UPDATE-POSITIVE] Regenerating thumbnail at ${thumbPath}`);
        // Try to unlink thumb first to avoid lock
        if (fs.existsSync(thumbPath)) {
            try { fs.unlinkSync(thumbPath); } catch(e) {}
        }
        
        // Read file to buffer to avoid Sharp holding a file lock on Windows
        const fileBuf = fs.readFileSync(fullPath);
        await sharp(fileBuf)
          .resize({ width: 240, height: 240, fit: 'inside' })
          .jpeg({ quality: 40 })
          .toFile(thumbPath);
      } catch (sharpErr) {
        console.error('[UPDATE-POSITIVE] Thumbnail regeneration failed:', sharpErr);
        // Do not fail the request if thumbnail fails, just log it
      }
    }

    res.json({ ok: true, newPath: newFullRelPath });
  } catch (err) {
    console.error('[UPDATE-POSITIVE] General error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Ingest a positive JPEG (e.g., from GPU export) into roll storage and update DB
// POST /api/photos/:id/ingest-positive  (multipart form field 'image')
router.post('/:id/ingest-positive', uploadDefault.single('image'), async (req, res) => {
  const id = req.params.id;
  console.log('[INGEST-POSITIVE] Request for photo ID:', id);
  console.log('[INGEST-POSITIVE] File received:', req.file ? 'yes' : 'no');
  if (req.file) {
    console.log('[INGEST-POSITIVE] File details:', {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path
    });
  }
  
  if (!req.file) {
    console.error('[INGEST-POSITIVE] No file received in request');
    return res.status(400).json({ error: 'image file required' });
  }
  
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT roll_id, frame_number, positive_rel_path, full_rel_path, positive_thumb_rel_path FROM photos WHERE id = ?', [id], (err, r) => err ? reject(err) : resolve(r));
    });
    if (!row) {
      console.error('[INGEST-POSITIVE] Photo not found:', id);
      return res.status(404).json({ error: 'Photo not found' });
    }
    console.log('[INGEST-POSITIVE] Photo row:', row);

    const rollId = row.roll_id;
    const frameNum = row.frame_number || '00';
    const folderName = String(rollId);
    const fullDir = path.join(uploadsDir, 'rolls', folderName, 'full');
    const thumbDir = path.join(uploadsDir, 'rolls', folderName, 'thumb');
    
    console.log('[INGEST-POSITIVE] Target directories:', { fullDir, thumbDir });
    
    if (!fs.existsSync(fullDir)) {
      console.log('[INGEST-POSITIVE] Creating fullDir:', fullDir);
      fs.mkdirSync(fullDir, { recursive: true });
    }
    if (!fs.existsSync(thumbDir)) {
      console.log('[INGEST-POSITIVE] Creating thumbDir:', thumbDir);
      fs.mkdirSync(thumbDir, { recursive: true });
    }

    // GPU export always generates JPG, so we use a distinct suffix to avoid conflicts
    // This way we don't overwrite the original JPG/jpg file
    const exportName = `${rollId}_${frameNum}_positive.jpg`;
    const newFullRelPath = path.join('rolls', folderName, 'full', exportName).replace(/\\/g, '/');
    const newFullPath = path.join(fullDir, exportName);

    console.log('[INGEST-POSITIVE] Moving file from', req.file.path, 'to', newFullPath);
    
    // Clean up old positive file first if it exists and is different
    if (row.positive_rel_path && row.positive_rel_path !== newFullRelPath) {
      try {
        const oldPosAbs = path.join(uploadsDir, row.positive_rel_path);
        if (fs.existsSync(oldPosAbs)) {
          console.log('[INGEST-POSITIVE] Removing old positive:', oldPosAbs);
          fs.unlinkSync(oldPosAbs);
        }
      } catch (e) { 
        console.warn('[INGEST-POSITIVE] Cleanup old positive failed', e.message); 
      }
    }
    
    try {
      // Ensure target does not exist to avoid Windows file locking issues
      if (fs.existsSync(newFullPath)) {
        console.log('[INGEST-POSITIVE] Target exists, removing:', newFullPath);
        try { fs.unlinkSync(newFullPath); } catch(e) { console.warn('[INGEST-POSITIVE] Unlink target failed', e.message); }
      }
      
      // Direct overwrite
      moveFileSync(req.file.path, newFullPath);
      console.log('[INGEST-POSITIVE] File moved successfully');
    } catch (e) {
      console.error('[INGEST-POSITIVE] Failed to move file:', e.message);
      return res.status(500).json({ error: 'Failed to save file: ' + e.message });
    }

    // Verify file exists and has content
    if (!fs.existsSync(newFullPath)) {
      console.error('[INGEST-POSITIVE] File does not exist after move:', newFullPath);
      return res.status(500).json({ error: 'File was not saved correctly' });
    }
    const stats = fs.statSync(newFullPath);
    console.log('[INGEST-POSITIVE] File verified at:', newFullPath, 'size:', stats.size);
    if (stats.size === 0) {
      console.error('[INGEST-POSITIVE] File size is 0!');
      return res.status(500).json({ error: 'File was saved but has 0 size' });
    }

    // Generate/update positive thumbnail
    const thumbName = `${rollId}_${frameNum}_positive-thumb.jpg`;
    const thumbPath = path.join(thumbDir, thumbName);
    console.log('[INGEST-POSITIVE] Generating thumbnail:', thumbPath);
    
    try {
      if (fs.existsSync(thumbPath)) { 
        console.log('[INGEST-POSITIVE] Removing old thumbnail');
        try { fs.unlinkSync(thumbPath); } catch(_){} 
      }
      // Read to buffer to avoid file lock
      const fileBuf = fs.readFileSync(newFullPath);
      await sharp(fileBuf).resize({ width: 240, height: 240, fit: 'inside' }).jpeg({ quality: 40 }).toFile(thumbPath);
      console.log('[INGEST-POSITIVE] Thumbnail generated successfully');
    } catch (e) {
      // log but do not fail
      console.error('[INGEST-POSITIVE] thumb failed', e.message);
    }
    const relThumb = path.join('rolls', folderName, 'thumb', thumbName).replace(/\\/g, '/');

    // Update DB: set positive paths; ensure full_rel_path has a value for legacy viewers
    console.log('[INGEST-POSITIVE] Updating DB with paths:', { newFullRelPath, relThumb });
    await runAsync('UPDATE photos SET positive_rel_path=?, positive_thumb_rel_path=?, full_rel_path=COALESCE(full_rel_path, ?) WHERE id=?', [newFullRelPath, relThumb, newFullRelPath, id]);
    console.log('[INGEST-POSITIVE] DB updated');

    // Cleanup old positive thumbnail if it was different
    if (row.positive_thumb_rel_path && row.positive_thumb_rel_path !== relThumb) {
      try {
        const oldThumbAbs = path.join(uploadsDir, row.positive_thumb_rel_path);
        if (fs.existsSync(oldThumbAbs)) {
          console.log('[INGEST-POSITIVE] Removing old positive thumbnail:', oldThumbAbs);
          fs.unlinkSync(oldThumbAbs);
        }
      } catch (e) { console.warn('[INGEST-POSITIVE] Cleanup old thumb failed', e.message); }
    }

    const updated = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM photos WHERE id=?', [id], (err, r) => err ? reject(err) : resolve(r));
    });
    console.log('[INGEST-POSITIVE] Success! Returning updated photo');
    res.json({ ok: true, photo: updated, positive_rel_path: newFullRelPath, positive_thumb_rel_path: relThumb });
  } catch (err) {
    console.error('[INGEST-POSITIVE] error', err);
    res.status(500).json({ error: err.message });
  }
});

// High-quality export from original scan applying Film Lab parameters
// POST /api/photos/:id/export-positive
// Body: { params: { inverted, inversionMode, exposure, contrast, temp, tint, red, green, blue, rotation, orientation } }
// NOTE: Initial implementation: applies inversion, WB gains, exposure, contrast, rotation. (Curves, tone sliders, LUTs deferred)
router.post('/:id/export-positive', async (req, res) => {
  console.log('[POST] /api/photos/:id/export-positive', req.params.id);
  const id = req.params.id;
  const body = req.body || {};
  const p = (body.params) || {};
  const format = (body.format || 'jpeg').toLowerCase(); // 'jpeg' | 'tiff16' | 'both'
  // Extract params with defaults
  const inverted = !!p.inverted;
  const inversionMode = p.inversionMode === 'log' ? 'log' : 'linear';
  const exposure = Number.isFinite(p.exposure) ? p.exposure : 0; // -100..100
  const contrast = Number.isFinite(p.contrast) ? p.contrast : 0; // -100..100
  const temp = Number.isFinite(p.temp) ? p.temp : 0; // -100..100
  const tint = Number.isFinite(p.tint) ? p.tint : 0; // -100..100
  const redGain = Number.isFinite(p.red) ? p.red : 1.0;
  const greenGain = Number.isFinite(p.green) ? p.green : 1.0;
  const blueGain = Number.isFinite(p.blue) ? p.blue : 1.0;
  const rotation = Number.isFinite(p.rotation) ? p.rotation : 0; // arbitrary degrees
  const orientation = Number.isFinite(p.orientation) ? p.orientation : 0; // multiples of 90 from UI

  try {
    // Fetch photo row to get original path & roll info
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT id, roll_id, frame_number, original_rel_path, positive_rel_path, full_rel_path, positive_thumb_rel_path FROM photos WHERE id = ?', [id], (err, r) => {
        if (err) reject(err); else resolve(r);
      });
    });
    if (!row) return res.status(404).json({ error: 'Photo not found' });
    // Pick best available source: prefer original; fallback to positive/full; then negative
    let relSource = row.original_rel_path || row.positive_rel_path || row.full_rel_path || row.negative_rel_path;
    if (!relSource) {
      return res.status(400).json({ error: 'No usable image source for export (missing original/positive/full/negative paths)' });
    }
    let sourceAbs = path.join(uploadsDir, relSource);
    if (!fs.existsSync(sourceAbs)) {
      return res.status(404).json({ error: 'Source file missing on disk: ' + relSource });
    }

    // Resolve roll folder paths
    const rollFolder = path.join(uploadsDir, 'rolls', String(row.roll_id));
    const fullDir = path.join(rollFolder, 'full');
    const thumbDir = path.join(rollFolder, 'thumb');
    if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });
    if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

    const frameNumber = row.frame_number || '00';
    const baseName = `${row.roll_id}_${frameNumber}`;
    const timestamp = Date.now();
    // Use stable filename for positive to avoid proliferation
    const exportName = `${baseName}.jpg`;
    const destPath = path.join(fullDir, exportName);
    const relDest = path.join('rolls', String(row.roll_id), 'full', exportName).replace(/\\/g, '/').replace(/\\/g, '/');

    // Build base pipeline (rotate/resize/crop, invert, WB)
    let imgBase = await buildPipeline(sourceAbs, {
      inverted, inversionMode, exposure, contrast, temp, tint,
      red: redGain, green: greenGain, blue: blueGain, rotation, orientation
    }, { maxWidth: null, cropRect: (p && p.cropRect) || null, toneAndCurvesInJs: true });

    // Build LUTs for tones and curves
    const toneLUT = buildToneLUT({
      exposure, contrast,
      highlights: Number.isFinite(p.highlights) ? p.highlights : 0,
      shadows: Number.isFinite(p.shadows) ? p.shadows : 0,
      whites: Number.isFinite(p.whites) ? p.whites : 0,
      blacks: Number.isFinite(p.blacks) ? p.blacks : 0,
    });
    const curves = p.curves || { rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }], red: [{ x: 0, y: 0 }, { x: 255, y: 255 }], green: [{ x: 0, y: 0 }, { x: 255, y: 255 }], blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };
    const lutRGB = buildCurveLUT(curves.rgb || []);
    const lutR = buildCurveLUT(curves.red || []);
    const lutG = buildCurveLUT(curves.green || []);
    const lutB = buildCurveLUT(curves.blue || []);

    // Pull raw, apply LUTs, then encode to JPEG
    const { data, info } = await imgBase.raw().toBuffer({ resolveWithObject: true });
    const width = info.width; const height = info.height; const channels = info.channels;
    const out = Buffer.allocUnsafe(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += channels, j += 3) {
      let r = data[i]; let g = data[i + 1]; let b = data[i + 2];
      r = toneLUT[r]; g = toneLUT[g]; b = toneLUT[b];
      r = lutRGB[r]; g = lutRGB[g]; b = lutRGB[b];
      r = lutR[r]; g = lutG[g]; b = lutB[b];
      out[j] = r; out[j + 1] = g; out[j + 2] = b;
    }
    await sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toFile(destPath);

    // Optional: write 16-bit TIFF sidecar
    let tiffRelPath = null;
    if (format === 'tiff16' || format === 'both') {
      const tiffName = `${baseName}_exp_${timestamp}.tiff`;
      const tiffPath = path.join(fullDir, tiffName);
      try {
          // Generate TIFF16 with tone & curves parity (approximate 16-bit LUT expansion)
          const imgTiffBase = await buildPipeline(sourceAbs, {
            inverted, inversionMode, exposure, contrast, temp, tint,
            red: redGain, green: greenGain, blue: blueGain, rotation, orientation
          }, { maxWidth: null, cropRect: (p && p.cropRect) || null, toneAndCurvesInJs: true });
          // Fetch raw 8-bit buffer then upscale to 16-bit applying curves already baked (toned & curved in JS via toneAndCurvesInJs)
          const { data: raw8, info: info8 } = await imgTiffBase.raw().toBuffer({ resolveWithObject: true });
          const width8 = info8.width; const height8 = info8.height; const channels8 = info8.channels;
          const raw16 = Buffer.allocUnsafe(width8 * height8 * channels8 * 2);
          for (let i=0, j=0; i<raw8.length; i++, j+=2) {
            // Scale 8-bit to 16-bit (simple upscale)
            const v8 = raw8[i];
            const v16 = (v8 << 8) | v8; // replicate bits for smoother gradient
            raw16[j] = v16 & 0xFF;
            raw16[j+1] = (v16 >> 8) & 0xFF;
          }
          await sharp(raw16, { raw: { width: width8, height: height8, channels: channels8, depth: 'ushort' } })
            .tiff({ compression: 'lzw', bitdepth: 16 })
            .toFile(tiffPath);
        tiffRelPath = path.join('rolls', String(row.roll_id), 'full', tiffName).replace(/\\/g, '/');
      } catch (tErr) {
        console.error('[EXPORT-POSITIVE] TIFF16 generation failed', tErr.message);
      }
    }

    // Generate thumbnail (240px inside) with lower quality
    const thumbName = `${baseName}-thumb.jpg`; // keep consistent naming; overwrite existing
    const thumbPath = path.join(thumbDir, thumbName);
    try {
      await sharp(destPath)
        .resize({ width: 240, height: 240, fit: 'inside' })
        .jpeg({ quality: 40 })
        .toFile(thumbPath);
    } catch (thErr) {
      console.error('[EXPORT-POSITIVE] Thumbnail generation failed', thErr.message);
    }
    const relThumb = path.join('rolls', String(row.roll_id), 'thumb', thumbName).replace(/\\/g, '/').replace(/\\/g, '/');

    // Remove previous positive if existed and is different (optional cleanup)
    if (row.positive_rel_path && row.positive_rel_path !== relDest) {
      try {
        const oldPosAbs = path.join(uploadsDir, row.positive_rel_path);
        if (fs.existsSync(oldPosAbs)) fs.unlinkSync(oldPosAbs);
      } catch (delErr) {
        console.warn('[EXPORT-POSITIVE] Could not delete previous positive file:', delErr.message);
      }
    }
    // Remove previous thumbnail if existed and is different
    if (row.positive_thumb_rel_path && row.positive_thumb_rel_path !== relThumb) {
      try {
        const oldThumbAbs = path.join(uploadsDir, row.positive_thumb_rel_path);
        if (fs.existsSync(oldThumbAbs)) fs.unlinkSync(oldThumbAbs);
      } catch (delErr) {
        console.warn('[EXPORT-POSITIVE] Could not delete previous thumbnail file:', delErr.message);
      }
    }

    // Update DB; also set full_rel_path if legacy null to keep compatibility
    await runAsync('UPDATE photos SET positive_rel_path = ?, positive_thumb_rel_path = ?, full_rel_path = COALESCE(full_rel_path, ?) WHERE id = ?', [relDest, relThumb, relDest, id]);

    // Return updated row
    const updated = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM photos WHERE id = ?', [id], (e, r) => e ? reject(e) : resolve(r));
    });
    console.log('[POST] export-positive done', { id, positive_rel_path: relDest });
    res.json({ ok: true, photo: updated, tiff_rel_path: tiffRelPath });
  } catch (err) {
    console.error('[EXPORT-POSITIVE] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Ad-hoc render (no DB mutation) of processed positive image
// POST /api/photos/:id/render-positive
// Body: { params: {...}, format: 'jpeg' | 'tiff16' }
router.post('/:id/render-positive', async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};
  const p = body.params || {};
  const format = (body.format || 'jpeg').toLowerCase();
  if (!['jpeg','tiff16'].includes(format)) {
    return res.status(400).json({ error: 'Unsupported format for render-positive' });
  }
  const inverted = !!p.inverted;
  const inversionMode = p.inversionMode === 'log' ? 'log' : 'linear';
  const exposure = Number.isFinite(p.exposure) ? p.exposure : 0;
  const contrast = Number.isFinite(p.contrast) ? p.contrast : 0;
  const temp = Number.isFinite(p.temp) ? p.temp : 0;
  const tint = Number.isFinite(p.tint) ? p.tint : 0;
  const redGain = Number.isFinite(p.red) ? p.red : 1.0;
  const greenGain = Number.isFinite(p.green) ? p.green : 1.0;
  const blueGain = Number.isFinite(p.blue) ? p.blue : 1.0;
  const rotation = Number.isFinite(p.rotation) ? p.rotation : 0;
  const orientation = Number.isFinite(p.orientation) ? p.orientation : 0;
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT id, roll_id, original_rel_path, positive_rel_path, full_rel_path, negative_rel_path FROM photos WHERE id = ?', [id], (err, r) => {
        if (err) reject(err); else resolve(r);
      });
    });
    if (!row) return res.status(404).json({ error: 'Photo not found' });
    let relSource = row.original_rel_path || row.positive_rel_path || row.full_rel_path || row.negative_rel_path;
    if (!relSource) return res.status(400).json({ error: 'No usable source for render-positive' });
    const sourceAbs = path.join(uploadsDir, relSource);
    if (!fs.existsSync(sourceAbs)) return res.status(404).json({ error: 'Source file missing on disk' });

    if (format === 'tiff16') {
      // Sharp pipeline without JS tone/curves for now (parity later)
        const imgTiffBase = await buildPipeline(sourceAbs, {
          inverted, inversionMode, exposure, contrast, temp, tint,
          red: redGain, green: greenGain, blue: blueGain, rotation, orientation
        }, { maxWidth: null, cropRect: (p && p.cropRect) || null, toneAndCurvesInJs: true });
        const { data: raw8, info: info8 } = await imgTiffBase.raw().toBuffer({ resolveWithObject: true });
        const width8 = info8.width; const height8 = info8.height; const channels8 = info8.channels;
        const raw16 = Buffer.allocUnsafe(width8 * height8 * channels8 * 2);
        for (let i=0, j=0; i<raw8.length; i++, j+=2) {
          const v8 = raw8[i];
          const v16 = (v8 << 8) | v8;
          raw16[j] = v16 & 0xFF;
          raw16[j+1] = (v16 >> 8) & 0xFF;
        }
        const buf = await sharp(raw16, { raw: { width: width8, height: height8, channels: channels8, depth: 'ushort' } })
          .tiff({ compression: 'lzw', bitdepth: 16 })
          .toBuffer();
      res.setHeader('Content-Type', 'image/tiff');
      res.setHeader('Content-Disposition', 'attachment; filename="render_positive_'+id+'_'+Date.now()+'.tiff"');
      return res.send(buf);
    }
    // JPEG path with JS tone & curves
    let imgBase = await buildPipeline(sourceAbs, {
      inverted, inversionMode, exposure, contrast, temp, tint,
      red: redGain, green: greenGain, blue: blueGain, rotation, orientation
    }, { maxWidth: null, cropRect: (p && p.cropRect) || null, toneAndCurvesInJs: true });
    const toneLUT = buildToneLUT({
      exposure, contrast,
      highlights: Number.isFinite(p.highlights) ? p.highlights : 0,
      shadows: Number.isFinite(p.shadows) ? p.shadows : 0,
      whites: Number.isFinite(p.whites) ? p.whites : 0,
      blacks: Number.isFinite(p.blacks) ? p.blacks : 0,
    });
    const curves = p.curves || { rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }], red: [{ x: 0, y: 0 }, { x: 255, y: 255 }], green: [{ x: 0, y: 0 }, { x: 255, y: 255 }], blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };
    const lutRGB = buildCurveLUT(curves.rgb || []);
    const lutR = buildCurveLUT(curves.red || []);
    const lutG = buildCurveLUT(curves.green || []);
    const lutB = buildCurveLUT(curves.blue || []);
    const { data, info } = await imgBase.raw().toBuffer({ resolveWithObject: true });
    const width = info.width; const height = info.height; const channels = info.channels;
    const out = Buffer.allocUnsafe(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += channels, j += 3) {
      let r = data[i]; let g = data[i + 1]; let b = data[i + 2];
      r = toneLUT[r]; g = toneLUT[g]; b = toneLUT[b];
      r = lutRGB[r]; g = lutRGB[g]; b = lutRGB[b];
      r = lutR[r]; g = lutG[g]; b = lutB[b];
      out[j] = r; out[j + 1] = g; out[j + 2] = b;
    }
    const jpegBuf = await sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="render_positive_'+id+'_'+Date.now()+'.jpg"');
    return res.send(jpegBuf);
  } catch (err) {
    console.error('[RENDER-POSITIVE] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// delete photo (enhanced to remove file from disk if in rolls folder)
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT filename, full_rel_path, thumb_rel_path, original_rel_path, negative_rel_path, positive_rel_path, positive_thumb_rel_path, negative_thumb_rel_path FROM photos WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const deleteDbRow = () => {
      db.run('DELETE FROM photos WHERE id = ?', [id], async function(e){
        if (e) return res.status(500).json({ error: e.message });
        
        // Cleanup orphaned tags
        try {
          await runAsync('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM photo_tags)');
        } catch (cleanupErr) {
          console.error('Tag cleanup error', cleanupErr);
        }

        res.json({ deleted: this.changes });
      });
    };

    if (row) {
      const pathsToDelete = [
        row.thumb_rel_path,
        row.full_rel_path,
        row.original_rel_path,
        row.negative_rel_path,
        row.positive_rel_path,
        row.positive_thumb_rel_path,
        row.negative_thumb_rel_path
      ];

      // Filter out nulls and duplicates
      const uniquePaths = [...new Set(pathsToDelete.filter(p => p))];

      let pending = uniquePaths.length;
      if (pending === 0) {
        // Fallback for legacy filename if no paths found
        if (row.filename && !row.full_rel_path) {
             const filePath = path.join(__dirname, '../', row.filename.replace(/^\//, ''));
             fs.unlink(filePath, deleteDbRow);
        } else {
             deleteDbRow();
        }
        return;
      }

      let processed = 0;
      const checkDone = () => {
        processed++;
        if (processed >= pending) {
          deleteDbRow();
        }
      };

      uniquePaths.forEach(relPath => {
        const filePath = path.join(uploadsDir, relPath);
        fs.unlink(filePath, (err) => {
            if (err && err.code !== 'ENOENT') console.warn(`Failed to delete ${filePath}`, err.message);
            checkDone();
        });
      });

    } else {
      deleteDbRow();
    }
  });
});

module.exports = router;
