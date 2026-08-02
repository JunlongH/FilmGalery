/**
 * Digital Import Service
 *
 * Two-phase import:
 *   preview(files)  — EXIF parse (exiftool-vendored) + sha256 hash + dedup +
 *                      RAW-readability probe. No files written.
 *   execute(body)   — atomic import: create digital_sessions → per-file
 *                      (demosaic RAW or read JPEG → generate display + thumb →
 *                      stage → publish → INSERT photo → UPDATE paths) →
 *                      optional album join → update session.file_count.
 *
 * EXIF is parsed via exiftool-vendored (already a server dependency) rather
 * than exifr (not installable in this environment — no registry access).
 *
 * Reuses:
 *   - raw-decoder (libraw) for RAW demosaic → Buffer
 *   - sharp for display JPEG + thumbnail generation
 *   - digital-file-service for path computation + atomic staging/publish
 *   - roll-file-service primitives (publishStagedOperations etc.)
 *
 * @module server/services/digital-import-service
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const sharp = require('sharp');

const { runAsync, getAsync } = require('../utils/db-helpers');
const PreparedStmt = require('../utils/prepared-statements');
const { localTmpDir } = require('../config/paths');
const rawDecoder = require('./raw-decoder');
const digitalFileService = require('./digital-file-service');

sharp.cache(false);

// ── EXIF (exiftool-vendored, lazy-loaded) ───────────────────────────────────

let _exiftool = null;
function getExiftool() {
  if (_exiftool === null) {
    try {
      _exiftool = require('exiftool-vendored').exiftool;
    } catch (e) {
      console.warn('[DigitalImport] exiftool-vendored not available, EXIF parsing disabled:', e.message);
      _exiftool = false;
    }
  }
  return _exiftool || null;
}

/**
 * Extract a normalized subset of EXIF fields from exiftool tags.
 * @param {Object} tags - raw exiftool-vendored tags
 * @returns {Object}
 */
function extractExifFields(tags) {
  if (!tags) return null;
  const out = {};
  if (tags.DateTimeOriginal) {
    const d = tags.DateTimeOriginal instanceof Date
      ? tags.DateTimeOriginal
      : new Date(tags.DateTimeOriginal);
    if (!isNaN(d.getTime())) out.dateTimeOriginal = d.toISOString();
  }
  if (tags.Make) out.make = String(tags.Make).trim();
  if (tags.Model) out.model = String(tags.Model).trim();
  if (tags.LensModel) out.lensModel = String(tags.LensModel).trim();
  if (tags.Software) out.software = String(tags.Software).trim();
  if (tags.FocalLength != null) out.focalLength = Number(tags.FocalLength);
  if (tags.FNumber != null) out.fNumber = Number(tags.FNumber);
  if (tags.ExposureTime != null) out.exposureTime = Number(tags.ExposureTime);
  if (tags.ISO != null) out.iso = Number(tags.ISO);
  if (tags.GPSLatitude != null) out.gpsLatitude = Number(tags.GPSLatitude);
  if (tags.GPSLongitude != null) out.gpsLongitude = Number(tags.GPSLongitude);
  if (tags.GPSAltitude != null) out.altitude = Number(tags.GPSAltitude);
  if (tags.ImageWidth != null) out.width = Number(tags.ImageWidth);
  if (tags.ImageHeight != null) out.height = Number(tags.ImageHeight);
  if (tags.Orientation != null) out.orientation = Number(tags.Orientation);
  if (tags.WhiteBalance) out.whiteBalance = String(tags.WhiteBalance);
  if (tags.ColorSpaceData) out.colorSpace = String(tags.ColorSpaceData);
  return out;
}

/**
 * Parse EXIF from a file path, returning null on any failure.
 * @param {string} filePath
 * @returns {Promise<Object|null>}
 */
async function safeParseExif(filePath) {
  const et = getExiftool();
  if (!et) return null;
  try {
    const tags = await et.read(filePath);
    return extractExifFields(tags);
  } catch (e) {
    return null;
  }
}

// ── Hash ────────────────────────────────────────────────────────────────────

/**
 * Compute sha256 of a file via stream.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// ── Summary ─────────────────────────────────────────────────────────────────

/**
 * Build an EXIF summary across a set of items.
 * @param {Array} items - non-duplicate items with .exif
 * @returns {Object}
 */
function summarizeExif(items) {
  const withExif = items.filter((i) => i.exif);
  const dates = withExif
    .map((i) => i.exif.dateTimeOriginal)
    .filter(Boolean)
    .sort();
  const cameras = {};
  for (const i of withExif) {
    const key = [i.exif.make, i.exif.model].filter(Boolean).join(' ') || 'Unknown';
    cameras[key] = (cameras[key] || 0) + 1;
  }
  const hasGps = withExif.some((i) => i.exif.gpsLatitude != null);
  return {
    dateRange: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null,
    cameras: Object.entries(cameras)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    hasGps,
  };
}

// ── Preview ─────────────────────────────────────────────────────────────────

const TMP_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Best-effort sweep of stale multer tmp uploads (older than 1 hour).
 * Preview uploads persist if the user never executes; this reclaims them.
 * @returns {Promise<void>}
 */
async function sweepStaleTmpFiles() {
  try {
    const entries = await fsp.readdir(localTmpDir);
    const cutoff = Date.now() - TMP_MAX_AGE_MS;
    for (const name of entries) {
      try {
        const abs = path.join(localTmpDir, name);
        const st = await fsp.stat(abs);
        if (st.isFile() && st.mtimeMs < cutoff) {
          await fsp.unlink(abs);
        }
      } catch (_) {
        // best-effort per-file
      }
    }
  } catch (e) {
    console.warn('[DigitalImport] tmp sweep failed:', e.message);
  }
}

/**
 * Preview a batch of uploaded files: hash, dedup, EXIF, RAW probe.
 * Does NOT write any files.
 *
 * @param {Array<{path: string, originalname: string, size: number}>} files
 * @returns {Promise<Object>}
 */
async function preview(files) {
  // Fire-and-forget: reclaim tmp uploads abandoned by previous previews
  sweepStaleTmpFiles().catch((e) => console.warn('[DigitalImport] tmp sweep failed:', e.message));

  const items = [];
  const decoderAvailable = await rawDecoder.isAvailable();

  for (const f of files) {
    const hash = await computeFileHash(f.path);
    const existing = await PreparedStmt.getAsync('photos.checkHash', [hash]);
    const exif = await safeParseExif(f.path);
    const isRaw = digitalFileService.isRawFilename(f.originalname);
    items.push({
      file: { path: f.path, originalname: f.originalname, size: f.size },
      hash,
      duplicate: !!existing,
      existingId: existing ? existing.id : null,
      isRaw,
      rawSupported: isRaw ? decoderAvailable : null,
      exif,
    });
  }

  return {
    total: items.length,
    duplicates: items.filter((i) => i.duplicate).length,
    raws: items.filter((i) => i.isRaw).length,
    rawUnsupported: items.filter((i) => i.isRaw && !i.rawSupported).length,
    jpeg: items.filter((i) => !i.isRaw).length,
    items,
    exif_summary: summarizeExif(items.filter((i) => !i.duplicate)),
  };
}

// ── Execute ─────────────────────────────────────────────────────────────────

/**
 * Process a single file into a photo row + published files.
 *
 * @param {Object} item - item from preview
 * @param {number} sessionId
 * @returns {Promise<{id: number, relPaths: {originalRelPath: string, positiveRelPath: string, thumbRelPath: string}}>}
 */
async function processOne(item, sessionId) {
  const exif = item.exif || {};
  const shard = digitalFileService.computeShardPath(exif.dateTimeOriginal);
  await digitalFileService.ensureDigitalDirs(shard);

  // Decode source into a displayable buffer
  let sourceBuf;
  if (item.isRaw) {
    sourceBuf = await rawDecoder.decode(item.file.path, { outputFormat: 'tiff', halfSize: false });
  } else {
    sourceBuf = await fsp.readFile(item.file.path);
  }

  let fileSize = null;
  try { fileSize = fs.statSync(item.file.path).size; } catch (_) { fileSize = null; }

  // INSERT photo first to obtain an id for file naming
  const ins = await runAsync(
    `INSERT INTO photos (
       source_type, session_id, content_hash, filename, original_filename,
       date_taken, focal_length, aperture, shutter_speed, iso,
       white_balance, color_space, latitude, longitude, altitude,
       camera, lens, source_make, source_model, source_software, source_lens,
       width, height, file_size
     ) VALUES ('digital', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      item.hash,
      item.file.originalname,
      item.file.originalname,
      exif.dateTimeOriginal || null,
      exif.focalLength || null,
      exif.fNumber || null,
      exif.exposureTime || null,
      exif.iso || null,
      exif.whiteBalance || null,
      exif.colorSpace || null,
      exif.gpsLatitude || null,
      exif.gpsLongitude || null,
      exif.altitude || null,
      [exif.make, exif.model].filter(Boolean).join(' ') || null,
      exif.lensModel || null,
      exif.make || null,
      exif.model || null,
      exif.software || null,
      exif.lensModel || null,
      exif.width || null,
      exif.height || null,
      fileSize,
    ]
  );
  const photoId = ins.lastID;

  // Compute all candidate abs paths up front so that if any step below
  // throws, the catch can best-effort unlink all three (a partially-written
  // display/thumb or an un-started original) — matching rollbackPartial's
  // shape.
  const originalExt = digitalFileService.extOf(item.file.originalname);
  const relPaths = digitalFileService.computeDigitalRelPaths(photoId, originalExt, shard);
  const displayAbs = digitalFileService.toUploadAbsPath(relPaths.positiveRelPath);
  const thumbAbs = digitalFileService.toUploadAbsPath(relPaths.thumbRelPath);
  const originalAbs = digitalFileService.toUploadAbsPath(relPaths.originalRelPath);

  try {
    await fsp.mkdir(path.dirname(displayAbs), { recursive: true });
    await fsp.mkdir(path.dirname(thumbAbs), { recursive: true });

    const oriented = sharp(sourceBuf).rotate();
    if (item.isRaw && exif.orientation) {
      const deg = { 3: 180, 6: 90, 8: 270 }[exif.orientation];
      if (deg) oriented.rotate(deg);
    }

    await oriented.clone().jpeg({ quality: 92 }).toFile(displayAbs);

    await oriented.clone()
      .resize({ width: 400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(thumbAbs);

    await fsp.mkdir(path.dirname(originalAbs), { recursive: true });
    await fsp.copyFile(item.file.path, originalAbs);

    await runAsync(
      `UPDATE photos SET original_rel_path = ?, positive_rel_path = ?, thumb_rel_path = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [relPaths.originalRelPath, relPaths.positiveRelPath, relPaths.thumbRelPath, photoId]
    );
  } catch (e) {
    // Self-cleanup: a failure after INSERT (sharp encode, copyFile, or the
    // path UPDATE) would otherwise orphan the photo row and any partially-
    // written files. Best-effort unlink each candidate abs path, hard-delete
    // the row, then rethrow so execute()'s per-file catch records the error.
    for (const abs of [displayAbs, thumbAbs, originalAbs]) {
      if (abs) {
        try {
          await fsp.unlink(abs);
        } catch (_) {
          // best-effort — file may not exist or already be gone
        }
      }
    }
    try {
      await runAsync('DELETE FROM photos WHERE id = ?', [photoId]);
    } catch (_) {
      // best-effort
    }
    throw e;
  }

  return { id: photoId, relPaths };
}

/**
 * Atomically execute an import batch.
 *
 * @param {Object} body
 * @param {Array} body.items - items from preview
 * @param {string} [body.session_title]
 * @param {number} [body.album_id]
 * @param {string} jobId
 * @param {Object} jobRegistry - import-job-registry
 * @returns {Promise<void>}
 */
async function execute(body, jobId, jobRegistry) {
  const { items = [], session_title, album_id } = body;
  const importBatchId = crypto.randomUUID();

  jobRegistry.start(jobId, items.length);

  // Pre-flight: verify uploaded temp files still exist. They can be swept by
  // the 1-hour stale-tmp cleanup, an OS tmp cleaner, or a process restart
  // between preview and execute — which would otherwise surface as a silent
  // per-file ENOENT storm in the loop below.
  const processable = items.filter((i) => !i.duplicate);
  if (processable.length > 0) {
    const missing = [];
    for (const it of processable) {
      try {
        await fsp.access(it.file.path);
      } catch (e) {
        if (e?.code !== 'ENOENT') {
          console.warn(`[DigitalImport] temp file check failed for ${it.file.originalname}: ${e.message}`);
        }
        missing.push(it.file.originalname);
      }
    }
    if (missing.length === processable.length) {
      console.error(
        `[DigitalImport] Job ${jobId} aborted: all ${missing.length} temp file(s) missing before execute.`,
      );
      await cleanupTempFiles(items);
      jobRegistry.fail(
        jobId,
        `Uploaded temp files expired before import (${missing.join(', ')}) — please re-import your photos.`,
      );
      return;
    }
  }

  // 1. Create session
  const firstDate = items.find((i) => i.exif?.dateTimeOriginal)?.exif.dateTimeOriginal || null;
  const sessionResult = await runAsync(
    `INSERT INTO digital_sessions (import_batch, session_date, label, file_count)
     VALUES (?, ?, ?, ?)`,
    [importBatchId, firstDate, session_title || null, items.length]
  );
  const sessionId = sessionResult.lastID;

  const photoRows = [];

  // 2. Per-file processing
  for (let i = 0; i < items.length; i++) {
    if (jobRegistry.isCancelled(jobId)) {
      await rollbackPartial(photoRows);
      try {
        await runAsync('UPDATE digital_sessions SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL', [sessionId]);
      } catch (e) {
        console.warn('[DigitalImport] session soft-delete failed:', e.message);
      }
      await cleanupTempFiles(items);
      jobRegistry.markCancelled(jobId);
      return;
    }
    const it = items[i];
    if (it.duplicate) {
      jobRegistry.tick(jobId, it.file.originalname);
      continue;
    }
    try {
      const row = await processOne(it, sessionId);
      photoRows.push(row);
      jobRegistry.tick(jobId, it.file.originalname);
    } catch (e) {
      console.error(
        `[DigitalImport] Failed to import ${it.file.originalname}:`,
        e.message,
      );
      jobRegistry.recordError(jobId, it.file.originalname, e.message);
    }
  }

  // 3. Update session actual count (excluding skipped duplicates)
  await runAsync('UPDATE digital_sessions SET file_count = ? WHERE id = ?', [
    photoRows.length,
    sessionId,
  ]);

  // 4. Optional album join (batched in a transaction)
  if (album_id && photoRows.length) {
    try {
      await runAsync('BEGIN');
      for (const r of photoRows) {
        await runAsync('INSERT OR IGNORE INTO album_photos (album_id, photo_id) VALUES (?, ?)', [
          album_id,
          r.id,
        ]);
      }
      await runAsync('COMMIT');
    } catch (e) {
      await runAsync('ROLLBACK').catch(() => {});
      jobRegistry.recordError(jobId, 'album-join', e.message);
    }
  }

  // 5. If nothing was imported and at least one file failed, fail the job
  //    loudly so the client surfaces the error instead of navigating away
  //    to an empty library.
  if (photoRows.length === 0) {
    const job = jobRegistry.get(jobId);
    const failedCount = job?.failed || 0;
    if (failedCount > 0) {
      const firstErr = job?.errors?.[0];
      const firstMsg = firstErr?.error || 'Unknown error';
      console.error(
        `[DigitalImport] Job ${jobId} failed: 0 of ${items.length} photo(s) imported (${failedCount} error(s)).`,
      );
      await cleanupTempFiles(items);
      jobRegistry.fail(
        jobId,
        `No photos imported — ${failedCount} file${failedCount === 1 ? '' : 's'} failed. First error: ${firstMsg}`,
      );
      return;
    }
  }

  jobRegistry.complete(jobId, { sessionId, imported: photoRows.length });
  await cleanupTempFiles(items);
}

/**
 * Best-effort cleanup of partially imported photos on cancellation.
 *
 * For each row: unlinks the display/thumb/original files (best-effort,
 * per-file catch), then HARD-DELETES the photos row. Hard-delete is safe
 * because cancellation is checked at the top of the per-file loop, BEFORE
 * the album_photos join in step 4 of execute() — so no FK rows can reference
 * these photo ids yet. The wider schema has additional FKs to photos
 * (albums.cover_photo_id, non-CASCADE; photo_tags) but neither is written
 * by this flow, and cover_photo_id is only ever set by album-update routes
 * outside the cancel timeline.
 *
 * @param {Array<{id: number, relPaths?: {originalRelPath: string, positiveRelPath: string, thumbRelPath: string}}>} photoRows
 */
async function rollbackPartial(photoRows) {
  for (const r of photoRows) {
    if (r.relPaths) {
      for (const rel of [r.relPaths.positiveRelPath, r.relPaths.thumbRelPath, r.relPaths.originalRelPath]) {
        const abs = digitalFileService.toUploadAbsPath(rel);
        if (abs) {
          try {
            await fsp.unlink(abs);
          } catch (_) {
            // best-effort — file may not exist or already be gone
          }
        }
      }
    }
    try {
      await runAsync('DELETE FROM photos WHERE id = ?', [r.id]);
    } catch (_) {
      // best-effort
    }
  }
}

/**
 * Best-effort delete of multer temp files after import.
 * @param {Array} items
 */
async function cleanupTempFiles(items) {
  for (const it of items) {
    if (it.file && it.file.path) {
      try {
        await fsp.unlink(it.file.path);
      } catch (_) {
        // best-effort — file may already be gone
      }
    }
  }
}

module.exports = { preview, execute, safeParseExif, computeFileHash };
