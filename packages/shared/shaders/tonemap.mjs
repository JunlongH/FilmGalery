/**
 * GLSL Tone Mapping Functions
 * 
 * 色调映射：对比度、曝光、高光/阴影、白/黑电平、曲线LUT、高光压缩
 * 
 * 算法匹配 CPU RenderCore.processPixelFloat()：
 * - 对比度以感知中灰 0.46 为中心 (18% 反射率)
 * - Bernstein basis 阴影/高光恢复
 * - tanh 高光滚降压缩 (threshold=0.8)
 * 
 * @version 2.0.0 — 修复对比度中灰点，添加高光压缩
 */

const TONEMAP_GLSL = `
// ============================================================================
// Contrast — around perceptual mid-gray (0.46, matching CPU CONTRAST_MID_GRAY)
// ============================================================================

vec3 applyContrast(vec3 c, float contrast) {
  // contrast is UI value -100..100, scale to -255..255 for the standard formula
  float C = contrast * 2.55;
  float factor = (259.0 * (C + 255.0)) / (255.0 * (259.0 - C));
  float midGray = 0.46;
  return (c - vec3(midGray)) * factor + vec3(midGray);
}

// ============================================================================
// Highlights & Shadows — Bernstein basis (matches CPU RenderCore)
// ============================================================================

vec3 applyHighlightsShadows(vec3 c) {
  float sFactor = u_shadows * 0.005;
  float hFactor = u_highlights * 0.005;

  // Bernstein 基函数在 clamp 后的值上计算（匹配 CPU processPixelFloat），
  // 避免 c 超出 [0,1] 时权重符号反转；增量仍加到未 clamp 的 c 上
  vec3 cc = clamp(c, 0.0, 1.0);

  if (sFactor != 0.0) {
    c += sFactor * pow(1.0 - cc, vec3(2.0)) * cc * 4.0;
  }

  if (hFactor != 0.0) {
    c += hFactor * pow(cc, vec3(2.0)) * (1.0 - cc) * 4.0;
  }

  return c;
}

// ============================================================================
// Whites & Blacks (Level Adjustment)
// ============================================================================

vec3 applyWhitesBlacks(vec3 c) {
  float blackPoint = -(u_blacks) * 0.002;
  float whitePoint = 1.0 - (u_whites) * 0.002;
  
  if (whitePoint != blackPoint) {
    c = (c - vec3(blackPoint)) / (whitePoint - blackPoint);
  }
  
  return c;
}

// ============================================================================
// Highlight Roll-Off — C² continuous tanh shoulder compression
// Matches CPU MathOps.highlightRollOff()
// ============================================================================

vec3 applyHighlightRollOff(vec3 c) {
  float maxVal = max(c.r, max(c.g, c.b));
  float threshold = 0.8;
  if (maxVal > threshold) {
    float headroom = 1.0 - threshold;
    float tRO = min((maxVal - threshold) / headroom, 10.0);
    float e2t = exp(2.0 * tRO);
    float tanhT = (e2t - 1.0) / (e2t + 1.0);
    float compressed = threshold + headroom * tanhT;
    c *= (compressed / maxVal);
  }
  return c;
}

// ============================================================================
// 1D Curve LUT Sampling
// ============================================================================

float sampleCurve(sampler2D t, float v) {
  return texture2D(t, vec2(v, 0.5)).r;
}

vec3 applyCurvesLUT(vec3 c) {
  float r = sampleCurve(u_curveRGB, c.r);
  float g = sampleCurve(u_curveRGB, c.g);
  float b = sampleCurve(u_curveRGB, c.b);
  
  r = sampleCurve(u_curveR, r);
  g = sampleCurve(u_curveG, g);
  b = sampleCurve(u_curveB, b);
  
  return vec3(r, g, b);
}
`;

export { TONEMAP_GLSL };