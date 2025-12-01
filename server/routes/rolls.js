const express = require('express');
const router = express.Router();
const db = require('../db');
const { recomputeRollSequence } = require('../services/roll-service');
const { addOrUpdateGear } = require('../services/gear-service');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
// Disable sharp cache to prevent file locking on Windows
sharp.cache(false);
// Limit concurrency to 1 to prevent memory spikes/crashes with large TIFFs
sharp.concurrency(1);

const { uploadTmp, uploadDefault } = require('../config/multer');
const { uploadsDir, tmpUploadDir, rollsDir } = require('../config/paths');
const { moveFileSync, moveFileAsync } = require('../utils/file-helpers');
const { runAsync, allAsync } = require('../utils/db-helpers');
const { attachTagsToPhotos } = require('../services/tag-service');

// Create roll
const cpUpload = uploadTmp.array('files', 200);
router.post('/', (req, res) => {
  cpUpload(req, res, async (err) => { 
    if (err) {
      console.error('Upload error', err);
      return res.status(500).json({ error: err.message });
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
      const filmId = body.filmId ? Number(body.filmId) : null;
      const notes = body.notes || null;
      const tmpFiles = body.tmpFiles ? (typeof body.tmpFiles === 'string' ? JSON.parse(body.tmpFiles) : body.tmpFiles) : null;
      const coverIndex = body.coverIndex ? Number(body.coverIndex) : null;
      const isNegativeGlobal = body.isNegative === 'true' || body.isNegative === true;
      console.log('[CREATE ROLL] isNegativeGlobal:', isNegativeGlobal);

      if (start_date && end_date) {
        const sd = new Date(start_date);
        const ed = new Date(end_date);
        if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return res.status(400).json({ error: 'Invalid start_date or end_date' });
        if (sd > ed) return res.status(400).json({ error: 'start_date cannot be later than end_date' });
      }

      // Insert Roll
      const sql = `INSERT INTO rolls (title, start_date, end_date, camera, lens, photographer, filmId, film_type, notes) VALUES (?,?,?,?,?,?,?,?,?)`;
      await new Promise((resolve, reject) => {
        db.run(sql, [title, start_date, end_date, camera, lens, photographer, filmId, film_type, notes], function(err) {
          if (err) reject(err);
          else {
            this.lastID; // access this context
            resolve(this.lastID);
          }
        });
      }).then(async (rollId) => {
        const folderName = String(rollId); // numeric folder naming scheme
        const rollFolderPath = path.join(rollsDir, folderName);
        fs.mkdirSync(rollFolderPath, { recursive: true });
        db.run('UPDATE rolls SET folderName = ? WHERE id = ?', [folderName, rollId]);

        const fullDir = path.join(rollFolderPath, 'full');
        const thumbDir = path.join(rollFolderPath, 'thumb');
        const originalsDir = path.join(rollFolderPath, 'originals');
        // Ensure subdirectories exist before writing files / thumbnails
        try {
          if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });
          if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
          if (!fs.existsSync(originalsDir)) fs.mkdirSync(originalsDir, { recursive: true });
        } catch (mkErr) {
          console.error('Failed to create roll subdirectories', mkErr);
        }

        // Collect incoming files from Multer and any tmpFiles provided
        const incoming = [];
        const reqFilesCount = (req.files && req.files.length) ? req.files.length : 0;
        const tmpFilesCount = (tmpFiles && Array.isArray(tmpFiles)) ? tmpFiles.length : 0;
        console.log(`[CREATE ROLL] Received files: req.files=${reqFilesCount}, tmpFiles=${tmpFilesCount}`);
        if (req.files && req.files.length) incoming.push(...req.files.map(f => ({ tmpPath: f.path, originalName: f.originalname, tmpName: f.filename, isNegative: isNegativeGlobal })));
        if (tmpFiles && Array.isArray(tmpFiles)) {
          for (const t of tmpFiles) {
            const tmpName = t.tmpName || t.filename;
            const tmpPath = path.join(tmpUploadDir, tmpName);
            if (!tmpName || !fs.existsSync(tmpPath)) continue;
            incoming.push({ tmpPath, originalName: tmpName, tmpName, isNegative: t.isNegative !== undefined ? t.isNegative : isNegativeGlobal });
          }
        }
        // Early validation: must have at least one file
        if (!incoming.length) {
          console.error('[CREATE ROLL] No files in request. Aborting create roll.');
          return res.status(400).json({ ok: false, error: 'No files uploaded. Please select at least one image.' });
        }

        // Group files by base name to handle pairs (negative + thumb)
        const groups = new Map();
        for (const f of incoming) {
          const originalName = f.originalName || f.tmpName;
          const parsed = path.parse(originalName);
          let base = parsed.name;
          let type = 'main';
          
          // Check for thumb suffix
          if (base.toLowerCase().endsWith('_thumb') || base.toLowerCase().endsWith('-thumb')) {
            base = base.replace(/[-_]thumb$/i, '');
            type = 'thumb';
          }
          
          if (!groups.has(base)) groups.set(base, { main: null, thumb: null });
          groups.get(base)[type] = f;
        }

        // Wait a moment for file system to settle (OneDrive sync)
        await new Promise(r => setTimeout(r, 1000));
        console.log(`[CREATE ROLL] Incoming=${incoming.length}, Grouped=${groups.size}`);

        // Sort groups by filename to ensure order
        const sortedGroups = Array.from(groups.values()).sort((a, b) => {
            const nameA = (a.main || a.thumb).originalName;
            const nameB = (b.main || b.thumb).originalName;
            return nameA.localeCompare(nameB);
        });
        console.log(`[CREATE ROLL] Sorted groups count=${sortedGroups.length}`);

        const inserted = [];
        let frameCounter = 0;
        
        // Prepare statement for insertion
        const stmt = db.prepare(`INSERT INTO photos (roll_id, frame_number, filename, full_rel_path, thumb_rel_path, negative_rel_path, original_rel_path, positive_rel_path, positive_thumb_rel_path, negative_thumb_rel_path, is_negative_source) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
        
        const runInsert = (params) => new Promise((resolve, reject) => {
            stmt.run(params, function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });

        for (const group of sortedGroups) {
          const f = group.main || group.thumb;
          if (!f) continue;

          frameCounter += 1;
          const frameNumber = String(frameCounter).padStart(2, '0');
          const originalExt = path.extname(f.originalName || f.tmpName) || '.jpg';
          const baseName = `${rollId}_${frameNumber}`;
          
          // Generated display files are always JPG
          let finalName = `${baseName}.jpg`;
          let negativeRelPath = null;
          let fullRelPath = null;
          let thumbRelPath = null;
          let originalRelPath = null;
          let positiveRelPath = null;
          let positiveThumbRelPath = null;
          let negativeThumbRelPath = null;
          let isNegativeSource = 0;

          const isNegative = f.isNegative;

          // Save original scan file regardless of source type
          try {
            const originalName = `${baseName}_original${originalExt}`;
            const originalPath = path.join(originalsDir, originalName);
            await moveFileAsync(f.tmpPath, originalPath);
            originalRelPath = path.join('rolls', folderName, 'originals', originalName).replace(/\\/g, '/');
          } catch (origErr) {
            console.error('Failed saving original scan file', origErr);
            // If we can't save original, we can't proceed with generation usually, but let's try to use tmpPath if original failed?
            // But moveFileSync might have partially moved it.
            // Let's continue and hope sharp fails gracefully if file missing.
          }

          if (isNegative) {
            console.log(`[CREATE ROLL] Processing negative for ${f.originalName}`);
            const negName = `${baseName}_neg.jpg`;
            const negDir = path.join(rollFolderPath, 'negative');
            const negThumbDir = path.join(rollFolderPath, 'negative', 'thumb');
            if (!fs.existsSync(negDir)) fs.mkdirSync(negDir, { recursive: true });
            if (!fs.existsSync(negThumbDir)) fs.mkdirSync(negThumbDir, { recursive: true });

            const negPath = path.join(negDir, negName);
            
            try {
              // Create high-quality negative JPG from original
              const sourceForSharp = originalRelPath ? path.join(rollsDir, folderName, 'originals', `${baseName}_original${originalExt}`) : f.tmpPath;
              
              if (!fs.existsSync(sourceForSharp)) {
                 console.error(`[CREATE ROLL] Source file not found: ${sourceForSharp}`);
                 // Continue to insert DB record even if image gen failed, so we don't lose the upload record
              } else {
                  await sharp(sourceForSharp)
                    .jpeg({ quality: 95 })
                    .toFile(negPath);
                  negativeRelPath = path.join('rolls', folderName, 'negative', negName).replace(/\\/g, '/');

                  // Handle Negative Thumbnail
                  const negThumbName = `${baseName}-thumb.jpg`;
                  const negThumbPath = path.join(negThumbDir, negThumbName);
                  
                  if (group.thumb) {
                    // Use uploaded thumb file as negative thumb
                    await moveFileAsync(group.thumb.tmpPath, negThumbPath);
                  } else {
                    // Generate thumb
                    await sharp(negPath)
                      .resize({ width: 240, height: 240, fit: 'inside' })
                      .jpeg({ quality: 40 })
                      .toFile(negThumbPath)
                      .catch(thErr => console.error('Negative Thumbnail generation failed', thErr.message));
                  }

                  // Copy negative thumb to main thumb dir (for grid view)
                  const mainThumbName = `${baseName}-thumb.jpg`;
                  const mainThumbPath = path.join(thumbDir, mainThumbName);
                  if (fs.existsSync(negThumbPath)) {
                    fs.copyFileSync(negThumbPath, mainThumbPath);
                    thumbRelPath = path.join('rolls', folderName, 'thumb', mainThumbName).replace(/\\/g, '/');
                    negativeThumbRelPath = path.join('rolls', folderName, 'negative', 'thumb', negThumbName).replace(/\\/g, '/');
                  }
              }

              // Do NOT generate positive
              fullRelPath = null;
              positiveRelPath = null;
              positiveThumbRelPath = null;
              isNegativeSource = 1;

            } catch (mvErr) {
              console.error('Failed processing negative file', mvErr);
              // Continue to insert DB record
            }
          } else {
            // Positive Logic
            const destPath = path.join(fullDir, finalName);
            try {
              // Create high-quality positive JPG from original
              const sourceForSharp = originalRelPath ? path.join(rollsDir, folderName, 'originals', `${baseName}_original${originalExt}`) : f.tmpPath;
              
              if (!fs.existsSync(sourceForSharp)) {
                 console.error(`[CREATE ROLL] Source file not found: ${sourceForSharp}`);
              } else {
                  await sharp(sourceForSharp)
                    .jpeg({ quality: 95 })
                    .toFile(destPath);
                  fullRelPath = path.join('rolls', folderName, 'full', finalName).replace(/\\/g, '/');
                  positiveRelPath = fullRelPath;
                  
                  // Generate thumbnail
                  const thumbName = `${baseName}-thumb.jpg`;
                  const thumbPath = path.join(thumbDir, thumbName);
                  
                  if (group.thumb) {
                    // Use uploaded thumb
                    await moveFileAsync(group.thumb.tmpPath, thumbPath);
                  } else {
                    // Generate thumb
                    if (fs.existsSync(destPath)) {
                        await sharp(destPath)
                        .resize({ width: 240, height: 240, fit: 'inside' })
                        .jpeg({ quality: 40 })
                        .toFile(thumbPath)
                        .catch(thErr => console.error('Thumbnail generation failed', thErr.message));
                    }
                  }
                  
                  if (fs.existsSync(thumbPath)) {
                    thumbRelPath = path.join('rolls', folderName, 'thumb', thumbName).replace(/\\/g, '/');
                    positiveThumbRelPath = thumbRelPath;
                  }
              }
            } catch (mvErr) {
              console.error('Failed moving temp file to dest', mvErr);
              // Continue to insert DB record
            }
          }

          // Insert immediately to prevent data loss on crash
          try {
              await runInsert([rollId, frameNumber, finalName, fullRelPath, thumbRelPath, negativeRelPath, originalRelPath, positiveRelPath, positiveThumbRelPath, negativeThumbRelPath, isNegativeSource]);
            inserted.push({ filename: finalName, fullRelPath, thumbRelPath, negativeRelPath, positiveRelPath });
            console.log(`[CREATE ROLL] Inserted photo ${finalName}`);
          } catch (dbErr) {
              console.error('Failed to insert photo record', dbErr);
          }
        }

        // Set cover
        try {

        // Seed roll_gear with initial values using intelligent deduplication
        try {
          if (camera) await addOrUpdateGear(rollId, 'camera', camera).catch(e => console.error('Add camera failed', e));
          if (lens) await addOrUpdateGear(rollId, 'lens', lens).catch(e => console.error('Add lens failed', e));
          if (photographer) await addOrUpdateGear(rollId, 'photographer', photographer).catch(e => console.error('Add photographer failed', e));
        } catch(e){ console.error('Seed roll_gear failed', e.message); }
            let coverToSet = null;
            if (filmId) {
              // Try to get film thumb
              const frow = await new Promise((res, rej) => db.get('SELECT thumbPath FROM films WHERE id = ?', [filmId], (e, r) => e ? rej(e) : res(r)));
              if (frow && frow.thumbPath) coverToSet = frow.thumbPath;
            }
            
            if (!coverToSet && inserted.length) {
               const idx = (Number.isFinite(coverIndex) && coverIndex >= 0 && coverIndex < inserted.length) ? coverIndex : 0;
               // Prefer thumbRelPath if fullRelPath is null (negative case)
               const p = inserted[idx];
               const pathForCover = p.positiveRelPath || p.fullRelPath || p.thumbRelPath || p.negativeRelPath; 
               
               if (p && pathForCover) {
                  coverToSet = `/uploads/${pathForCover}`.replace(/\\/g, '/');
               }
            }
            
            if (coverToSet) {
               db.run('UPDATE rolls SET coverPath = ? WHERE id = ?', [coverToSet, rollId]);
            }
        } catch (covErr) {
            console.error('Error setting default cover for roll', covErr);
        }

        const filesForClient = inserted.map(p => ({
          filename: p.filename,
          url: p.fullRelPath ? `/uploads/${p.fullRelPath}` : null,
          fullRelPath: p.fullRelPath,
          thumbRelPath: p.thumbRelPath
        }));

        db.get('SELECT * FROM rolls WHERE id = ?', [rollId], (e2, row) => {
          if (e2) return res.status(500).json({ error: e2.message });
          res.status(201).json({ ok: true, roll: row, files: filesForClient });
        });

      }).then(async () => {
        // Recompute display sequence after creation
        try { await recomputeRollSequence(); } catch(e){ console.error('recompute sequence failed', e); }
      }).catch(err => {
         console.error('Transaction error', err);
         res.status(500).json({ error: err.message });
      });

    } catch (err) {
      console.error('POST /api/rolls (multipart) handler error', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });
});

// GET /api/rolls
router.get('/', (req, res) => {
  const { camera, lens, photographer, location_id, year, month, ym, film } = req.query;

  const toArray = (v) => {
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string' && v.includes(',')) return v.split(',').map(s=>s.trim()).filter(Boolean);
    return v === '' ? [] : [v];
  };
  const cameras = toArray(camera);
  const lenses = toArray(lens);
  const photographers = toArray(photographer);
  const locations = toArray(location_id).map(v => String(v).split('::')[0]); // support "id::label"
  const years = toArray(year);
  const months = toArray(month);
  const yms = toArray(ym);
  const films = toArray(film);
  
  let sql = `
    SELECT DISTINCT rolls.*, films.name AS film_name_joined 
    FROM rolls 
    LEFT JOIN films ON rolls.filmId = films.id 
  `;
  
  const params = [];
  const conditions = [];

  if (cameras.length) {
    const cameraConds = cameras.map(() => `(
      rolls.camera = ? OR 
      EXISTS (SELECT 1 FROM roll_gear WHERE roll_id = rolls.id AND type='camera' AND value = ?)
    )`).join(' OR ');
    conditions.push(`(${cameraConds})`);
    cameras.forEach(c => { params.push(c, c); });
  }

  if (lenses.length) {
    const lensConds = lenses.map(() => `(
      rolls.lens = ? OR 
      EXISTS (SELECT 1 FROM roll_gear WHERE roll_id = rolls.id AND type='lens' AND value = ?)
    )`).join(' OR ');
    conditions.push(`(${lensConds})`);
    lenses.forEach(l => { params.push(l, l); });
  }

  if (photographers.length) {
    const pgConds = photographers.map(() => `(
      rolls.photographer = ? OR 
      EXISTS (SELECT 1 FROM roll_gear WHERE roll_id = rolls.id AND type='photographer' AND value = ?) OR
      EXISTS (SELECT 1 FROM photos WHERE roll_id = rolls.id AND photographer = ?)
    )`).join(' OR ');
    conditions.push(`(${pgConds})`);
    photographers.forEach(p => { params.push(p, p, p); });
  }

  if (locations.length) {
    const placeholders = locations.map(()=>'?').join(',');
    conditions.push(`(
      EXISTS (SELECT 1 FROM roll_locations WHERE roll_id = rolls.id AND location_id IN (${placeholders}))
      OR EXISTS (SELECT 1 FROM photos WHERE roll_id = rolls.id AND location_id IN (${placeholders}))
    )`);
    params.push(...locations, ...locations);
  }

  if (years.length || months.length || yms.length) {
    const parts = [];
    if (yms.length) {
      parts.push(`strftime('%Y-%m', rolls.start_date) IN (${yms.map(()=>'?').join(',')})`);
      params.push(...yms);
    } else {
      if (years.length) { parts.push(`strftime('%Y', rolls.start_date) IN (${years.map(()=>'?').join(',')})`); params.push(...years); }
      if (months.length) { parts.push(`strftime('%m', rolls.start_date) IN (${months.map(()=>'?').join(',')})`); params.push(...months); }
    }
    if (parts.length) conditions.push(`(${parts.join(' OR ')})`);
  }

  if (films.length) {
    const filmConds = films.map(() => `(
      rolls.filmId = ? OR films.name = ? OR rolls.film_type = ?
    )`).join(' OR ');
    conditions.push(`(${filmConds})`);
    films.forEach(fv => { params.push(fv, fv, fv); });
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY rolls.start_date DESC, rolls.id DESC';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// GET /api/rolls/:id
router.get('/:id', (req, res) => {
  const id = req.params.id;
  const sql = `
    SELECT rolls.*, films.name AS film_name_joined, films.iso AS film_iso_joined
    FROM rolls
    LEFT JOIN films ON rolls.filmId = films.id
    WHERE rolls.id = ?
  `;
  db.get(sql, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Not found' });
    
    // Check if locations table exists before querying
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='locations'", [], (checkErr, tableExists) => {
      const locationsQuery = tableExists ? 
        `SELECT l.id AS location_id, l.country_code, l.country_name, l.city_name, l.city_lat, l.city_lng
         FROM roll_locations rl JOIN locations l ON rl.location_id = l.id
         WHERE rl.roll_id = ? ORDER BY l.country_name, l.city_name` : null;
      
      if (!locationsQuery) {
        row.locations = [];
        // attach gear arrays
        db.all('SELECT type, value FROM roll_gear WHERE roll_id = ?', [id], (e3, gearRows) => {
          if (e3) return res.status(500).json({ error: e3.message });
          const gear = { cameras: [], lenses: [], photographers: [] };
          (gearRows || []).forEach(g => {
            if (g.type === 'camera') gear.cameras.push(g.value);
            else if (g.type === 'lens') gear.lenses.push(g.value);
            else if (g.type === 'photographer') gear.photographers.push(g.value);
          });
          row.gear = gear;
          res.json(row);
        });
      } else {
        db.all(locationsQuery, [id], (e2, locs) => {
          if (e2) {
            console.warn('Error fetching locations:', e2.message);
            row.locations = [];
          } else {
            row.locations = locs || [];
          }
          // attach gear arrays
          db.all('SELECT type, value FROM roll_gear WHERE roll_id = ?', [id], (e3, gearRows) => {
            if (e3) return res.status(500).json({ error: e3.message });
            const gear = { cameras: [], lenses: [], photographers: [] };
            (gearRows || []).forEach(g => {
              if (g.type === 'camera') gear.cameras.push(g.value);
              else if (g.type === 'lens') gear.lenses.push(g.value);
              else if (g.type === 'photographer') gear.photographers.push(g.value);
            });
            row.gear = gear;
            res.json(row);
          });
        });
      }
    });
  });
});

// GET /api/rolls/:id/locations
router.get('/:id/locations', async (req, res) => {
  const id = req.params.id;
  const sql = `
    SELECT l.id AS location_id, l.country_code, l.country_name, l.city_name, l.city_lat, l.city_lng
    FROM roll_locations rl
    JOIN locations l ON rl.location_id = l.id
    WHERE rl.roll_id = ?
    ORDER BY l.country_name, l.city_name
  `;
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all(sql, [id], (err, rows) => err ? reject(err) : resolve(rows));
    });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/rolls/:id/preset - return stored preset JSON (parsed)
router.get('/:id/preset', (req, res) => {
  const id = req.params.id;
  db.get('SELECT preset_json FROM rolls WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Not found' });
    let parsed = null;
    try { parsed = row.preset_json ? JSON.parse(row.preset_json) : null; } catch { parsed = null; }
    res.json({ rollId: id, preset: parsed });
  });
});

// POST /api/rolls/:id/preset - set/overwrite preset_json
// Body: { name: string, params: { inverted, inversionMode, exposure, ... curves } }
router.post('/:id/preset', (req, res) => {
  const id = req.params.id;
  const body = req.body || {};
  if (!body || !body.params) return res.status(400).json({ error: 'params required' });
  const payload = { name: body.name || 'Unnamed', params: body.params };
  let json;
  try { json = JSON.stringify(payload); } catch(e) { return res.status(400).json({ error: 'Invalid params JSON' }); }
  db.run('UPDATE rolls SET preset_json = ? WHERE id = ?', [json, id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, updated: this.changes });
  });
});

// DELETE /api/rolls/:id/preset - clear preset_json
router.delete('/:id/preset', (req, res) => {
  const id = req.params.id;
  db.run('UPDATE rolls SET preset_json = NULL WHERE id = ?', [id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, cleared: this.changes });
  });
});

// PUT /api/rolls/:id
router.put('/:id', async (req, res) => {
  const id = req.params.id;
  const { title, start_date, end_date, camera, lens, photographer, film_type, filmId, notes, locations, develop_lab, develop_process, develop_date, purchase_cost, develop_cost, purchase_channel, batch_number, develop_note } = req.body;
  if (start_date !== undefined && end_date !== undefined) {
    const sd = new Date(start_date);
    const ed = new Date(end_date);
    if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return res.status(400).json({ error: 'Invalid start_date or end_date' });
    if (sd > ed) return res.status(400).json({ error: 'start_date cannot be later than end_date' });
  }
  
  // Build dynamic UPDATE query to only update provided fields
  const updates = [];
  const values = [];
  const fieldMap = { title, start_date, end_date, camera, lens, photographer, film_type, filmId, notes, develop_lab, develop_process, develop_date, purchase_cost, develop_cost, purchase_channel, batch_number, develop_note };
  
  for (const [key, val] of Object.entries(fieldMap)) {
    if (val !== undefined) {
      updates.push(`${key}=?`);
      values.push(val);
    }
  }
  
  if (updates.length === 0 && !Array.isArray(locations)) {
    return res.json({ ok: true, message: 'No fields to update' });
  }
  
  try {
    if (updates.length > 0) {
      const sql = `UPDATE rolls SET ${updates.join(', ')} WHERE id=?`;
      values.push(id);
      await new Promise((resolve, reject) => {
        db.run(sql, values, function(err){
          if (err) reject(err); else resolve(this.changes);
        });
      });
      
      // Update gear with intelligent deduplication
      if (camera !== undefined) await addOrUpdateGear(id, 'camera', camera).catch(e => console.error('Update camera failed', e));
      if (lens !== undefined) await addOrUpdateGear(id, 'lens', lens).catch(e => console.error('Update lens failed', e));
      if (photographer !== undefined) await addOrUpdateGear(id, 'photographer', photographer).catch(e => console.error('Update photographer failed', e));
    }
    if (Array.isArray(locations)) {
      for (const locId of locations) {
        await new Promise((resolve, reject) => db.run('INSERT OR IGNORE INTO roll_locations (roll_id, location_id) VALUES (?, ?)', [id, locId], (e)=> e?reject(e):resolve()));
      }
    }
    try { await recomputeRollSequence(); } catch(e){ console.error('recompute sequence failed', e); }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/rolls/:id
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  console.log(`[DELETE] Request to delete roll id: ${id}`);
  db.get('SELECT cover_photo, coverPath, folderName FROM rolls WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    
    console.log(`[DELETE] DB Row for ${id}:`, row);

    const performDelete = (folderName) => {
      console.log(`[DELETE] performDelete called with folderName: ${folderName}`);
      const cover = row && (row.cover_photo || row.coverPath);
      // delete cover if it exists and is NOT inside the folder we are about to delete
      if (cover) {
        const coverAbs = path.join(uploadsDir, '../', cover.replace(/^\//, '')); // Assuming cover path is relative to server root or uploads?
        // In server.js: path.join(__dirname, cover.replace(/^\//, ''))
        // __dirname was server root.
        // So path.join(uploadsDir, '../', ...) is roughly correct if uploadsDir is server/uploads.
        // Let's use path.resolve(uploadsDir, '..', cover...)
        
        // Wait, if cover starts with /uploads/, we should strip it and use uploadsDir.
        let coverPath;
        if (cover.startsWith('/uploads/')) {
            coverPath = path.join(uploadsDir, cover.replace(/^\/uploads\//, ''));
        } else {
            // Legacy path relative to server root?
            // Let's assume it's relative to server root.
            coverPath = path.join(uploadsDir, '../', cover.replace(/^\//, ''));
        }

        const targetFolder = folderName ? path.join(rollsDir, folderName) : null;
        if (!targetFolder || !coverPath.startsWith(targetFolder)) {
           fs.unlink(coverPath, () => {});
        }
      }

      const deleteDb = () => {
        console.log(`[DELETE] Deleting from DB for id: ${id}`);
          db.run('DELETE FROM rolls WHERE id = ?', [id], async function(e){
          if (e) return res.status(500).json({ error: e.message });
            try { await recomputeRollSequence(); } catch(err){ console.error('recompute sequence failed', err); }
            res.json({ deleted: this.changes });
        });
      };

      if (folderName) {
        const folderPath = path.join(rollsDir, folderName);
        console.log(`[DELETE] Attempting to delete folder: ${folderPath}`);
        if (fs.existsSync(folderPath)) {
          console.log(`[DELETE] Folder exists. Calling fs.rm...`);
          fs.rm(folderPath, { recursive: true, force: true }, (rmErr) => {
            if (rmErr) console.error('[DELETE] Error deleting folder', folderPath, rmErr);
            else console.log(`[DELETE] Folder deleted successfully: ${folderPath}`);
            deleteDb();
          });
        } else {
          console.log(`[DELETE] Folder does not exist on disk: ${folderPath}`);
          deleteDb();
        }
      } else {
        console.log(`[DELETE] No folderName provided to performDelete.`);
        deleteDb();
      }
    };

    if (row && row.folderName) {
      performDelete(row.folderName);
    } else {
      // Try to deduce folder from photos if folderName missing
      db.get('SELECT full_rel_path FROM photos WHERE roll_id = ? AND full_rel_path IS NOT NULL LIMIT 1', [id], (e2, pRow) => {
        console.log(`[DELETE] Deduced photo row:`, pRow);
        let deduced = null;
        const candidatePath = pRow && pRow.full_rel_path;
        if (candidatePath) {
          const parts = candidatePath.split('/');
          // expect rolls/<folder>/...
          if (parts.length >= 2 && (parts[0] === 'rolls' || parts[0] === 'uploads')) {
             deduced = parts[1] === 'rolls' ? parts[2] : parts[1]; // handle potential variations
             if (parts[0] === 'rolls') deduced = parts[1];
          }
        }
        // If still null, try ID as fallback for new system
        if (!deduced) deduced = String(id);
        console.log(`[DELETE] Deduced folder name: ${deduced}`);
        performDelete(deduced);
      });
    }
  });
});

// Photos endpoints (now rely on full_rel_path in uploads/rolls)
router.get('/:rollId/photos', async (req, res) => {
  const rollId = req.params.rollId;
  try {
    const rows = await allAsync('SELECT * FROM photos WHERE roll_id = ? ORDER BY frame_number', [rollId]);
    
    // DEBUG: Log first row to check paths
    if (rows && rows.length > 0) {
       const r = rows[0];
       console.log(`[DEBUG] Roll ${rollId} photo[0]: id=${r.id}, full=${r.full_rel_path}, pos=${r.positive_rel_path}, neg=${r.negative_rel_path}`);
    }

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
    console.error('[GET] roll photos error', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:rollId/photos', uploadDefault.single('image'), async (req, res) => {
  const rollId = req.params.rollId;
  const { caption, taken_at, rating, isNegative, camera: photoCamera, lens: photoLens, photographer: photoPhotographer } = req.body;
  if (!req.file) return res.status(400).json({ error: 'image file required' });
  
  // Use original extension for the original file
  const originalExt = path.extname(req.file.originalname || req.file.filename) || '.jpg';
  
  const rollFolder = path.join(rollsDir, String(rollId));
  fs.mkdirSync(rollFolder, { recursive: true });
  
  try {
    const cntRow = await new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) AS cnt FROM photos WHERE roll_id = ?', [rollId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    const nextIndex = (cntRow && cntRow.cnt ? cntRow.cnt : 0) + 1;
    const frameNumber = String(nextIndex).padStart(2, '0');
    const baseName = `${rollId}_${frameNumber}`;
    
    // Display files are always JPG
    const finalName = `${baseName}.jpg`;
    
    const fullDir = path.join(rollFolder, 'full');
    const thumbDir = path.join(rollFolder, 'thumb');
    const originalsDir = path.join(rollFolder, 'originals');
    
    if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });
    if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
    if (!fs.existsSync(originalsDir)) fs.mkdirSync(originalsDir, { recursive: true });

    let negativeRelPath = null;
    let fullRelPath = null;
    let thumbRelPath = null;
    let originalRelPath = null;
    let positiveRelPath = null;
    let positiveThumbRelPath = null;
    let negativeThumbRelPath = null;
    let isNegativeSource = 0;

    const isNeg = isNegative === 'true' || isNegative === true;

    // Save original
    const originalName = `${baseName}_original${originalExt}`;
    const originalPath = path.join(originalsDir, originalName);
    moveFileSync(req.file.path, originalPath);
    originalRelPath = path.join('rolls', String(rollId), 'originals', originalName).replace(/\\/g, '/');

    if (isNeg) {
      const negName = `${baseName}_neg.jpg`;
      const negDir = path.join(rollFolder, 'negative');
      const negThumbDir = path.join(rollFolder, 'negative', 'thumb');
      if (!fs.existsSync(negDir)) fs.mkdirSync(negDir, { recursive: true });
      if (!fs.existsSync(negThumbDir)) fs.mkdirSync(negThumbDir, { recursive: true });
      
      const negPath = path.join(negDir, negName);
      
      // Generate negative JPG from original
      await sharp(originalPath)
        .jpeg({ quality: 95 })
        .toFile(negPath);
        
      negativeRelPath = path.join('rolls', String(rollId), 'negative', negName).replace(/\\/g, '/');
      isNegativeSource = 1;
      
      // Generate negative thumb
      const negThumbName = `${baseName}-thumb.jpg`;
      const negThumbPath = path.join(negThumbDir, negThumbName);
      
      await sharp(negPath)
        .resize({ width: 240, height: 240, fit: 'inside' })
        .jpeg({ quality: 40 })
        .toFile(negThumbPath)
        .catch(thErr => console.error('Negative Thumbnail generation failed', thErr.message));

      // Copy negative thumb to main thumb dir
      const mainThumbName = `${baseName}-thumb.jpg`;
      const mainThumbPath = path.join(thumbDir, mainThumbName);
      if (fs.existsSync(negThumbPath)) {
        fs.copyFileSync(negThumbPath, mainThumbPath);
        thumbRelPath = path.join('rolls', String(rollId), 'thumb', mainThumbName).replace(/\\/g, '/');
        negativeThumbRelPath = path.join('rolls', String(rollId), 'negative', 'thumb', negThumbName).replace(/\\/g, '/');
      }
      
      // Do NOT generate positive
      fullRelPath = null;
      positiveRelPath = null;

    } else {
      // Positive Logic
      const destPath = path.join(fullDir, finalName);
      
      // Generate positive JPG from original
      await sharp(originalPath)
        .jpeg({ quality: 95 })
        .toFile(destPath);
        
      fullRelPath = path.join('rolls', String(rollId), 'full', finalName).replace(/\\/g, '/');
      positiveRelPath = fullRelPath;

      // Generate thumbnail
      const thumbName = `${baseName}-thumb.jpg`;
      const thumbPath = path.join(thumbDir, thumbName);
      
      try {
        await sharp(destPath)
          .resize({ width: 240, height: 240, fit: 'inside' })
          .jpeg({ quality: 40 })
          .toFile(thumbPath);
        thumbRelPath = path.join('rolls', String(rollId), 'thumb', thumbName).replace(/\\/g, '/');
        positiveThumbRelPath = thumbRelPath;
      } catch (thErr) {
        console.error('Thumbnail generation failed', thErr.message);
      }
    }

    // Fetch roll defaults for metadata if not provided explicitly
    const rollMeta = await new Promise((resolve) => {
      db.get('SELECT camera, lens, photographer FROM rolls WHERE id = ?', [rollId], (e, row) => {
        if (e || !row) return resolve({ camera: null, lens: null, photographer: null });
        resolve(row);
      });
    });
    const finalCamera = photoCamera || rollMeta.camera || null;
    const finalLens = photoLens || rollMeta.lens || null;
    const finalPhotographer = photoPhotographer || rollMeta.photographer || null;

    const sql = `INSERT INTO photos (roll_id, frame_number, filename, full_rel_path, thumb_rel_path, negative_rel_path, caption, taken_at, rating, camera, lens, photographer) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
    db.run(sql, [rollId, frameNumber, finalName, fullRelPath, thumbRelPath, negativeRelPath, caption, taken_at, rating, finalCamera, finalLens, finalPhotographer], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ ok: true, id: this.lastID, filename: finalName, fullRelPath, thumbRelPath, negativeRelPath, camera: finalCamera, lens: finalLens, photographer: finalPhotographer });
    });

  } catch (err) {
      console.error('Upload photo error', err);
      return res.status(500).json({ error: err.message });
  }
});

// set roll cover
router.post('/:id/cover', (req, res) => {
  const rollId = req.params.id;
  const { photoId, filename } = req.body;
  if (!photoId && !filename) return res.status(400).json({ error: 'photoId or filename required' });

  const setCover = (file) => {
    // Normalize the incoming file value into both coverPath and cover_photo.
    let coverPath = null;
    let coverPhoto = null;
    if (!file) {
      coverPath = null;
      coverPhoto = null;
    } else if (typeof file === 'string') {
      // If already an absolute uploads path, use it directly
      if (file.startsWith('/uploads') || file.startsWith('http://') || file.startsWith('https://')) {
        coverPath = file;
        // If it starts with '/uploads/', also set legacy cover_photo as the path without leading '/uploads/' prefix
        if (file.startsWith('/uploads/')) coverPhoto = file.replace(/^\/uploads\//, '');
        else coverPhoto = file;
      } else if (file.startsWith('/')) {
        // leading slash but not /uploads — keep as-is for coverPath, and store cover_photo without leading '/'
        coverPath = file;
        coverPhoto = file.replace(/^\//, '');
      } else {
        // likely a legacy relative path like 'rolls/...', produce '/uploads/<file>' as coverPath
        coverPhoto = file;
        coverPath = `/uploads/${file}`.replace(/\\/g, '/');
      }
    }

    const sql = `UPDATE rolls SET coverPath = ?, cover_photo = ? WHERE id = ?`;
    db.run(sql, [coverPath, coverPhoto, rollId], function(err){
      if (err) return res.status(500).json({ error: err.message });
      db.get('SELECT * FROM rolls WHERE id = ?', [rollId], (e, row) => {
        if (e) return res.status(500).json({ error: e.message });
        res.json(row);
      });
    });
  };

  if (photoId) {
    db.get('SELECT filename, full_rel_path, positive_rel_path, negative_rel_path FROM photos WHERE id = ? AND roll_id = ?', [photoId, rollId], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'photo not found' });
      
      const photoPath = row.positive_rel_path || row.full_rel_path || row.negative_rel_path;
      
      if (photoPath) {
        const coverPath = `/uploads/${photoPath}`.replace(/\\/g, '/');
        setCover(coverPath);
      } else {
        setCover(row.filename);
      }
    });
  } else {
    setCover(filename);
  }
});

module.exports = router;
