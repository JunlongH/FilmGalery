/**
 * Equipment Service - Centralized business logic for equipment management
 * 
 * Provides generic CRUD operations for all equipment types:
 * - Cameras, Lenses, Flashes, Scanners, Film Backs, Film Formats
 * 
 * Extracts common patterns to reduce code duplication in routes.
 */

const { runAsync, allAsync, getAsync } = require('../utils/db-helpers');
const { parseCameraString, parseLensString, isFixedLensString } = require('../utils/equipment-parse');
const { ValidationError } = require('../middleware/error-handler');

/**
 * Equipment type configurations
 * Defines table names, field mappings, and boolean field handling
 */
const EQUIPMENT_CONFIG = {
  cameras: {
    table: 'equip_cameras',
    displayName: 'Camera',
    fields: [
      'name', 'brand', 'model', 'type', 'format_id', 'sub_format', 'mount',
      'has_fixed_lens', 'fixed_lens_focal_length', 'fixed_lens_max_aperture', 'fixed_lens_min_aperture',
      'has_built_in_flash', 'flash_gn',
      'production_year_start', 'production_year_end',
      'meter_type', 'shutter_type', 'shutter_speed_min', 'shutter_speed_max', 'weight_g', 'battery_type',
      'serial_number', 'purchase_date', 'purchase_price', 'condition', 'notes', 'image_path', 'status',
      'is_digital', 'sensor_type', 'sensor_width_mm', 'sensor_height_mm', 'megapixels', 'crop_factor', 'sensor_format'
    ],
    booleanFields: ['has_fixed_lens', 'has_built_in_flash', 'is_digital'],
    requiredFields: ['name'],
    defaultValues: { status: 'owned' },
    listJoin: `
      SELECT c.*, f.name as format_name
      FROM equip_cameras c
      LEFT JOIN ref_film_formats f ON c.format_id = f.id
    `,
    listAlias: 'c'
  },
  lenses: {
    table: 'equip_lenses',
    displayName: 'Lens',
    fields: [
      'name', 'brand', 'model',
      'focal_length_min', 'focal_length_max', 'max_aperture', 'min_aperture', 'max_aperture_tele',
      'mount', 'focus_type', 'min_focus_distance', 'filter_size', 'weight_g',
      'elements', 'groups', 'blade_count',
      'is_macro', 'magnification_ratio', 'image_stabilization',
      'production_year_start', 'production_year_end',
      'serial_number', 'purchase_date', 'purchase_price', 'condition', 'notes', 'image_path', 'status',
      'is_digital'
    ],
    booleanFields: ['is_macro', 'image_stabilization'],
    requiredFields: ['name'],
    defaultValues: { status: 'owned', focus_type: 'manual' }
  },
  flashes: {
    table: 'equip_flashes',
    displayName: 'Flash',
    fields: [
      'name', 'brand', 'model', 'guide_number',
      'ttl_compatible', 'has_auto_mode', 'swivel_head', 'bounce_head',
      'power_source', 'recycle_time',
      'serial_number', 'purchase_date', 'purchase_price', 'condition', 'notes', 'image_path', 'status'
    ],
    booleanFields: ['ttl_compatible', 'has_auto_mode', 'swivel_head', 'bounce_head'],
    requiredFields: ['name'],
    defaultValues: { status: 'owned' }
  },
  scanners: {
    table: 'equip_scanners',
    displayName: 'Scanner',
    fields: [
      'name', 'brand', 'model', 'type', 'max_resolution', 'sensor_type', 'supported_formats',
      'has_infrared_cleaning', 'bit_depth', 'default_software',
      'camera_equip_id', 'lens_equip_id',
      'serial_number', 'purchase_date', 'purchase_price', 'condition', 'notes', 'image_path', 'status'
    ],
    booleanFields: ['has_infrared_cleaning'],
    requiredFields: ['name'],
    defaultValues: { status: 'owned' }
  },
  'film-backs': {
    table: 'equip_film_backs',
    displayName: 'Film Back',
    fields: [
      'name', 'brand', 'model',
      'format', 'sub_format', 'frame_width_mm', 'frame_height_mm', 'frames_per_roll',
      'compatible_cameras', 'mount_type',
      'magazine_type', 'is_motorized', 'has_dark_slide',
      'serial_number', 'purchase_date', 'purchase_price', 'condition', 'notes', 'image_path', 'status'
    ],
    booleanFields: ['is_motorized', 'has_dark_slide'],
    requiredFields: ['name'],
    defaultValues: { status: 'owned', format: '120', has_dark_slide: true }
  },
  formats: {
    table: 'ref_film_formats',
    displayName: 'Film Format',
    fields: ['name', 'description', 'frame_size'],
    booleanFields: [],
    requiredFields: ['name'],
    defaultValues: {},
    noSoftDelete: true // Formats use hard delete only
  }
};

/**
 * Convert value based on field type
 */
function convertValue(field, value, config) {
  if (config.booleanFields.includes(field)) {
    return value ? 1 : 0;
  }
  return value;
}

/**
 * Apply default values to data object
 */
function applyDefaults(data, config) {
  const result = { ...data };
  for (const [key, defaultValue] of Object.entries(config.defaultValues || {})) {
    if (result[key] === undefined) {
      result[key] = defaultValue;
    }
  }
  return result;
}

/**
 * Validate required fields
 */
function validateRequired(data, config) {
  for (const field of config.requiredFields) {
    if (!data[field]) {
      throw new Error(`${field} is required`);
    }
  }
}

// ========================================
// GENERIC CRUD OPERATIONS
// ========================================

/**
 * List equipment with optional filters
 */
async function listEquipment(type, filters = {}) {
  const config = EQUIPMENT_CONFIG[type];
  if (!config) throw new Error(`Unknown equipment type: ${type}`);

  const alias = config.listAlias || '';
  const prefix = alias ? `${alias}.` : '';
  
  let sql = config.listJoin || `SELECT * FROM ${config.table}`;
  sql += ` WHERE 1=1`;
  
  const params = [];

  // Handle soft delete
  if (!config.noSoftDelete && !filters.includeDeleted) {
    sql += ` AND ${prefix}deleted_at IS NULL`;
  }

  // Allowed filter fields (only fields that exist in config + common fields)
  const allowedFilterFields = new Set([
    ...config.fields,
    'id', 'deleted_at', 'created_at', 'updated_at'
  ]);

  // Apply dynamic filters - only for valid fields
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || key === 'includeDeleted') continue;
    // Skip unknown fields to prevent SQL errors
    if (!allowedFilterFields.has(key)) {
      console.warn(`[equipment-service] Ignoring unknown filter field: ${key}`);
      continue;
    }
    sql += ` AND ${prefix}${key} = ?`;
    params.push(value);
  }

  sql += ` ORDER BY ${prefix}brand, ${prefix}name`;

  return allAsync(sql, params);
}

/**
 * Get single equipment by ID
 */
async function getEquipmentById(type, id) {
  const config = EQUIPMENT_CONFIG[type];
  if (!config) throw new Error(`Unknown equipment type: ${type}`);

  // Use join query if available
  if (config.listJoin) {
    const sql = config.listJoin + ` WHERE ${config.listAlias || ''}.id = ?`;
    return getAsync(sql.replace('WHERE 1=1', ''), [id]);
  }

  return getAsync(`SELECT * FROM ${config.table} WHERE id = ?`, [id]);
}

/**
 * Create new equipment
 */
async function createEquipment(type, data) {
  const config = EQUIPMENT_CONFIG[type];
  if (!config) throw new Error(`Unknown equipment type: ${type}`);

  validateRequired(data, config);
  const finalData = applyDefaults(data, config);

  const fieldsToInsert = config.fields.filter(f => f !== 'image_path');
  const values = fieldsToInsert.map(f => convertValue(f, finalData[f] ?? null, config));
  
  const columns = fieldsToInsert.join(', ');
  const placeholders = fieldsToInsert.map(() => '?').join(', ');
  
  // Add updated_at for tables that have it
  const hasUpdatedAt = !config.noSoftDelete;
  const sql = hasUpdatedAt
    ? `INSERT INTO ${config.table} (${columns}, updated_at) VALUES (${placeholders}, CURRENT_TIMESTAMP)`
    : `INSERT INTO ${config.table} (${columns}) VALUES (${placeholders})`;

  const result = await runAsync(sql, values);
  return getAsync(`SELECT * FROM ${config.table} WHERE id = ?`, [result.lastID]);
}

/**
 * Update equipment by ID
 */
async function updateEquipment(type, id, data) {
  const config = EQUIPMENT_CONFIG[type];
  if (!config) throw new Error(`Unknown equipment type: ${type}`);

  const updates = [];
  const params = [];

  for (const field of config.fields) {
    if (data[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(convertValue(field, data[field], config));
    }
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  // Add updated_at for tables that have it
  if (!config.noSoftDelete) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
  }
  params.push(id);

  await runAsync(`UPDATE ${config.table} SET ${updates.join(', ')} WHERE id = ?`, params);
  return getAsync(`SELECT * FROM ${config.table} WHERE id = ?`, [id]);
}

/**
 * Delete equipment (soft or hard)
 */
async function deleteEquipment(type, id, hard = false) {
  const config = EQUIPMENT_CONFIG[type];
  if (!config) throw new Error(`Unknown equipment type: ${type}`);

  if (hard || config.noSoftDelete) {
    await runAsync(`DELETE FROM ${config.table} WHERE id = ?`, [id]);
  } else {
    await runAsync(
      `UPDATE ${config.table} SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );
  }

  return { ok: true };
}

/**
 * Update equipment image path
 */
async function updateEquipmentImage(type, id, imagePath) {
  const config = EQUIPMENT_CONFIG[type];
  if (!config) throw new Error(`Unknown equipment type: ${type}`);

  if (config.noSoftDelete) {
    throw new Error(`${config.displayName} does not support images`);
  }

  await runAsync(
    `UPDATE ${config.table} SET image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [imagePath, id]
  );

  return { image_path: imagePath };
}

// ========================================
// SPECIALIZED QUERIES
// ========================================

/**
 * Get all equipment suggestions (for dropdowns)
 */
async function getEquipmentSuggestions() {
  const [cameras, lenses, flashes, formats] = await Promise.all([
    allAsync(`
      SELECT id, name, brand, model, mount, type, has_fixed_lens, 
             fixed_lens_focal_length, fixed_lens_max_aperture, image_path
      FROM equip_cameras 
      WHERE deleted_at IS NULL 
      ORDER BY brand, name
    `),
    allAsync(`
      SELECT id, name, brand, model, mount, focal_length_min, focal_length_max, 
             max_aperture, focus_type, image_path
      FROM equip_lenses 
      WHERE deleted_at IS NULL 
      ORDER BY brand, focal_length_min, name
    `),
    allAsync(`
      SELECT id, name, brand, model, guide_number, image_path
      FROM equip_flashes 
      WHERE deleted_at IS NULL 
      ORDER BY brand, name
    `),
    allAsync(`SELECT * FROM ref_film_formats ORDER BY name`)
  ]);

  return { cameras, lenses, flashes, formats };
}

/**
 * Get compatible lenses for a camera
 */
async function getCompatibleLenses(cameraId, mode = null) {
  const camera = await getAsync(`
    SELECT id, brand, model, mount, has_fixed_lens, fixed_lens_focal_length, fixed_lens_max_aperture,
           is_digital
    FROM equip_cameras WHERE id = ?
  `, [cameraId]);

  if (!camera) {
    return null;
  }

  const cameraName = `${camera.brand || ''} ${camera.model || ''}`.trim();

  // If camera has fixed lens, return that info
  if (camera.has_fixed_lens) {
    return {
      fixed_lens: true,
      camera_name: cameraName,
      focal_length: camera.fixed_lens_focal_length,
      max_aperture: camera.fixed_lens_max_aperture,
      lenses: [],
      adapted_lenses: []
    };
  }

  let nativeLenses = [];
  let adaptedLenses = [];

  if (camera.mount) {
    // Native lenses: exact mount match or Universal
    nativeLenses = await allAsync(`
      SELECT id, name, brand, model, mount, focal_length_min, focal_length_max, 
             max_aperture, focus_type, image_path, is_digital
      FROM equip_lenses 
      WHERE deleted_at IS NULL AND (mount = ? OR mount = 'Universal')
      ORDER BY brand, focal_length_min, name
    `, [camera.mount]);

    // Adapted lenses: different mount
    adaptedLenses = await allAsync(`
      SELECT id, name, brand, model, mount, focal_length_min, focal_length_max, 
             max_aperture, focus_type, image_path, is_digital
      FROM equip_lenses 
      WHERE deleted_at IS NULL AND mount != ? AND mount != 'Universal'
      ORDER BY mount, brand, focal_length_min, name
    `, [camera.mount]);
  } else {
    nativeLenses = await allAsync(`
      SELECT id, name, brand, model, mount, focal_length_min, focal_length_max, 
             max_aperture, focus_type, image_path, is_digital
      FROM equip_lenses 
      WHERE deleted_at IS NULL
      ORDER BY brand, focal_length_min, name
    `);
  }

  // Apply three-state is_digital mode filter when requested. If mode is not
  // specified, infer from the camera's own is_digital flag so that a digital
  // camera defaults to showing digital+universal lenses, and a film camera
  // defaults to film+universal.
  const effectiveMode = mode || (camera.is_digital === 1 ? 'digital' : 'film');
  const filterByMode = (lensList) => {
    if (effectiveMode === 'digital') {
      return lensList.filter(l => l.is_digital === 1 || l.is_digital === null || l.is_digital === undefined);
    }
    if (effectiveMode === 'film') {
      return lensList.filter(l => l.is_digital === 0 || l.is_digital === null || l.is_digital === undefined);
    }
    return lensList;
  };
  nativeLenses = filterByMode(nativeLenses);
  adaptedLenses = filterByMode(adaptedLenses);

  return {
    fixed_lens: false,
    camera_name: cameraName,
    camera_mount: camera.mount,
    camera_is_digital: camera.is_digital,
    lenses: nativeLenses,
    adapted_lenses: adaptedLenses
  };
}

/**
 * Get lenses filtered by camera compatibility
 */
async function getLensesByCamera(cameraId, lenses) {
  const camera = await getAsync(
    `SELECT mount, has_fixed_lens FROM equip_cameras WHERE id = ?`,
    [cameraId]
  );

  if (!camera) return lenses;

  if (camera.has_fixed_lens) {
    return [];
  }

  if (camera.mount) {
    return lenses.filter(l => l.mount === camera.mount || l.mount === 'Universal');
  }

  return lenses;
}

/**
 * Get rolls related to equipment
 * Searches both roll assignments AND photos with the equipment
 */
async function getRelatedRolls(type, equipId, limit = 20) {
  try {
    let rollIds = new Set();

    // Map type to field names (support both singular and plural forms)
    // rolls table fields: camera_equip_id, lens_equip_id, flash_equip_id, film_back_equip_id, scanner_equip_id, filmId
    // photos table fields: camera_equip_id, lens_equip_id, flash_equip_id, scanner_equip_id
    const fieldMap = {
      camera: { rollField: 'camera_equip_id', photoField: 'camera_equip_id' },
      cameras: { rollField: 'camera_equip_id', photoField: 'camera_equip_id' },
      lens: { rollField: 'lens_equip_id', photoField: 'lens_equip_id' },
      lenses: { rollField: 'lens_equip_id', photoField: 'lens_equip_id' },
      film: { rollField: 'filmId', photoField: null },
      films: { rollField: 'filmId', photoField: null },
      scanner: { rollField: 'scanner_equip_id', photoField: 'scanner_equip_id' },
      scanners: { rollField: 'scanner_equip_id', photoField: 'scanner_equip_id' },
      flash: { rollField: 'flash_equip_id', photoField: 'flash_equip_id' },
      flashes: { rollField: 'flash_equip_id', photoField: 'flash_equip_id' },
      'film-back': { rollField: 'film_back_equip_id', photoField: null },
      'film-backs': { rollField: 'film_back_equip_id', photoField: null }
    };

    const fields = fieldMap[type];
    if (!fields) {
      console.warn(`[getRelatedRolls] Unknown equipment type: ${type}`);
      return [];
    }

    // 1. Get rolls directly assigned to this equipment
    if (fields.rollField) {
      try {
        const directRolls = await allAsync(
          `SELECT id FROM rolls WHERE ${fields.rollField} = ?`,
          [equipId]
        );
        if (Array.isArray(directRolls)) {
          directRolls.forEach(r => rollIds.add(r.id));
        }
      } catch (err) {
        console.warn(`[getRelatedRolls] Error querying rolls.${fields.rollField}:`, err.message);
      }
    }

    // 2. Get rolls containing photos with this equipment
    if (fields.photoField) {
      try {
        const photoRolls = await allAsync(
          `SELECT DISTINCT roll_id FROM photos WHERE ${fields.photoField} = ? AND roll_id IS NOT NULL`,
          [equipId]
        );
        if (Array.isArray(photoRolls)) {
          photoRolls.forEach(r => {
            if (r.roll_id) rollIds.add(r.roll_id);
          });
        }
      } catch (err) {
        console.warn(`[getRelatedRolls] Error querying photos.${fields.photoField}:`, err.message);
      }
    }

    if (rollIds.size === 0) return [];

    // 3. Fetch roll details with cover photo
    const idsArray = Array.from(rollIds);
    const placeholders = idsArray.map(() => '?').join(',');
    
    const rolls = await allAsync(`
      SELECT 
        r.id, 
        r.title, 
        r.start_date, 
        r.end_date, 
        r.coverPath, 
        r.cover_photo,
        f.name as film_name, 
        f.thumbPath as film_thumb
      FROM rolls r
      LEFT JOIN films f ON r.filmId = f.id
      WHERE r.id IN (${placeholders})
      ORDER BY r.start_date DESC
      LIMIT ?
    `, [...idsArray, limit]);

    return Array.isArray(rolls) ? rolls : [];
  } catch (err) {
    console.error('[getRelatedRolls] Unexpected error:', err);
    return [];
  }
}

// ========================================
// UNREGISTERED DEVICE SCAN + REGISTER FROM PHOTOS
// ========================================

function normalizeName(s) {
  return String(s).trim().replace(/\s+/g, ' ');
}

async function getUnregisteredDevices() {
  const cameraRows = await allAsync(
    `SELECT camera AS raw, COUNT(*) AS photoCount,
            MAX(source_make) AS make, MAX(source_model) AS model
     FROM photos
     WHERE source_type = 'digital' AND deleted_at IS NULL
       AND camera IS NOT NULL AND camera != ''
       AND camera_equip_id IS NULL
     GROUP BY camera
     ORDER BY photoCount DESC`
  );

  const lensRowsRaw = await allAsync(
    `SELECT lens AS raw, COUNT(*) AS photoCount
     FROM photos
     WHERE source_type = 'digital' AND deleted_at IS NULL
       AND lens IS NOT NULL AND lens != ''
       AND lens_equip_id IS NULL
     GROUP BY lens
     ORDER BY photoCount DESC`
  );
  const lensRows = lensRowsRaw.filter((r) => !isFixedLensString(r.raw));

  const [existingCameras, existingLenses] = await Promise.all([
    allAsync(`SELECT id, name FROM equip_cameras WHERE deleted_at IS NULL`),
    allAsync(`SELECT id, name FROM equip_lenses WHERE deleted_at IS NULL`),
  ]);
  const cameraMap = new Map();
  for (const c of existingCameras) cameraMap.set(String(c.name).toLowerCase(), c.id);
  const lensMap = new Map();
  for (const l of existingLenses) lensMap.set(String(l.name).toLowerCase(), l.id);

  const cameras = [];
  for (const r of cameraRows) {
    const name = normalizeName(r.raw);
    const parsed = parseCameraString(r.raw);
    const brand = r.make || (parsed && parsed.brand) || null;
    const model = r.model || (parsed && parsed.model) || null;
    cameras.push({
      name,
      brand,
      model,
      photoCount: r.photoCount,
      existingId: cameraMap.has(name.toLowerCase()) ? cameraMap.get(name.toLowerCase()) : null,
      raw: r.raw,
    });
  }

  const lenses = [];
  for (const r of lensRows) {
    const name = normalizeName(r.raw);
    const parsed = parseLensString(r.raw);
    const brand = (parsed && parsed.brand) || null;
    const model = (parsed && parsed.model) || null;
    lenses.push({
      name,
      brand,
      model,
      photoCount: r.photoCount,
      existingId: lensMap.has(name.toLowerCase()) ? lensMap.get(name.toLowerCase()) : null,
      raw: r.raw,
    });
  }

  return { cameras, lenses };
}

function _validateItemArray(items, label) {
  if (!Array.isArray(items)) {
    throw new ValidationError(`${label} must be an array`);
  }
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      throw new ValidationError(`${label} entries must be objects`);
    }
    if (typeof item.name !== 'string' || item.name.trim() === '') {
      throw new ValidationError(`${label} entry name is required`);
    }
  }
}

async function registerFromPhotos(body) {
  const cameras = (body && body.cameras) || [];
  const lenses = (body && body.lenses) || [];
  _validateItemArray(cameras, 'cameras');
  _validateItemArray(lenses, 'lenses');

  const camResult = { created: 0, reused: 0, linked: 0 };
  const lensResult = { created: 0, reused: 0, linked: 0 };

  for (const c of cameras) {
    const name = normalizeName(c.name);
    const existing = await getAsync(
      `SELECT id FROM equip_cameras WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL`,
      [name]
    );
    let id;
    if (existing) {
      id = existing.id;
      camResult.reused += 1;
    } else {
      const res = await runAsync(
        `INSERT INTO equip_cameras (name, brand, model, is_digital, status, updated_at)
         VALUES (?, ?, ?, 1, 'owned', CURRENT_TIMESTAMP)`,
        [name, c.brand != null ? c.brand : null, c.model != null ? c.model : null]
      );
      id = res.lastID;
      camResult.created += 1;
    }

    const raw = typeof c.raw === 'string' && c.raw.trim() !== '' ? c.raw : name;
    const r1 = await runAsync(
      `UPDATE photos SET camera_equip_id = ?
       WHERE source_type = 'digital' AND deleted_at IS NULL
         AND camera_equip_id IS NULL AND camera = ?`,
      [id, raw]
    );
    camResult.linked += r1.changes || 0;
  }

  for (const l of lenses) {
    const name = normalizeName(l.name);
    const existing = await getAsync(
      `SELECT id FROM equip_lenses WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL`,
      [name]
    );
    let id;
    if (existing) {
      id = existing.id;
      lensResult.reused += 1;
    } else {
      const res = await runAsync(
        `INSERT INTO equip_lenses (name, brand, model, is_digital, status, updated_at)
         VALUES (?, ?, ?, 1, 'owned', CURRENT_TIMESTAMP)`,
        [name, l.brand != null ? l.brand : null, l.model != null ? l.model : null]
      );
      id = res.lastID;
      lensResult.created += 1;
    }

    const raw = typeof l.raw === 'string' && l.raw.trim() !== '' ? l.raw : name;
    const r1 = await runAsync(
      `UPDATE photos SET lens_equip_id = ?
       WHERE source_type = 'digital' AND deleted_at IS NULL
         AND lens_equip_id IS NULL AND lens = ?`,
      [id, raw]
    );
    lensResult.linked += r1.changes || 0;
    const r2 = await runAsync(
      `UPDATE photos SET lens_equip_id = ?
       WHERE source_type = 'digital' AND deleted_at IS NULL
         AND lens_equip_id IS NULL AND source_lens = ?`,
      [id, raw]
    );
    lensResult.linked += r2.changes || 0;
  }

  return { cameras: camResult, lenses: lensResult };
}

module.exports = {
  EQUIPMENT_CONFIG,
  listEquipment,
  getEquipmentById,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  updateEquipmentImage,
  getEquipmentSuggestions,
  getCompatibleLenses,
  getLensesByCamera,
  getRelatedRolls,
  getUnregisteredDevices,
  registerFromPhotos
};
