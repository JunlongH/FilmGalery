/**
 * Digital File Service
 *
 * Path computation, directory creation, and atomic staging/publish for digital
 * photos. Digital photos have no roll concept — files are sharded by
 * {year}/{month} derived from EXIF DateTimeOriginal (or file mtime fallback).
 *
 * Reuses the atomic staging/publish/rollback primitives from roll-file-service
 * (publishStagedOperations / rollbackCreatedFiles / cleanupTempArtifacts) so the
 * OneDrive-safe commit/rollback semantics are identical to the film pipeline.
 *
 * Path layout (relative to uploadsDir):
 *   digital/{year}/{month}/{photoId}_original.{ext}   — original (RAW or JPEG)
 *   digital/{year}/{month}/{photoId}_display.jpg      — developed display image
 *   digital/{year}/{month}/thumb/{photoId}_thumb.jpg  — thumbnail
 *
 * @module server/services/digital-file-service
 */

const path = require('path');
const fs = require('fs').promises;
const { uploadsDir } = require('../config/paths');
const rollFileService = require('./roll-file-service');

const DIGITAL_DIR = path.join(uploadsDir, 'digital');

const RAW_EXTENSIONS = [
  '.dng', '.cr2', '.cr3', '.nef', '.arw',
  '.raf', '.orf', '.rw2', '.pef', '.srw',
];

/**
 * Compute a {year}/{month} shard path from a date string, falling back to now.
 * @param {string|Date|null} dateTaken
 * @returns {string} e.g. "2026/07"
 */
function computeShardPath(dateTaken) {
  let d;
  if (dateTaken instanceof Date) {
    d = dateTaken;
  } else if (dateTaken) {
    d = new Date(dateTaken);
  }
  if (!d || isNaN(d.getTime())) d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return path.join(String(year), month);
}

/**
 * Detect whether a filename is a RAW file.
 * @param {string} filename
 * @returns {boolean}
 */
function isRawFilename(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  return RAW_EXTENSIONS.includes(ext);
}

/**
 * Extract the lowercase extension (without dot) from a filename.
 * For RAW files the display/original ext is preserved; for others '.jpg'.
 * @param {string} filename
 * @returns {string}
 */
function extOf(filename) {
  return path.extname(filename || '').toLowerCase().replace(/^\./, '') || 'jpg';
}

/**
 * Compute relative paths (under uploadsDir) for a digital photo.
 *
 * @param {number} photoId
 * @param {string} originalExt - lowercased extension without dot (e.g. "cr2", "jpg")
 * @param {string} shardPath - e.g. "2026/07"
 * @returns {{originalRelPath: string, positiveRelPath: string, thumbRelPath: string}}
 */
function computeDigitalRelPaths(photoId, originalExt, shardPath) {
  const shard = shardPath;
  return {
    originalRelPath: `digital/${shard}/${photoId}_original.${originalExt}`,
    positiveRelPath: `digital/${shard}/${photoId}_display.jpg`,
    thumbRelPath: `digital/${shard}/thumb/${photoId}_thumb.jpg`,
  };
}

/**
 * Convert a relative uploads path to an absolute filesystem path.
 * @param {string|null} relPath
 * @returns {string|null}
 */
function toUploadAbsPath(relPath) {
  if (!relPath) return null;
  const trimmed = relPath.replace(/^\/+/, '').replace(/^uploads\//, '');
  return path.join(uploadsDir, trimmed);
}

/**
 * Ensure the digital shard directories exist.
 * @param {string} shardPath - e.g. "2026/07"
 * @returns {Promise<void>}
 */
async function ensureDigitalDirs(shardPath) {
  const base = path.join(DIGITAL_DIR, shardPath);
  await fs.mkdir(path.join(base, 'thumb'), { recursive: true });
}

module.exports = {
  DIGITAL_DIR,
  RAW_EXTENSIONS,
  computeShardPath,
  isRawFilename,
  extOf,
  computeDigitalRelPaths,
  toUploadAbsPath,
  ensureDigitalDirs,
  // Re-exported atomic primitives (OneDrive-safe staging/publish/rollback)
  publishStagedOperations: rollFileService.publishStagedOperations,
  rollbackCreatedFiles: rollFileService.rollbackCreatedFiles,
  cleanupTempArtifacts: rollFileService.cleanupTempArtifacts,
  createStagedOp: rollFileService.createStagedOp,
  deleteFilesSafe: rollFileService.deleteFilesSafe,
};
