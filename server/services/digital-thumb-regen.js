/**
 * Digital Thumb Regeneration (one-time)
 *
 * Early digital imports generated 240px/q40 thumbnails without EXIF
 * auto-orientation. Current spec is 400px/q80 with orientation baked in.
 * This one-time startup task re-renders the display JPEG and thumbnail
 * for existing digital photos: from the original (non-RAW, with
 * auto-orient) when available, otherwise thumbnail-only from the
 * existing display JPEG. A marker file prevents re-running.
 */

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { allAsync, runAsync } = require('../utils/db-helpers');
const { DIGITAL_DIR, isRawFilename, toUploadAbsPath } = require('./digital-file-service');

const MARKER = path.join(DIGITAL_DIR, '.thumb-regen-400q80.done');

async function regenDigitalThumbs() {
  try {
    if (fs.existsSync(MARKER)) return;

    const photos = await allAsync(
      `SELECT id, original_rel_path, positive_rel_path, thumb_rel_path, original_filename
       FROM photos WHERE source_type = 'digital' AND deleted_at IS NULL`,
    );
    console.log(`[DigitalThumbRegen] Regenerating derivatives for ${photos.length} digital photo(s)…`);

    let rebuilt = 0;
    let thumbOnly = 0;
    let skipped = 0;
    for (const p of photos) {
      try {
        const origAbs = toUploadAbsPath(p.original_rel_path);
        const posAbs = toUploadAbsPath(p.positive_rel_path);
        const thumbAbs = toUploadAbsPath(p.thumb_rel_path);
        const isRaw = p.original_filename ? isRawFilename(p.original_filename) : false;
        if (!thumbAbs) { skipped += 1; continue; }

        if (origAbs && !isRaw && fs.existsSync(origAbs)) {
          const oriented = sharp(origAbs, { limitInputPixels: false }).rotate();
          await oriented.clone().jpeg({ quality: 92 }).toFile(posAbs);
          await oriented.clone()
            .resize({ width: 400, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(thumbAbs);
          rebuilt += 1;
        } else if (posAbs && fs.existsSync(posAbs)) {
          await sharp(posAbs, { limitInputPixels: false })
            .resize({ width: 400, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(thumbAbs);
          thumbOnly += 1;
        } else {
          skipped += 1;
          continue;
        }
        await runAsync('UPDATE photos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [p.id]);
      } catch (e) {
        skipped += 1;
        console.warn(`[DigitalThumbRegen] photo ${p.id}: ${e.message}`);
      }
    }

    fs.writeFileSync(MARKER, new Date().toISOString() + '\n');
    console.log(`[DigitalThumbRegen] Done — rebuilt ${rebuilt}, thumb-only ${thumbOnly}, skipped ${skipped}.`);
  } catch (e) {
    console.warn('[DigitalThumbRegen] failed:', e.message);
  }
}

function scheduleDigitalThumbRegen(delayMs = 8000) {
  const t = setTimeout(() => { regenDigitalThumbs(); }, delayMs);
  if (typeof t.unref === 'function') t.unref();
}

module.exports = { regenDigitalThumbs, scheduleDigitalThumbRegen };
