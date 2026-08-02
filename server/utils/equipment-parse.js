/**
 * Equipment string parsing helpers.
 *
 * Extracted from equipment-migration.js so that runtime services (e.g.
 * equipment-service unregistered-device scan) can reuse the exact same
 * brand/model heuristics and fixed-lens skip rule as the one-time migration.
 *
 * @module server/utils/equipment-parse
 */

const FIXED_LENS_PATTERN = /^\d+(?:\.\d+)?mm\s+f\/[\d.?]+$/i;

function parseCameraString(str) {
  if (!str) return null;
  str = str.trim();
  const parts = str.split(/\s+/);
  if (parts.length === 0) return null;
  const brand = parts[0];
  const model = parts.slice(1).join(' ') || parts[0];
  return { name: str, brand, model };
}

function parseLensString(str) {
  if (!str) return null;
  str = str.trim();

  if (isFixedLensString(str)) {
    return null;
  }

  const focalMatch = str.match(/(\d+)(?:\s*-\s*(\d+))?\s*mm/i);
  const apertureMatch = str.match(/[fF][\s\/]?(\d+\.?\d*)/);

  const parts = str.split(/\s+/);
  const brand = parts[0];

  return {
    name: str,
    brand,
    model: str,
    focal_length_min: focalMatch ? parseInt(focalMatch[1]) : null,
    focal_length_max: focalMatch && focalMatch[2] ? parseInt(focalMatch[2]) : (focalMatch ? parseInt(focalMatch[1]) : null),
    max_aperture: apertureMatch ? parseFloat(apertureMatch[1]) : null
  };
}

function isFixedLensString(str) {
  if (!str) return false;
  return FIXED_LENS_PATTERN.test(str) || str.trim().toLowerCase() === 'fixed';
}

module.exports = { parseCameraString, parseLensString, isFixedLensString };
