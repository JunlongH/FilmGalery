/**
 * GLSL Inversion Functions
 * 
 * 负片反转处理（线性/对数模式）
 */

const INVERSION_GLSL = `
// ============================================================================
// Negative Inversion
// ============================================================================

// Apply negative inversion
// 
// Two modes:
// - Linear (u_inversionMode == 0): Simple subtraction from 1.0
// - Log (u_inversionMode == 1): Logarithmic inversion for better shadow detail
//
vec3 applyInversion(vec3 col) {
  if (u_inverted < 0.5) return col;
  
  vec3 c255 = col * 255.0;
  
  if (u_inversionMode > 0.5) {
    // Log inversion: preserves more shadow detail
    // Formula: 255 * (1 - log(x + 1) / log(256))
    c255.r = 255.0 * (1.0 - log(c255.r + 1.0) / log(256.0));
    c255.g = 255.0 * (1.0 - log(c255.g + 1.0) / log(256.0));
    c255.b = 255.0 * (1.0 - log(c255.b + 1.0) / log(256.0));
  } else {
    // Linear inversion: simple subtraction
    c255 = vec3(255.0) - c255;
  }
  
  return c255 / 255.0;
}
`;

const _sharedExports = {
  INVERSION_GLSL,
};
const _e_INVERSION_GLSL = _sharedExports.INVERSION_GLSL;
export { _e_INVERSION_GLSL as INVERSION_GLSL };
export default _sharedExports;
