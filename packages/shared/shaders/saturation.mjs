/**
 * shaders/saturation.js — GLSL Saturation Adjustment
 * ====================================================
 * 
 * Luma-preserving saturation for the WebGL rendering pipeline.
 * Uses the same Rec.709 coefficients as the CPU path (filmLabSaturation.js).
 *
 * Pipeline position: after HSL (⑦), before Split Toning (⑧).
 *
 * @module shaders/saturation
 */

'use strict';

/**
 * GLSL function for luma-preserving saturation adjustment.
 *
 * Expects uniforms:
 *   uniform float u_saturation;   // −100..+100, 0 = identity
 *   uniform float u_useSaturation; // 1.0 to enable, 0.0 to bypass
 *
 * @returns {string} GLSL source for `applySaturation(vec3 color)` function
 */
function getSaturationGLSL() {
  return `
// ── Saturation (Luma-Preserving, Rec.709) ──────────────────────
vec3 applySaturation(vec3 color) {
  // X.4 (P1-1): clamp s to >= 0 to match CPU filmLabSaturation.js:39
  // Math.max(0, 1 + strength/100). Without this, saturation < -100
  // produces a negative s, which inverts chroma (R/G/B flip around luma)
  // — visible as a color-polarity flip. UI bounds saturation to [-100,100]
  // but API/programmatic callers (presets, AI) can exceed the range.
  float s = max(0.0, 1.0 + u_saturation / 100.0);
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  return clamp(vec3(lum) + (color - vec3(lum)) * s, 0.0, 1.0);
}
`;
}

/**
 * GLSL call to insert in the main() pipeline.
 *
 * @returns {string} GLSL statement guarded by u_useSaturation flag
 */
function getSaturationMainCall() {
  return `
  // ⑦b Saturation (Luma-Preserving)
  if (u_useSaturation > 0.5) {
    color = applySaturation(color);
  }
`;
}

export {
  getSaturationGLSL,
  getSaturationMainCall,
}