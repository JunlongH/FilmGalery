/**
 * Tone Mapping and Dynamic Range Compression
 * Math for compressing High Dynamic Range (Linear Float) into Standard Dynamic Range (0-1).
 */

/**
 * Simple Reinhard Tone Mapping.
 * x / (x + 1)
 * Preserves average brightness but desaturates highlights if applied per channel.
 * @param {number} x - Input linear value
 * @returns {number} Tone mapped value (0.0 - 1.0)
 */
function reinhard(x) {
    return x / (x + 1.0);
}

/**
 * Extended Reinhard (allows burning out whites).
 * x * (1 + x / (whitePoint^2)) / (1 + x)
 * @param {number} x - Input linear value
 * @param {number} whitePoint - The value that will map to 1.0 (default infinity)
 * @returns {number} Tone mapped value
 */
function reinhardExtended(x, whitePoint = 4.0) {
    return (x * (1.0 + x / (whitePoint * whitePoint))) / (1.0 + x);
}

/**
 * Filmic Curve Approximation (ACES-like)
 * Gives a nice "film look" with toe and shoulder.
 * @param {number} x - Input
 * @returns {number} Output
 */
function filmicACES(x) {
    const a = 2.51;
    const b = 0.03;
    const c = 2.43;
    const d = 0.59;
    const e = 0.14;
    return Math.max(0, Math.min(1, (x * (a * x + b)) / (x * (c * x + d) + e)));
}

/**
 * Applies a highlight compression roll-off "shoulder".
 * For values below threshold, it's linear (identity).
 * For values above, it compresses softly toward 1.0.
 *
 * Uses tanh-based compression for C² continuity at the threshold:
 *   f(threshold)  = threshold       (value match)
 *   f'(threshold) = 1               (derivative match — no slope kink)
 *   f''(threshold) = 0              (curvature match — smooth onset)
 *
 * @param {number} x - Input value
 * @param {number} threshold - Start of shoulder (0.0 - 1.0), default 0.8
 * @returns {number} Compressed output in [0, 1.0)
 */
function highlightRollOff(x, threshold = 0.8) {
    if (x <= threshold) return x;
    
    const headroom = 1.0 - threshold;
    const t = (x - threshold) / headroom;  // normalized overshoot [0, ∞)
    
    // tanh: maps [0, ∞) → [0, 1), with derivative 1 and curvature 0 at t=0
    // Clamp input to avoid exp overflow on extreme HDR values
    const tc = Math.min(t, 10.0);  // tanh(10) ≈ 1.0
    const e2t = Math.exp(2.0 * tc);
    const tanhT = (e2t - 1.0) / (e2t + 1.0);
    
    return threshold + headroom * tanhT;
}

const _sharedExports = {
    reinhard,
    reinhardExtended,
    filmicACES,
    highlightRollOff
};
const _e_reinhard = _sharedExports.reinhard;
export { _e_reinhard as reinhard };
const _e_reinhardExtended = _sharedExports.reinhardExtended;
export { _e_reinhardExtended as reinhardExtended };
const _e_filmicACES = _sharedExports.filmicACES;
export { _e_filmicACES as filmicACES };
const _e_highlightRollOff = _sharedExports.highlightRollOff;
export { _e_highlightRollOff as highlightRollOff };
export default _sharedExports;
