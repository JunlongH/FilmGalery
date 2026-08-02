/**
 * Digital Fileinfo Backfill
 *
 * Digital imports before width/height/file_size/altitude persistence stored
 * no dimension or size metadata. This task re-reads EXIF from the stored
 * originals and fills in the missing values.
 *
 * Runs as a low-priority background task after server startup; each run
 * only processes photos whose width IS NULL, so once caught up the
 * startup cost is a single COUNT query.
 *
 * altitude is only backfilled for photos whose altitude IS NULL — existing
 * altitude values are never overwritten.
 */

const fs = require('fs');
const { allAsync, runAsync, getAsync } = require('../utils/db-helpers');
const { toUploadAbsPath } = require('./digital-file-service');

let _exiftool = null;
function getExiftool() {
  if (_exiftool === null) {
    try {
      _exiftool = require('exiftool-vendored').exiftool;
    } catch (e) {
      console.warn('[DigitalFileinfoBackfill] exiftool-vendored not available:', e.message);
      _exiftool = false;
    }
  }
  return _exiftool || null;
}

async function backfillDigitalFileinfo() {
  try {
    const row = await getAsync(
      `SELECT COUNT(*) AS cnt FROM photos
       WHERE source_type = 'digital' AND deleted_at IS NULL
         AND width IS NULL`,
    );
    if (!row || row.cnt === 0) return;

    const et = getExiftool();
    if (!et) return;

    console.log(`[DigitalFileinfoBackfill] Checking ${row.cnt} digital photo(s) for missing file info…`);
    const photos = await allAsync(
      `SELECT id, original_rel_path, positive_rel_path FROM photos
       WHERE source_type = 'digital' AND deleted_at IS NULL
         AND width IS NULL`,
    );

    let updated = 0;
    for (const p of photos) {
      const rel = p.original_rel_path || p.positive_rel_path;
      if (!rel) continue;
      const abs = toUploadAbsPath(rel);
      if (!abs || !fs.existsSync(abs)) continue;
      try {
        const tags = await et.read(abs);
        const width = tags.ImageWidth != null ? Number(tags.ImageWidth) : null;
        const height = tags.ImageHeight != null ? Number(tags.ImageHeight) : null;
        const altitude = tags.GPSAltitude != null ? Number(tags.GPSAltitude) : null;
        let fileSize = null;
        try { fileSize = fs.statSync(abs).size; } catch (_) { fileSize = null; }

        if (width == null && height == null) {
          await runAsync('UPDATE photos SET width = 0 WHERE id = ?', [p.id]);
          continue;
        }

        await runAsync(
          `UPDATE photos SET width = ?, height = ?, file_size = ?,
             altitude = COALESCE(altitude, ?), updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [width, height, fileSize, altitude, p.id]
        );
        updated += 1;
      } catch (e) {
        console.warn(`[DigitalFileinfoBackfill] photo ${p.id}: ${e.message}`);
        try {
          await runAsync('UPDATE photos SET width = 0 WHERE id = ?', [p.id]);
        } catch (_) { /* ignore */ }
      }
    }
    console.log(`[DigitalFileinfoBackfill] Done — updated file info for ${updated}/${photos.length} photo(s).`);
  } catch (e) {
    console.warn('[DigitalFileinfoBackfill] failed:', e.message);
  }
}

function scheduleDigitalFileinfoBackfill(delayMs = 6000) {
  const t = setTimeout(() => { backfillDigitalFileinfo(); }, delayMs);
  if (typeof t.unref === 'function') t.unref();
}

module.exports = { backfillDigitalFileinfo, scheduleDigitalFileinfoBackfill };
