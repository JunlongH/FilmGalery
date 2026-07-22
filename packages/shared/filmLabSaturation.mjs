/**
 * filmLabSaturation.js — Global Saturation Adjustment (Luma-Preserving)
 * =====================================================================
 * 
 * Provides a luma-preserving saturation adjustment for the FilmLab pipeline.
 * Placed after HSL channel adjustments and before Split Toning.
 *
 * Algorithm:
 *   Y  = 0.2126·R + 0.7152·G + 0.0722·B   (Rec.709 luminance)
 *   s  = 1 + strength / 100                 (strength ∈ [-100, 100])
 *   R' = Y + (R - Y) × s
 *   G' = Y + (G - Y) × s
 *   B' = Y + (B - Y) × s
 *
 * At strength = 0, output === input (identity).
 * At strength = -100, output = pure luminance (full desaturation).
 * At strength = +100, chroma is doubled.
 *
 * @module filmLabSaturation
 */

'use strict';

// Rec.709 luminance coefficients
const LUM_R = 0.2126;
const LUM_G = 0.7152;
const LUM_B = 0.0722;

/**
 * Apply luma-preserving saturation to a float-domain pixel (0–1 range).
 *
 * X2.2: optional `out` parameter — when provided, writes the result into
 * `out[0..2]` and returns `out` instead of allocating a fresh array. The
 * hot-path caller (RenderCore.processPixelFloat) passes a pre-allocated
 * buffer to eliminate 960K array allocations per frame. Tests and other
 * callers that destructure the return value keep working via the fallback.
 *
 * @param {number} r - Red   channel (0–1)
 * @param {number} g - Green channel (0–1)
 * @param {number} b - Blue  channel (0–1)
 * @param {number} strength - Saturation strength (−100 to +100, 0 = identity)
 * @param {[number, number, number]} [out] - Optional reusable output buffer
 * @returns {[number, number, number]} Adjusted [r, g, b] in 0–1 range
 */
function applySaturationFloat(r, g, b, strength, out) {
  const s = Math.max(0, 1 + strength / 100); // 防 strength < -100 产生负饱和度（色度反转）
  const lum = LUM_R * r + LUM_G * g + LUM_B * b;
  const ro = Math.max(0, Math.min(1, lum + (r - lum) * s));
  const go = Math.max(0, Math.min(1, lum + (g - lum) * s));
  const bo = Math.max(0, Math.min(1, lum + (b - lum) * s));
  if (out) {
    out[0] = ro; out[1] = go; out[2] = bo;
    return out;
  }
  return [ro, go, bo];
}

/**
 * Apply luma-preserving saturation to an 8-bit pixel (0–255 range).
 *
 * @param {number} r - Red   channel (0–255)
 * @param {number} g - Green channel (0–255)
 * @param {number} b - Blue  channel (0–255)
 * @param {number} strength - Saturation strength (−100 to +100, 0 = identity)
 * @returns {[number, number, number]} Adjusted [r, g, b] clamped to 0–255
 */
function applySaturation(r, g, b, strength) {
  const s = Math.max(0, 1 + strength / 100); // 防 strength < -100 产生负饱和度（色度反转）
  const lum = LUM_R * r + LUM_G * g + LUM_B * b;
  return [
    Math.max(0, Math.min(255, Math.round(lum + (r - lum) * s))),
    Math.max(0, Math.min(255, Math.round(lum + (g - lum) * s))),
    Math.max(0, Math.min(255, Math.round(lum + (b - lum) * s))),
  ];
}

/**
 * Check whether the saturation value is the default (identity).
 *
 * @param {number|null|undefined} value - The saturation strength
 * @returns {boolean} true if the value represents no change
 */
function isDefaultSaturation(value) {
  return value == null || value === 0;
}

const _sharedExports = {
  applySaturationFloat,
  applySaturation,
  isDefaultSaturation,
  // Export constants for testing
  LUM_R,
  LUM_G,
  LUM_B,
};
const _e_applySaturationFloat = _sharedExports.applySaturationFloat;
export { _e_applySaturationFloat as applySaturationFloat };
const _e_applySaturation = _sharedExports.applySaturation;
export { _e_applySaturation as applySaturation };
const _e_isDefaultSaturation = _sharedExports.isDefaultSaturation;
export { _e_isDefaultSaturation as isDefaultSaturation };
const _e_LUM_R = _sharedExports.LUM_R;
export { _e_LUM_R as LUM_R };
const _e_LUM_G = _sharedExports.LUM_G;
export { _e_LUM_G as LUM_G };
const _e_LUM_B = _sharedExports.LUM_B;
export { _e_LUM_B as LUM_B };
export default _sharedExports;
