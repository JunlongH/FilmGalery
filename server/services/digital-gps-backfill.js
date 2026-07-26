/**
 * Digital GPS Backfill
 *
 * Digital imports before GPS persistence stored no latitude/longitude, so
 * those photos never appear on the map. This task re-reads EXIF GPS from
 * the stored originals and fills in the missing coordinates.
 *
 * Runs as a low-priority background task after server startup; each run
 * only processes photos whose latitude IS NULL, so once caught up the
 * startup cost is a single COUNT query.
 */

const { allAsync, runAsync, getAsync } = require('../utils/db-helpers');
const { toUploadAbsPath } = require('./digital-file-service');

let _exiftool = null;
function getExiftool() {
  if (_exiftool === null) {
    try {
      _exiftool = require('exiftool-vendored').exiftool;
    } catch (e) {
      console.warn('[DigitalGpsBackfill] exiftool-vendored not available:', e.message);
      _exiftool = false;
    }
  }
  return _exiftool || null;
}

async function backfillDigitalGps() {
  try {
    const row = await getAsync(
      `SELECT COUNT(*) AS cnt FROM photos
       WHERE source_type = 'digital' AND deleted_at IS NULL
         AND (latitude IS NULL OR longitude IS NULL)`,
    );
    if (!row || row.cnt === 0) return;

    const et = getExiftool();
    if (!et) return;

    console.log(`[DigitalGpsBackfill] Checking ${row.cnt} digital photo(s) for missing GPS…`);
    const photos = await allAsync(
      `SELECT id, original_rel_path, positive_rel_path FROM photos
       WHERE source_type = 'digital' AND deleted_at IS NULL
         AND (latitude IS NULL OR longitude IS NULL)`,
    );

    let updated = 0;
    try {
      for (const p of photos) {
        const rel = p.original_rel_path || p.positive_rel_path;
        if (!rel) continue;
        try {
          const tags = await et.read(toUploadAbsPath(rel));
          const lat = tags.GPSLatitude != null ? Number(tags.GPSLatitude) : null;
          const lng = tags.GPSLongitude != null ? Number(tags.GPSLongitude) : null;
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            await runAsync('UPDATE photos SET latitude = ?, longitude = ? WHERE id = ?', [lat, lng, p.id]);
            updated += 1;
          }
        } catch (e) {
          console.warn(`[DigitalGpsBackfill] photo ${p.id}: ${e.message}`);
        }
      }
    } finally {
      try { await et.end(); } catch { /* already ended */ }
      _exiftool = null;
    }
    console.log(`[DigitalGpsBackfill] Done — updated GPS for ${updated}/${photos.length} photo(s).`);
  } catch (e) {
    console.warn('[DigitalGpsBackfill] failed:', e.message);
  }
}

function scheduleDigitalGpsBackfill(delayMs = 5000) {
  const t = setTimeout(() => { backfillDigitalGps(); }, delayMs);
  if (typeof t.unref === 'function') t.unref();
}

module.exports = { backfillDigitalGps, scheduleDigitalGpsBackfill };
