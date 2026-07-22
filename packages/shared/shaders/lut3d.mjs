/**
 * GLSL 3D LUT Sampling Functions
 * 
 * 3D LUT 采样（使用打包到2D纹理的方式，兼容 WebGL 1.0）
 * 打包格式：width = size, height = size * size
 * UV映射：x = r / size, y = (g + b * size) / (size * size)
 */

const LUT3D_GLSL = `
// ============================================================================
// 3D LUT Sampling (Packed 2D Texture)
// ============================================================================

// Sample a 3D LUT that has been packed into a 2D texture
// 
// Packing format:
// - Width: LUT size (e.g., 33 for a 33x33x33 LUT)
// - Height: size * size
// - Each row contains one "slice" of the blue channel
//
// Trilinear interpolation for smooth color transitions
//
vec3 sampleLUT3D(vec3 c) {
  float sz = u_lutSize;
  
  // Map input to [0, size-1] range
  float rf = c.r * (sz - 1.0);
  float gf = c.g * (sz - 1.0);
  float bf = c.b * (sz - 1.0);
  
  // Floor values for grid positions
  float r0 = floor(rf);
  float g0 = floor(gf);
  float b0 = floor(bf);
  float r1 = min(sz - 1.0, r0 + 1.0);
  float g1 = min(sz - 1.0, g0 + 1.0);
  float b1 = min(sz - 1.0, b0 + 1.0);
  
  // Fractional parts for interpolation
  float fr = rf - r0;
  float fg = gf - g0;
  float fb = bf - b0;
  
  // Sample 8 corners of the cube
  vec3 c000, c100, c010, c110, c001, c101, c011, c111;
  vec2 uv;
  
  // Helper: UV for packed LUT
  // x = (r + 0.5) / size
  // y = (g + b * size + 0.5) / (size * size)
  
  uv.x = (r0 + 0.5) / sz;
  uv.y = (g0 + b0 * sz + 0.5) / (sz * sz);
  c000 = texture2D(u_lut3d, uv).rgb;
  
  uv.x = (r1 + 0.5) / sz;
  uv.y = (g0 + b0 * sz + 0.5) / (sz * sz);
  c100 = texture2D(u_lut3d, uv).rgb;
  
  uv.x = (r0 + 0.5) / sz;
  uv.y = (g1 + b0 * sz + 0.5) / (sz * sz);
  c010 = texture2D(u_lut3d, uv).rgb;
  
  uv.x = (r1 + 0.5) / sz;
  uv.y = (g1 + b0 * sz + 0.5) / (sz * sz);
  c110 = texture2D(u_lut3d, uv).rgb;
  
  uv.x = (r0 + 0.5) / sz;
  uv.y = (g0 + b1 * sz + 0.5) / (sz * sz);
  c001 = texture2D(u_lut3d, uv).rgb;
  
  uv.x = (r1 + 0.5) / sz;
  uv.y = (g0 + b1 * sz + 0.5) / (sz * sz);
  c101 = texture2D(u_lut3d, uv).rgb;
  
  uv.x = (r0 + 0.5) / sz;
  uv.y = (g1 + b1 * sz + 0.5) / (sz * sz);
  c011 = texture2D(u_lut3d, uv).rgb;
  
  uv.x = (r1 + 0.5) / sz;
  uv.y = (g1 + b1 * sz + 0.5) / (sz * sz);
  c111 = texture2D(u_lut3d, uv).rgb;
  
  // Trilinear interpolation
  vec3 c00 = mix(c000, c100, fr);
  vec3 c10 = mix(c010, c110, fr);
  vec3 c01 = mix(c001, c101, fr);
  vec3 c11 = mix(c011, c111, fr);
  
  vec3 c0 = mix(c00, c10, fg);
  vec3 c1 = mix(c01, c11, fg);
  
  return mix(c0, c1, fb);
}
`;

export {
  LUT3D_GLSL,
}