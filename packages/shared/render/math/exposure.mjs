/**
 * Exposure and Dynamic Range Math
 * Pure functions for exposure adjustments in Linear Space.
 */

/**
 * Calculates the linear gain factor from exposure value (EV).
 * F-stop scale: +1 EV = 2x brightness.
 * @param {number} ev - Exposure Value shift (e.g., +1.0, -0.5)
 * @returns {number} Multiplier factor
 */
function evToGain(ev) {
    return Math.pow(2.0, ev);
}

/**
 * Applies exposure to a linear value.
 * @param {number} linear - Input linear value
 * @param {number} ev - Exposure Value shift
 * @returns {number} Adjusted linear value
 */
function applyExposure(linear, ev) {
    return linear * Math.pow(2.0, ev);
}

/**
 * Applies white balance coefficients.
 * @param {number} r - Red channel
 * @param {number} g - Green channel
 * @param {number} b - Blue channel
 * @param {object} multipliers - { r: number, g: number, b: number }
 * @returns {object} { r, g, b }
 */
function applyWhiteBalance(r, g, b, multipliers) {
    return {
        r: r * multipliers.r,
        g: g * multipliers.g, // constant 1.0 usually
        b: b * multipliers.b
    };
}

const _sharedExports = {
    evToGain,
    applyExposure,
    applyWhiteBalance
};
const _e_evToGain = _sharedExports.evToGain;
export { _e_evToGain as evToGain };
const _e_applyExposure = _sharedExports.applyExposure;
export { _e_applyExposure as applyExposure };
const _e_applyWhiteBalance = _sharedExports.applyWhiteBalance;
export { _e_applyWhiteBalance as applyWhiteBalance };
export default _sharedExports;
