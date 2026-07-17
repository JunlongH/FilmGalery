/**
 * Roll Service
 * 
 * Business logic and database operations for rolls.
 * Separates concerns from the controller layer (routes/rolls.js).
 * 
 * @module server/services/roll-service
 */

const { runAsync, allAsync, getAsync } = require('../utils/db-helpers');

// ============================================================================
// DISPLAY SEQUENCE MANAGEMENT
// ============================================================================

async function ensureDisplaySeqColumn() {
  // Check if column exists using PRAGMA
  const cols = await allAsync(`PRAGMA table_info(rolls)`);
  const hasCol = cols.some(c => c.name === 'display_seq');
  
  if (!hasCol) {
    try {
      await runAsync(`ALTER TABLE rolls ADD COLUMN display_seq INTEGER NOT NULL DEFAULT 0`);
      console.log('[MIGRATION] display_seq column created via ALTER TABLE');
    } catch (e) {
      console.error('[MIGRATION] Failed to add display_seq column:', e.message);
      throw e;
    }
  }
}

// Ensure the `start_date` column exists on rolls (added by a migration that is
// currently disabled — without this the server crashes on a fresh database at
// first run). Idempotent; backfills from date_loaded when added.
async function ensureStartDateColumn() {
  const cols = await allAsync(`PRAGMA table_info(rolls)`);
  if (cols.some(c => c.name === 'start_date')) return;
  try {
    await runAsync(`ALTER TABLE rolls ADD COLUMN start_date DATE`);
    await runAsync(`UPDATE rolls SET start_date = date_loaded WHERE start_date IS NULL AND date_loaded IS NOT NULL`);
    console.log('[MIGRATION] start_date column created via ALTER TABLE');
  } catch (e) {
    console.error('[MIGRATION] Failed to add start_date column:', e.message);
    throw e;
  }
}

async function recomputeRollSequence() {
  await ensureDisplaySeqColumn();
  await ensureStartDateColumn();
  
  const rows = await allAsync(`
    SELECT id
    FROM rolls
    ORDER BY 
      CASE WHEN start_date IS NULL THEN 1 ELSE 0 END,
      start_date ASC,
      CASE WHEN created_at IS NULL THEN 1 ELSE 0 END,
      created_at ASC,
      id ASC
  `);

  if (rows.length === 0) return { count: 0 };

  await runAsync('BEGIN');
  try {
    let seq = 1;
    for (const r of rows) {
      await runAsync(`UPDATE rolls SET display_seq = ? WHERE id = ?`, [seq, r.id]);
      seq++;
    }
    await runAsync('COMMIT');
    console.log(`[MIGRATION] Recomputed display_seq for ${rows.length} rolls`);
  } catch (e) {
    try { await runAsync('ROLLBACK'); } catch(_) {}
    throw e;
  }

  return { count: rows.length };
}

// ============================================================================
// ROLL CRUD OPERATIONS
// ============================================================================

/**
 * Build filter conditions for rolls query
 * @param {Object} filters - Filter parameters
 * @returns {{conditions: string[], params: any[]}}
 */
function buildRollFilters(filters) {
  const {
    camera, lens, photographer, location_id, year, month, ym, film,
    camera_equip_id, lens_equip_id, flash_equip_id, film_id, q
  } = filters;
  
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
      userCityNames.push(str.substring(6)); // Extract city name after "user::"
    } else {
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
  
  const conditions = [];
  const params = [];
  
  // Full-text search (q parameter)
  if (q && typeof q === 'string' && q.trim()) {
    const searchTerm = `%${q.trim()}%`;
    conditions.push(`(
      rolls.title LIKE ? 
      OR rolls.notes LIKE ?
      OR rolls.camera LIKE ?
      OR rolls.lens LIKE ?
      OR rolls.photographer LIKE ?
      OR films.name LIKE ?
      OR cam.brand LIKE ?
      OR cam.model LIKE ?
    )`);
    params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
  }
  
  // Equipment ID filters
  if (camera_equip_id) {
    conditions.push(`rolls.camera_equip_id = ?`);
    params.push(Number(camera_equip_id));
  }
  if (lens_equip_id) {
    conditions.push(`rolls.lens_equip_id = ?`);
    params.push(Number(lens_equip_id));
  }
  if (flash_equip_id) {
    conditions.push(`rolls.flash_equip_id = ?`);
    params.push(Number(flash_equip_id));
  }
  if (film_id) {
    conditions.push(`rolls.filmId = ?`);
    params.push(Number(film_id));
  }
  
  // Legacy text filters
  if (cameras.length) {
    conditions.push(`(rolls.camera IN (${cameras.map(()=>'?').join(',')}) OR cam.model IN (${cameras.map(()=>'?').join(',')}) OR cam.name IN (${cameras.map(()=>'?').join(',')}))`);
    params.push(...cameras, ...cameras, ...cameras);
  }
  if (lenses.length) {
    // Match against:
    // 1) rolls.lens (legacy text field)
    // 2) lens.name (from equip_lenses table)
    // 3) Virtual lens name for fixed-lens cameras: "Camera Name focal_length mm f/aperture"
    // Note: Use CASE to handle integer apertures (f/11 not f/11.0)
    const virtualLensExpr = `(cam.has_fixed_lens = 1 AND (cam.name || ' ' || CAST(cam.fixed_lens_focal_length AS INTEGER) || 'mm f/' || CASE WHEN cam.fixed_lens_max_aperture = CAST(cam.fixed_lens_max_aperture AS INTEGER) THEN CAST(cam.fixed_lens_max_aperture AS INTEGER) ELSE cam.fixed_lens_max_aperture END) IN (${lenses.map(()=>'?').join(',')}))`;
    const lensConditions = [
      `rolls.lens IN (${lenses.map(()=>'?').join(',')})`,
      `lens.name IN (${lenses.map(()=>'?').join(',')})`,
      virtualLensExpr
    ];
    conditions.push(`(${lensConditions.join(' OR ')})`);
    params.push(...lenses, ...lenses, ...lenses);
  }
  if (photographers.length) {
    conditions.push(`rolls.photographer IN (${photographers.map(()=>'?').join(',')})`);
    params.push(...photographers);
  }
  
  // Location filter via roll_locations or photos with user-entered cities
  if (numericLocationIds.length || userCityNames.length) {
    const locationConditions = [];
    if (numericLocationIds.length) {
      locationConditions.push(`EXISTS (
        SELECT 1 FROM roll_locations rl WHERE rl.roll_id = rolls.id 
        AND rl.location_id IN (${numericLocationIds.map(()=>'?').join(',')})
      )`);
      params.push(...numericLocationIds);
    }
    if (userCityNames.length) {
      // Include rolls that have photos with user-entered city names
      locationConditions.push(`EXISTS (
        SELECT 1 FROM photos p WHERE p.roll_id = rolls.id 
        AND p.location_id IS NULL 
        AND p.city IN (${userCityNames.map(()=>'?').join(',')})
      )`);
      params.push(...userCityNames);
    }
    conditions.push(`(${locationConditions.join(' OR ')})`);
  }
  
  // Date filters
  if (yms.length || years.length || months.length) {
    const parts = [];
    if (yms.length) {
      parts.push(`strftime('%Y-%m', rolls.start_date) IN (${yms.map(()=>'?').join(',')})`);
      params.push(...yms);
    } else {
      if (years.length) { 
        parts.push(`strftime('%Y', rolls.start_date) IN (${years.map(()=>'?').join(',')})`); 
        params.push(...years); 
      }
      if (months.length) { 
        parts.push(`strftime('%m', rolls.start_date) IN (${months.map(()=>'?').join(',')})`); 
        params.push(...months); 
      }
    }
    if (parts.length) conditions.push(`(${parts.join(' OR ')})`);
  }
  
  // Film filter
  if (films.length) {
    const filmConds = films.map(() => `(
      rolls.filmId = ? OR films.name = ? OR rolls.film_type = ?
    )`).join(' OR ');
    conditions.push(`(${filmConds})`);
    films.forEach(fv => { params.push(fv, fv, fv); });
  }
  
  return { conditions, params };
}

/**
 * Get all rolls with optional filters
 * @param {Object} filters - Filter parameters
 * @returns {Promise<Array>}
 */
async function listRolls(filters = {}) {
  let sql = `
    SELECT DISTINCT rolls.*, 
           films.name AS film_name_joined,
           COALESCE(cam.brand || ' ' || cam.model, rolls.camera) AS display_camera,
           COALESCE(
             lens.brand || ' ' || lens.model,
             CASE WHEN cam.has_fixed_lens = 1 THEN 
               cam.fixed_lens_focal_length || 'mm f/' || cam.fixed_lens_max_aperture 
             END,
             rolls.lens
           ) AS display_lens,
           cam.has_fixed_lens AS camera_has_fixed_lens,
           cam.fixed_lens_focal_length,
           cam.fixed_lens_max_aperture
    FROM rolls 
    LEFT JOIN films ON rolls.filmId = films.id 
    LEFT JOIN equip_cameras cam ON rolls.camera_equip_id = cam.id
    LEFT JOIN equip_lenses lens ON rolls.lens_equip_id = lens.id
  `;
  
  const { conditions, params } = buildRollFilters(filters);
  
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  
  sql += ' ORDER BY rolls.start_date DESC, rolls.id DESC';
  
  return allAsync(sql, params);
}

/**
 * Get single roll by ID with full details
 * @param {number} id - Roll ID
 * @returns {Promise<Object|null>}
 */
async function getRollById(id) {
  const sql = `
    SELECT rolls.*, 
           films.name AS film_name_joined, 
           films.iso AS film_iso_joined,
           cam.name AS camera_equip_name,
           cam.brand AS camera_equip_brand,
           cam.model AS camera_equip_model,
           cam.mount AS camera_equip_mount,
           cam.type AS camera_equip_type,
           cam.has_fixed_lens AS camera_has_fixed_lens,
           cam.fixed_lens_focal_length AS camera_fixed_lens_focal_length,
           cam.fixed_lens_max_aperture AS camera_fixed_lens_max_aperture,
           cam.image_path AS camera_equip_image,
           lens.name AS lens_equip_name,
           lens.brand AS lens_equip_brand,
           lens.model AS lens_equip_model,
           lens.mount AS lens_equip_mount,
           lens.focal_length_min AS lens_equip_focal_length_min,
           lens.focal_length_max AS lens_equip_focal_length_max,
           lens.max_aperture AS lens_equip_max_aperture,
           lens.image_path AS lens_equip_image,
           flash.name AS flash_equip_name,
           flash.brand AS flash_equip_brand,
           flash.model AS flash_equip_model,
           flash.image_path AS flash_equip_image,
           scanner.name AS scanner_equip_name,
           scanner.brand AS scanner_equip_brand,
           scanner.model AS scanner_equip_model,
           scanner.image_path AS scanner_equip_image,
           fb.name AS film_back_equip_name,
           fb.brand AS film_back_equip_brand,
           fb.model AS film_back_equip_model,
           fb.sub_format AS film_back_sub_format,
           fb.image_path AS film_back_equip_image,
           -- Dynamic display fields
           COALESCE(cam.brand || ' ' || cam.model, rolls.camera) AS display_camera,
           COALESCE(
             lens.brand || ' ' || lens.model,
             CASE WHEN cam.has_fixed_lens = 1 THEN 
               cam.fixed_lens_focal_length || 'mm f/' || cam.fixed_lens_max_aperture 
             END,
             rolls.lens
           ) AS display_lens
    FROM rolls 
    LEFT JOIN films ON rolls.filmId = films.id
    LEFT JOIN equip_cameras cam ON rolls.camera_equip_id = cam.id
    LEFT JOIN equip_lenses lens ON rolls.lens_equip_id = lens.id
    LEFT JOIN equip_flashes flash ON rolls.flash_equip_id = flash.id
    LEFT JOIN equip_scanners scanner ON rolls.scanner_equip_id = scanner.id
    LEFT JOIN equip_film_backs fb ON rolls.film_back_equip_id = fb.id
    WHERE rolls.id = ?
  `;
  return getAsync(sql, [id]);
}

/**
 * Get single roll by ID with full details including locations and gear
 * @param {number} id - Roll ID
 * @returns {Promise<Object|null>}
 */
async function getRollByIdWithDetails(id) {
  const row = await getRollById(id);
  if (!row) return null;
  
  // Fetch locations
  try {
    const tableExists = await getAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='locations'", 
      []
    );
    if (tableExists) {
      row.locations = await getRollLocations(id);
    } else {
      row.locations = [];
    }
  } catch (e) {
    console.warn('[getRollByIdWithDetails] Error fetching locations:', e.message);
    row.locations = [];
  }
  
  // Fetch gear arrays
  try {
    const gearRows = await allAsync(
      'SELECT type, value FROM roll_gear WHERE roll_id = ?', 
      [id]
    );
    const gear = { cameras: [], lenses: [], photographers: [] };
    (gearRows || []).forEach(g => {
      if (g.type === 'camera') gear.cameras.push(g.value);
      else if (g.type === 'lens') gear.lenses.push(g.value);
      else if (g.type === 'photographer') gear.photographers.push(g.value);
    });
    row.gear = gear;
  } catch (e) {
    console.warn('[getRollByIdWithDetails] Error fetching gear:', e.message);
    row.gear = { cameras: [], lenses: [], photographers: [] };
  }
  
  return row;
}

/**
 * Get roll locations
 * @param {number} rollId - Roll ID
 * @returns {Promise<Array>}
 */
async function getRollLocations(rollId) {
  return allAsync(`
    SELECT l.id AS location_id, l.country_code, l.country_name, l.city_name, l.city_lat, l.city_lng
    FROM roll_locations rl
    JOIN locations l ON rl.location_id = l.id
    WHERE rl.roll_id = ?
    ORDER BY l.country_name, l.city_name
  `, [rollId]);
}

/**
 * Get roll preset
 * @param {number} rollId - Roll ID
 * @returns {Promise<Object|null>}
 */
async function getRollPreset(rollId) {
  const row = await getAsync('SELECT preset_json FROM rolls WHERE id = ?', [rollId]);
  if (!row || !row.preset_json) return null;
  try {
    return JSON.parse(row.preset_json);
  } catch {
    return null;
  }
}

/**
 * Set roll preset
 * @param {number} rollId - Roll ID
 * @param {string} name - Preset name
 * @param {Object} params - Preset parameters
 * @returns {Promise<{updated: number}>}
 */
async function setRollPreset(rollId, name, params) {
  const payload = { name: name || 'Unnamed', params };
  const json = JSON.stringify(payload);
  const result = await runAsync('UPDATE rolls SET preset_json = ? WHERE id = ?', [json, rollId]);
  return { updated: result?.changes || 0 };
}

/**
 * Clear roll preset
 * @param {number} rollId - Roll ID
 * @returns {Promise<{cleared: number}>}
 */
async function clearRollPreset(rollId) {
  const result = await runAsync('UPDATE rolls SET preset_json = NULL WHERE id = ?', [rollId]);
  return { cleared: result?.changes || 0 };
}

/**
 * Update roll
 * @param {number} id - Roll ID
 * @param {Object} data - Update data
 * @returns {Promise<{updated: number}>}
 */
async function updateRoll(id, data) {
  const allowedFields = [
    'title', 'start_date', 'end_date', 'camera', 'lens', 'photographer',
    'film_type', 'filmId', 'notes', 'develop_lab', 'develop_process',
    'develop_date', 'purchase_cost', 'develop_cost', 'purchase_channel',
    'batch_number', 'develop_note', 'camera_equip_id', 'lens_equip_id',
    'flash_equip_id', 'scanner_equip_id', 'scan_resolution', 'scan_software',
    'scan_lab', 'scan_date', 'scan_cost', 'scan_notes', 'format', 'film_back_equip_id'
  ];
  
  const updates = [];
  const params = [];
  
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(data[field]);
    }
  }
  
  if (updates.length === 0) {
    return { updated: 0 };
  }
  
  params.push(id);
  const sql = `UPDATE rolls SET ${updates.join(', ')} WHERE id = ?`;
  const result = await runAsync(sql, params);
  return { updated: result?.changes || 0 };
}

/**
 * Add locations to a roll
 * @param {number} rollId - Roll ID
 * @param {number[]} locationIds - Location IDs to add
 * @returns {Promise<{added: number}>}
 */
async function addRollLocations(rollId, locationIds) {
  if (!Array.isArray(locationIds) || locationIds.length === 0) {
    return { added: 0 };
  }
  
  let added = 0;
  for (const locId of locationIds) {
    try {
      await runAsync(
        'INSERT OR IGNORE INTO roll_locations (roll_id, location_id) VALUES (?, ?)', 
        [rollId, locId]
      );
      added++;
    } catch (e) {
      console.warn(`[addRollLocations] Failed to add location ${locId}:`, e.message);
    }
  }
  return { added };
}

/**
 * Delete roll from database with full cleanup
 * Returns all photo paths for filesystem cleanup by caller.
 * @param {number} id - Roll ID
 * @returns {Promise<{deleted: number, roll: Object|null, photos: Array}>}
 */
async function deleteRollFromDb(id) {
  // Get roll data for cleanup
  const roll = await getAsync(
    'SELECT id, cover_photo, coverPath, folderName FROM rolls WHERE id = ?', 
    [id]
  );
  
  // Get all photo paths for cleanup
  const photos = await allAsync(`
    SELECT id, full_rel_path, positive_rel_path, negative_rel_path, 
           thumb_rel_path, positive_thumb_rel_path, negative_thumb_rel_path
    FROM photos WHERE roll_id = ?
  `, [id]);
  
  await runAsync('BEGIN');
  try {
    // Delete related records in proper order
    await runAsync('DELETE FROM photo_tags WHERE photo_id IN (SELECT id FROM photos WHERE roll_id = ?)', [id]);
    await runAsync('DELETE FROM roll_locations WHERE roll_id = ?', [id]);
    await runAsync('DELETE FROM roll_gear WHERE roll_id = ?', [id]);
    // Unlink film items without deleting them
    await runAsync('UPDATE film_items SET roll_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE roll_id = ?', [id]);
    await runAsync('DELETE FROM photos WHERE roll_id = ?', [id]);
    const result = await runAsync('DELETE FROM rolls WHERE id = ?', [id]);
    await runAsync('COMMIT');
    
    return { 
      deleted: result?.changes || 0, 
      roll, 
      photos 
    };
  } catch (e) {
    try { await runAsync('ROLLBACK'); } catch(_) {}
    throw e;
  }
}

/**
 * Set roll cover
 * @param {number} rollId - Roll ID
 * @param {Object} options - Cover options
 * @param {number} [options.photoId] - Photo ID to use as cover
 * @param {string} [options.filename] - Filename or path to use as cover
 * @returns {Promise<Object>} Updated roll data
 */
async function setRollCover(rollId, { photoId, filename }) {
  /**
   * Normalize file path into coverPath and cover_photo fields
   * - coverPath: Full path with /uploads/ prefix for direct URL use
   * - cover_photo: Legacy relative path without /uploads/ prefix
   */
  const normalizeCoverPath = (file) => {
    if (!file) return { coverPath: null, coverPhoto: null };
    
    if (typeof file !== 'string') return { coverPath: null, coverPhoto: null };
    
    // Already an absolute URL or uploads path
    if (file.startsWith('/uploads') || file.startsWith('http://') || file.startsWith('https://')) {
      const coverPath = file;
      const coverPhoto = file.startsWith('/uploads/') 
        ? file.replace(/^\/uploads\//, '') 
        : file;
      return { coverPath, coverPhoto };
    }
    
    // Leading slash but not /uploads
    if (file.startsWith('/')) {
      return { 
        coverPath: file, 
        coverPhoto: file.replace(/^\//, '') 
      };
    }
    
    // Relative path (e.g., 'rolls/...')
    return { 
      coverPath: `/uploads/${file}`.replace(/\\/g, '/'),
      coverPhoto: file 
    };
  };
  
  let filePath = null;
  
  // Get photo path if photoId provided
  if (photoId) {
    const photo = await getAsync(
      `SELECT filename, full_rel_path, positive_rel_path, negative_rel_path 
       FROM photos WHERE id = ? AND roll_id = ?`,
      [photoId, rollId]
    );
    if (!photo) {
      throw new Error('Photo not found');
    }
    
    const photoPath = photo.positive_rel_path || photo.full_rel_path || photo.negative_rel_path;
    filePath = photoPath 
      ? `/uploads/${photoPath}`.replace(/\\/g, '/')
      : photo.filename;
  } else if (filename) {
    filePath = filename;
  }
  
  const { coverPath, coverPhoto } = normalizeCoverPath(filePath);
  
  await runAsync(
    'UPDATE rolls SET coverPath = ?, cover_photo = ? WHERE id = ?', 
    [coverPath, coverPhoto, rollId]
  );
  
  // Return updated roll
  return getAsync('SELECT * FROM rolls WHERE id = ?', [rollId]);
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Display sequence
  recomputeRollSequence,
  ensureDisplaySeqColumn,
  ensureStartDateColumn,
  
  // CRUD operations
  listRolls,
  getRollById,
  getRollByIdWithDetails,
  getRollLocations,
  addRollLocations,
  updateRoll,
  deleteRollFromDb,
  
  // Preset operations
  getRollPreset,
  setRollPreset,
  clearRollPreset,
  
  // Cover
  setRollCover,
  
  // Utilities
  buildRollFilters
};
