/**
 * Camera utilities for Vision Camera
 * Provides helper functions for exposure calculation, format selection, etc.
 */

// Standard Aperture stops (1/3 stops)
export const APERTURES = [
  1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5, 2.8, 3.2, 3.5, 4.0, 4.5, 5.0, 5.6, 
  6.3, 7.1, 8.0, 9.0, 10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32
];

// Standard Shutter speeds (1/3 stops)
export const SHUTTERS = [
  '1/8000', '1/6400', '1/5000', '1/4000', '1/3200', '1/2500', '1/2000', '1/1600', 
  '1/1250', '1/1000', '1/800', '1/640', '1/500', '1/400', '1/320', '1/250', '1/200', 
  '1/160', '1/125', '1/100', '1/80', '1/60', '1/50', '1/40', '1/30', '1/25', '1/20', 
  '1/15', '1/13', '1/10', '1/8', '1/6', '1/5', '1/4', '1/3', '0.4', '0.5', '0.6', 
  '0.8', '1', '1.3', '1.6', '2', '2.5', '3.2', '4', '5', '6', '8', '10', '13', '15', 
  '20', '25', '30'
];

/**
 * Parse shutter speed string to numeric value
 * @param {string|number} s - Shutter speed (e.g., "1/125" or 2)
 * @returns {number} - Numeric shutter speed value
 */
export function parseShutter(s) {
  if (typeof s === 'string' && s.includes('/')) {
    const [n, d] = s.split('/');
    return Number(n) / Number(d);
  }
  return Number(s);
}

/**
 * Calculate EV from camera metadata
 * @param {object} metadata - Camera metadata from frame
 * @param {number} filmIso - Target film ISO
 * @returns {number|null} - Calculated EV or null if insufficient data
 */
export function calculateEV(metadata, filmIso) {
  if (!metadata || !metadata.iso || !metadata.exposureTime) {
    return null;
  }

  const iso = metadata.iso;
  const shutterSpeed = metadata.exposureTime;
  const aperture = metadata.aperture || 1.8; // Fallback to typical mobile aperture

  // Calculate EV100 (EV at ISO 100)
  const ev100 = Math.log2((aperture * aperture) / shutterSpeed) - Math.log2(iso / 100);
  
  // Adjust for target film ISO
  const targetEV = ev100 + Math.log2(filmIso / 100);
  
  return targetEV;
}

/**
 * Find closest shutter speed from standard values
 * @param {number} targetT - Target shutter speed (numeric)
 * @returns {string} - Closest standard shutter speed
 */
export function findClosestShutter(targetT) {
  let closest = SHUTTERS[0];
  let minDiff = Infinity;
  
  SHUTTERS.forEach(s => {
    const val = parseShutter(s);
    const diff = Math.abs(val - targetT);
    if (diff < minDiff) {
      minDiff = diff;
      closest = s;
    }
  });
  
  return closest;
}

/**
 * Generate valid aperture/shutter pairs for target EV
 * @param {number} targetEV - Target exposure value
 * @returns {Array<{f: number, s: string}>} - Array of valid pairs
 */
export function generateValidPairs(targetEV) {
  const pairs = [];
  
  APERTURES.forEach(f => {
    // Calculate required shutter speed: t = f^2 / 2^EV
    const t = (f * f) / Math.pow(2, targetEV);
    const sStr = findClosestShutter(t);
    const sVal = parseShutter(sStr);
    
    // Verify if this pair is close enough to target EV (within 0.5 EV)
    const pairEV = Math.log2((f * f) / sVal);
    if (Math.abs(pairEV - targetEV) < 0.5) {
      pairs.push({ f, s: sStr });
    }
  });
  
  return pairs;
}

/**
 * Point & Shoot exposure calculation
 * @param {number} ev - Measured EV
 * @param {string} flashMode - 'auto' | 'on' | 'off'
 * @param {number} maxAperture - Maximum aperture of lens
 * @returns {object} - Recommended settings {s: string, f: number, flash: boolean}
 */
export function calculatePSExposure(ev, flashMode, maxAperture) {
  const BRIGHT_THRESHOLD = 12;
  const DARK_THRESHOLD = 8;
  const SYNC_SHUTTER = '1/60';
  
  let s = '1/125';
  let f = 8.0;
  let flash = false;

  if (ev >= BRIGHT_THRESHOLD) {
    // Bright scene: Small aperture, fast shutter
    s = '1/250';
    f = 11;
    flash = false;
  } else if (ev >= DARK_THRESHOLD) {
    // Medium light: Open aperture, moderate shutter
    s = '1/60';
    f = Math.max(maxAperture, 3.5);

    if (flashMode === 'on') {
      flash = true;
      s = SYNC_SHUTTER;
      f = 5.6;
    }
  } else {
    // Dark scene
    if (flashMode === 'auto' || flashMode === 'on') {
      flash = true;
      s = SYNC_SHUTTER;
      f = 5.6;
    } else {
      // No flash, long exposure
      s = '1/4';
      f = maxAperture;
      flash = false;
    }
  }

  return { s, f, flash };
}

/**
 * Get best camera format for metering
 * @param {Array} formats - Available camera formats
 * @returns {object|null} - Best format or null
 */
export function getBestFormat(formats) {
  if (!formats || formats.length === 0) return null;

  // Prioritize:
  // 1. 30 FPS
  // 2. 4:3 aspect ratio
  // 3. Reasonable resolution (not too high to avoid performance issues)
  
  const filtered = formats.filter(f => {
    const fps = f.maxFps || f.frameRateRanges?.[0]?.maxFrameRate || 0;
    const width = f.videoWidth || f.photoWidth || 0;
    const height = f.videoHeight || f.photoHeight || 0;
    
    return fps >= 30 && width > 0 && height > 0 && width <= 1920;
  });

  if (filtered.length === 0) return formats[0];

  // Sort by aspect ratio closeness to 4:3
  filtered.sort((a, b) => {
    const ratioA = (a.videoWidth || a.photoWidth) / (a.videoHeight || a.photoHeight);
    const ratioB = (b.videoWidth || b.photoWidth) / (b.videoHeight || b.photoHeight);
    const target = 4 / 3;
    
    return Math.abs(ratioA - target) - Math.abs(ratioB - target);
  });

  return filtered[0];
}
