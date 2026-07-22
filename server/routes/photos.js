const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsPromises = require('fs').promises;

// Promise-based existence check (replaces fs.existsSync — idempotent under
// async, no event-loop blocking). Returns false on ENOENT, propagates other
// errors. Used on hot request paths in photos.js where blocking sync I/O
// would stall concurrent renders.
async function pathExists(p) {
  try { await fsPromises.access(p); return true; }
  catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
const path = require('path');
const sharp = require('sharp');
sharp.cache(false);
const { buildPipeline } = require('../services/filmlab-service');
const { runAsync, allAsync, getAsync, validatePhotoUpdate, paginateQuery } = require('../utils/db-helpers');
const { isPathConfined, safeUnlink } = require('../utils/path-security');
const { savePhotoTags, attachTagsToPhotos } = require('../services/tag-service');
const { uploadsDir } = require('../config/paths');
const { uploadDefault } = require('../config/multer');
const { moveFileSync } = require('../utils/file-helpers');
const PreparedStmt = require('../utils/prepared-statements');
const { generatePositiveThumb, cleanupOldThumb } = require('../services/thumb-service');
const { isValidLatLng } = require('@filmgallery/shared/mapUtils');
const renderPool = require('../services/render-worker-pool');

// Film Curve support
const { applyFilmCurve, FILM_CURVE_PROFILES } = require('../../packages/shared/filmLabCurve');

// 使用统一渲染核心
const { getEffectiveInverted } = require('../../packages/shared');

// 使用统一源路径解析器
const { getStrictSourcePath, SOURCE_TYPE } = require('../../packages/shared/sourcePathResolver');

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
router.get('/', async (req, res, next) => {
  const { camera, lens, photographer, location_id, film, year, month, ym, q, favorite } = req.query;

  const toArray = (v) => {
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string' && v.includes(',')) return v.split(',').map(s=>s.trim()).filter(Boolean);
    return v === '' ? [] : [v];
  };

  const cameras = toArray(camera);
  const lenses = toArray(lens);
  const photographers = toArray(photographer);
  
  // Parse location IDs: regular numbers or "user::CityName" for user-entered cities
  const rawLocations = toArray(location_id);
  const numericLocationIds = [];
  const userCityNames = [];
  rawLocations.forEach(v => {
    const str = String(v);
    if (str.startsWith('user::')) {
      // User-entered city name
      userCityNames.push(str.substring(6)); // Extract city name after "user::"
    } else {
      // Regular location ID
      const id = str.split('::')[0];
      if (id && !isNaN(Number(id))) {
        numericLocationIds.push(Number(id));
      }
    }
  });
  
  const years = toArray(year);
  const months = toArray(month);
  const yms = toArray(ym);
  const films = toArray(film);

  try {
    // Check if locations table exists
    const locationsTableExists = await getAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='locations'", []);

  let sql = locationsTableExists ? `
    SELECT p.*, r.title as roll_title, l.city_name, l.country_name, COALESCE(f.name, r.film_type) AS film_name,
           COALESCE(cam.name, rcam.name) AS camera_equip_name, 
           COALESCE(cam.brand, rcam.brand) AS camera_equip_brand, 
           COALESCE(cam.mount, rcam.mount) AS camera_equip_mount,
           COALESCE(cam.has_fixed_lens, rcam.has_fixed_lens) AS has_fixed_lens, 
           COALESCE(cam.fixed_lens_focal_length, rcam.fixed_lens_focal_length) AS fixed_lens_focal_length, 
           COALESCE(cam.fixed_lens_max_aperture, rcam.fixed_lens_max_aperture) AS fixed_lens_max_aperture,
           COALESCE(lens.name, rlens.name) AS lens_equip_name, 
           COALESCE(lens.brand, rlens.brand) AS lens_equip_brand,
           COALESCE(lens.focal_length_min, rlens.focal_length_min) AS lens_equip_focal_min, 
           COALESCE(lens.focal_length_max, rlens.focal_length_max) AS lens_equip_focal_max,
           COALESCE(lens.max_aperture, rlens.max_aperture) AS lens_equip_max_aperture,
           flash.name AS flash_equip_name, flash.brand AS flash_equip_brand, flash.guide_number AS flash_equip_gn
    FROM photos p
    JOIN rolls r ON p.roll_id = r.id
    LEFT JOIN locations l ON p.location_id = l.id
    LEFT JOIN films f ON r.filmId = f.id
    LEFT JOIN equip_cameras cam ON p.camera_equip_id = cam.id
    LEFT JOIN equip_cameras rcam ON r.camera_equip_id = rcam.id
    LEFT JOIN equip_lenses lens ON p.lens_equip_id = lens.id
    LEFT JOIN equip_lenses rlens ON r.lens_equip_id = rlens.id
    LEFT JOIN equip_flashes flash ON p.flash_equip_id = flash.id
    WHERE 1=1
  ` : `
    SELECT p.*, r.title as roll_title, NULL as city_name, NULL as country_name, COALESCE(f.name, r.film_type) AS film_name,
           COALESCE(cam.name, rcam.name) AS camera_equip_name, 
           COALESCE(cam.brand, rcam.brand) AS camera_equip_brand, 
           COALESCE(cam.mount, rcam.mount) AS camera_equip_mount,
           COALESCE(cam.has_fixed_lens, rcam.has_fixed_lens) AS has_fixed_lens, 
           COALESCE(cam.fixed_lens_focal_length, rcam.fixed_lens_focal_length) AS fixed_lens_focal_length, 
           COALESCE(cam.fixed_lens_max_aperture, rcam.fixed_lens_max_aperture) AS fixed_lens_max_aperture,
           COALESCE(lens.name, rlens.name) AS lens_equip_name, 
           COALESCE(lens.brand, rlens.brand) AS lens_equip_brand,
           COALESCE(lens.focal_length_min, rlens.focal_length_min) AS lens_equip_focal_min, 
           COALESCE(lens.focal_length_max, rlens.focal_length_max) AS lens_equip_focal_max,
           COALESCE(lens.max_aperture, rlens.max_aperture) AS lens_equip_max_aperture,
           flash.name AS flash_equip_name, flash.brand AS flash_equip_brand, flash.guide_number AS flash_equip_gn
    FROM photos p
    JOIN rolls r ON p.roll_id = r.id
    LEFT JOIN films f ON r.filmId = f.id
    LEFT JOIN equip_cameras cam ON p.camera_equip_id = cam.id
    LEFT JOIN equip_cameras rcam ON r.camera_equip_id = rcam.id
    LEFT JOIN equip_lenses lens ON p.lens_equip_id = lens.id
    LEFT JOIN equip_lenses rlens ON r.lens_equip_id = rlens.id
    LEFT JOIN equip_flashes flash ON p.flash_equip_id = flash.id
    WHERE 1=1
  `;
  const params = [];

  // Full-text search (q parameter)
  if (q && typeof q === 'string' && q.trim()) {
    const searchTerm = `%${q.trim()}%`;
    sql += ` AND (
      p.caption LIKE ? 
      OR p.notes LIKE ?
      OR r.title LIKE ?
      OR p.camera LIKE ?
      OR p.lens LIKE ?
      OR f.name LIKE ?
      OR cam.brand LIKE ?
      OR cam.model LIKE ?
    )`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
  }

  if (cameras.length) {
    // Check photo's camera, photo's camera_equip, or roll's camera_equip
    const cameraConditions = [
      ...cameras.map(() => `p.camera = ?`),
      ...cameras.map(() => `cam.name = ?`),
      ...cameras.map(() => `rcam.name = ?`)
    ];
    sql += ` AND (${cameraConditions.join(' OR ')})`;
    cameras.forEach(c => { params.push(c); });
    cameras.forEach(c => { params.push(c); });
    cameras.forEach(c => { params.push(c); });
  }

  if (lenses.length) {
    // Match against:
    // 1) p.lens (legacy text field on photos)
    // 2) lens.name (from photo's equip_lenses)
    // 3) rlens.name (from roll's equip_lenses, for photos inheriting from roll)
    // 4) Virtual lens from photo's fixed-lens camera
    // 5) Virtual lens from roll's fixed-lens camera
    // Note: Use CASE to handle integer apertures (f/11 not f/11.0)
    const virtualLensExpr = (alias) => `(${alias}.has_fixed_lens = 1 AND (${alias}.name || ' ' || CAST(${alias}.fixed_lens_focal_length AS INTEGER) || 'mm f/' || CASE WHEN ${alias}.fixed_lens_max_aperture = CAST(${alias}.fixed_lens_max_aperture AS INTEGER) THEN CAST(${alias}.fixed_lens_max_aperture AS INTEGER) ELSE ${alias}.fixed_lens_max_aperture END) IN (${lenses.map(()=>'?').join(',')}))`;
    const lensConditions = [
      `p.lens IN (${lenses.map(()=>'?').join(',')})`,
      `lens.name IN (${lenses.map(()=>'?').join(',')})`,
      `rlens.name IN (${lenses.map(()=>'?').join(',')})`,
      virtualLensExpr('cam'),
      virtualLensExpr('rcam')
    ];
    sql += ` AND (${lensConditions.join(' OR ')})`;
    lenses.forEach(l => { params.push(l); });
    lenses.forEach(l => { params.push(l); });
    lenses.forEach(l => { params.push(l); });
    lenses.forEach(l => { params.push(l); });
    lenses.forEach(l => { params.push(l); });
  }

  if (photographers.length) {
    const ps = photographers.map(() => `p.photographer = ?`).join(' OR ');
    sql += ` AND (${ps})`;
    photographers.forEach(pv => { params.push(pv); });
  }

  // Location filter: handle both location IDs and user-entered city names
  if (numericLocationIds.length || userCityNames.length) {
    const locationConditions = [];
    if (numericLocationIds.length) {
      const placeholders = numericLocationIds.map(()=>'?').join(',');
      locationConditions.push(`p.location_id IN (${placeholders})`);
      params.push(...numericLocationIds);
    }
    if (userCityNames.length) {
      // Match user-entered cities by the photos.city field
      const cityPlaceholders = userCityNames.map(()=>'?').join(',');
      locationConditions.push(`(p.location_id IS NULL AND p.city IN (${cityPlaceholders}))`);
      params.push(...userCityNames);
    }
    sql += ` AND (${locationConditions.join(' OR ')})`;
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

  // Favorites filter
  if (favorite === 'true' || favorite === '1') {
    sql += ` AND IFNULL(CAST(p.rating AS INTEGER), 0) <> 0`;
  }

  sql += ` ORDER BY p.date_taken DESC, p.id DESC`;

  // Y.1 (P0-3): opt-in pagination. When `?page=N` is provided, return
  // { data, total, page, pageSize, hasMore } and apply LIMIT/OFFSET.
  // Without `?page`, return the array directly (backward compat).
  const pageResult = await paginateQuery(sql, params, req.query);
  const rows = pageResult.rows || (pageResult.payload && pageResult.payload.data) || [];
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
  if (pageResult.paginated) {
    res.json({ ...pageResult.payload, data: withTags });
  } else {
    // X-Total-Count header lets clients opt-in without changing response shape
    res.setHeader('X-Total-Count', String(withTags.length));
    res.json(withTags);
  }
  } catch (err) {
    next(err);
  }
});

// Get random photos for hero section
router.get('/random', async (req, res, next) => {
  const limit = parseInt(req.query.limit) || 10;
  const sql = `
    SELECT p.*, 
           r.title as roll_title,
           p.date_taken as date,
           f.name AS film_name,
           r.iso AS roll_iso,
           f.iso AS film_iso,
           COALESCE(
             (SELECT brand || ' ' || model FROM equip_cameras WHERE id = p.camera_equip_id),
             p.camera
           ) as camera_name,
           COALESCE(
             (SELECT name FROM equip_lenses WHERE id = p.lens_equip_id),
             p.lens
           ) as lens_name,
           COALESCE(loc.city_name, p.city) as city
    FROM photos p
    JOIN rolls r ON p.roll_id = r.id
    LEFT JOIN films f ON f.id = r.filmId
    LEFT JOIN locations loc ON loc.id = p.location_id
    WHERE p.full_rel_path IS NOT NULL OR p.positive_rel_path IS NOT NULL
    ORDER BY RANDOM() 
    LIMIT ?
  `;
  try {
    const rows = await allAsync(sql, [limit]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Get single photo by ID
router.get('/single/:id', async (req, res, next) => {
  const { id } = req.params;
  console.log('[GET] /api/photos/single/' + id);
  try {
    const sql = `
      SELECT p.*, COALESCE(f.name, r.film_type) AS film_name, r.title AS roll_title
      FROM photos p
      JOIN rolls r ON r.id = p.roll_id
      LEFT JOIN films f ON f.id = r.filmId
      WHERE p.id = ?
    `;
    const photo = await getAsync(sql, [id]);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    const withTags = await attachTagsToPhotos([photo]);
    res.json(withTags[0]);
  } catch (err) {
    next(err);
  }
});

// Get liked photos
router.get('/favorites', async (req, res, next) => {
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
    const pageResult = await paginateQuery(sql, [], req.query);
    const rows = pageResult.rows || (pageResult.payload && pageResult.payload.data) || [];
    console.log(`[GET] Favorites found: ${rows.length}`);
    const withTags = await attachTagsToPhotos(rows);
    if (pageResult.paginated) {
      res.json({ ...pageResult.payload, data: withTags });
    } else {
      res.setHeader('X-Total-Count', String(withTags.length));
      res.json(withTags);
    }
  } catch (err) {
    next(err);
  }
});

// Get negative source photos (original scanned negatives)
router.get('/negatives', async (req, res, next) => {
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
    const pageResult = await paginateQuery(sql, [], req.query);
    const rows = pageResult.rows || (pageResult.payload && pageResult.payload.data) || [];
    const withTags = await attachTagsToPhotos(rows);
    if (pageResult.paginated) {
      res.json({ ...pageResult.payload, data: withTags });
    } else {
      res.setHeader('X-Total-Count', String(withTags.length));
      res.json(withTags);
    }
  } catch (err) {
    next(err);
  }
});

// update photo (adds tags support)
router.put('/:id', async (req, res, next) => {
  const id = req.params.id;
  const { frame_number, caption, taken_at, rating, tags, date_taken, time_taken, location_id, detail_location, latitude, longitude, altitude, location_name, country, city, camera, lens, photographer, aperture, shutter_speed, iso, focal_length, camera_equip_id, lens_equip_id, flash_equip_id, scanner_equip_id, scan_resolution, scan_software, scan_lab, scan_date, scan_cost, scan_notes } = req.body;
  // Y.3 (P0-5): redact PII from logs. Full req.body may contain GPS coords
  // (latitude/longitude/altitude), location names, and photographer identity.
  // Log only the id + which fields are being updated (key presence, not values).
  const updatedKeys = Object.keys(req.body || {}).filter(k => k !== 'tags');
  console.log(`[PUT] Update photo ${id} fields=[${updatedKeys.join(',')}]`);

  // Validate latitude/longitude range if either is present in the body.
  // Both null (unset) is allowed; mixed null/non-null or out-of-range is not.
  if ('latitude' in (req.body || {}) || 'longitude' in (req.body || {})) {
    if (!isValidLatLng(latitude ?? null, longitude ?? null)) {
      return res.status(400).json({ error: 'invalid latitude/longitude (must be both null or both in range ±90/±180)' });
    }
  }

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
  if (altitude !== undefined) { updates.push('altitude=?'); params.push(altitude); }
  if (location_name !== undefined) { updates.push('location_name=?'); params.push(location_name); }
  if (country !== undefined) { updates.push('country=?'); params.push(country); }
  if (city !== undefined) { updates.push('city=?'); params.push(city); }
  if (camera !== undefined) { updates.push('camera=?'); params.push(camera); }
  if (lens !== undefined) { updates.push('lens=?'); params.push(lens); }
  if (photographer !== undefined) { updates.push('photographer=?'); params.push(photographer); }
  if (aperture !== undefined) { updates.push('aperture=?'); params.push(aperture !== null && aperture !== '' ? parseFloat(aperture) : null); }
  if (shutter_speed !== undefined) { updates.push('shutter_speed=?'); params.push(shutter_speed || null); }
  if (iso !== undefined) { updates.push('iso=?'); params.push(iso !== null && iso !== '' ? parseInt(iso) : null); }
  if (focal_length !== undefined) { updates.push('focal_length=?'); params.push(focal_length !== null && focal_length !== '' ? parseFloat(focal_length) : null); }
  // Equipment IDs
  if (camera_equip_id !== undefined) { updates.push('camera_equip_id=?'); params.push(camera_equip_id); }
  if (lens_equip_id !== undefined) { updates.push('lens_equip_id=?'); params.push(lens_equip_id); }
  if (flash_equip_id !== undefined) { updates.push('flash_equip_id=?'); params.push(flash_equip_id); }
  // Scanner/Scan info
  if (scanner_equip_id !== undefined) { updates.push('scanner_equip_id=?'); params.push(scanner_equip_id); }
  if (scan_resolution !== undefined) { updates.push('scan_resolution=?'); params.push(scan_resolution !== null && scan_resolution !== '' ? parseInt(scan_resolution) : null); }
  if (scan_software !== undefined) { updates.push('scan_software=?'); params.push(scan_software || null); }
  if (scan_lab !== undefined) { updates.push('scan_lab=?'); params.push(scan_lab || null); }
  if (scan_date !== undefined) { updates.push('scan_date=?'); params.push(scan_date || null); }
  if (scan_cost !== undefined) { updates.push('scan_cost=?'); params.push(scan_cost !== null && scan_cost !== '' ? parseFloat(scan_cost) : null); }
  if (scan_notes !== undefined) { updates.push('scan_notes=?'); params.push(scan_notes || null); }

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
      console.log(`[PUT] About to save tags for photo ${id}:`, tags);
      try {
        appliedTags = await savePhotoTags(id, Array.isArray(tags) ? tags : []);
        console.log(`[PUT] Tags saved successfully:`, appliedTags);
      } catch (tagErr) {
        console.error(`[PUT] savePhotoTags failed for photo ${id}:`, tagErr);
        throw tagErr; // Re-throw to trigger outer catch
      }
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
    console.error('[PUT] Stack trace:', err.stack);
    next(err);
  }
});

// Update positive image from negative (FilmLab save)
router.put('/:id/update-positive', uploadDefault.single('image'), async (req, res, next) => {
  const id = req.params.id;
  if (!req.file) return res.status(400).json({ error: 'image file required' });

  try {
    const row = await PreparedStmt.getAsync('photos.getByRollSimple', [id]);

    if (!row) return res.status(404).json({ error: 'Photo not found' });

    const rollId = row.roll_id;
    const frameNum = row.frame_number || '00';
    const folderName = String(rollId);
    
    // Ensure full directory exists
    const fullDir = path.join(uploadsDir, 'rolls', folderName, 'full');
    if (!(await pathExists(fullDir))) (await fsPromises.mkdir(fullDir, { recursive: true }));

    // Stable filename: rollID_frame.jpg
    const newFileName = `${rollId}_${frameNum}.jpg`;
    const newFullRelPath = path.join('rolls', folderName, 'full', newFileName).replace(/\\/g, '/');
    const newFullPath = path.join(fullDir, newFileName);

    // Move uploaded file to new path
    try {
        console.log(`[UPDATE-POSITIVE] Moving file from ${req.file.path} to ${newFullPath}`);
        moveFileSync(req.file.path, newFullPath);
    } catch (moveErr) {
        console.error('[UPDATE-POSITIVE] Move failed:', moveErr);
        return next(moveErr);
    }

    // Try to delete the old positive file if it existed and is different
    // v4-review: use safeUnlink to enforce path confinement on DB-derived paths
    if (row.positive_rel_path && row.positive_rel_path !== newFullRelPath) {
        await safeUnlink(uploadsDir, row.positive_rel_path, { label: 'UPDATE-POSITIVE', silent: true });
    } else if (row.full_rel_path && row.full_rel_path !== newFullRelPath) {
        await safeUnlink(uploadsDir, row.full_rel_path, { label: 'UPDATE-POSITIVE', silent: true });
    }

    // Generate positive thumbnail via shared thumb-service
    let relThumb = null;
    try {
      const thumbResult = await generatePositiveThumb(newFullPath, rollId, frameNum);
      relThumb = thumbResult.relPath;
      // Cleanup previous positive thumb if path changed
      cleanupOldThumb(row.positive_thumb_rel_path, relThumb);
      console.log(`[UPDATE-POSITIVE] Generated positive thumb: ${relThumb}`);
    } catch (sharpErr) {
      console.error('[UPDATE-POSITIVE] Thumbnail generation failed:', sharpErr.message);
    }

    // Update DB: set positive_rel_path, full_rel_path, positive_thumb_rel_path, and updated_at
    try {
        const sql = relThumb
          ? 'UPDATE photos SET full_rel_path = ?, positive_rel_path = ?, positive_thumb_rel_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
          : 'UPDATE photos SET full_rel_path = ?, positive_rel_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        const params = relThumb
          ? [newFullRelPath, newFullRelPath, relThumb, id]
          : [newFullRelPath, newFullRelPath, id];
        await runAsync(sql, params);
    } catch (dbErr) {
        console.error('[UPDATE-POSITIVE] DB update failed:', dbErr);
        return next(dbErr);
    }

    res.json({ ok: true, newPath: newFullRelPath, thumbPath: relThumb });
  } catch (err) {
    console.error('[UPDATE-POSITIVE] General error:', err);
    next(err);
  }
});

// Ingest a positive JPEG (e.g., from GPU export) into roll storage and update DB
// POST /api/photos/:id/ingest-positive  (multipart form field 'image')
router.post('/:id/ingest-positive', uploadDefault.single('image'), async (req, res, next) => {
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
    const row = await getAsync('SELECT roll_id, frame_number, positive_rel_path, full_rel_path, positive_thumb_rel_path FROM photos WHERE id = ?', [id]);
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
    
    if (!(await pathExists(fullDir))) {
      console.log('[INGEST-POSITIVE] Creating fullDir:', fullDir);
      (await fsPromises.mkdir(fullDir, { recursive: true }));
    }
    if (!(await pathExists(thumbDir))) {
      console.log('[INGEST-POSITIVE] Creating thumbDir:', thumbDir);
      (await fsPromises.mkdir(thumbDir, { recursive: true }));
    }

    // Use stable filename consistent with HQ Export (export-positive)
    // This ensures GPU Export, HQ Export, and Save all use the same naming convention
    const exportName = `${rollId}_${frameNum}.jpg`;
    const newFullRelPath = path.join('rolls', folderName, 'full', exportName).replace(/\\/g, '/');
    const newFullPath = path.join(fullDir, exportName);

    console.log('[INGEST-POSITIVE] Moving file from', req.file.path, 'to', newFullPath);
    
    // Clean up old positive file first if it exists and is different
    // v4-review: safeUnlink enforces confinement on DB-derived path
    if (row.positive_rel_path && row.positive_rel_path !== newFullRelPath) {
      const r = await safeUnlink(uploadsDir, row.positive_rel_path, { label: 'INGEST-POSITIVE', silent: true });
      if (r.deleted) console.log('[INGEST-POSITIVE] Old positive removed');
    }
    
    try {
      // Ensure target does not exist to avoid Windows file locking issues
      // (this is a freshly-computed path, not DB-derived — but use safeUnlink
      // anyway for consistency with the new pattern)
      const newRel = path.relative(uploadsDir, newFullPath);
      await safeUnlink(uploadsDir, newRel, { label: 'INGEST-POSITIVE', silent: true });
      
      // Direct overwrite
      moveFileSync(req.file.path, newFullPath);
      console.log('[INGEST-POSITIVE] File moved successfully');
    } catch (e) {
      return next(e);
    }

    // Verify file exists and has content
    if (!(await pathExists(newFullPath))) {
      console.error('[INGEST-POSITIVE] File does not exist after move:', newFullPath);
      throw new Error('File was not saved correctly: missing after move');
    }
    const stats = (await fsPromises.stat(newFullPath));
    console.log('[INGEST-POSITIVE] File verified at:', newFullPath, 'size:', stats.size);
    if (stats.size === 0) {
      console.error('[INGEST-POSITIVE] File size is 0!');
      throw new Error('File was saved but has 0 size');
    }

    // Generate/update positive thumbnail (consistent naming with HQ Export)
    const thumbName = `${rollId}_${frameNum}-thumb.jpg`;
    const thumbPath = path.join(thumbDir, thumbName);
    console.log('[INGEST-POSITIVE] Generating thumbnail:', thumbPath);
    
    try {
      // Remove existing thumbnail if present (path is freshly-computed but
      // use safeUnlink for consistency)
      const thumbRel = path.relative(uploadsDir, thumbPath);
      await safeUnlink(uploadsDir, thumbRel, { label: 'INGEST-POSITIVE', silent: true });
      // Read to buffer to avoid file lock
      const fileBuf = (await fsPromises.readFile(newFullPath));
      await sharp(fileBuf).resize({ width: 240, height: 240, fit: 'inside' }).jpeg({ quality: 40 }).toFile(thumbPath);
      console.log('[INGEST-POSITIVE] Thumbnail generated successfully');
    } catch (e) {
      // log but do not fail
      console.error('[INGEST-POSITIVE] thumb failed', e.message);
    }
    const relThumb = path.join('rolls', folderName, 'thumb', thumbName).replace(/\\/g, '/');

    // Update DB: set positive paths; ensure full_rel_path has a value for legacy viewers
    console.log('[INGEST-POSITIVE] Updating DB with paths:', { newFullRelPath, relThumb });
    await runAsync('UPDATE photos SET positive_rel_path=?, positive_thumb_rel_path=?, full_rel_path=COALESCE(full_rel_path, ?), updated_at=CURRENT_TIMESTAMP WHERE id=?', [newFullRelPath, relThumb, newFullRelPath, id]);
    console.log('[INGEST-POSITIVE] DB updated');

    // Cleanup old positive thumbnail if it was different (DB-derived path)
    if (row.positive_thumb_rel_path && row.positive_thumb_rel_path !== relThumb) {
      await safeUnlink(uploadsDir, row.positive_thumb_rel_path, { label: 'INGEST-POSITIVE', silent: true });
    }

    const updatedPhoto = await PreparedStmt.getAsync('photos.getById', [id]);
    console.log('[INGEST-POSITIVE] Success! Returning updated photo');
    // Return both relative path (for DB) and absolute path (for showInFolder)
    res.json({ 
      ok: true, 
      photo: updatedPhoto, 
      positive_rel_path: newFullRelPath, 
      positive_abs_path: newFullPath,
      positive_thumb_rel_path: relThumb 
    });
  } catch (err) {
    console.error('[INGEST-POSITIVE] error', err);
    next(err);
  }
});

// High-quality export from original scan applying Film Lab parameters
// POST /api/photos/:id/export-positive
// Body: { params: { inverted, inversionMode, exposure, contrast, temp, tint, red, green, blue, rotation, orientation } }
// NOTE: Initial implementation: applies inversion, WB gains, exposure, contrast, rotation. (Curves, tone sliders, LUTs deferred)
router.post('/:id/export-positive', async (req, res, next) => {
  console.log('[POST] /api/photos/:id/export-positive', req.params.id);
  const id = req.params.id;
  const body = req.body || {};
  const p = (body.params) || {};
  const format = (body.format || 'jpeg').toLowerCase(); // 'jpeg' | 'tiff16' | 'both'
  
  // 获取源类型，决定从哪个源文件开始处理
  const sourceType = p.sourceType || 'original'; // 'original' | 'negative' | 'positive'
  
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
  // 片基校正增益 (Pre-Inversion, independent of scene WB)
  const baseRed = Number.isFinite(p.baseRed) ? p.baseRed : 1.0;
  const baseGreen = Number.isFinite(p.baseGreen) ? p.baseGreen : 1.0;
  const baseBlue = Number.isFinite(p.baseBlue) ? p.baseBlue : 1.0;
  // 片基校正模式和密度值 (对数域校正)
  const baseMode = p.baseMode === 'log' ? 'log' : 'linear';
  const baseDensityR = Number.isFinite(p.baseDensityR) ? p.baseDensityR : 0.0;
  const baseDensityG = Number.isFinite(p.baseDensityG) ? p.baseDensityG : 0.0;
  const baseDensityB = Number.isFinite(p.baseDensityB) ? p.baseDensityB : 0.0;
  // 密度色阶 (Density Levels) - 对数域自动色阶
  const densityLevelsEnabled = !!p.densityLevelsEnabled;
  const densityLevels = p.densityLevels && typeof p.densityLevels === 'object' ? {
    red: { min: Number.isFinite(p.densityLevels.red?.min) ? p.densityLevels.red.min : 0.0, max: Number.isFinite(p.densityLevels.red?.max) ? p.densityLevels.red.max : 3.0 },
    green: { min: Number.isFinite(p.densityLevels.green?.min) ? p.densityLevels.green.min : 0.0, max: Number.isFinite(p.densityLevels.green?.max) ? p.densityLevels.green.max : 3.0 },
    blue: { min: Number.isFinite(p.densityLevels.blue?.min) ? p.densityLevels.blue.min : 0.0, max: Number.isFinite(p.densityLevels.blue?.max) ? p.densityLevels.blue.max : 3.0 }
  } : null;
  const rotation = Number.isFinite(p.rotation) ? p.rotation : 0; // arbitrary degrees
  const orientation = Number.isFinite(p.orientation) ? p.orientation : 0; // multiples of 90 from UI
  
  // Film Curve params
  const filmCurveEnabled = !!p.filmCurveEnabled;
  const filmCurveProfile = p.filmCurveProfile || 'default';

  try {
    // Fetch photo row to get original path & roll info
    const row = await getAsync('SELECT id, roll_id, frame_number, original_rel_path, negative_rel_path, positive_rel_path, full_rel_path, positive_thumb_rel_path FROM photos WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Photo not found' });
    
    // 【重要】使用严格源路径选择，不允许跨类型回退
    const sourceResult = getStrictSourcePath(row, sourceType, {
      allowFallbackWithinType: true,
      allowCrossTypeFallback: false  // 绝不允许正片模式回退到负片
    });
    
    if (!sourceResult.path) {
      return res.status(400).json({ 
        error: 'source_type_unavailable',
        message: sourceResult.warning || `No ${sourceType} file available for this photo`,
        sourceType,
        photoId: id
      });
    }
    
    const relSource = sourceResult.path;
    
    // 记录警告（如有）
    if (sourceResult.warning) {
      console.log(`[EXPORT-POSITIVE] Photo ${id}: ${sourceResult.warning}`);
    }
    
    console.log(`[EXPORT-POSITIVE] Using sourceType: ${sourceType}, actualType: ${sourceResult.actualType}, source: ${relSource}`);
    let sourceAbs = path.join(uploadsDir, relSource);
    if (!(await pathExists(sourceAbs))) {
      return res.status(404).json({ error: 'Source file missing on disk: ' + relSource });
    }

    // Resolve roll folder paths
    const rollFolder = path.join(uploadsDir, 'rolls', String(row.roll_id));
    const fullDir = path.join(rollFolder, 'full');
    const thumbDir = path.join(rollFolder, 'thumb');
    if (!(await pathExists(fullDir))) (await fsPromises.mkdir(fullDir, { recursive: true }));
    if (!(await pathExists(thumbDir))) (await fsPromises.mkdir(thumbDir, { recursive: true }));

    const frameNumber = row.frame_number || '00';
    const baseName = `${row.roll_id}_${frameNumber}`;
    const timestamp = Date.now();
    // Use stable filename for positive to avoid proliferation
    const exportName = `${baseName}.jpg`;
    const destPath = path.join(fullDir, exportName);
    const relDest = path.join('rolls', String(row.roll_id), 'full', exportName).replace(/\\/g, '/').replace(/\\/g, '/');

    // Build base pipeline (rotate/resize/crop only - skip color ops for RenderCore parity)
    let imgBase = await buildPipeline(sourceAbs, {
      inverted, inversionMode, exposure, contrast, temp, tint,
      red: redGain, green: greenGain, blue: blueGain, rotation, orientation,
      filmCurveEnabled
    }, { maxWidth: null, cropRect: (p && p.cropRect) || null, toneAndCurvesInJs: true, skipColorOps: true });

    // 处理 LUT 数据（从客户端传来的是数组，需要转为 Float32Array）
    const deserializeLut = (lutData) => {
      if (!lutData || !lutData.data) return null;
      return {
        size: lutData.size,
        data: lutData.data instanceof Float32Array ? lutData.data : new Float32Array(lutData.data),
        intensity: lutData.intensity ?? 1.0
      };
    };
    
    const lut1Data = deserializeLut(p.lut1);
    const lut2Data = deserializeLut(p.lut2);
    
    // 使用 getEffectiveInverted 计算有效反转状态，正片模式不需要反转
    const effectiveInverted = getEffectiveInverted(sourceType, inverted);

    // ── 全浮点管线：充分利用源数据色深和动态范围 ──
    // Pull raw pixels — sharp 会保留源数据的原始位深（8/16-bit）
    const { data, info } = await imgBase.raw().toBuffer({ resolveWithObject: true });
    const width = info.width; const height = info.height; const channels = info.channels;

    // 检测实际位深：16-bit 数据大小 = width * height * channels * 2
    const expectedBytes8 = width * height * channels;
    const is16bit = (data.length >= expectedBytes8 * 2);
    if (is16bit) {
      console.log(`[EXPORT-POSITIVE] High bit-depth source detected (${data.length} bytes, 16-bit), using float pipeline`);
    }

    // Offload the per-pixel Float pipeline to the worker pool (2C.3). Both
    // 'tiff16' and 'both' wantTiff16; 'jpeg' is JPEG-only. The thumbnail
    // JPEG is derived from the canonical positive below, so we always
    // produce jpeg8.
    const wantTiff16 = format !== 'jpeg';
    const { jpeg8, tiff16 } = await renderPool.processImage(data, {
      width, height, channels, is16bit, wantTiff16,
      params: {
        exposure, contrast,
        highlights: Number.isFinite(p.highlights) ? p.highlights : 0,
        shadows: Number.isFinite(p.shadows) ? p.shadows : 0,
        whites: Number.isFinite(p.whites) ? p.whites : 0,
        blacks: Number.isFinite(p.blacks) ? p.blacks : 0,
        curves: p.curves,
        red: redGain, green: greenGain, blue: blueGain,
        baseRed, baseGreen, baseBlue,
        baseMode, baseDensityR, baseDensityG, baseDensityB,
        densityLevelsEnabled, densityLevels,
        temp, tint,
        lut1: lut1Data,
        lut2: lut2Data,
        lut1Intensity: p.lut1Intensity ?? lut1Data?.intensity ?? 1.0,
        lut2Intensity: p.lut2Intensity ?? lut2Data?.intensity ?? 1.0,
        inverted: effectiveInverted, inversionMode,
        filmCurveEnabled, filmCurveProfile,
        hslParams: p.hslParams || null,
        splitToning: p.splitToning || null,
        saturation: Number.isFinite(p.saturation) ? p.saturation : 0,
      },
    });

    // JPEG output (always — canonical positive + thumbnail source).
    await sharp(jpeg8, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toFile(destPath);

    // Optional 16-bit TIFF sidecar.
    let tiffRelPath = null;
    if (tiff16) {
      const tiffName = `${baseName}_exp_${timestamp}.tiff`;
      const tiffPath = path.join(fullDir, tiffName);
      try {
        await sharp(tiff16, { raw: { width, height, channels: 3, depth: 'ushort' } })
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
    // v4-review: safeUnlink for DB-derived paths
    if (row.positive_rel_path && row.positive_rel_path !== relDest) {
      await safeUnlink(uploadsDir, row.positive_rel_path, { label: 'EXPORT-POSITIVE', silent: true });
    }
    // Remove previous thumbnail if existed and is different
    if (row.positive_thumb_rel_path && row.positive_thumb_rel_path !== relThumb) {
      await safeUnlink(uploadsDir, row.positive_thumb_rel_path, { label: 'EXPORT-POSITIVE', silent: true });
    }

    // Update DB; also set full_rel_path if legacy null to keep compatibility
    await runAsync('UPDATE photos SET positive_rel_path = ?, positive_thumb_rel_path = ?, full_rel_path = COALESCE(full_rel_path, ?) WHERE id = ?', [relDest, relThumb, relDest, id]);

    // Return updated row
    const updatedPhoto = await PreparedStmt.getAsync('photos.getById', [id]);
    console.log('[POST] export-positive done', { id, positive_rel_path: relDest });
    res.json({ ok: true, photo: updatedPhoto, tiff_rel_path: tiffRelPath });
  } catch (err) {
    console.error('[EXPORT-POSITIVE] Error:', err);
    next(err);
  }
});

// Ad-hoc render (no DB mutation) of processed positive image
// POST /api/photos/:id/render-positive
// Body: { params: {...}, format: 'jpeg' | 'tiff16' }
// Uses RenderCore for consistent processing including Film Curve gamma
router.post('/:id/render-positive', async (req, res, next) => {
  const id = req.params.id;
  const body = req.body || {};
  const p = body.params || {};
  const format = (body.format || 'jpeg').toLowerCase();
  if (!['jpeg','tiff16'].includes(format)) {
    return res.status(400).json({ error: 'Unsupported format for render-positive' });
  }
  // 客户端已经使用 getEffectiveInverted 计算过了，直接使用
  const inverted = !!p.inverted;
  const inversionMode = p.inversionMode === 'log' ? 'log' : 'linear';
  const sourceType = p.sourceType || 'original'; // 'original' | 'negative' | 'positive'
  const exposure = Number.isFinite(p.exposure) ? p.exposure : 0;
  const contrast = Number.isFinite(p.contrast) ? p.contrast : 0;
  const temp = Number.isFinite(p.temp) ? p.temp : 0;
  const tint = Number.isFinite(p.tint) ? p.tint : 0;
  const redGain = Number.isFinite(p.red) ? p.red : 1.0;
  const greenGain = Number.isFinite(p.green) ? p.green : 1.0;
  const blueGain = Number.isFinite(p.blue) ? p.blue : 1.0;
  const rotation = Number.isFinite(p.rotation) ? p.rotation : 0;
  const orientation = Number.isFinite(p.orientation) ? p.orientation : 0;
  const filmCurveEnabled = !!p.filmCurveEnabled;
  const filmCurveProfile = p.filmCurveProfile || 'default';
  // 片基校正增益 (Pre-Inversion)
  const baseRed = Number.isFinite(p.baseRed) ? p.baseRed : 1.0;
  const baseGreen = Number.isFinite(p.baseGreen) ? p.baseGreen : 1.0;
  const baseBlue = Number.isFinite(p.baseBlue) ? p.baseBlue : 1.0;
  // 片基校正模式和密度值 (对数域校正)
  const baseMode = p.baseMode === 'log' ? 'log' : 'linear';
  const baseDensityR = Number.isFinite(p.baseDensityR) ? p.baseDensityR : 0.0;
  const baseDensityG = Number.isFinite(p.baseDensityG) ? p.baseDensityG : 0.0;
  const baseDensityB = Number.isFinite(p.baseDensityB) ? p.baseDensityB : 0.0;
  // 密度色阶 (Density Levels) - 对数域自动色阶
  const densityLevelsEnabled = !!p.densityLevelsEnabled;
  const densityLevels = p.densityLevels && typeof p.densityLevels === 'object' ? {
    red: { min: Number.isFinite(p.densityLevels.red?.min) ? p.densityLevels.red.min : 0.0, max: Number.isFinite(p.densityLevels.red?.max) ? p.densityLevels.red.max : 3.0 },
    green: { min: Number.isFinite(p.densityLevels.green?.min) ? p.densityLevels.green.min : 0.0, max: Number.isFinite(p.densityLevels.green?.max) ? p.densityLevels.green.max : 3.0 },
    blue: { min: Number.isFinite(p.densityLevels.blue?.min) ? p.densityLevels.blue.min : 0.0, max: Number.isFinite(p.densityLevels.blue?.max) ? p.densityLevels.blue.max : 3.0 }
  } : null;

  try {
    const row = await getAsync('SELECT id, roll_id, original_rel_path, positive_rel_path, full_rel_path, negative_rel_path FROM photos WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Photo not found' });
    
    // 【重要】使用严格源路径选择，不允许跨类型回退
    const sourceResult = getStrictSourcePath(row, sourceType, {
      allowFallbackWithinType: true,
      allowCrossTypeFallback: false
    });
    
    if (!sourceResult.path) {
      return res.status(400).json({ 
        error: 'source_type_unavailable',
        message: sourceResult.warning || `No ${sourceType} file available`,
        sourceType,
        photoId: id
      });
    }
    
    const relSource = sourceResult.path;
    console.log(`[RENDER-POSITIVE] Photo ${id}: sourceType=${sourceType}, actual=${sourceResult.actualType}, filmCurveEnabled=${filmCurveEnabled}`);
    
    const sourceAbs = path.join(uploadsDir, relSource);
    if (!(await pathExists(sourceAbs))) return res.status(404).json({ error: 'Source file missing on disk' });

    // 使用 RenderCore 统一渲染（与 export-positive 保持一致）
    // RenderCore 实例化下沉到 render-worker-pool（2C.3）；此处只组装参数。
    const renderParams = {
      exposure, contrast,
      highlights: Number.isFinite(p.highlights) ? p.highlights : 0,
      shadows: Number.isFinite(p.shadows) ? p.shadows : 0,
      whites: Number.isFinite(p.whites) ? p.whites : 0,
      blacks: Number.isFinite(p.blacks) ? p.blacks : 0,
      curves: p.curves,
      red: redGain, green: greenGain, blue: blueGain,
      // 片基校正增益 (Pre-Inversion)
      baseRed, baseGreen, baseBlue,
      baseMode, baseDensityR, baseDensityG, baseDensityB,
      // 密度色阶 (Density Levels)
      densityLevelsEnabled, densityLevels,
      temp, tint,
      inverted, inversionMode,
      filmCurveEnabled, filmCurveProfile,
      hslParams: p.hslParams || null,
      splitToning: p.splitToning || null,
      saturation: Number.isFinite(p.saturation) ? p.saturation : 0,
    };

    // Build base image with Sharp (geometry only, color ops deferred to RenderCore)
    const imgBase = await buildPipeline(sourceAbs, {
      inverted, inversionMode, exposure, contrast, temp, tint,
      red: redGain, green: greenGain, blue: blueGain, rotation, orientation,
      filmCurveEnabled
    }, { maxWidth: null, cropRect: (p && p.cropRect) || null, toneAndCurvesInJs: true, skipColorOps: true });

    // ── 全浮点管线：充分利用源数据色深和动态范围 ──
    const { data, info } = await imgBase.raw().toBuffer({ resolveWithObject: true });
    const width = info.width; const height = info.height; const channels = info.channels;

    // 检测实际位深
    const expectedBytes8 = width * height * channels;
    const is16bit = (data.length >= expectedBytes8 * 2);
    if (is16bit) {
      console.log(`[RENDER-POSITIVE] High bit-depth source detected, using float pipeline`);
    }

    // Offload the per-pixel Float pipeline to the worker pool (2C.3). The
    // response is the rendered buffer; sharp encode stays on the main thread.
    const wantTiff16 = format === 'tiff16';
    const { jpeg8, tiff16 } = await renderPool.processImage(data, {
      width, height, channels, is16bit, wantTiff16, params: renderParams,
    });

    if (tiff16) {
      const buf = await sharp(tiff16, { raw: { width, height, channels: 3, depth: 'ushort' } })
        .tiff({ compression: 'lzw', bitdepth: 16 })
        .toBuffer();
      res.setHeader('Content-Type', 'image/tiff');
      res.setHeader('Content-Disposition', 'attachment; filename="render_positive_' + id + '_' + Date.now() + '.tiff"');
      return res.send(buf);
    }

    const jpegBuf = await sharp(jpeg8, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="render_positive_' + id + '_' + Date.now() + '.jpg"');
    return res.send(jpegBuf);
  } catch (err) {
    console.error('[RENDER-POSITIVE] Error:', err);
    next(err);
  }
});

// delete photo (enhanced to remove file from disk if in rolls folder)
router.delete('/:id', async (req, res, next) => {
  const id = req.params.id;
  try {
    const row = await getAsync('SELECT roll_id, filename, full_rel_path, thumb_rel_path, original_rel_path, negative_rel_path, positive_rel_path, positive_thumb_rel_path, negative_thumb_rel_path FROM photos WHERE id = ?', [id]);
    
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

      // Delete files from disk — v4-review: use safeUnlink for all DB-derived paths
      for (const relPath of uniquePaths) {
        await safeUnlink(uploadsDir, relPath, { label: 'DELETE-PHOTO', silent: true });
      }
      
      // Fallback for legacy filename if no paths found
      if (uniquePaths.length === 0 && row.filename && !row.full_rel_path) {
        // v4-review: use safeUnlink (centralizes the isPathConfined guard)
        const legacyRel = row.filename.replace(/^\//, '');
        await safeUnlink(uploadsDir, legacyRel, { label: 'DELETE-PHOTO-LEGACY' });
      }
    }

    // Delete DB row
    const result = await runAsync('DELETE FROM photos WHERE id = ?', [id]);
    
    // NOTE: We intentionally do NOT resequence frame_numbers after deletion.
    // frame_number is used in disk file naming (e.g. {rollId}_{frame}-thumb.jpg).
    // Resequencing would desync DB frame_numbers from on-disk filenames, causing
    // new uploads to overwrite existing files. Gaps in numbering are harmless —
    // photos are still sorted correctly by frame_number, and MAX+1 guarantees
    // the next upload gets a unique, non-colliding number.

    // Cleanup orphaned tags
    try {
      await runAsync('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM photo_tags)');
    } catch (cleanupErr) {
      console.error('Tag cleanup error', cleanupErr);
    }

    res.json({ deleted: result?.changes || 0 });
  } catch (err) {
    next(err);
  }
});

// POST /api/photos/:id/download-with-exif
// Returns JPEG with embedded EXIF metadata (camera, lens, ISO, aperture, shutter, GPS, tags, etc.)
router.post('/:id/download-with-exif', async (req, res, next) => {
  const id = req.params.id;
  console.log('[DOWNLOAD-WITH-EXIF] Request received for photo ID:', id);
  
  const { exiftool } = require('exiftool-vendored');
  const os = require('os');
  
  try {
    // Fetch photo with all metadata including roll, film, equipment, scanner, and develop info
    const photo = await getAsync(`
      SELECT p.*, r.title as roll_title, r.camera as roll_camera, r.lens as roll_lens, 
             r.photographer as roll_photographer, r.start_date as roll_start_date,
             r.develop_lab, r.develop_process, r.develop_date, r.develop_note,
             -- Film info (full details)
             COALESCE(f.name, r.film_type) AS film_name,
             f.brand AS film_brand, f.iso AS film_iso, f.format AS film_format,
             f.category AS film_category, f.process AS film_process,
             -- Photo equipment
             pcam.name AS photo_camera_name, pcam.brand AS photo_camera_brand, pcam.model AS photo_camera_model,
             pcam.has_fixed_lens, pcam.fixed_lens_focal_length, pcam.fixed_lens_max_aperture,
             plens.name AS photo_lens_name, plens.brand AS photo_lens_brand, plens.model AS photo_lens_model,
             plens.focal_length_min AS photo_lens_focal_min, plens.focal_length_max AS photo_lens_focal_max,
             plens.max_aperture AS photo_lens_max_aperture,
             -- Roll equipment (fallback)
             rcam.name AS roll_camera_name, rcam.brand AS roll_camera_brand, rcam.model AS roll_camera_model,
             rcam.has_fixed_lens AS roll_has_fixed_lens, rcam.fixed_lens_focal_length AS roll_fixed_lens_focal,
             rcam.fixed_lens_max_aperture AS roll_fixed_lens_aperture,
             rlens.name AS roll_lens_name, rlens.brand AS roll_lens_brand, rlens.model AS roll_lens_model,
             rlens.focal_length_min AS roll_lens_focal_min, rlens.focal_length_max AS roll_lens_focal_max,
             rlens.max_aperture AS roll_lens_max_aperture,
             -- Scanner info
             pscan.name AS scanner_name, pscan.brand AS scanner_brand, pscan.model AS scanner_model,
             pscan.type AS scanner_type
      FROM photos p
      JOIN rolls r ON r.id = p.roll_id
      LEFT JOIN films f ON f.id = r.filmId
      LEFT JOIN equip_cameras pcam ON p.camera_equip_id = pcam.id
      LEFT JOIN equip_lenses plens ON p.lens_equip_id = plens.id
      LEFT JOIN equip_cameras rcam ON r.camera_equip_id = rcam.id
      LEFT JOIN equip_lenses rlens ON r.lens_equip_id = rlens.id
      LEFT JOIN equip_scanners pscan ON p.scanner_equip_id = pscan.id
      WHERE p.id = ?
    `, [id]);
    
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    
    // Determine camera and lens from equipment tables first, then fallback to text fields
    const cameraName = photo.photo_camera_name || photo.roll_camera_name || photo.camera || photo.roll_camera;
    const cameraBrand = photo.photo_camera_brand || photo.roll_camera_brand || (cameraName ? cameraName.split(' ')[0] : null);
    const lensName = photo.photo_lens_name || photo.roll_lens_name || photo.lens || photo.roll_lens;
    const lensBrand = photo.photo_lens_brand || photo.roll_lens_brand;
    
    // For PS cameras with fixed lens, get lens info from camera
    let fixedLensFocal = null, fixedLensAperture = null;
    if (photo.has_fixed_lens || photo.roll_has_fixed_lens) {
      fixedLensFocal = photo.fixed_lens_focal_length || photo.roll_fixed_lens_focal;
      fixedLensAperture = photo.fixed_lens_max_aperture || photo.roll_fixed_lens_aperture;
    }
    
    console.log('[DOWNLOAD-WITH-EXIF] Photo metadata:', {
      id: photo.id,
      camera: cameraName,
      cameraBrand,
      lens: lensName,
      lensBrand,
      fixedLensFocal,
      fixedLensAperture,
      photographer: photo.photographer || photo.roll_photographer,
      iso: photo.iso,
      aperture: photo.aperture,
      shutter_speed: photo.shutter_speed,
      focal_length: photo.focal_length,
      date_taken: photo.date_taken,
      latitude: photo.latitude,
      longitude: photo.longitude,
      // New fields
      film_brand: photo.film_brand,
      film_name: photo.film_name,
      film_iso: photo.film_iso,
      film_format: photo.film_format,
      film_process: photo.film_process,
      develop_lab: photo.develop_lab,
      develop_process: photo.develop_process,
      develop_date: photo.develop_date
    });
    
    // Get tags for this photo
    const tagRows = await allAsync('SELECT t.name FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.photo_id = ?', [id]);
    const tags = tagRows.map(t => t.name);
    console.log('[DOWNLOAD-WITH-EXIF] Tags:', tags);
    
    // Determine source image path (prefer positive, fallback to full)
    let sourcePath = photo.positive_rel_path || photo.full_rel_path;
    if (!sourcePath) {
      return res.status(400).json({ error: 'No image available for download' });
    }
    
    const sourceAbs = path.join(uploadsDir, sourcePath);
    if (!(await pathExists(sourceAbs))) {
      console.error('[DOWNLOAD-WITH-EXIF] Source file not found:', sourceAbs);
      return res.status(404).json({ error: 'Image file not found on disk' });
    }
    
    console.log('[DOWNLOAD-WITH-EXIF] Source file:', sourceAbs);
    
    // Only process JPEG files for EXIF writing
    const ext = path.extname(sourceAbs).toLowerCase();
    if (!['.jpg', '.jpeg'].includes(ext)) {
      // For non-JPEG, just return the file as-is
      const filename = photo.filename ? path.basename(photo.filename) : `photo_${id}${ext}`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.sendFile(sourceAbs);
    }
    
    // Create temp file for EXIF writing (avoid modifying original)
    const tempPath = path.join(os.tmpdir(), `filmgallery_exif_${Date.now()}.jpg`);
    (await fsPromises.copyFile(sourceAbs, tempPath));
    console.log('[DOWNLOAD-WITH-EXIF] Created temp file:', tempPath);
    
    // Build EXIF metadata object
    const exifData = {};
    
    // Camera info (from equipment library, with text field fallback)
    if (cameraName) {
      exifData.Make = cameraBrand || cameraName.split(' ')[0] || cameraName;
      exifData.Model = cameraName;
    }
    
    // Lens info (from equipment library, with text field fallback)
    // For fixed-lens cameras, use the built-in lens info
    if (fixedLensFocal) {
      // Fixed lens camera - construct lens model from camera data
      const lensStr = fixedLensAperture 
        ? `${fixedLensFocal}mm f/${fixedLensAperture}` 
        : `${fixedLensFocal}mm`;
      exifData.LensModel = `${cameraName} ${lensStr}`;
      // Also set focal length if not already specified
      if (!photo.focal_length) {
        exifData.FocalLength = fixedLensFocal;
      }
    } else if (lensName) {
      exifData.LensModel = lensName;
      if (lensBrand) {
        exifData.LensMake = lensBrand;
      }
    }
    
    // Photographer (Artist & Copyright)
    const photographer = photo.photographer || photo.roll_photographer;
    if (photographer) {
      exifData.Artist = photographer;
      exifData.Copyright = `© ${photographer}`;
    }
    
    // Shooting parameters
    if (photo.iso) exifData.ISO = photo.iso;
    if (photo.aperture) exifData.FNumber = photo.aperture;
    if (photo.shutter_speed) exifData.ExposureTime = photo.shutter_speed;
    if (photo.focal_length) exifData.FocalLength = photo.focal_length;
    
    // Lens focal length from equipment (if not set on photo)
    if (!photo.focal_length && !fixedLensFocal) {
      const focalMin = photo.photo_lens_focal_min || photo.roll_lens_focal_min;
      const focalMax = photo.photo_lens_focal_max || photo.roll_lens_focal_max;
      if (focalMin) {
        // For zoom lenses, use min focal length as default
        exifData.FocalLength = focalMin;
      }
    }
    
    // Lens serial number and additional info (XMP)
    const lensMaxAperture = photo.photo_lens_max_aperture || photo.roll_lens_max_aperture || fixedLensAperture;
    if (lensMaxAperture) {
      exifData.MaxApertureValue = lensMaxAperture;
    }
    
    // Date/Time (format: YYYY:MM:DD HH:mm:ss)
    if (photo.date_taken) {
      const dateStr = photo.date_taken;
      const timeStr = photo.time_taken || '12:00:00';
      const formatted = `${dateStr.replace(/-/g, ':')} ${timeStr}`;
      exifData.DateTimeOriginal = formatted;
      exifData.CreateDate = formatted;
    }
    
    // GPS Location
    if (photo.latitude && photo.longitude) {
      exifData.GPSLatitude = photo.latitude;
      exifData.GPSLongitude = photo.longitude;
    }
    
    // Build comprehensive film info string
    const filmParts = [];
    if (photo.film_brand) filmParts.push(photo.film_brand);
    if (photo.film_name) filmParts.push(photo.film_name);
    const filmFullName = filmParts.length > 0 ? filmParts.join(' ') : null;
    const filmDetails = [];
    if (filmFullName) filmDetails.push(filmFullName);
    if (photo.film_iso) filmDetails.push(`ISO ${photo.film_iso}`);
    if (photo.film_format) filmDetails.push(photo.film_format);
    if (photo.film_process) filmDetails.push(photo.film_process);
    
    // Build develop info string
    const developParts = [];
    if (photo.develop_lab) developParts.push(`Lab: ${photo.develop_lab}`);
    if (photo.develop_process) developParts.push(`Process: ${photo.develop_process}`);
    if (photo.develop_date) developParts.push(`Date: ${photo.develop_date}`);
    const developInfo = developParts.length > 0 ? developParts.join(', ') : null;
    
    // Description combining caption, roll info, film info, frame number
    const descParts = [];
    if (photo.caption) descParts.push(photo.caption);
    if (photo.roll_title) descParts.push(`Roll: ${photo.roll_title}`);
    if (filmFullName) descParts.push(`Film: ${filmDetails.join(' ')}`);
    if (photo.frame_number) descParts.push(`Frame: ${photo.frame_number}`);
    if (developInfo) descParts.push(`Develop: ${developInfo}`);
    if (descParts.length > 0) {
      exifData.ImageDescription = descParts.join(' | ');
    }
    
    // UserComment for extended film and develop info (better structured)
    const userCommentParts = [];
    if (filmDetails.length > 0) userCommentParts.push(`Film: ${filmDetails.join(' ')}`);
    if (lensName) userCommentParts.push(`Lens: ${lensName}`);
    if (developInfo) userCommentParts.push(developInfo);
    if (photo.develop_note) userCommentParts.push(`Note: ${photo.develop_note}`);
    if (userCommentParts.length > 0) {
      exifData.UserComment = userCommentParts.join(' | ');
    }
    
    // Keywords (tags) - IPTC/XMP compatible
    // Add film name and develop lab as keywords too
    const allKeywords = [...tags];
    if (filmFullName) allKeywords.push(filmFullName);
    if (photo.develop_lab) allKeywords.push(photo.develop_lab);
    if (allKeywords.length > 0) {
      exifData.Subject = allKeywords;
      exifData.Keywords = allKeywords;
    }
    
    // Software tag
    exifData.Software = 'FilmGallery v1.9.2';
    
    // Scanner/Digitization info (XMP custom namespace)
    // This preserves the original scanner/digitizer metadata
    if (photo.source_make) {
      exifData['XMP-FilmGallery:ScannerMake'] = photo.source_make;
    }
    if (photo.source_model) {
      exifData['XMP-FilmGallery:ScannerModel'] = photo.source_model;
    }
    if (photo.source_software) {
      exifData['XMP-FilmGallery:ScanSoftware'] = photo.source_software;
    }
    if (photo.scan_resolution) {
      exifData['XMP-FilmGallery:ScanResolution'] = photo.scan_resolution;
    }
    if (photo.scan_bit_depth) {
      exifData['XMP-FilmGallery:ScanBitDepth'] = photo.scan_bit_depth;
    }
    if (photo.scan_date) {
      exifData['XMP-FilmGallery:ScanDate'] = photo.scan_date;
    }
    
    // Y.3 (P0-5): redact GPS from EXIF logs — exifData contains lat/lon/alt
    // which is PII. Log only the keys being written, not their values.
    console.log(`[DOWNLOAD-WITH-EXIF] EXIF keys to write: [${Object.keys(exifData).join(',')}]`);
    
    // Write EXIF to temp file
    try {
      console.log('[DOWNLOAD-WITH-EXIF] Writing EXIF with exiftool...');
      await exiftool.write(tempPath, exifData, ['-overwrite_original']);
      console.log('[DOWNLOAD-WITH-EXIF] ✅ EXIF write successful');
    } catch (exifErr) {
      console.error('[DOWNLOAD-WITH-EXIF] exiftool write failed:', exifErr);
      // Clean up and return original file if EXIF write fails
      try { (await fsPromises.unlink(tempPath)); } catch(_) {}
      const filename = photo.filename ? path.basename(photo.filename) : `photo_${id}.jpg`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.sendFile(sourceAbs);
    }
    
    // Send file with embedded EXIF
    const filename = photo.filename ? path.basename(photo.filename) : `photo_${id}.jpg`;
    console.log('[DOWNLOAD-WITH-EXIF] Sending file with EXIF:', filename);
    res.download(tempPath, filename, (err) => {
      // Clean up temp file after download completes (sync here — callback
      // isn't async and unlink is fast on a temp file).
      try {
        fs.unlinkSync(tempPath);
      } catch (cleanupErr) {
        console.warn('[DOWNLOAD-WITH-EXIF] Failed to cleanup temp file:', cleanupErr.message);
      }
      if (err && !res.headersSent) {
        console.error('[DOWNLOAD-WITH-EXIF] Download error:', err);
      }
    });
    
  } catch (err) {
    console.error('[DOWNLOAD-WITH-EXIF] Error:', err);
    next(err);
  }
});

// ============================================
// GET /api/photos/geo - Photos with GPS data
// ============================================
/**
 * Fetch photos that have geographic coordinates (latitude/longitude).
 * Supports filtering by bounds, roll_id, and date range.
 * 
 * Query params:
 *   - bounds: "sw_lat,sw_lng,ne_lat,ne_lng" - filter to map viewport
 *   - roll_id: number - filter by specific roll
 *   - date_start: "YYYY-MM-DD" - filter by start date
 *   - date_end: "YYYY-MM-DD" - filter by end date
 *   - limit: number - max photos to return (default: 2000)
 */
router.get('/geo', async (req, res, next) => {
  try {
    const { bounds, roll_id, date_start, date_end, limit = 2000 } = req.query;
    
    let sql = `
      SELECT 
        p.id,
        p.roll_id,
        p.filename,
        p.latitude,
        p.longitude,
        p.thumb_rel_path,
        p.positive_thumb_rel_path,
        p.negative_thumb_rel_path,
        p.full_rel_path,
        p.positive_rel_path,
        p.negative_rel_path,
        p.date_taken,
        p.taken_at,
        p.detail_location,
        p.city,
        p.country,
        p.camera,
        p.lens,
        r.title AS roll_name
      FROM photos p
      LEFT JOIN rolls r ON r.id = p.roll_id
      WHERE p.latitude IS NOT NULL 
        AND p.longitude IS NOT NULL
        AND p.latitude != 0
        AND p.longitude != 0
    `;
    
    const params = [];
    
    // Filter by roll ID
    if (roll_id) {
      sql += ` AND p.roll_id = ?`;
      params.push(Number(roll_id));
    }
    
    // Filter by date range
    if (date_start) {
      sql += ` AND (p.date_taken >= ? OR p.taken_at >= ?)`;
      params.push(date_start, date_start);
    }
    
    if (date_end) {
      sql += ` AND (p.date_taken <= ? OR p.taken_at <= ?)`;
      params.push(date_end, date_end);
    }
    
    // Filter by map bounds (sw_lat, sw_lng, ne_lat, ne_lng)
    if (bounds) {
      const [sw_lat, sw_lng, ne_lat, ne_lng] = bounds.split(',').map(Number);
      if (!isNaN(sw_lat) && !isNaN(sw_lng) && !isNaN(ne_lat) && !isNaN(ne_lng)) {
        sql += ` AND p.latitude BETWEEN ? AND ? AND p.longitude BETWEEN ? AND ?`;
        params.push(sw_lat, ne_lat, sw_lng, ne_lng);
      }
    }
    
    // Order by date (newest first) for consistent results
    sql += ` ORDER BY COALESCE(p.date_taken, p.taken_at) DESC`;
    
    // Apply limit
    sql += ` LIMIT ?`;
    params.push(Number(limit));
    
    const photos = await allAsync(sql, params);
    
    // Get total count of geo-tagged photos (without limit)
    const countResult = await getAsync(`
      SELECT COUNT(*) as total 
      FROM photos 
      WHERE latitude IS NOT NULL 
        AND longitude IS NOT NULL
        AND latitude != 0
        AND longitude != 0
    `);
    
    res.json({
      photos: photos || [],
      total: countResult?.total || 0,
      returned: photos?.length || 0,
    });
    
  } catch (err) {
    console.error('[GET /api/photos/geo] Error:', err);
    next(err);
  }
});

module.exports = router;
