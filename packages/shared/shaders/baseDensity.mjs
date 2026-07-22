/**
 * GLSL Base Density Correction Functions
 * 
 * 片基校正处理（密度域减法模式 / 线性增益模式）
 * 以及密度域自动电平（Density Levels）
 */

const BASE_DENSITY_GLSL = `
// ============================================================================
// Base Density Correction
// ============================================================================

// Correct for film base color (orange mask for C-41, etc.)
//
// Two modes:
// - Linear (u_baseMode == 0): Simple RGB gain multiplication
// - Log (u_baseMode == 1): Density domain subtraction (more accurate)
//
vec3 applyBaseDensityCorrection(vec3 col) {
  if (u_baseMode > 0.5) {
    // Log mode: density domain subtraction
    // D = -log10(T), then subtract base density, then convert back
    float minT = 0.001;
    float log10 = log(10.0);
    
    // Red channel
    float Tr = max(col.r, minT);
    float Dr = -log(Tr) / log10;
    float Dr_corrected = Dr - u_baseDensity.r;
    col.r = pow(10.0, -Dr_corrected);
    
    // Green channel
    float Tg = max(col.g, minT);
    float Dg = -log(Tg) / log10;
    float Dg_corrected = Dg - u_baseDensity.g;
    col.g = pow(10.0, -Dg_corrected);
    
    // Blue channel
    float Tb = max(col.b, minT);
    float Db = -log(Tb) / log10;
    float Db_corrected = Db - u_baseDensity.b;
    col.b = pow(10.0, -Db_corrected);
    
    col = clamp(col, 0.0, 1.0);
  } else {
    // Linear mode: simple gain multiplication (legacy compatible)
    col = col * u_baseGains;
    col = clamp(col, 0.0, 1.0);
  }
  
  return col;
}

// ============================================================================
// Density Levels (Log Domain Per-Channel Normalization)
// ============================================================================

// Normalize each channel's [Dmin, Dmax] to a common output range.
// This "flattens" the RGB channels, compensating for:
// 1. Orange mask in color negative film
// 2. Different dye characteristics per layer
// 3. Scanner/light source color imbalance
//
// The output range is set to the average of the three input ranges,
// which preserves overall contrast while normalizing channel balance.
//
vec3 applyDensityLevels(vec3 col) {
  if (u_densityLevelsEnabled < 0.5) return col;
  
  float minT = 0.001;
  float log10 = log(10.0);
  
  // Calculate average range across channels for output scaling
  float rangeR = u_densityLevelsMax.r - u_densityLevelsMin.r;
  float rangeG = u_densityLevelsMax.g - u_densityLevelsMin.g;
  float rangeB = u_densityLevelsMax.b - u_densityLevelsMin.b;
  float avgRange = (rangeR + rangeG + rangeB) / 3.0;
  // Clamp average range to reasonable bounds
  avgRange = max(avgRange, 0.5);  // Minimum 0.5 to avoid extreme compression
  avgRange = min(avgRange, 2.5);  // Maximum 2.5 to avoid extreme expansion
  
  // Red channel
  float Tr = max(col.r, minT);
  float Dr = -log(Tr) / log10;
  if (rangeR > 0.001) {
    float normR = clamp((Dr - u_densityLevelsMin.r) / rangeR, 0.0, 1.0);
    float DrNew = normR * avgRange;
    col.r = pow(10.0, -DrNew);
  }
  
  // Green channel
  float Tg = max(col.g, minT);
  float Dg = -log(Tg) / log10;
  if (rangeG > 0.001) {
    float normG = clamp((Dg - u_densityLevelsMin.g) / rangeG, 0.0, 1.0);
    float DgNew = normG * avgRange;
    col.g = pow(10.0, -DgNew);
  }
  
  // Blue channel
  float Tb = max(col.b, minT);
  float Db = -log(Tb) / log10;
  if (rangeB > 0.001) {
    float normB = clamp((Db - u_densityLevelsMin.b) / rangeB, 0.0, 1.0);
    float DbNew = normB * avgRange;
    col.b = pow(10.0, -DbNew);
  }
  
  return clamp(col, 0.0, 1.0);
}
`;

export {
  BASE_DENSITY_GLSL,
}