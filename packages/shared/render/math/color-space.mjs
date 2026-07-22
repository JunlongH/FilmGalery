/**
 * Color Space Transformation Math
 * Pure functions for converting between color spaces and transfer functions.
 * All inputs/outputs are normalized floats (0.0 - 1.0+).
 */

/**
 * Converts Linear float values to sRGB (Gamma Corrected)
 * Implements the precise sRGB transfer function (IEC 61966-2-1).
 * 负值 clamp 到 0（线性光下不应有负值；旧实现对 linear*12.92 分支返回负值会污染下游）。
 * @param {number} linear - Linear value (0.0 - 1.0+)
 * @returns {number} sRGB value (0.0 - 1.0)
 */
function linearToSrgb(linear) {
    if (linear < 0) linear = 0;
    if (linear <= 0.0031308) {
        return linear * 12.92;
    } else {
        return 1.055 * Math.pow(linear, 1.0 / 2.4) - 0.055;
    }
}

/**
 * Converts sRGB float values to Linear
 * 负值 clamp 到 0。
 * @param {number} srgb - sRGB value (0.0 - 1.0)
 * @returns {number} Linear value (0.0 - 1.0+)
 */
function srgbToLinear(srgb) {
    if (srgb < 0) srgb = 0;
    if (srgb <= 0.04045) {
        return srgb / 12.92;
    } else {
        return Math.pow((srgb + 0.055) / 1.055, 2.4);
    }
}

/**
 * Simple Gamma correction (e.g., for simple display)
 * @param {number} linear - Linear value
 * @param {number} gamma - Gamma value (e.g., 2.2)
 * @returns {number} Gamma corrected value
 */
function applyGamma(linear, gamma = 2.2) {
    return Math.pow(Math.max(0, linear), 1.0 / gamma);
}

/**
 * Inverse Gamma correction
 * @param {number} val - Gamma corrected value
 * @param {number} gamma - Gamma value
 * @returns {number} Linear value
 */
function removeGamma(val, gamma = 2.2) {
    return Math.pow(Math.max(0, val), gamma);
}

const _sharedExports = {
    linearToSrgb,
    srgbToLinear,
    applyGamma,
    removeGamma
};
const _e_linearToSrgb = _sharedExports.linearToSrgb;
export { _e_linearToSrgb as linearToSrgb };
const _e_srgbToLinear = _sharedExports.srgbToLinear;
export { _e_srgbToLinear as srgbToLinear };
const _e_applyGamma = _sharedExports.applyGamma;
export { _e_applyGamma as applyGamma };
const _e_removeGamma = _sharedExports.removeGamma;
export { _e_removeGamma as removeGamma };
export default _sharedExports;
