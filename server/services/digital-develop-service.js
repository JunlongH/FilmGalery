/**
 * Digital Develop Service
 *
 * Light color grading for digital photos. Reuses the FilmLab bottom-layer
 * pipeline (buildPipeline + renderBuffer) but with digital-appropriate defaults
 * (no inversion, no film curve).
 *
 * buildPipeline auto-decodes RAW via getImageInput, so this service works
 * for both RAW and JPEG originals without manual demosaic.
 *
 * @module server/services/digital-develop-service
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const sharp = require('sharp');

const { uploadsDir } = require('../config/paths');
const { buildPipeline } = require('./filmlab-service');
const { renderBuffer, EXPORT_MAX_WIDTH, PREVIEW_MAX_WIDTH_SERVER } = require('../../packages/shared');
const { runAsync, getAsync } = require('../utils/db-helpers');

sharp.cache(false);

// ── Photo query (LEFT JOIN — digital photos have no roll) ───────────────────

/**
 * Fetch a digital photo record (source_type='digital', not soft-deleted).
 * Uses LEFT JOIN on digital_sessions — no rolls JOIN.
 * @param {number} photoId
 * @returns {Promise<Object|null>}
 */
async function getDigitalPhotoRecord(photoId) {
  return getAsync(
    `SELECT p.*, ds.label AS session_label, ds.import_batch
     FROM photos p
     LEFT JOIN digital_sessions ds ON p.session_id = ds.id
     WHERE p.id = ? AND p.source_type = 'digital' AND p.deleted_at IS NULL`,
    [photoId]
  );
}

/**
 * Resolve the absolute source path from a photo record.
 * Prefers original_rel_path (RAW or JPEG original), falls back to positive.
 * @param {Object} photo
 * @returns {string|null}
 */
function getSourcePath(photo) {
  const relSource = photo.original_rel_path || photo.positive_rel_path;
  if (!relSource) return null;
  const abs = path.join(uploadsDir, relSource);
  return fs.existsSync(abs) ? abs : null;
}

// ── Params normalization ────────────────────────────────────────────────────

/**
 * Parse and normalize develop params for digital photos.
 * Forces inverted=false and filmCurveEnabled=false (digital-specific).
 * @param {string|Object} paramsJson
 * @returns {Object}
 */
function normalizeParams(paramsJson) {
  let params = {};
  if (paramsJson) {
    try {
      params = typeof paramsJson === 'string' ? JSON.parse(paramsJson) : paramsJson;
    } catch (_) {
      params = {};
    }
  }
  params.inverted = false;
  params.filmCurveEnabled = false;
  return params;
}

// ── Core render ─────────────────────────────────────────────────────────────

/**
 * Render a digital photo to a JPEG buffer.
 *
 * Uses buildPipeline (auto-decodes RAW) + renderBuffer (Float pipeline)
 * for CPU/GPU consistency.
 *
 * @param {Object} options
 * @param {number} options.photoId
 * @param {string|Object} [options.paramsJson] - Develop params
 * @param {number} [options.maxWidth] - Override max render width
 * @param {number} [options.quality=90] - JPEG quality
 * @returns {Promise<{buffer: Buffer, width: number, height: number}>}
 */
async function renderPhoto({ photoId, paramsJson, maxWidth, quality = 90 }) {
  const photo = await getDigitalPhotoRecord(photoId);
  if (!photo) throw new Error(`Digital photo not found: ${photoId}`);

  const sourcePath = getSourcePath(photo);
  if (!sourcePath) throw new Error(`Source file not found for photo: ${photoId}`);

  const params = normalizeParams(paramsJson);

  const img = await buildPipeline(sourcePath, params, {
    maxWidth: maxWidth || PREVIEW_MAX_WIDTH_SERVER,
    cropRect: params.cropRect || null,
    toneAndCurvesInJs: true,
    skipColorOps: true,
  });

  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const expectedBytes8 = width * height * channels;
  const is16bit = data.length >= expectedBytes8 * 2;

  const { jpeg8 } = renderBuffer(data, {
    width,
    height,
    channels,
    is16bit,
    params,
  });

  const buffer = await sharp(jpeg8, { raw: { width, height, channels: 3 } })
    .jpeg({ quality })
    .toBuffer();

  return { buffer, width, height };
}

/**
 * Render a preview JPEG (lower resolution, quality 90).
 * @param {number} photoId
 * @param {string|Object} paramsJson
 * @returns {Promise<Buffer>}
 */
async function renderPreview(photoId, paramsJson) {
  const { buffer } = await renderPhoto({ photoId, paramsJson, quality: 90 });
  return buffer;
}

/**
 * Render at export resolution (quality 95) and return buffer.
 * @param {number} photoId
 * @param {string|Object} paramsJson
 * @returns {Promise<{buffer: Buffer, width: number, height: number}>}
 */
async function renderExport(photoId, paramsJson) {
  return renderPhoto({ photoId, paramsJson, maxWidth: EXPORT_MAX_WIDTH, quality: 95 });
}

// ── Save (overwrite positive + thumb + develop_params_json) ─────────────────

/**
 * Render at export quality and persist: overwrite positive_rel_path,
 * regenerate thumbnail, update develop_params_json.
 * @param {number} photoId
 * @param {string|Object} paramsJson
 * @returns {Promise<{photoId: number, positivePath: string, thumbPath: string}>}
 */
async function save(photoId, paramsJson) {
  const photo = await getDigitalPhotoRecord(photoId);
  if (!photo) throw new Error(`Digital photo not found: ${photoId}`);

  const result = await renderExport(photoId, paramsJson);

  // Overwrite positive
  if (!photo.positive_rel_path) throw new Error('Photo has no positive_rel_path');
  const positiveAbs = path.join(uploadsDir, photo.positive_rel_path);
  await fsp.mkdir(path.dirname(positiveAbs), { recursive: true });
  await fsp.writeFile(positiveAbs, result.buffer);

  // Regenerate thumbnail
  let thumbPath = photo.thumb_rel_path;
  if (thumbPath) {
    const thumbAbs = path.join(uploadsDir, thumbPath);
    await fsp.mkdir(path.dirname(thumbAbs), { recursive: true });
    await sharp(result.buffer)
      .resize({ width: 400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(thumbAbs);
  }

  // Update develop_params_json
  const paramsStr = typeof paramsJson === 'string' ? paramsJson : JSON.stringify(paramsJson || {});
  await runAsync(
    'UPDATE photos SET develop_params_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [paramsStr, photoId]
  );

  return {
    photoId,
    positivePath: photo.positive_rel_path,
    thumbPath,
  };
}

// ── Read params ─────────────────────────────────────────────────────────────

/**
 * Read saved develop_params_json for a photo.
 * @param {number} photoId
 * @returns {Promise<Object|null>}
 */
async function getParams(photoId) {
  const row = await getAsync(
    'SELECT develop_params_json FROM photos WHERE id = ? AND source_type = \'digital\'',
    [photoId]
  );
  if (!row) return null;
  if (!row.develop_params_json) return null;
  try {
    return JSON.parse(row.develop_params_json);
  } catch (_) {
    return null;
  }
}

module.exports = {
  renderPhoto,
  renderPreview,
  renderExport,
  save,
  getParams,
  getDigitalPhotoRecord,
  getSourcePath,
  normalizeParams,
};
