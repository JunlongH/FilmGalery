/**
 * Photo Upload Service
 * 
 * Unified photo processing logic shared between:
 *   - POST /api/rolls (batch upload during roll creation)
 *   - POST /api/rolls/:rollId/photos (single photo upload)
 * 
 * This service handles:
 *   - RAW file detection and decoding
 *   - Scanner EXIF extraction
 *   - Image processing (positive/negative modes)
 *   - Metadata resolution and location caching
 *   - Staged file operations for atomic workflow
 * 
 * @module server/services/photo-upload-service
 */

const path = require('path');
const fs = require('fs');
const imageProcessor = require('./image-processor');
const rollFileService = require('./roll-file-service');
const scanExifService = require('./scan-exif-service');
const { runAsync, getAsync } = require('../utils/db-helpers');
const { localTmpDir, rollsDir } = require('../config/paths');

/**
 * Location cache for deduplication during batch processing.
 * Key: "country||city" (lowercase), Value: location_id
 */
class LocationCache {
  constructor() {
    this.cache = new Map();
    this.rollLocationIds = new Set();
  }

  /**
   * Get or create a location ID for the given country/city.
   * 
   * @param {string|null} country - Country name or code
   * @param {string|null} city - City name
   * @returns {Promise<number|null>} - Location ID or null
   */
  async ensureLocationId(country, city) {
    const normCity = (city || '').trim();
    const normCountry = (country || '').trim();
    
    if (!normCity) return null;
    
    const key = `${normCountry.toLowerCase()}||${normCity.toLowerCase()}`;
    
    if (this.cache.has(key)) {
      const id = this.cache.get(key);
      this.rollLocationIds.add(id);
      return id;
    }

    // Try to match existing location
    const existing = await getAsync(
      `SELECT id FROM locations
       WHERE LOWER(city_name) = LOWER(?)
         AND (
           LOWER(country_name) = LOWER(?) OR country_code = ? OR country_code IS NULL OR country_name IS NULL
         )
       LIMIT 1`,
      [normCity, normCountry, normCountry]
    );

    if (existing && existing.id) {
      this.cache.set(key, existing.id);
      this.rollLocationIds.add(existing.id);
      return existing.id;
    }

    // Insert new location
    const result = await runAsync(
      'INSERT INTO locations (country_name, city_name) VALUES (?, ?)',
      [normCountry || null, normCity]
    ).catch(() => null);

    const insertedId = result?.lastID || null;
    if (insertedId) {
      this.cache.set(key, insertedId);
      this.rollLocationIds.add(insertedId);
    }
    return insertedId;
  }

  /**
   * Get all location IDs collected during batch processing.
   * @returns {number[]}
   */
  getRollLocationIds() {
    return Array.from(this.rollLocationIds);
  }
}

/**
 * Resolve metadata from the fileMetadata map.
 * Tries multiple key variants (originalName, tmpName, finalName).
 * 
 * @param {Object} metaMap - Metadata map from request body
 * @param {string[]} keys - Array of keys to try
 * @returns {Object} - Resolved metadata object
 */
function resolveFileMetadata(metaMap, keys = []) {
  for (const k of keys) {
    if (!k) continue;
    const m = metaMap[k];
    if (!m) continue;
    
    if (typeof m === 'string') {
      return {
        date: m,
        lens: null,
        country: null,
        city: null,
        detail_location: null,
        aperture: null,
        shutter_speed: null,
        latitude: null,
        longitude: null,
        focal_length: null,
        caption: null
      };
    }
    
    if (typeof m === 'object') {
      return {
        date: m.date || null,
        shot_time: m.shot_time || null,
        lens: m.lens || null,
        country: m.country || null,
        city: m.city || null,
        detail_location: m.detail_location || null,
        aperture: m.aperture ?? null,
        shutter_speed: m.shutter_speed || null,
        latitude: m.latitude ?? null,
        longitude: m.longitude ?? null,
        focal_length: m.focal_length ?? null,
        caption: m.caption || null
      };
    }
  }
  
  return {
    date: null,
    shot_time: null,
    lens: null,
    country: null,
    city: null,
    detail_location: null,
    aperture: null,
    shutter_speed: null,
    latitude: null,
    longitude: null,
    focal_length: null,
    caption: null
  };
}

/**
 * Process a single file and prepare staged operations.
 * Used in the batch roll creation workflow.
 * 
 * @param {Object} params - Processing parameters
 * @param {Object} params.file - File object { tmpPath, originalName, isNegative, isRaw }
 * @param {Object|null} params.thumbFile - Optional separate thumbnail file
 * @param {number} params.rollId - Roll ID
 * @param {string} params.folderName - Roll folder name
 * @param {number} params.frameNumber - Frame number (padded string like "01")
 * @param {string} params.localTmpDir - Local temp directory for staging
 * @param {Object} params.fileMetadata - Metadata map from request
 * @param {Object} params.rollDefaults - Default values from roll
 * @param {LocationCache} params.locationCache - Location cache instance
 * @param {Object} params.scannerDefaults - Scanner info defaults from roll
 * @returns {Promise<Object>} - { stagedOps, stagedTempArtifacts, photoData }
 */
async function processFileForRoll({
  file,
  thumbFile,
  rollId,
  folderName,
  frameNumber,
  localTmpDir: tmpDir,
  fileMetadata,
  rollDefaults,
  locationCache,
  scannerDefaults
}) {
  const rollFolderPath = path.join(rollsDir, folderName);
  const originalExt = path.extname(file.originalName || file.tmpName) || '.jpg';
  const baseName = `${rollId}_${frameNumber}`;

  const stagedOps = [];
  const stagedTempArtifacts = [];

  // Prepare input for Sharp
  let processInput = file.tmpPath;
  let rawMetadata = null;
  let scannerInfo = null;

  // Extract scanner/source info from EXIF
  try {
    scannerInfo = await scanExifService.extractScannerInfo(file.tmpPath);
    if (scannerInfo && scannerInfo.isScanner) {
      console.log(`[PhotoUpload] Detected scanner file: ${scannerInfo.make} ${scannerInfo.model}`);
    }
  } catch (scanErr) {
    console.warn('[PhotoUpload] Scanner EXIF extraction failed:', scanErr.message);
  }

  // RAW file handling
  if (file.isRaw) {
    console.log(`[PhotoUpload] Detected RAW file: ${file.originalName}`);
    try {
      // Use halfSize decode for very large RAW files (>100MB) to prevent OOM/timeout
      // Pixel-shift files (e.g. 170MP Panasonic RW2) can be 200-400MB
      const fileStats = fs.statSync(file.tmpPath);
      const useHalfSize = fileStats.size > 100 * 1024 * 1024; // >100MB
      if (useHalfSize) {
        console.log(`[PhotoUpload] Large RAW file (${(fileStats.size / 1024 / 1024).toFixed(0)}MB), using halfSize decode`);
      }
      const decoded = await imageProcessor.decodeRawFile(file.tmpPath, { halfSize: useHalfSize });
      processInput = decoded.buffer;
      rawMetadata = decoded.metadata;
      console.log(`[PhotoUpload] RAW decoded. Camera: ${rawMetadata?.camera || 'Unknown'}`);
    } catch (rawErr) {
      console.error('[PhotoUpload] RAW decode failed, using original as fallback:', rawErr.message);
    }
  }

  // Determine paths
  let pathData;
  
  if (file.isNegative) {
    // Process as negative
    const tempNegPath = path.join(tmpDir, `proc_${baseName}_neg.jpg`);
    stagedTempArtifacts.push(tempNegPath);

    const startTime = Date.now();
    await imageProcessor.processToJpeg(processInput, tempNegPath, { quality: 95 });
    console.log(`[PhotoUpload] Negative ${frameNumber} processed in ${Date.now() - startTime}ms`);

    let tempNegThumbPath = null;
    if (!thumbFile) {
      tempNegThumbPath = path.join(tmpDir, `proc_${baseName}_neg_thumb.jpg`);
      stagedTempArtifacts.push(tempNegThumbPath);
      await imageProcessor.generateThumbnail(tempNegPath, tempNegThumbPath, { quality: 40 });
    }

    // Build staged ops
    const ops = rollFileService.buildNegativeStageOps({
      originalPath: file.tmpPath,
      tempNegPath,
      tempNegThumbPath,
      thumbFilePath: thumbFile?.tmpPath || null,
      rollFolderPath,
      baseName,
      originalExt
    });
    stagedOps.push(...ops);

    pathData = rollFileService.computeNegativeRelPaths(folderName, baseName, originalExt);
  } else {
    // Process as positive
    const tempFullPath = path.join(tmpDir, `proc_${baseName}_full.jpg`);
    stagedTempArtifacts.push(tempFullPath);

    const startTime = Date.now();
    await imageProcessor.processToJpeg(processInput, tempFullPath, { quality: 95 });
    console.log(`[PhotoUpload] Positive ${frameNumber} processed in ${Date.now() - startTime}ms`);

    let tempThumbPath = null;
    if (!thumbFile) {
      tempThumbPath = path.join(tmpDir, `proc_${baseName}_thumb.jpg`);
      stagedTempArtifacts.push(tempThumbPath);
      await imageProcessor.generateThumbnail(tempFullPath, tempThumbPath, { quality: 40 });
    }

    // Build staged ops
    const ops = rollFileService.buildPositiveStageOps({
      originalPath: file.tmpPath,
      tempFullPath,
      tempThumbPath,
      thumbFilePath: thumbFile?.tmpPath || null,
      rollFolderPath,
      baseName,
      originalExt
    });
    stagedOps.push(...ops);

    pathData = rollFileService.computePositiveRelPaths(folderName, baseName, originalExt);
  }

  // Resolve metadata
  const meta = resolveFileMetadata(fileMetadata, [file.originalName, file.tmpName, `${baseName}.jpg`]);

  // NOTE: RAW metadata (rawMetadata.camera, rawMetadata.lens, etc.) is from the
  // digitization device (scanner or DSLR used for scanning), NOT the film camera.
  // These should go to scanner fields, NOT to camera/lens/aperture/shutter_speed.
  // The film camera metadata should come from:
  // 1. User input (fileMetadata)
  // 2. Roll defaults
  // 3. CSV import with shot logs

  // Compute final metadata values
  const dateTaken = meta.date || null;
  const takenAt = dateTaken
    ? (meta.shot_time ? `${dateTaken}T${meta.shot_time}:00` : `${dateTaken}T12:00:00`)
    : null;

  // Film camera/lens - only from user input or roll defaults, NOT from EXIF
  const lensForPhoto = meta.lens || rollDefaults.lens || null;
  const cameraForPhoto = rollDefaults.camera || null;  // Film camera, not digitization device
  const photographerForPhoto = rollDefaults.photographer || null;
  
  // Exposure data - only from user input (shot logs), NOT from EXIF
  // EXIF aperture/shutter are from the scanning device, not the film exposure
  const apertureForPhoto = meta.aperture !== undefined && meta.aperture !== null && meta.aperture !== '' 
    ? Number(meta.aperture) : null;
  const shutterForPhoto = meta.shutter_speed || null;
  const isoForPhoto = rollDefaults.filmIso ?? null;
  const focalLengthForPhoto = meta.focal_length !== undefined && meta.focal_length !== null && meta.focal_length !== '' 
    ? Number(meta.focal_length) : null;

  // Location resolution
  const countryForPhoto = meta.country || rollDefaults.default_country || null;
  const cityForPhoto = meta.city || rollDefaults.default_city || null;
  
  let locationId = null;
  if (meta.country || meta.city) {
    locationId = await locationCache.ensureLocationId(meta.country, meta.city);
  } else {
    locationId = rollDefaults.default_location_id;
    if (locationId) locationCache.rollLocationIds.add(locationId);
  }

  const detailLoc = meta.detail_location || null;
  const latitudeForPhoto = meta.latitude !== undefined && meta.latitude !== null && meta.latitude !== '' 
    ? Number(meta.latitude) : null;
  const longitudeForPhoto = meta.longitude !== undefined && meta.longitude !== null && meta.longitude !== '' 
    ? Number(meta.longitude) : null;

  // Scanner info (EXIF priority, then RAW metadata, then roll defaults)
  // RAW metadata provides digitization device info (camera used for scanning)
  const scanDbInfo = scannerInfo ? scanExifService.formatForDatabase(scannerInfo) : {};
  
  // If no scanner info from EXIF but we have RAW metadata, use that as source info
  // This handles DSLR scanning where the camera is the digitization device
  if (rawMetadata && !scanDbInfo.source_make) {
    scanDbInfo.source_make = rawMetadata.make || null;
    scanDbInfo.source_model = rawMetadata.camera || null;
    scanDbInfo.source_software = rawMetadata.software || null;
    // Also capture the lens used for scanning
    if (rawMetadata.lens) {
      scanDbInfo.source_lens = rawMetadata.lens;
    }
  }

  // Caption from shot log mapping
  const captionForPhoto = meta.caption || null;

  const photoData = {
    frameNumber,
    finalName: `${baseName}.jpg`,
    ...pathData,
    caption: captionForPhoto,
    takenAt,
    dateTaken,
    locationId,
    detailLoc,
    countryForPhoto,
    cityForPhoto,
    cameraForPhoto,
    lensForPhoto,
    photographerForPhoto,
    apertureForPhoto,
    shutterForPhoto,
    isoForPhoto,
    focalLengthForPhoto,
    latitudeForPhoto,
    longitudeForPhoto,
    // Scanner info
    scannerEquipId: scanDbInfo.scanner_equip_id || scannerDefaults.scanner_equip_id || null,
    scanResolution: scanDbInfo.scan_resolution || scannerDefaults.scan_resolution || null,
    scanSoftware: scanDbInfo.scan_software || scannerDefaults.scan_software || null,
    scanDate: scanDbInfo.scan_date || scannerDefaults.scan_date || null,
    scanBitDepth: scanDbInfo.scan_bit_depth || null,
    sourceMake: scanDbInfo.source_make || null,
    sourceModel: scanDbInfo.source_model || null,
    sourceSoftware: scanDbInfo.source_software || null,
    sourceLens: scanDbInfo.source_lens || null
  };

  return { stagedOps, stagedTempArtifacts, photoData };
}

/**
 * Upload a single photo to an existing roll.
 * Used by POST /api/rolls/:rollId/photos endpoint.
 * 
 * @param {Object} params - Upload parameters
 * @param {number} params.rollId - Roll ID
 * @param {Object} params.file - Multer file object
 * @param {Object} params.options - Upload options (uploadType, caption, etc.)
 * @returns {Promise<Object>} - Created photo record
 */
async function uploadSinglePhoto({ rollId, file, options = {} }) {
  const {
    uploadType,
    isNegative: isNegativeFlag,
    caption,
    taken_at,
    rating,
    camera: photoCamera,
    lens: photoLens,
    photographer: photoPhotographer
  } = options;

  const rollFolder = path.join(rollsDir, String(rollId));
  fs.mkdirSync(rollFolder, { recursive: true });

  const originalExt = path.extname(file.originalname || file.filename) || '.jpg';
  const isRawFile = imageProcessor.isRawFile(file.originalname || file.filename);

  // Get next frame number — use MAX(frame_number) + 1 to avoid collisions after deletions
  const PreparedStmt = require('../utils/prepared-statements');
  const maxRow = await PreparedStmt.getAsync('rolls.maxFrameNumber', [rollId]);
  const nextIndex = (maxRow && maxRow.max_frame ? maxRow.max_frame : 0) + 1;
  const frameNumber = String(nextIndex).padStart(2, '0');
  const baseName = `${rollId}_${frameNumber}`;
  const finalName = `${baseName}.jpg`;

  // Ensure directories
  const fullDir = path.join(rollFolder, 'full');
  const thumbDir = path.join(rollFolder, 'thumb');
  const originalsDir = path.join(rollFolder, 'originals');
  
  fs.mkdirSync(fullDir, { recursive: true });
  fs.mkdirSync(thumbDir, { recursive: true });
  fs.mkdirSync(originalsDir, { recursive: true });

  // Prepare input
  let processInput = file.path;
  let rawMetadata = null;

  if (isRawFile) {
    console.log(`[PhotoUpload] Detected RAW file: ${file.originalname}`);
    try {
      const decoded = await imageProcessor.decodeRawFile(file.path);
      processInput = decoded.buffer;
      rawMetadata = decoded.metadata;
    } catch (rawErr) {
      console.error('[PhotoUpload] RAW decode failed, using original as fallback:', rawErr.message);
    }
  }

  // Save original first
  const originalName = `${baseName}_original${originalExt}`;
  const originalPath = path.join(originalsDir, originalName);
  const { moveFileSync } = require('../utils/file-helpers');
  moveFileSync(file.path, originalPath);

  // Compute original_rel_path for DB (consistent with roll-file-service pattern)
  const originalRelPath = `rolls/${rollId}/originals/${originalName}`;

  // If processInput is still a file path (i.e. non-RAW), update it to the new location
  // since the original upload file has been moved to originals/
  if (typeof processInput === 'string') {
    processInput = originalPath;
  }

  // Determine upload mode
  const effectiveUploadType = uploadType || (isNegativeFlag === 'true' || isNegativeFlag === true ? 'negative' : 'positive');
  const isNeg = effectiveUploadType === 'negative';
  const isOriginal = effectiveUploadType === 'original';

  let negativeRelPath = null;
  let fullRelPath = null;
  let thumbRelPath = null;
  let positiveRelPath = null;
  let positiveThumbRelPath = null;
  let negativeThumbRelPath = null;
  let isNegativeSource = 0;

  if (isOriginal || isNeg) {
    // Negative mode
    const negDir = path.join(rollFolder, 'negative');
    const negThumbDir = path.join(rollFolder, 'negative', 'thumb');
    fs.mkdirSync(negDir, { recursive: true });
    fs.mkdirSync(negThumbDir, { recursive: true });

    const negName = `${baseName}_neg.jpg`;
    const negPath = path.join(negDir, negName);
    const negThumbName = `${baseName}-thumb.jpg`;
    const negThumbPath = path.join(negThumbDir, negThumbName);
    const mainThumbPath = path.join(thumbDir, negThumbName);

    await imageProcessor.processToJpeg(processInput, negPath, { quality: 95 });
    await imageProcessor.generateThumbnail(negPath, negThumbPath, { quality: 60 });

    // Copy to main thumb
    if (fs.existsSync(negThumbPath)) {
      fs.copyFileSync(negThumbPath, mainThumbPath);
      thumbRelPath = `rolls/${rollId}/thumb/${negThumbName}`;
      negativeThumbRelPath = `rolls/${rollId}/negative/thumb/${negThumbName}`;
    }

    negativeRelPath = `rolls/${rollId}/negative/${negName}`;
    isNegativeSource = 1;
  } else {
    // Positive mode
    const destPath = path.join(fullDir, finalName);
    const thumbName = `${baseName}-thumb.jpg`;
    const thumbPath = path.join(thumbDir, thumbName);

    await imageProcessor.processToJpeg(processInput, destPath, { quality: 95 });
    await imageProcessor.generateThumbnail(destPath, thumbPath, { quality: 60 });

    fullRelPath = `rolls/${rollId}/full/${finalName}`;
    positiveRelPath = fullRelPath;
    thumbRelPath = `rolls/${rollId}/thumb/${thumbName}`;
    positiveThumbRelPath = thumbRelPath;
  }

  // Get roll defaults
  const rollMeta = await getAsync('SELECT camera, lens, photographer FROM rolls WHERE id = ?', [rollId]) || {};

  const finalCamera = photoCamera || rollMeta.camera || null;
  const finalLens = photoLens || rollMeta.lens || null;
  const finalPhotographer = photoPhotographer || rollMeta.photographer || null;

  // RAW source info (digitization device, not film camera)
  const sourceMake = isRawFile ? (rawMetadata?.make || null) : null;
  const sourceModel = isRawFile ? (rawMetadata?.camera || null) : null;
  const sourceSoftware = isRawFile ? (rawMetadata?.software || null) : null;
  const sourceLens = isRawFile ? (rawMetadata?.lens || null) : null;

  // Insert photo
  const sql = `INSERT INTO photos (
    roll_id, frame_number, filename, full_rel_path, thumb_rel_path, negative_rel_path,
    original_rel_path, positive_rel_path, positive_thumb_rel_path, negative_thumb_rel_path,
    is_negative_source, caption, taken_at, rating, camera, lens, photographer,
    source_make, source_model, source_software, source_lens
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

  const result = await runAsync(sql, [
    rollId, frameNumber, finalName, fullRelPath, thumbRelPath, negativeRelPath,
    originalRelPath, positiveRelPath, positiveThumbRelPath, negativeThumbRelPath,
    isNegativeSource, caption, taken_at, rating, finalCamera, finalLens, finalPhotographer,
    sourceMake, sourceModel, sourceSoftware, sourceLens
  ]);

  return {
    ok: true,
    id: result?.lastID,
    filename: finalName,
    fullRelPath,
    thumbRelPath,
    negativeRelPath,
    originalRelPath,
    isNegativeSource,
    camera: finalCamera,
    lens: finalLens,
    photographer: finalPhotographer,
    sourceMake,
    sourceModel
  };
}

/**
 * Group incoming files by base name for pair handling (main + thumb).
 * 
 * @param {Object[]} incoming - Array of file objects
 * @returns {Map} - Map of base name to { main, thumb } objects
 */
function groupFilesByBaseName(incoming) {
  const groups = new Map();
  
  for (const f of incoming) {
    const originalName = f.originalName || f.tmpName;
    const parsed = path.parse(originalName);
    let base = parsed.name;
    let type = 'main';

    if (base.toLowerCase().endsWith('_thumb') || base.toLowerCase().endsWith('-thumb')) {
      base = base.replace(/[-_]thumb$/i, '');
      type = 'thumb';
    }

    if (!groups.has(base)) {
      groups.set(base, { main: null, thumb: null });
    }
    groups.get(base)[type] = f;
  }

  return groups;
}

/**
 * Sort groups by original filename for consistent ordering.
 * 
 * @param {Map} groups - Groups from groupFilesByBaseName
 * @returns {Object[]} - Sorted array of group objects
 */
function sortGroups(groups) {
  return Array.from(groups.values()).sort((a, b) => {
    const nameA = (a.main || a.thumb).originalName;
    const nameB = (b.main || b.thumb).originalName;
    return nameA.localeCompare(nameB);
  });
}

module.exports = {
  // Core processing
  processFileForRoll,
  uploadSinglePhoto,
  
  // Helpers
  LocationCache,
  resolveFileMetadata,
  groupFilesByBaseName,
  sortGroups
};
