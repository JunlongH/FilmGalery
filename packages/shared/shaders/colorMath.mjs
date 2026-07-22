/**
 * GLSL Color Math Functions
 * 
 * RGB/HSL 转换及亮度计算等基础数学函数
 */

const COLOR_MATH_GLSL = `
// ============================================================================
// RGB <-> HSL Conversion
// ============================================================================

vec3 rgb2hsl(vec3 c) {
  float maxC = max(max(c.r, c.g), c.b);
  float minC = min(min(c.r, c.g), c.b);
  float l = (maxC + minC) / 2.0;
  
  if (maxC == minC) {
    return vec3(0.0, 0.0, l);
  }
  
  float d = maxC - minC;
  float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
  
  float h;
  if (maxC == c.r) {
    h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  } else if (maxC == c.g) {
    h = (c.b - c.r) / d + 2.0;
  } else {
    h = (c.r - c.g) / d + 4.0;
  }
  h /= 6.0;
  
  return vec3(h * 360.0, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0/2.0) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  float h = mod(hsl.x, 360.0) / 360.0;
  float s = clamp(hsl.y, 0.0, 1.0);
  float l = clamp(hsl.z, 0.0, 1.0);
  
  if (s == 0.0) {
    return vec3(l);
  }
  
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  
  float r = hue2rgb(p, q, h + 1.0/3.0);
  float g = hue2rgb(p, q, h);
  float b = hue2rgb(p, q, h - 1.0/3.0);
  
  return vec3(r, g, b);
}

// ============================================================================
// Luminance Calculation
// ============================================================================

// Rec. 709 luminance coefficients
float calcLuminance(vec3 c) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

// Alternative: Rec. 601 coefficients (legacy)
float calcLuminance601(vec3 c) {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

// ============================================================================
// sRGB <-> Linear transfer functions (IEC 61966-2-1)
// 与 packages/shared/render/math/color-space.js 数值一致；用于 Phase I 线性域反转
// ============================================================================

// 单通道 sRGB → linear（负值 clamp 到 0）
float srgbToLinear1(float srgb) {
  srgb = max(srgb, 0.0);
  if (srgb <= 0.04045) return srgb / 12.92;
  return pow((srgb + 0.055) / 1.055, 2.4);
}

// 单通道 linear → sRGB（负值 clamp 到 0）
float linearToSrgb1(float linear) {
  linear = max(linear, 0.0);
  if (linear <= 0.0031308) return linear * 12.92;
  return 1.055 * pow(linear, 1.0 / 2.4) - 0.055;
}

vec3 srgbToLinear(vec3 c) {
  return vec3(srgbToLinear1(c.r), srgbToLinear1(c.g), srgbToLinear1(c.b));
}

vec3 linearToSrgb(vec3 c) {
  return vec3(linearToSrgb1(c.r), linearToSrgb1(c.g), linearToSrgb1(c.b));
}
`;

const _sharedExports = {
  COLOR_MATH_GLSL,
};
export const { COLOR_MATH_GLSL } = _sharedExports;
export default _sharedExports;
