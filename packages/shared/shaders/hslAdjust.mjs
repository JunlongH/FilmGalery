/**
 * GLSL HSL Adjustment Functions
 * 
 * 8通道 HSL 调整：红/橙/黄/绿/青/蓝/紫/洋红
 * 每个通道可独立调整色相偏移、饱和度、明度
 * 
 * 算法匹配 CPU filmLabHSL.js：
 * - 余弦平滑权重过渡
 * - 非对称饱和度映射 (正值：向1扩展，负值：向0压缩)
 * - 非对称明度映射 (带0.5阻尼因子)
 * - 重叠通道权重归一化
 * - 洋红中心色相 330° (匹配 HSL_CHANNELS 定义)
 * 
 * @version 2.0.0 — 修复 BUG-04/05/06/07，与 CPU/GPU Export 路径一致
 */

const HSL_ADJUST_GLSL = `
// ============================================================================
// HSL Channel Weight Calculation
// Cosine smooth transition: 0.5*(1+cos(t*PI))  — matches CPU filmLabHSL.js
// ============================================================================

float hslChannelWeight(float hue, float centerHue, float hueRange) {
  float dist = min(abs(hue - centerHue), 360.0 - abs(hue - centerHue));
  if (dist >= hueRange) return 0.0;
  float t = dist / hueRange;
  return 0.5 * (1.0 + cos(t * 3.14159265));
}

// ============================================================================
// HSL Adjustment Application
// Matches CPU filmLabHSL.js — asymmetric sat/lum, weight normalization
// ============================================================================

vec3 applyHSLAdjustment(vec3 color) {
  vec3 hsl = rgb2hsl(color);
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;

  float hueAdjust = 0.0;
  float satAdjust = 0.0;
  float lumAdjust = 0.0;
  float totalWeight = 0.0;
  float w;

  // 8 channels: hue centers & ranges from HSL_CHANNELS (filmLabHSL.js)
  // P2-1: ranges adjusted for partition of unity (no weak zones at midpoints)
  w = hslChannelWeight(h, 0.0, 30.0);
  if (w > 0.0) { hueAdjust += u_hslRed.x * w; satAdjust += (u_hslRed.y / 100.0) * w; lumAdjust += (u_hslRed.z / 100.0) * w; totalWeight += w; }
  w = hslChannelWeight(h, 30.0, 30.0);
  if (w > 0.0) { hueAdjust += u_hslOrange.x * w; satAdjust += (u_hslOrange.y / 100.0) * w; lumAdjust += (u_hslOrange.z / 100.0) * w; totalWeight += w; }
  w = hslChannelWeight(h, 60.0, 60.0);
  if (w > 0.0) { hueAdjust += u_hslYellow.x * w; satAdjust += (u_hslYellow.y / 100.0) * w; lumAdjust += (u_hslYellow.z / 100.0) * w; totalWeight += w; }
  w = hslChannelWeight(h, 120.0, 60.0);
  if (w > 0.0) { hueAdjust += u_hslGreen.x * w; satAdjust += (u_hslGreen.y / 100.0) * w; lumAdjust += (u_hslGreen.z / 100.0) * w; totalWeight += w; }
  w = hslChannelWeight(h, 180.0, 60.0);
  if (w > 0.0) { hueAdjust += u_hslCyan.x * w; satAdjust += (u_hslCyan.y / 100.0) * w; lumAdjust += (u_hslCyan.z / 100.0) * w; totalWeight += w; }
  w = hslChannelWeight(h, 240.0, 60.0);
  if (w > 0.0) { hueAdjust += u_hslBlue.x * w; satAdjust += (u_hslBlue.y / 100.0) * w; lumAdjust += (u_hslBlue.z / 100.0) * w; totalWeight += w; }
  w = hslChannelWeight(h, 280.0, 50.0);
  if (w > 0.0) { hueAdjust += u_hslPurple.x * w; satAdjust += (u_hslPurple.y / 100.0) * w; lumAdjust += (u_hslPurple.z / 100.0) * w; totalWeight += w; }
  // Magenta: center 330° (NOT 320°) — matches CPU HSL_CHANNELS definition
  w = hslChannelWeight(h, 330.0, 50.0);
  if (w > 0.0) { hueAdjust += u_hslMagenta.x * w; satAdjust += (u_hslMagenta.y / 100.0) * w; lumAdjust += (u_hslMagenta.z / 100.0) * w; totalWeight += w; }

  // P2-1: Normalize by max(1, totalWeight) — eliminates weak response zones
  // (old code only divided when > 1, leaving midpoints at 25% strength)
  float norm = max(1.0, totalWeight);
  hueAdjust /= norm;
  satAdjust /= norm;
  lumAdjust /= norm;

  if (totalWeight > 0.0) {
    // Continuous saturation ramp: fade hue/sat adjustments for near-gray pixels
    // (replaces the old s<0.05 hard switch in CPU — keeps both paths identical)
    float rampT = clamp(s / 0.1, 0.0, 1.0);
    float satRamp = rampT * rampT * (3.0 - 2.0 * rampT);
    hueAdjust *= satRamp;
    satAdjust *= satRamp;

    hsl.x = mod(hsl.x + hueAdjust, 360.0);

    // Asymmetric saturation (BUG-04 fix — matches CPU filmLabHSL.js)
    // Positive: expand toward 1.0;  Negative: compress toward 0.0
    if (satAdjust > 0.0) {
      hsl.y = s + (1.0 - s) * satAdjust;
    } else if (satAdjust < 0.0) {
      hsl.y = s * (1.0 + satAdjust);
    }
    hsl.y = clamp(hsl.y, 0.0, 1.0);

    // Luminance: linear delta for near-gray (legacy gray behavior), asymmetric
    // delta for saturated pixels, continuously blended by satRamp (matches CPU)
    float linearDelta = lumAdjust * 0.5;
    float asymDelta = lumAdjust > 0.0 ? (1.0 - l) * lumAdjust * 0.5 : l * lumAdjust * 0.5;
    hsl.z = clamp(l + mix(linearDelta, asymDelta, satRamp), 0.0, 1.0);
  }

  return hsl2rgb(hsl);
}
`;

export {
  HSL_ADJUST_GLSL,
}