const express = require('express');
const router = express.Router();
const db = require('../db'); // Required for prepared statements in batch insert
const rollService = require('../services/roll-service');
const { recomputeRollSequence } = rollService; // Keep for backward compat
const { addOrUpdateGear, formatFixedLensDescription, getFixedLensInfo, cleanupFixedLensGear } = require('../services/gear-service');
const fs = require('fs');
const path = require('path');

const { uploadTmp, uploadDefault } = require('../config/multer');
const { uploadsDir, tmpUploadDir, localTmpDir, rollsDir } = require('../config/paths');
const { runAsync, allAsync, getAsync } = require('../utils/db-helpers');
const { attachTagsToPhotos } = require('../services/tag-service');
const { linkFilmItemToRoll } = require('../services/film/film-item-service');
const PreparedStmt = require('../utils/prepared-statements');
const { generateContactSheet, STYLES } = require('../services/contactSheetGenerator');

// New service layer imports
const imageProcessor = require('../services/image-processor');
const rollFileService = require('../services/roll-file-service');
const photoUploadService = require('../services/photo-upload-service');

// ============================================================================
// POST /api/rolls - CREATE ROLL WITH PHOTOS
// ============================================================================
// 
// Handles roll creation with batch photo upload.
// Refactored to use service layer:
//   - imageProcessor: Sharp operations, RAW decoding
//   - rollFileService: File staging, publishing, cleanup
//   - photoUploadService: Photo processing, metadata resolution
//
// Atomic workflow:
//   1. Parse request, create roll record (in transaction)
//   2. Process all images in local temp directory
//   3. If all succeed, publish files to final location
//   4. Insert photo records, commit transaction
//   5. On any failure, rollback DB and cleanup files
// ============================================================================

const cpUpload = uploadTmp.array('files', 200);
router.post('/', (req, res, next) => {
  cpUpload(req, res, async (err) => { 
    if (err) {
      console.error('Upload error', err);
      return next(err);
    }
    try {
      const body = req.body || {};
      const title = body.title || null;
      const start_date = body.start_date || null;
      const end_date = body.end_date || null;
      const camera = body.camera || null;
      const lens = body.lens || null;
      const photographer = body.photographer || null;
      const film_type = body.film_type || null;
      const filmIdRaw = body.filmId ? Number(body.filmId) : null;
      const film_item_id = body.film_item_id ? Number(body.film_item_id) : null;
      // Equipment IDs (new)
      const camera_equip_id = body.camera_equip_id ? Number(body.camera_equip_id) : null;
      const lens_equip_id = body.lens_equip_id ? Number(body.lens_equip_id) : null;
      const flash_equip_id = body.flash_equip_id ? Number(body.flash_equip_id) : null;
      const film_back_equip_id = body.film_back_equip_id ? Number(body.film_back_equip_id) : null;
      // Scanner/Digitization info (roll level)
      const scanner_equip_id = body.scanner_equip_id ? Number(body.scanner_equip_id) : null;
      const scan_resolution = body.scan_resolution ? Number(body.scan_resolution) : null;
      const scan_software = body.scan_software || null;
      const scan_lab = body.scan_lab || null;
      const scan_date = body.scan_date || null;
      const scan_cost = body.scan_cost ? Number(body.scan_cost) : null;
      const scan_notes = body.scan_notes || null;
      
      // Default location for fallback
      const default_location_id = body.default_location_id ? Number(body.default_location_id) : null;
      const default_country = body.default_country || null;
      const default_city = body.default_city || null;
      
      let filmId = filmIdRaw;
      let filmIso = null;
      const notes = body.notes || null;
      const tmpFiles = body.tmpFiles ? (typeof body.tmpFiles === 'string' ? JSON.parse(body.tmpFiles) : body.tmpFiles) : null;
      const coverIndex = body.coverIndex ? Number(body.coverIndex) : null;
      const uploadTypeGlobal = body.uploadType || null; // 'positive' | 'negative' | 'original'
      const isNegativeGlobal = uploadTypeGlobal === 'negative' || body.isNegative === 'true' || body.isNegative === true;
      // Fix: Support explicit isOriginal flag (from checkbox) independent of uploadType
      const isOriginalGlobal = uploadTypeGlobal === 'original' || body.isOriginal === 'true' || body.isOriginal === true;
      const fileMetadata = body.fileMetadata ? (typeof body.fileMetadata === 'string' ? JSON.parse(body.fileMetadata) : body.fileMetadata) : {};
      console.log('[CREATE ROLL] uploadType:', uploadTypeGlobal, 'isNegativeGlobal:', isNegativeGlobal, 'isOriginalGlobal:', isOriginalGlobal);

      if (start_date && end_date) {
        const sd = new Date(start_date);
        const ed = new Date(end_date);
        if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return res.status(400).json({ error: 'Invalid start_date or end_date' });
        if (sd > ed) return res.status(400).json({ error: 'start_date cannot be later than end_date' });
      }

      // Insert Roll
      // If a film_item_id is provided, prefer its film_id for this roll
      if (film_item_id) {
        try {
          const itemRow = await getAsync('SELECT film_id FROM film_items WHERE id = ? AND deleted_at IS NULL', [film_item_id]);
          if (itemRow && itemRow.film_id) filmId = itemRow.film_id;
        } catch (e) {
          console.error('[CREATE ROLL] Failed to load film_item for filmId override', e.message);
        }
      }

      // Load film ISO (used as default ISO for photos)
      if (filmId) {
        try {
          const isoRow = await getAsync('SELECT iso FROM films WHERE id = ?', [filmId]);
          filmIso = isoRow && isoRow.iso ? isoRow.iso : null;
        } catch (isoErr) {
          console.warn('[CREATE ROLL] Failed to load film iso', isoErr.message || isoErr);
        }
      }

      // ==============================
      // FIXED LENS CAMERA & FORMAT HANDLING
      // ==============================
      // If the selected camera has a fixed lens, enforce implicit lens:
      // - Set lens_equip_id to NULL (lens is derived from camera)
      // - Set legacy text to full description: "Brand Model Xmm f/Y"
      // Also look up camera's format for roll inheritance
      let finalLensEquipId = lens_equip_id;
      let finalLensText = lens;
      let rollFormat = null;
      
      if (camera_equip_id) {
        try {
          const camRow = await getAsync(`
            SELECT c.brand, c.model, c.has_fixed_lens, c.fixed_lens_focal_length, c.fixed_lens_max_aperture, f.name as format_name
            FROM equip_cameras c
            LEFT JOIN ref_film_formats f ON c.format_id = f.id
            WHERE c.id = ?
          `, [camera_equip_id]);
          if (camRow) {
            // Inherit camera format for the roll
            if (camRow.format_name) {
              rollFormat = camRow.format_name;
              console.log(`[CREATE ROLL] Camera format: ${rollFormat}`);
            }
            // Fixed lens camera: nullify explicit lens, set full description for backward compat
            if (camRow.has_fixed_lens === 1) {
              finalLensEquipId = null;
              finalLensText = formatFixedLensDescription(camRow);
              console.log(`[CREATE ROLL] Fixed lens camera detected. Setting implicit lens: ${finalLensText}`);
            }
          }
        } catch (camErr) {
          console.warn('[CREATE ROLL] Failed to check camera fixed lens/format status', camErr.message);
        }
      }

      const sql = `INSERT INTO rolls (
        title, start_date, end_date, camera, lens, photographer, 
        filmId, film_type, notes, film_item_id, 
        camera_equip_id, lens_equip_id, flash_equip_id,
        scanner_equip_id, scan_resolution, scan_software, 
        scan_lab, scan_date, scan_cost, scan_notes,
        format, film_back_equip_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

      // ==============================
      // ATOMIC CREATE (DB + FILES)
      // ==============================
      let rollId = null;
      let folderName = null;
      let rollFolderPath = null;
      const createdPaths = []; // absolute paths created under uploads/rolls

      let stmtToFinalize = null;
      try {
        // Collect incoming files from Multer and any tmpFiles provided
        const incoming = [];
        const reqFilesCount = (req.files && req.files.length) ? req.files.length : 0;
        const tmpFilesCount = (tmpFiles && Array.isArray(tmpFiles)) ? tmpFiles.length : 0;
        console.log(`[CREATE ROLL] Received files: req.files=${reqFilesCount}, tmpFiles=${tmpFilesCount}`);

        if (req.files && req.files.length) {
          incoming.push(...req.files.map(f => {
             // Robust RAW detection: check both originalname and filename (uploaded name)
             const nameCands = [f.originalname, f.filename].filter(Boolean);
             const isRaw = nameCands.some(n => imageProcessor.isRawFile(n));
             return { 
                tmpPath: f.path, 
                originalName: f.originalname, 
                tmpName: f.filename, 
                isNegative: isNegativeGlobal,
                isOriginal: isOriginalGlobal,
                isRaw
             };
          }));
        }

        // IMPORTANT: tmpFiles are also stored in localTmpDir now (NOT uploads/tmp)
        if (tmpFiles && Array.isArray(tmpFiles)) {
          for (const t of tmpFiles) {
            const tmpName = t.tmpName || t.filename;
            const tmpPath = path.join(localTmpDir, tmpName);
            if (!tmpName || !fs.existsSync(tmpPath)) continue;
            const fileIsNegative = t.isNegative !== undefined ? t.isNegative : isNegativeGlobal;
            const fileIsOriginal = (t.isOriginal !== undefined ? t.isOriginal : isOriginalGlobal) || t.uploadType === 'original';
            
            const isRaw = imageProcessor.isRawFile(tmpName) || imageProcessor.isRawFile(t.originalName);
            
            incoming.push({ 
              tmpPath, 
              originalName: tmpName, 
              tmpName, 
              isNegative: fileIsNegative,
              isOriginal: fileIsOriginal,
              isRaw
            });
          }
        }

        if (!incoming.length) {
          console.error('[CREATE ROLL] No files in request. Aborting create roll.');
          return res.status(400).json({ ok: false, error: 'No files uploaded. Please select at least one image.' });
        }

        // Group files by base name to handle pairs (main + thumb)
        const groups = photoUploadService.groupFilesByBaseName(incoming);
        const sortedGroups = photoUploadService.sortGroups(groups);

        // Begin transaction AFTER validation so we can fully rollback.
        await runAsync('BEGIN');
        const rollInsertRes = await runAsync(sql, [
          title, start_date, end_date, camera, finalLensText, photographer, 
          filmId, film_type, notes, film_item_id, 
          camera_equip_id, finalLensEquipId, flash_equip_id,
          scanner_equip_id, scan_resolution, scan_software,
          scan_lab, scan_date, scan_cost, scan_notes,
          rollFormat, film_back_equip_id
        ]);
        rollId = rollInsertRes?.lastID;
        if (!rollId) throw new Error('Failed to create roll');

        // If a film_item_id is provided, link it to this roll.
        if (film_item_id) {
          // Determine target status based on current film item state
          // If already sent_to_lab, move to developed (scans uploaded)
          // Otherwise move to shot (just finished shooting)
          let targetStatus = 'shot';
          try {
            const filmItem = await getAsync('SELECT status FROM film_items WHERE id = ?', [film_item_id]);
            if (filmItem && filmItem.status === 'sent_to_lab') {
              targetStatus = 'developed';
            }
          } catch (e) {
            console.warn('[CREATE ROLL] Failed to check film item status, defaulting to shot:', e.message);
          }
          
          await linkFilmItemToRoll({
            filmItemId: film_item_id,
            rollId,
            loadedCamera: camera,
            targetStatus,
          });
        }

        folderName = String(rollId);
        rollFolderPath = path.join(rollsDir, folderName);
        await runAsync('UPDATE rolls SET folderName = ? WHERE id = ?', [folderName, rollId]);

        const inserted = [];
        let frameCounter = 0;

        // Initialize location cache for this batch
        const locationCache = new photoUploadService.LocationCache();

        // Prepare statement for insertion
        let stmt = null;
        stmt = db.prepare(`INSERT INTO photos (
          roll_id, frame_number, filename,
          full_rel_path, thumb_rel_path, negative_rel_path,
          original_rel_path, positive_rel_path, positive_thumb_rel_path, negative_thumb_rel_path,
          is_negative_source, caption, taken_at, date_taken, time_taken,
          location_id, detail_location, country, city,
          camera, lens, photographer, aperture, shutter_speed, iso, focal_length,
          latitude, longitude,
          scanner_equip_id, scan_resolution, scan_software, scan_date, scan_bit_depth,
          source_make, source_model, source_software, source_lens
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        stmtToFinalize = stmt;
        
        const runInsert = (params) => new Promise((resolve, reject) => {
            stmt.run(params, function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });

        // Prepare roll defaults for photo processing
        const rollDefaults = {
          camera,
          lens,
          photographer,
          filmIso,
          default_location_id,
          default_country,
          default_city
        };
        
        const scannerDefaults = {
          scanner_equip_id,
          scan_resolution,
          scan_software,
          scan_date
        };

        // Stage operations first (no writes to OneDrive/rolls until all processing succeeded)
        const stagedOps = [];
        const stagedTempArtifacts = [];
        const stagedPhotos = [];

        // Process each file group using photo upload service
        for (const group of sortedGroups) {
          const f = group.main || group.thumb;
          if (!f) continue;

          const thumbFile = group.thumb && group.thumb !== f ? group.thumb : null;
          frameCounter += 1;
          const frameNumber = String(frameCounter).padStart(2, '0');

          try {
            const result = await photoUploadService.processFileForRoll({
              file: f,
              thumbFile,
              rollId,
              folderName,
              frameNumber,
              localTmpDir,
              fileMetadata,
              rollDefaults,
              locationCache,
              scannerDefaults
            });

            stagedOps.push(...result.stagedOps);
            stagedTempArtifacts.push(...result.stagedTempArtifacts);
            stagedPhotos.push(result.photoData);
          } catch (procErr) {
            console.error(`[CREATE ROLL] Processing failed for ${f.originalName}:`, procErr);
            const err = new Error(`Failed to process image ${f.originalName}: ${procErr.message}`);
            err.originalError = procErr;
            err.fileInfo = { name: f.originalName };
            throw err;
          }
        }

        // Ensure roll directories exist only after ALL processing succeeded
        await rollFileService.ensureRollDirectories(rollFolderPath);

        // Publish filesystem changes (moves/copies into uploads/rolls)
        console.log(`[CREATE ROLL] Publishing ${stagedOps.length} file operations...`);
        try {
          const publishedPaths = await rollFileService.publishStagedOperations(stagedOps);
          createdPaths.push(...publishedPaths);
        } catch (publishErr) {
          console.error('[CREATE ROLL] File publish failed:', publishErr);
          if (publishErr.createdPaths) {
            createdPaths.push(...publishErr.createdPaths);
          }
          throw publishErr;
        }

        // Cleanup staged temp artifacts after publish
        await rollFileService.cleanupTempArtifacts(stagedTempArtifacts);

        // Insert DB records (atomic: any failure -> rollback)
        for (const p of stagedPhotos) {
          await runInsert([
            rollId,
            p.frameNumber,
            p.finalName,
            p.fullRelPath,
            p.thumbRelPath,
            p.negativeRelPath,
            p.originalRelPath,
            p.positiveRelPath,
            p.positiveThumbRelPath,
            p.negativeThumbRelPath,
            p.isNegativeSource,
            p.caption,
            p.takenAt,
            p.dateTaken,
            null, // time_taken unused here
            p.locationId,
            p.detailLoc,
            p.countryForPhoto,
            p.cityForPhoto,
            p.cameraForPhoto,
            p.lensForPhoto,
            p.photographerForPhoto,
            p.apertureForPhoto,
            p.shutterForPhoto,
            p.isoForPhoto,
            p.focalLengthForPhoto,
            p.latitudeForPhoto,
            p.longitudeForPhoto,
            // Scanner info
            p.scannerEquipId,
            p.scanResolution,
            p.scanSoftware,
            p.scanDate,
            p.scanBitDepth,
            p.sourceMake,
            p.sourceModel,
            p.sourceSoftware,
            p.sourceLens
          ]);
          inserted.push({
            filename: p.finalName,
            fullRelPath: p.fullRelPath,
            thumbRelPath: p.thumbRelPath,
            negativeRelPath: p.negativeRelPath,
            positiveRelPath: p.positiveRelPath,
          });
        }

        // Seed roll_gear with initial values using intelligent deduplication
        try {
          if (camera) await addOrUpdateGear(rollId, 'camera', camera).catch(e => console.error('Add camera failed', e));
          if (lens) await addOrUpdateGear(rollId, 'lens', lens).catch(e => console.error('Add lens failed', e));
          if (photographer) await addOrUpdateGear(rollId, 'photographer', photographer).catch(e => console.error('Add photographer failed', e));
        } catch(e){ console.error('Seed roll_gear failed', e.message); }

        // Set cover (within transaction)
        let coverToSet = null;
        if (filmId) {
          const frow = await getAsync('SELECT thumbPath FROM films WHERE id = ?', [filmId]).catch(() => null);
          if (frow && frow.thumbPath) coverToSet = frow.thumbPath;
        }

        if (!coverToSet && inserted.length) {
          const idx = (Number.isFinite(coverIndex) && coverIndex >= 0 && coverIndex < inserted.length) ? coverIndex : 0;
          const p = inserted[idx];
          const pathForCover = p.positiveRelPath || p.fullRelPath || p.thumbRelPath || p.negativeRelPath;
          if (p && pathForCover) coverToSet = `/uploads/${pathForCover}`.replace(/\\/g, '/');
        }

        if (coverToSet) {
          await runAsync('UPDATE rolls SET coverPath = ? WHERE id = ?', [coverToSet, rollId]);
        }

        const filesForClient = inserted.map(p => ({
          filename: p.filename,
          url: p.fullRelPath ? `/uploads/${p.fullRelPath}` : null,
          fullRelPath: p.fullRelPath,
          thumbRelPath: p.thumbRelPath
        }));

        // Attach roll_locations after photo insert completes
        try {
          const rollLocationIds = locationCache.getRollLocationIds();
          for (const locId of rollLocationIds) {
            await runAsync('INSERT OR IGNORE INTO roll_locations (roll_id, location_id) VALUES (?, ?)', [rollId, locId]);
          }
        } catch (locErr) {
          console.error('[CREATE ROLL] Failed to upsert roll_locations', locErr.message || locErr);
        }

        console.log(`[CREATE ROLL] Complete. Roll ${rollId} created with ${inserted.length}/${sortedGroups.length} photos`);

        await runAsync('COMMIT');

        const row = await getAsync('SELECT * FROM rolls WHERE id = ?', [rollId]);
        res.status(201).json({ ok: true, roll: row, files: filesForClient });

        // Recompute display sequence after creation (best-effort)
        try { await recomputeRollSequence(); } catch (e) { console.error('recompute sequence failed', e); }

      } catch (err) {
        console.error('[CREATE ROLL] Atomic create failed:');
        console.error('Error message:', err.message);
        console.error('Error stack:', err.stack);
        if (err.originalError) {
          console.error('Original error:', err.originalError);
        }
        if (err.fileInfo) {
          console.error('File info:', err.fileInfo);
        }
        if (err.operation) {
          console.error('Failed operation:', err.operation);
        }
        
        try { await runAsync('ROLLBACK'); } catch (_) {}

        // Cleanup created roll folder/files (best-effort)
        await rollFileService.rollbackCreatedFiles({ rollFolderPath, createdPaths });

        return next(err);
      } finally {
        // Always finalize the prepared statement to avoid lingering locks.
        if (stmtToFinalize) {
          try {
            stmtToFinalize.finalize();
          } catch (finalizeErr) {
            console.error('[CREATE ROLL] Failed to finalize statement', finalizeErr.message || finalizeErr);
          }
        }
      }

    } catch (err) {
      console.error('POST /api/rolls (multipart) handler error:');
      console.error('Error:', err);
      console.error('Stack:', err.stack);
      next(err);
    }
  });
});

// GET /api/rolls
router.get('/', async (req, res, next) => {
  try {
    const rows = await rollService.listRolls(req.query);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/rolls/:id
router.get('/:id', async (req, res, next) => {
  try {
    const row = await rollService.getRollByIdWithDetails(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// GET /api/rolls/:id/locations
router.get('/:id/locations', async (req, res, next) => {
  try {
    const rows = await rollService.getRollLocations(req.params.id);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// GET /api/rolls/:id/preset - return stored preset JSON (parsed)
router.get('/:id/preset', async (req, res, next) => {
  const id = req.params.id;
  try {
    const preset = await rollService.getRollPreset(id);
    res.json({ rollId: id, preset });
  } catch (err) {
    next(err);
  }
});

// POST /api/rolls/:id/preset - set/overwrite preset_json
router.post('/:id/preset', async (req, res, next) => {
  const id = req.params.id;
  const body = req.body || {};
  if (!body || !body.params) return res.status(400).json({ error: 'params required' });
  try {
    const result = await rollService.setRollPreset(id, body.name, body.params);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/rolls/:id/preset - clear preset_json
router.delete('/:id/preset', async (req, res, next) => {
  const id = req.params.id;
  try {
    const result = await rollService.clearRollPreset(id);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// PUT /api/rolls/:id
router.put('/:id', async (req, res, next) => {
  const id = req.params.id;
  let { locations, camera_equip_id, lens_equip_id, camera, lens, photographer, ...restFields } = req.body;
  
  // Validate date range
  const { start_date, end_date } = restFields;
  if (start_date !== undefined && end_date !== undefined) {
    const sd = new Date(start_date);
    const ed = new Date(end_date);
    if (isNaN(sd.getTime()) || isNaN(ed.getTime())) {
      return res.status(400).json({ error: 'Invalid start_date or end_date' });
    }
    if (sd > ed) {
      return res.status(400).json({ error: 'start_date cannot be later than end_date' });
    }
  }
  
  // Handle fixed lens camera: nullify lens_equip_id and set legacy lens text
  if (camera_equip_id !== undefined && camera_equip_id !== null) {
    try {
      const camRow = await getAsync(
        `SELECT brand, model, has_fixed_lens, fixed_lens_focal_length, fixed_lens_max_aperture 
         FROM equip_cameras WHERE id = ?`,
        [camera_equip_id]
      );
      if (camRow?.has_fixed_lens === 1) {
        lens_equip_id = null;
        lens = formatFixedLensDescription(camRow);
        console.log(`[UPDATE ROLL ${id}] Fixed lens camera → implicit lens: ${lens}`);
      }
    } catch (e) {
      console.warn('[UPDATE ROLL] Fixed lens check failed:', e.message);
    }
  }
  
  // Merge equipment and text fields
  const updateData = {
    ...restFields,
    camera_equip_id,
    lens_equip_id,
    camera,
    lens,
    photographer
  };
  
  // Check if there's anything to update
  const hasFieldUpdates = Object.values(updateData).some(v => v !== undefined);
  if (!hasFieldUpdates && !Array.isArray(locations)) {
    return res.json({ ok: true, message: 'No fields to update' });
  }
  
  try {
    // Update roll fields
    if (hasFieldUpdates) {
      await rollService.updateRoll(id, updateData);
      
      // Update gear with intelligent deduplication
      if (camera !== undefined) {
        await addOrUpdateGear(id, 'camera', camera).catch(e => console.error('Update camera failed', e));
      }
      if (lens !== undefined) {
        const fixedInfo = await getFixedLensInfo(camera_equip_id);
        if (fixedInfo.isFixedLens && fixedInfo.lensDescription) {
          await cleanupFixedLensGear(id, fixedInfo.lensDescription).catch(e => console.error('Cleanup fixed lens gear failed', e));
        } else {
          await addOrUpdateGear(id, 'lens', lens).catch(e => console.error('Update lens failed', e));
        }
      }
      if (photographer !== undefined) {
        await addOrUpdateGear(id, 'photographer', photographer).catch(e => console.error('Update photographer failed', e));
      }
    }
    
    // Add locations
    if (Array.isArray(locations)) {
      await rollService.addRollLocations(id, locations);
    }
    
    // Recompute display sequence
    await recomputeRollSequence().catch(e => console.error('recompute sequence failed', e));
    
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/rolls/:id
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  console.log(`[DELETE] Request to delete roll id: ${id}`);

  try {
    // Delete from database (returns roll and photo data for file cleanup)
    const { deleted, roll, photos } = await rollService.deleteRollFromDb(id);
    
    // Recompute display sequence
    await recomputeRollSequence().catch(e => console.error('recompute sequence failed', e));

    // Remove roll folder and files (best-effort, DB already committed)
    rollFileService.deleteRollFiles({ roll, photos, rollId: id });

    res.json({ deleted });
  } catch (err) {
    console.error('[DELETE] Failed to delete roll', err.message || err);
    next(err);
  }
});

// ============================================================================
// PHOTO ENDPOINTS
// ============================================================================

const photoService = require('../services/photo-service');

// GET /api/rolls/:rollId/photos - List photos in a roll
router.get('/:rollId/photos', async (req, res, next) => {
  try {
    const photos = await photoService.listByRoll(req.params.rollId);
    res.json(photos);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// POST /api/rolls/:rollId/photos - UPLOAD SINGLE PHOTO
// ============================================================================
//
// Handles single photo upload to an existing roll.
// Uses photoUploadService for processing (shared with POST / route).
// ============================================================================

router.post('/:rollId/photos', uploadDefault.single('image'), async (req, res, next) => {
  const rollId = req.params.rollId;
  
  if (!req.file) {
    return res.status(400).json({ error: 'image file required' });
  }

  try {
    const result = await photoUploadService.uploadSinglePhoto({
      rollId,
      file: req.file,
      options: {
        uploadType: req.body.uploadType,
        isNegative: req.body.isNegative,
        caption: req.body.caption,
        taken_at: req.body.taken_at,
        rating: req.body.rating,
        camera: req.body.camera,
        lens: req.body.lens,
        photographer: req.body.photographer
      }
    });

    res.status(201).json(result);
  } catch (err) {
    console.error('Upload photo error', err);
    return next(err);
  }
});

// set roll cover
router.post('/:id/cover', async (req, res, next) => {
  const { photoId, filename } = req.body;
  if (!photoId && !filename) {
    return res.status(400).json({ error: 'photoId or filename required' });
  }

  try {
    const row = await rollService.setRollCover(req.params.id, { photoId, filename });
    res.json(row);
  } catch (err) {
    if (err.message === 'Photo not found') {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

// Contact Sheet Export
router.post('/:id/contact-sheet', async (req, res, next) => {
  const rollId = req.params.id;
  const { 
    style = 'kodak',
    imageSource = 'auto',
    columns = 6,
    maxTotalWidth = 4800,
    maxPhotoWidth = 400,
    quality = 95
  } = req.body;

  try {
    // Validate style
    if (!STYLES[style]) {
      return res.status(400).json({ error: `Invalid style: ${style}. Available styles: ${Object.keys(STYLES).join(', ')}` });
    }

    // Fetch roll metadata
    const roll = await getAsync(
      `SELECT r.*, f.name as film_name_joined, f.iso as film_iso_joined
       FROM rolls r
       LEFT JOIN films f ON r.filmId = f.id
       WHERE r.id = ?`,
      [rollId]
    );

    if (!roll) {
      return res.status(404).json({ error: 'Roll not found' });
    }

    // Fetch photos with all path variants
    const photos = await allAsync(
      `SELECT id, frame_number, thumb_rel_path, full_rel_path, 
              positive_rel_path, negative_rel_path, 
              positive_thumb_rel_path, negative_thumb_rel_path
       FROM photos
       WHERE roll_id = ?
       ORDER BY frame_number ASC, id ASC`,
      [rollId]
    );

    if (photos.length === 0) {
      return res.status(400).json({ error: 'No photos found in this roll' });
    }

    // Apply imageSource preference to determine which path to use
    const getPhotoPath = (p) => {
      switch (imageSource) {
        case 'positive':
          return p.positive_thumb_rel_path || p.thumb_rel_path || p.positive_rel_path || p.full_rel_path;
        case 'negative':
          return p.negative_thumb_rel_path || p.negative_rel_path || p.thumb_rel_path;
        case 'auto':
        default:
          return p.positive_thumb_rel_path || p.thumb_rel_path || p.negative_thumb_rel_path || p.positive_rel_path || p.full_rel_path || p.negative_rel_path;
      }
    };

    // Add resolved path and filter out photos without paths
    const validPhotos = photos.map(p => ({
      ...p,
      resolved_path: getPhotoPath(p)
    })).filter(p => p.resolved_path);

    if (validPhotos.length === 0) {
      return res.status(400).json({ error: 'No valid photos with paths found' });
    }

    // Set response headers for streaming
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');

    let progressSent = false;

    // Progress callback
    const onProgress = (current, total, message) => {
      const progressData = {
        type: 'progress',
        current,
        total,
        percentage: Math.round((current / total) * 100),
        message
      };
      
      // Send progress as newline-delimited JSON
      res.write(JSON.stringify(progressData) + '\n');
      progressSent = true;
    };

    // Generate contact sheet
    const imageBuffer = await generateContactSheet({
      photos: validPhotos,
      rollMetadata: roll,
      uploadsDir,
      columns: Number(columns),
      maxTotalWidth: Number(maxTotalWidth),
      maxPhotoWidth: Number(maxPhotoWidth),
      styleName: style,
      quality: Number(quality),
      onProgress
    });

    // Send final result
    const finalData = {
      type: 'complete',
      image: imageBuffer.toString('base64'),
      filename: `${roll.title || 'Roll-' + rollId}_contact-sheet_${style}.jpg`,
      size: imageBuffer.length,
      photoCount: validPhotos.length
    };

    res.write(JSON.stringify(finalData) + '\n');
    res.end();

  } catch (error) {
    console.error('[Contact Sheet] Error:', error);
    
    // Send error as JSON if possible
    if (!res.headersSent) {
      next(error);
    } else {
      res.write(JSON.stringify({ type: 'error', message: error.message }) + '\n');
      res.end();
    }
  }
});

module.exports = router;
