/**
 * GLSL Split Toning Functions
 * 
 * 分离色调处理：高光/中间调/阴影着色
 * 支持独立的色相和饱和度控制，以及整体平衡调整
 * 
 * 算法匹配 CPU filmLabSplitTone.js：
 * - Rec.709 亮度系数
 * - Hermite smoothstep 区域过渡 (手动实现，非 GLSL 内置)
 * - Lerp-to-tint 混合 (非 multiply-blend)
 * - balance / 2.0 偏移 (非 balance * 0.15)
 * - 固定区域边界: shadowEnd=0.25, highlightStart=0.75
 * 
 * @version 2.0.0 — 修复 BUG-03/08/09，与 CPU/GPU Export 路径一致
 */

const SPLIT_TONE_GLSL = `
// ============================================================================
// Split Toning — matches CPU filmLabSplitTone.js
// ============================================================================

// calcLuminance is defined in colorMath.js (Rec.709: 0.2126/0.7152/0.0722).
// Do NOT re-declare here — GLSL rejects duplicate function definitions, causing
// "function already has a body" shader compile error at runtime.
// (Pre-existing bug found by v4 E2E browser test with swiftshader WebGL.)

// Hermite smoothstep for zone weight transitions (NOT GLSL built-in)
float splitToneSmoothstep(float t) {
  t = clamp(t, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec3 applySplitTone(vec3 color) {
  float lum = calcLuminance(color);

  // Zone weights (matching CPU calculateZoneWeights — partition of unity,
  // shadow + midtone + highlight ≡ 1, continuous smoothstep transitions)
  // balance is in [-1, 1] range (pre-divided by 100 on JS side)
  float balanceOffset = u_splitBalance / 2.0;
  float shadowEnd = 0.25;
  float highlightStart = 0.75;
  float midpoint = clamp(0.5 + balanceOffset, shadowEnd + 0.05, highlightStart - 0.05);

  float shadowWeight = 0.0;
  float highlightWeight = 0.0;

  // Shadow zone: 1 below shadowEnd, smooth ramp to 0 at midpoint
  if (lum <= shadowEnd) {
    shadowWeight = 1.0;
  } else if (lum < midpoint) {
    float d = midpoint - shadowEnd;
    float st = splitToneSmoothstep((lum - shadowEnd) / d);
    shadowWeight = 1.0 - st;
  }

  // Highlight zone: 1 above highlightStart, smooth ramp from 0 at midpoint
  if (lum >= highlightStart) {
    highlightWeight = 1.0;
  } else if (lum > midpoint) {
    float d = highlightStart - midpoint;
    highlightWeight = splitToneSmoothstep((lum - midpoint) / d);
  }

  // Midtone takes the remainder — weights always sum to 1
  float midtoneWeight = 1.0 - shadowWeight - highlightWeight;

  // Generate tint colors (hue is 0-1 range, pre-divided by 360 on JS side)
  vec3 highlightTint = hsl2rgb(vec3(u_splitHighlightHue * 360.0, 1.0, 0.5));
  vec3 midtoneTint = hsl2rgb(vec3(u_splitMidtoneHue * 360.0, 1.0, 0.5));
  vec3 shadowTint = hsl2rgb(vec3(u_splitShadowHue * 360.0, 1.0, 0.5));

  // Lerp-to-tint blend (matching CPU: result + (tint - result) * strength * 0.3)
  // NOT multiply-blend — lerp preserves luminance better
  vec3 result = color;
  if (shadowWeight > 0.0 && u_splitShadowSat > 0.0) {
    float strength = u_splitShadowSat * shadowWeight;
    result += (shadowTint - result) * strength * 0.3;
  }
  if (midtoneWeight > 0.0 && u_splitMidtoneSat > 0.0) {
    float strength = u_splitMidtoneSat * midtoneWeight;
    result += (midtoneTint - result) * strength * 0.3;
  }
  if (highlightWeight > 0.0 && u_splitHighlightSat > 0.0) {
    float strength = u_splitHighlightSat * highlightWeight;
    result += (highlightTint - result) * strength * 0.3;
  }
  return clamp(result, 0.0, 1.0);
}
`;

const _sharedExports = {
  SPLIT_TONE_GLSL,
};
const _e_SPLIT_TONE_GLSL = _sharedExports.SPLIT_TONE_GLSL;
export { _e_SPLIT_TONE_GLSL as SPLIT_TONE_GLSL };
export default _sharedExports;
