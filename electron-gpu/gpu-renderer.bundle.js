"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // packages/shared/filmLabConstants.js
  var require_filmLabConstants = __commonJS({
    "packages/shared/filmLabConstants.js"(exports, module) {
      var PREVIEW_MAX_WIDTH_SERVER = 1400;
      var PREVIEW_MAX_WIDTH_CLIENT = 1200;
      var EXPORT_MAX_WIDTH = 8e3;
      var DEFAULT_TONE_PARAMS = {
        exposure: 0,
        // -100 to 100
        contrast: 0,
        // -100 to 100
        highlights: 0,
        // -100 to 100
        shadows: 0,
        // -100 to 100
        whites: 0,
        // -100 to 100
        blacks: 0
        // -100 to 100
      };
      var CONTRAST_MID_GRAY = 0.46;
      var DEFAULT_WB_PARAMS = {
        red: 1,
        green: 1,
        blue: 1,
        temp: 0,
        // -100 to 100 (Blue <-> Yellow)
        tint: 0
        // -100 to 100 (Green <-> Magenta)
      };
      var INVERSION_MODE_LABELS = {
        linear: "Linear",
        // 标准线性反转
        log: "Soft"
        // 对数压缩反转 (原 Log)，保留更多阴影细节
      };
      var WB_GAIN_LIMITS = {
        min: 0.05,
        max: 50
      };
      var DEFAULT_INVERSION_PARAMS = {
        inverted: false,
        inversionMode: "linear"
        // 'linear' | 'log' | 'film'
      };
      var DEFAULT_CURVES = {
        rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }]
      };
      var DEFAULT_CROP_RECT = { x: 0, y: 0, w: 1, h: 1 };
      var JPEG_QUALITY = {
        preview: 85,
        export: 95,
        maximum: 100
      };
      var WEBGL_DEBOUNCE_MS = 100;
      var DEBUG = false;
      var FILM_PROFILES = {
        // 彩色负片 — per-channel gamma 模拟不同乳剂层感光特性
        portra160: { gamma: 0.58, gammaR: 0.56, gammaG: 0.58, gammaB: 0.54, dMin: 0.1, dMax: 2.8, toe: 0.3, shoulder: 0.2, name: "Kodak Portra 160" },
        portra400: { gamma: 0.6, gammaR: 0.58, gammaG: 0.6, gammaB: 0.55, dMin: 0.12, dMax: 3, toe: 0.3, shoulder: 0.2, name: "Kodak Portra 400" },
        portra800: { gamma: 0.62, gammaR: 0.6, gammaG: 0.62, gammaB: 0.57, dMin: 0.15, dMax: 3.2, toe: 0.35, shoulder: 0.25, name: "Kodak Portra 800" },
        ektar100: { gamma: 0.55, gammaR: 0.53, gammaG: 0.55, gammaB: 0.51, dMin: 0.08, dMax: 3, toe: 0.25, shoulder: 0.3, name: "Kodak Ektar 100" },
        gold200: { gamma: 0.58, gammaR: 0.56, gammaG: 0.58, gammaB: 0.54, dMin: 0.12, dMax: 2.9, toe: 0.3, shoulder: 0.2, name: "Kodak Gold 200" },
        colorplus200: { gamma: 0.57, gammaR: 0.55, gammaG: 0.57, gammaB: 0.53, dMin: 0.11, dMax: 2.8, toe: 0.3, shoulder: 0.2, name: "Kodak ColorPlus 200" },
        pro400h: { gamma: 0.6, gammaR: 0.58, gammaG: 0.6, gammaB: 0.56, dMin: 0.12, dMax: 3, toe: 0.25, shoulder: 0.2, name: "Fuji Pro 400H" },
        superia400: { gamma: 0.58, gammaR: 0.56, gammaG: 0.58, gammaB: 0.54, dMin: 0.13, dMax: 2.9, toe: 0.3, shoulder: 0.2, name: "Fuji Superia 400" },
        c200: { gamma: 0.56, gammaR: 0.54, gammaG: 0.56, gammaB: 0.52, dMin: 0.1, dMax: 2.8, toe: 0.3, shoulder: 0.2, name: "Fuji C200" },
        // 黑白负片 — 单一 gamma (各层感光特性相同)
        trix400: { gamma: 0.65, dMin: 0.15, dMax: 2.8, toe: 0.35, shoulder: 0.25, name: "Kodak Tri-X 400" },
        tmax100: { gamma: 0.62, dMin: 0.1, dMax: 2.6, toe: 0.2, shoulder: 0.15, name: "Kodak T-Max 100" },
        tmax400: { gamma: 0.64, dMin: 0.12, dMax: 2.8, toe: 0.25, shoulder: 0.2, name: "Kodak T-Max 400" },
        hp5: { gamma: 0.63, dMin: 0.14, dMax: 2.7, toe: 0.3, shoulder: 0.2, name: "Ilford HP5+" },
        delta100: { gamma: 0.6, dMin: 0.08, dMax: 2.5, toe: 0.2, shoulder: 0.15, name: "Ilford Delta 100" },
        delta400: { gamma: 0.62, dMin: 0.1, dMax: 2.7, toe: 0.25, shoulder: 0.2, name: "Ilford Delta 400" },
        acros100: { gamma: 0.6, dMin: 0.09, dMax: 2.6, toe: 0.2, shoulder: 0.15, name: "Fuji Acros 100" },
        // 默认 (通用 — 无 toe/shoulder，向后兼容)
        default: { gamma: 0.6, dMin: 0.1, dMax: 3, toe: 0, shoulder: 0, name: "Generic Film" }
      };
      var REFERENCE_WHITE_POINTS = {
        D50: 5e3,
        // 印刷标准
        D55: 5500,
        // 中间色温
        D65: 6500,
        // 日光 (sRGB 标准)
        D75: 7500,
        // 北方天光
        A: 2856,
        // 钨丝灯
        F2: 4230,
        // 冷白色荧光灯
        F11: 4e3
        // 窄带荧光灯
      };
      var TEMP_SLIDER_CONFIG = {
        min: -100,
        max: 100,
        // 滑块值映射到开尔文: baseKelvin + (sliderValue * kelvinPerUnit)
        baseKelvin: 6500,
        // D65 作为中性点
        kelvinPerUnit: 40
        // 每单位 40K，范围 2500K - 10500K
      };
      module.exports = {
        PREVIEW_MAX_WIDTH_SERVER,
        PREVIEW_MAX_WIDTH_CLIENT,
        EXPORT_MAX_WIDTH,
        DEFAULT_TONE_PARAMS,
        CONTRAST_MID_GRAY,
        DEFAULT_WB_PARAMS,
        INVERSION_MODE_LABELS,
        DEFAULT_INVERSION_PARAMS,
        DEFAULT_CURVES,
        DEFAULT_CROP_RECT,
        WB_GAIN_LIMITS,
        JPEG_QUALITY,
        WEBGL_DEBOUNCE_MS,
        DEBUG,
        FILM_PROFILES,
        REFERENCE_WHITE_POINTS,
        TEMP_SLIDER_CONFIG
      };
    }
  });

  // packages/shared/filmLabWhiteBalance.js
  var require_filmLabWhiteBalance = __commonJS({
    "packages/shared/filmLabWhiteBalance.js"(exports, module) {
      var {
        DEFAULT_WB_PARAMS,
        WB_GAIN_LIMITS,
        TEMP_SLIDER_CONFIG,
        REFERENCE_WHITE_POINTS
      } = require_filmLabConstants();
      function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
      }
      function kelvinToRGB(kelvin) {
        kelvin = clamp(kelvin, 1e3, 4e4);
        let xD, yD;
        if (kelvin >= 4e3 && kelvin <= 25e3) {
          const T = kelvin;
          const T2 = T * T;
          const T3 = T2 * T;
          if (T <= 7e3) {
            xD = -4607e6 / T3 + 2967800 / T2 + 99.11 / T + 0.244063;
          } else {
            xD = -20064e5 / T3 + 1901800 / T2 + 247.48 / T + 0.23704;
          }
          yD = -3 * xD * xD + 2.87 * xD - 0.275;
        } else {
          const T = kelvin;
          const T2 = T * T;
          const T3 = T2 * T;
          if (T < 4e3) {
            xD = -266123900 / T3 - 234358.9 / T2 + 877.6956 / T + 0.17991;
            yD = -1.1063814 * xD * xD * xD - 1.3481102 * xD * xD + 2.18555832 * xD - 0.20219683;
            if (T > 3500) {
              const blend = (T - 3500) / 500;
              const xD_cie = -4607e6 / (4e3 * 4e3 * 4e3) + 2967800 / (4e3 * 4e3) + 99.11 / 4e3 + 0.244063;
              const yD_cie = -3 * xD_cie * xD_cie + 2.87 * xD_cie - 0.275;
              xD = xD * (1 - blend) + xD_cie * blend;
              yD = yD * (1 - blend) + yD_cie * blend;
            }
          } else {
            xD = -20064e5 / T3 + 1901800 / T2 + 247.48 / T + 0.23704;
            yD = -3 * xD * xD + 2.87 * xD - 0.275;
          }
        }
        const X = xD / yD;
        const Y = 1;
        const Z = (1 - xD - yD) / yD;
        let R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
        let G = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
        let B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
        const maxC = Math.max(R, G, B);
        if (maxC > 0) {
          R /= maxC;
          G /= maxC;
          B /= maxC;
        }
        R = Math.max(0, R);
        G = Math.max(0, G);
        B = Math.max(0, B);
        return [R, G, B];
      }
      function sliderToKelvin(sliderValue) {
        const { baseKelvin, kelvinPerUnit } = TEMP_SLIDER_CONFIG;
        return baseKelvin + sliderValue * kelvinPerUnit;
      }
      function computeWBGains2(params = {}, options = {}) {
        const minGain = options.minGain ?? WB_GAIN_LIMITS.min;
        const maxGain = options.maxGain ?? WB_GAIN_LIMITS.max;
        const useKelvinModel = options.useKelvinModel !== false;
        const R = Number.isFinite(params.red) ? params.red : DEFAULT_WB_PARAMS.red;
        const G = Number.isFinite(params.green) ? params.green : DEFAULT_WB_PARAMS.green;
        const B = Number.isFinite(params.blue) ? params.blue : DEFAULT_WB_PARAMS.blue;
        const T = Number.isFinite(params.temp) ? params.temp : DEFAULT_WB_PARAMS.temp;
        const N = Number.isFinite(params.tint) ? params.tint : DEFAULT_WB_PARAMS.tint;
        let rGain, gGain, bGain;
        if (useKelvinModel) {
          const targetKelvin = sliderToKelvin(T);
          const [rTemp, gTemp, bTemp] = kelvinToRGB(targetKelvin);
          const [rRef, gRef, bRef] = kelvinToRGB(REFERENCE_WHITE_POINTS.D65);
          const rTempGain = rRef / Math.max(1e-3, rTemp);
          const gTempGain = gRef / Math.max(1e-3, gTemp);
          const bTempGain = bRef / Math.max(1e-3, bTemp);
          const n = N / 100;
          const tempScale = Math.max(0.5, Math.min(2, (rTemp + gTemp + bTemp) / 1.5));
          const tintR = 1 + n * 0.15 * tempScale;
          const tintG = 1 - n * 0.3 * tempScale;
          const tintB = 1 + n * 0.15 * tempScale;
          rGain = R * rTempGain * tintR;
          gGain = G * gTempGain * tintG;
          bGain = B * bTempGain * tintB;
          const avgGain = 0.2126 * rGain + 0.7152 * gGain + 0.0722 * bGain;
          if (avgGain > 1e-3) {
            const luminanceCompensation = 1 / avgGain;
            rGain *= luminanceCompensation;
            gGain *= luminanceCompensation;
            bGain *= luminanceCompensation;
          }
        } else {
          const t = T / 100;
          const n = N / 100;
          rGain = R * (1 + t * 0.5 + n * 0.3);
          gGain = G * (1 - n * 0.5);
          bGain = B * (1 - t * 0.5 + n * 0.3);
          const avgGain = 0.2126 * rGain + 0.7152 * gGain + 0.0722 * bGain;
          if (avgGain > 1e-3) {
            const luminanceCompensation = 1 / avgGain;
            rGain *= luminanceCompensation;
            gGain *= luminanceCompensation;
            bGain *= luminanceCompensation;
          }
        }
        if (!Number.isFinite(rGain)) rGain = 1;
        if (!Number.isFinite(gGain)) gGain = 1;
        if (!Number.isFinite(bGain)) bGain = 1;
        rGain = clamp(rGain, minGain, maxGain);
        gGain = clamp(gGain, minGain, maxGain);
        bGain = clamp(bGain, minGain, maxGain);
        return [rGain, gGain, bGain];
      }
      function computeWBGainsLegacy(params = {}, options = {}) {
        return computeWBGains2(params, { ...options, useKelvinModel: false });
      }
      function solveTempTintFromSample(sampleRgb, baseGains = {}) {
        if (!Array.isArray(sampleRgb) || sampleRgb.length < 3) {
          return { temp: 0, tint: 0 };
        }
        const safeSample = sampleRgb.map((v) => {
          const val = Number(v);
          return Number.isFinite(val) ? Math.max(1, val) : 128;
        });
        const base = {
          red: Math.max(0.05, Number.isFinite(baseGains.red) ? baseGains.red : 1),
          green: Math.max(0.05, Number.isFinite(baseGains.green) ? baseGains.green : 1),
          blue: Math.max(0.05, Number.isFinite(baseGains.blue) ? baseGains.blue : 1)
        };
        const [rS, gS, bS] = safeSample;
        const rBase = rS * base.red;
        const gBase = gS * base.green;
        const bBase = bS * base.blue;
        const avgBase = (rBase + gBase + bBase) / 3;
        if (avgBase < 1) return { temp: 0, tint: 0 };
        const maxDev = Math.max(
          Math.abs(rBase - gBase),
          Math.abs(gBase - bBase),
          Math.abs(rBase - bBase)
        ) / avgBase;
        if (maxDev < 0.02) return { temp: 0, tint: 0 };
        const ratioR = gBase / rBase;
        const ratioB = gBase / bBase;
        const sumRatios = ratioR + ratioB;
        const n0 = (sumRatios - 2) / (0.6 + 0.5 * sumRatios);
        const t0 = (ratioR - ratioB) * (1 - n0 * 0.5);
        let t = clamp(t0 * 100, -100, 100);
        let n = clamp(n0 * 100, -100, 100);
        function residuals(temp, tint) {
          const gains = computeWBGains2({
            red: base.red,
            green: base.green,
            blue: base.blue,
            temp,
            tint
          }, { useKelvinModel: true });
          const outR = rS * gains[0];
          const outG = gS * gains[1];
          const outB = bS * gains[2];
          return [outR - outG, outB - outG];
        }
        const EPSILON = 0.05;
        const MAX_ITER = 30;
        const CONVERGE = 0.3;
        const DAMPING = 0.75;
        for (let iter = 0; iter < MAX_ITER; iter++) {
          const [f1, f2] = residuals(t, n);
          if (Math.abs(f1) < CONVERGE && Math.abs(f2) < CONVERGE) break;
          const [f1_dt, f2_dt] = residuals(t + EPSILON, n);
          const [f1_dn, f2_dn] = residuals(t, n + EPSILON);
          const J11 = (f1_dt - f1) / EPSILON;
          const J12 = (f1_dn - f1) / EPSILON;
          const J21 = (f2_dt - f2) / EPSILON;
          const J22 = (f2_dn - f2) / EPSILON;
          const det = J11 * J22 - J12 * J21;
          if (Math.abs(det) < 1e-12) break;
          const dt = -(J22 * f1 - J12 * f2) / det;
          const dn = (J21 * f1 - J11 * f2) / det;
          t = clamp(t + dt * DAMPING, -100, 100);
          n = clamp(n + dn * DAMPING, -100, 100);
        }
        if (!Number.isFinite(t)) t = 0;
        if (!Number.isFinite(n)) n = 0;
        const finalGains = computeWBGains2({
          red: base.red,
          green: base.green,
          blue: base.blue,
          temp: t,
          tint: n
        }, { useKelvinModel: true });
        const isExtreme = finalGains.some((g) => g < 0.1 || g > 10);
        if (isExtreme) {
          t *= 0.5;
          n *= 0.5;
        }
        return { temp: t, tint: n };
      }
      module.exports = {
        computeWBGains: computeWBGains2,
        computeWBGainsLegacy,
        solveTempTintFromSample,
        kelvinToRGB,
        sliderToKelvin
      };
    }
  });

  // packages/shared/shaders/colorMath.js
  var require_colorMath = __commonJS({
    "packages/shared/shaders/colorMath.js"(exports, module) {
      var COLOR_MATH_GLSL = `
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
// \u4E0E packages/shared/render/math/color-space.js \u6570\u503C\u4E00\u81F4\uFF1B\u7528\u4E8E Phase I \u7EBF\u6027\u57DF\u53CD\u8F6C
// ============================================================================

// \u5355\u901A\u9053 sRGB \u2192 linear\uFF08\u8D1F\u503C clamp \u5230 0\uFF09
float srgbToLinear1(float srgb) {
  srgb = max(srgb, 0.0);
  if (srgb <= 0.04045) return srgb / 12.92;
  return pow((srgb + 0.055) / 1.055, 2.4);
}

// \u5355\u901A\u9053 linear \u2192 sRGB\uFF08\u8D1F\u503C clamp \u5230 0\uFF09
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
      module.exports = {
        COLOR_MATH_GLSL
      };
    }
  });

  // packages/shared/shaders/hslAdjust.js
  var require_hslAdjust = __commonJS({
    "packages/shared/shaders/hslAdjust.js"(exports, module) {
      var HSL_ADJUST_GLSL = `
// ============================================================================
// HSL Channel Weight Calculation
// Cosine smooth transition: 0.5*(1+cos(t*PI))  \u2014 matches CPU filmLabHSL.js
// ============================================================================

float hslChannelWeight(float hue, float centerHue, float hueRange) {
  float dist = min(abs(hue - centerHue), 360.0 - abs(hue - centerHue));
  if (dist >= hueRange) return 0.0;
  float t = dist / hueRange;
  return 0.5 * (1.0 + cos(t * 3.14159265));
}

// ============================================================================
// HSL Adjustment Application
// Matches CPU filmLabHSL.js \u2014 asymmetric sat/lum, weight normalization
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
  // Magenta: center 330\xB0 (NOT 320\xB0) \u2014 matches CPU HSL_CHANNELS definition
  w = hslChannelWeight(h, 330.0, 50.0);
  if (w > 0.0) { hueAdjust += u_hslMagenta.x * w; satAdjust += (u_hslMagenta.y / 100.0) * w; lumAdjust += (u_hslMagenta.z / 100.0) * w; totalWeight += w; }

  // P2-1: Normalize by max(1, totalWeight) \u2014 eliminates weak response zones
  // (old code only divided when > 1, leaving midpoints at 25% strength)
  float norm = max(1.0, totalWeight);
  hueAdjust /= norm;
  satAdjust /= norm;
  lumAdjust /= norm;

  if (totalWeight > 0.0) {
    // Continuous saturation ramp: fade hue/sat adjustments for near-gray pixels
    // (replaces the old s<0.05 hard switch in CPU \u2014 keeps both paths identical)
    float rampT = clamp(s / 0.1, 0.0, 1.0);
    float satRamp = rampT * rampT * (3.0 - 2.0 * rampT);
    hueAdjust *= satRamp;
    satAdjust *= satRamp;

    hsl.x = mod(hsl.x + hueAdjust, 360.0);

    // Asymmetric saturation (BUG-04 fix \u2014 matches CPU filmLabHSL.js)
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
      module.exports = {
        HSL_ADJUST_GLSL
      };
    }
  });

  // packages/shared/shaders/splitTone.js
  var require_splitTone = __commonJS({
    "packages/shared/shaders/splitTone.js"(exports, module) {
      var SPLIT_TONE_GLSL = `
// ============================================================================
// Split Toning \u2014 matches CPU filmLabSplitTone.js
// ============================================================================

// calcLuminance is defined in colorMath.js (Rec.709: 0.2126/0.7152/0.0722).
// Do NOT re-declare here \u2014 GLSL rejects duplicate function definitions, causing
// "function already has a body" shader compile error at runtime.
// (Pre-existing bug found by v4 E2E browser test with swiftshader WebGL.)

// Hermite smoothstep for zone weight transitions (NOT GLSL built-in)
float splitToneSmoothstep(float t) {
  t = clamp(t, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec3 applySplitTone(vec3 color) {
  float lum = calcLuminance(color);

  // Zone weights (matching CPU calculateZoneWeights \u2014 partition of unity,
  // shadow + midtone + highlight \u2261 1, continuous smoothstep transitions)
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

  // Midtone takes the remainder \u2014 weights always sum to 1
  float midtoneWeight = 1.0 - shadowWeight - highlightWeight;

  // Generate tint colors (hue is 0-1 range, pre-divided by 360 on JS side)
  vec3 highlightTint = hsl2rgb(vec3(u_splitHighlightHue * 360.0, 1.0, 0.5));
  vec3 midtoneTint = hsl2rgb(vec3(u_splitMidtoneHue * 360.0, 1.0, 0.5));
  vec3 shadowTint = hsl2rgb(vec3(u_splitShadowHue * 360.0, 1.0, 0.5));

  // Lerp-to-tint blend (matching CPU: result + (tint - result) * strength * 0.3)
  // NOT multiply-blend \u2014 lerp preserves luminance better
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
      module.exports = {
        SPLIT_TONE_GLSL
      };
    }
  });

  // packages/shared/shaders/filmCurve.js
  var require_filmCurve = __commonJS({
    "packages/shared/shaders/filmCurve.js"(exports, module) {
      var FILM_CURVE_GLSL = `
// ============================================================================
// Film Curve: H&D Density Model (Q13: 3-segment S-curve)
// ============================================================================

// Hermite smoothstep for toe/shoulder blending
float filmHermite(float t) {
  float c = clamp(t, 0.0, 1.0);
  return c * c * (3.0 - 2.0 * c);
}

// Three-segment gamma mapping (matches CPU _applyThreeSegmentGamma)
float threeSegGamma(float d, float gamma, float toe, float shoulder) {
  float toeBound = 0.25 * toe;
  // X.1 (P0-3): sync with CPU filmLabCurve.js:172 \u2014 P2-shoulder fix changed
  // shBound from (1 - 0.25*shoulder) to (1 - 0.5*shoulder) to widen the
  // shoulder compression range. The GPU shader was never updated, causing
  // WebGL preview to compress only the top 12.5% (8-bit rarely triggers)
  // while CPU export compresses the top 25% \u2014 visible divergence between
  // preview and saved images.
  float shBound  = 1.0 - 0.5 * shoulder;
  float gammaToe = gamma * 1.5;
  float gammaSh  = gamma * 0.6;
  float tw = 0.08;

  if (d < toeBound) {
    return pow(d, gammaToe);
  } else if (d < toeBound + tw && toeBound > 0.0) {
    float t = (d - toeBound) / tw;
    float blend = filmHermite(t);
    return mix(pow(d, gammaToe), pow(d, gamma), blend);
  } else if (d > shBound) {
    return pow(d, gammaSh);
  } else if (d > shBound - tw && shoulder > 0.0) {
    float t = (d - (shBound - tw)) / tw;
    float blend = filmHermite(t);
    return mix(pow(d, gamma), pow(d, gammaSh), blend);
  } else {
    return pow(d, gamma);
  }
}

// Full film curve: per-channel gamma + toe/shoulder S-curve
float applyFilmCurve(float value, float gamma, float dMin, float dMax,
                      float toe, float shoulder) {
  float normalized = clamp(value, 0.001, 1.0);
  float density = -log(normalized) / log(10.0);
  // X.6 (P1-4): guard against dMax==dMin (custom profile edge case) to match
  // CPU filmLabCurve.js:88 Math.max(dMax - dMin, 1e-6). Without this, the
  // division produces Infinity \u2192 clamp to 1.0 on GPU while CPU clamps to 0.0
  // (density - dMin == 0 \u2192 0/1e-6 = 0) \u2192 completely different output.
  float dRange = max(dMax - dMin, 1e-6);
  float densityNorm = clamp((density - dMin) / dRange, 0.0, 1.0);

  float gammaApplied;
  if (toe <= 0.0 && shoulder <= 0.0) {
    gammaApplied = pow(densityNorm, gamma);
  } else {
    gammaApplied = threeSegGamma(densityNorm, gamma, toe, shoulder);
  }

  float adjustedDensity = dMin + gammaApplied * (dMax - dMin);
  float outputT = pow(10.0, -adjustedDensity);
  return clamp(outputT, 0.0, 1.0);
}

// Legacy single-gamma overload (backward compat \u2014 used when toe=shoulder=0)
float applyFilmCurveLegacy(float value) {
  return applyFilmCurve(value, u_filmCurveGamma, u_filmCurveDMin, u_filmCurveDMax, 0.0, 0.0);
}
`;
      module.exports = {
        FILM_CURVE_GLSL
      };
    }
  });

  // packages/shared/shaders/tonemap.js
  var require_tonemap = __commonJS({
    "packages/shared/shaders/tonemap.js"(exports, module) {
      var TONEMAP_GLSL = `
// ============================================================================
// Contrast \u2014 around perceptual mid-gray (0.46, matching CPU CONTRAST_MID_GRAY)
// ============================================================================

vec3 applyContrast(vec3 c, float contrast) {
  // contrast is UI value -100..100, scale to -255..255 for the standard formula
  float C = contrast * 2.55;
  float factor = (259.0 * (C + 255.0)) / (255.0 * (259.0 - C));
  float midGray = 0.46;
  return (c - vec3(midGray)) * factor + vec3(midGray);
}

// ============================================================================
// Highlights & Shadows \u2014 Bernstein basis (matches CPU RenderCore)
// ============================================================================

vec3 applyHighlightsShadows(vec3 c) {
  float sFactor = u_shadows * 0.005;
  float hFactor = u_highlights * 0.005;

  // Bernstein \u57FA\u51FD\u6570\u5728 clamp \u540E\u7684\u503C\u4E0A\u8BA1\u7B97\uFF08\u5339\u914D CPU processPixelFloat\uFF09\uFF0C
  // \u907F\u514D c \u8D85\u51FA [0,1] \u65F6\u6743\u91CD\u7B26\u53F7\u53CD\u8F6C\uFF1B\u589E\u91CF\u4ECD\u52A0\u5230\u672A clamp \u7684 c \u4E0A
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
// Highlight Roll-Off \u2014 C\xB2 continuous tanh shoulder compression
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
      module.exports = {
        TONEMAP_GLSL
      };
    }
  });

  // packages/shared/shaders/lut3d.js
  var require_lut3d = __commonJS({
    "packages/shared/shaders/lut3d.js"(exports, module) {
      var LUT3D_GLSL = `
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
      module.exports = {
        LUT3D_GLSL
      };
    }
  });

  // packages/shared/shaders/inversion.js
  var require_inversion = __commonJS({
    "packages/shared/shaders/inversion.js"(exports, module) {
      var INVERSION_GLSL = `
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
      module.exports = {
        INVERSION_GLSL
      };
    }
  });

  // packages/shared/shaders/baseDensity.js
  var require_baseDensity = __commonJS({
    "packages/shared/shaders/baseDensity.js"(exports, module) {
      var BASE_DENSITY_GLSL = `
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
      module.exports = {
        BASE_DENSITY_GLSL
      };
    }
  });

  // packages/shared/shaders/saturation.js
  var require_saturation = __commonJS({
    "packages/shared/shaders/saturation.js"(exports, module) {
      "use strict";
      function getSaturationGLSL() {
        return `
// \u2500\u2500 Saturation (Luma-Preserving, Rec.709) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
vec3 applySaturation(vec3 color) {
  // X.4 (P1-1): clamp s to >= 0 to match CPU filmLabSaturation.js:39
  // Math.max(0, 1 + strength/100). Without this, saturation < -100
  // produces a negative s, which inverts chroma (R/G/B flip around luma)
  // \u2014 visible as a color-polarity flip. UI bounds saturation to [-100,100]
  // but API/programmatic callers (presets, AI) can exceed the range.
  float s = max(0.0, 1.0 + u_saturation / 100.0);
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  return clamp(vec3(lum) + (color - vec3(lum)) * s, 0.0, 1.0);
}
`;
      }
      function getSaturationMainCall() {
        return `
  // \u2466b Saturation (Luma-Preserving)
  if (u_useSaturation > 0.5) {
    color = applySaturation(color);
  }
`;
      }
      module.exports = {
        getSaturationGLSL,
        getSaturationMainCall
      };
    }
  });

  // packages/shared/shaders/uniforms.js
  var require_uniforms = __commonJS({
    "packages/shared/shaders/uniforms.js"(exports, module) {
      var UNIFORMS_GLSL = `
// Image texture
uniform sampler2D u_image;

// Inversion (float for WebGL1/2 compat \u2014 test with > 0.5)
uniform float u_inverted;      // 0.0 = no inversion, 1.0 = invert
uniform float u_inversionMode; // 0.0 = linear, 1.0 = log

// Phase I: \u7EBF\u6027\u57DF\u53CD\u8F6C\uFF080.0 = gamma \u57DF\uFF0C1.0 = \u7EBF\u6027\u5149\u4E0B\u505A\u7247\u57FA\u6821\u6B63+\u53CD\u8F6C\uFF09
uniform float u_linearDomainInversion;

// White Balance
uniform vec3 u_gains;          // r,g,b gains

// Tone adjustments (raw values from UI, see shader for scaling)
uniform float u_exposure;      // -100..100
uniform float u_contrast;      // -100..100
uniform float u_highlights;    // -100..100
uniform float u_shadows;       // -100..100
uniform float u_whites;        // -100..100
uniform float u_blacks;        // -100..100

// Film Curve parameters (Q13: per-channel gamma + toe/shoulder)
uniform float u_filmCurveEnabled;
uniform float u_filmCurveGamma;
uniform float u_filmCurveGammaR;
uniform float u_filmCurveGammaG;
uniform float u_filmCurveGammaB;
uniform float u_filmCurveDMin;
uniform float u_filmCurveDMax;
uniform float u_filmCurveToe;
uniform float u_filmCurveShoulder;

// Film Base Correction (Pre-Inversion)
uniform float u_baseMode;      // 0.0 = linear (gains), 1.0 = log (density subtraction)
uniform vec3 u_baseGains;      // Linear mode: r,g,b gains
uniform vec3 u_baseDensity;    // Log mode: r,g,b density values to subtract

// Density Levels (Log domain auto-levels)
uniform float u_densityLevelsEnabled;
uniform vec3 u_densityLevelsMin;
uniform vec3 u_densityLevelsMax;

// Curve LUTs (1D textures)
uniform sampler2D u_curveRGB;
uniform sampler2D u_curveR;
uniform sampler2D u_curveG;
uniform sampler2D u_curveB;
uniform float u_useCurves;

// 3D LUT (packed 2D texture for WebGL1; native 3D texture for WebGL2)
uniform sampler2D u_lut3d;
uniform float u_useLut3d;
uniform float u_lutSize;
uniform float u_lutIntensity;

// HSL adjustments (8 channels x 3 values: hue, saturation, luminance)
uniform float u_useHSL;
uniform vec3 u_hslRed;
uniform vec3 u_hslOrange;
uniform vec3 u_hslYellow;
uniform vec3 u_hslGreen;
uniform vec3 u_hslCyan;
uniform vec3 u_hslBlue;
uniform vec3 u_hslPurple;
uniform vec3 u_hslMagenta;

// Global Saturation (Luma-Preserving, Rec.709)
uniform float u_useSaturation;
uniform float u_saturation;    // -100..100, 0 = identity

// Split Toning (u_split* prefix to distinguish from tone mapping highlights)
uniform float u_useSplitTone;
uniform float u_splitHighlightHue;
uniform float u_splitHighlightSat;
uniform float u_splitMidtoneHue;
uniform float u_splitMidtoneSat;
uniform float u_splitShadowHue;
uniform float u_splitShadowSat;
uniform float u_splitBalance;
`;
      module.exports = {
        UNIFORMS_GLSL
      };
    }
  });

  // packages/shared/shaders/index.js
  var require_shaders = __commonJS({
    "packages/shared/shaders/index.js"(exports, module) {
      var colorMath = require_colorMath();
      var hslAdjust = require_hslAdjust();
      var splitTone = require_splitTone();
      var filmCurve = require_filmCurve();
      var tonemap = require_tonemap();
      var lut3d = require_lut3d();
      var inversion = require_inversion();
      var baseDensity = require_baseDensity();
      var saturation = require_saturation();
      var uniforms = require_uniforms();
      function buildFragmentShader2(options = {}) {
        const {
          isGL2 = false,
          useCompositeCurve = false,
          precision = "mediump"
        } = options;
        const useNativeLUT3D = options.useNativeLUT3D !== void 0 ? options.useNativeLUT3D : isGL2;
        if (isGL2) {
          return `#version 300 es
precision highp float;
${useNativeLUT3D ? "precision highp sampler3D;\n" : ""}
// WebGL2 compat: modules may use texture2D()
#define texture2D texture

in vec2 v_uv;
out vec4 fragColor;

${useNativeLUT3D ? `
// WebGL2: 3D LUT as native sampler3D
uniform sampler3D u_lut3dTex;
uniform float u_hasLut3d;
uniform float u_lut3dSize;
` : ""}
${useCompositeCurve ? `
// Composite curve texture (gpu-renderer path: R,G,B channels = per-channel curves)
uniform sampler2D u_toneCurveTex;
` : ""}

${uniforms.UNIFORMS_GLSL}
${colorMath.COLOR_MATH_GLSL}
${filmCurve.FILM_CURVE_GLSL}
${baseDensity.BASE_DENSITY_GLSL}
${inversion.INVERSION_GLSL}
${tonemap.TONEMAP_GLSL}
${useNativeLUT3D ? "" : lut3d.LUT3D_GLSL}
${hslAdjust.HSL_ADJUST_GLSL}
${saturation.getSaturationGLSL()}
${splitTone.SPLIT_TONE_GLSL}
${buildMainFunction({ isGL2: true, useCompositeCurve, useNativeLUT3D })}
`;
        } else {
          return `
precision ${precision} float;
varying vec2 v_uv;

${uniforms.UNIFORMS_GLSL}
${colorMath.COLOR_MATH_GLSL}
${filmCurve.FILM_CURVE_GLSL}
${baseDensity.BASE_DENSITY_GLSL}
${inversion.INVERSION_GLSL}
${tonemap.TONEMAP_GLSL}
${lut3d.LUT3D_GLSL}
${hslAdjust.HSL_ADJUST_GLSL}
${saturation.getSaturationGLSL()}
${splitTone.SPLIT_TONE_GLSL}
${buildMainFunction({ isGL2: false })}
`;
        }
      }
      function buildMainFunction(options = {}) {
        const { isGL2 = false, useCompositeCurve = false } = options;
        const useNativeLUT3D = options.useNativeLUT3D !== void 0 ? options.useNativeLUT3D : isGL2;
        const TEX = isGL2 ? "texture" : "texture2D";
        const FRAG_OUT = isGL2 ? "fragColor" : "gl_FragColor";
        const curveSampling = useCompositeCurve ? `
    // Composite curve texture: R,G,B channels contain per-channel curve data
    c.r = ${TEX}(u_toneCurveTex, vec2(c.r, 0.5)).r;
    c.g = ${TEX}(u_toneCurveTex, vec2(c.g, 0.5)).g;
    c.b = ${TEX}(u_toneCurveTex, vec2(c.b, 0.5)).b;
  ` : `
    // Separate 1D curve textures: master RGB + per-channel
    c = applyCurvesLUT(c);
  `;
        return `
void main() {
  vec3 c = ${TEX}(u_image, v_uv).rgb;

  // \u2460 Film Curve (before inversion) \u2014 Q13: per-channel gamma + toe/shoulder S-curve
  if (u_inverted > 0.5 && u_filmCurveEnabled > 0.5) {
    float toe = u_filmCurveToe;
    float sh  = u_filmCurveShoulder;
    c.r = applyFilmCurve(c.r, u_filmCurveGammaR, u_filmCurveDMin, u_filmCurveDMax, toe, sh);
    c.g = applyFilmCurve(c.g, u_filmCurveGammaG, u_filmCurveDMin, u_filmCurveDMax, toe, sh);
    c.b = applyFilmCurve(c.b, u_filmCurveGammaB, u_filmCurveDMin, u_filmCurveDMax, toe, sh);
  }

  // Phase I\uFF1A\u7EBF\u6027\u57DF\u53CD\u8F6C\uFF08\u4E0E CPU processPixelFloat \u540C\u8BED\u4E49\uFF09\u2014 \u7247\u57FA\u6821\u6B63/\u5BC6\u5EA6\u8272\u9636/\u53CD\u8F6C\u5728\u7EBF\u6027\u5149\u4E0B\u8FDB\u884C
  if (u_linearDomainInversion > 0.5) {
    c = srgbToLinear(c);
  }

  // \u2461 Base Correction \u2014 neutralize film base color
  if (u_baseMode > 0.5) {
    float minT = 0.001;
    float log10 = log(10.0);
    float Tr = max(c.r, minT);
    c.r = pow(10.0, -(-log(Tr) / log10 - u_baseDensity.r));
    float Tg = max(c.g, minT);
    c.g = pow(10.0, -(-log(Tg) / log10 - u_baseDensity.g));
    float Tb = max(c.b, minT);
    c.b = pow(10.0, -(-log(Tb) / log10 - u_baseDensity.b));
    c = clamp(c, 0.0, 1.0);
  } else {
    c = clamp(c * u_baseGains, 0.0, 1.0);
  }

  // \u2461.5 Density Levels (Log domain auto-levels)
  if (u_densityLevelsEnabled > 0.5) {
    float minT = 0.001;
    float log10 = log(10.0);
    float rangeR = u_densityLevelsMax.r - u_densityLevelsMin.r;
    float rangeG = u_densityLevelsMax.g - u_densityLevelsMin.g;
    float rangeB = u_densityLevelsMax.b - u_densityLevelsMin.b;
    float avgRange = clamp((rangeR + rangeG + rangeB) / 3.0, 0.5, 2.5);

    if (rangeR > 0.001) {
      float Dr = -log(max(c.r, minT)) / log10;
      c.r = pow(10.0, -clamp((Dr - u_densityLevelsMin.r) / rangeR, 0.0, 1.0) * avgRange);
    }
    if (rangeG > 0.001) {
      float Dg = -log(max(c.g, minT)) / log10;
      c.g = pow(10.0, -clamp((Dg - u_densityLevelsMin.g) / rangeG, 0.0, 1.0) * avgRange);
    }
    if (rangeB > 0.001) {
      float Db = -log(max(c.b, minT)) / log10;
      c.b = pow(10.0, -clamp((Db - u_densityLevelsMin.b) / rangeB, 0.0, 1.0) * avgRange);
    }
    c = clamp(c, 0.0, 1.0);
  }

  // \u2462 Inversion
  if (u_inverted > 0.5) {
    if (u_inversionMode > 0.5) {
      c = vec3(1.0) - log(c * 255.0 + vec3(1.0)) / log(256.0);
    } else {
      c = vec3(1.0) - c;
    }
  }

  // Phase I\uFF1A\u8F6C\u56DE sRGB \u7F16\u7801\u57DF\uFF08LUT/WB/Tone \u4ECD\u5728 sRGB \u57DF\uFF09
  if (u_linearDomainInversion > 0.5) {
    c = linearToSrgb(c);
  }

${useNativeLUT3D ? `
  // \u2462b 3D LUT (WebGL2 native sampler3D \u2014 applied AFTER inversion)
  if (u_hasLut3d > 0.5) {
    float size = u_lut3dSize;
    vec3 uvw = c * (size - 1.0) / size + 0.5 / size;
    vec3 lutColor = texture(u_lut3dTex, uvw).rgb;
    c = mix(c, lutColor, u_lutIntensity);
  }
` : `
  // \u2462b 3D LUT (packed 2D texture \u2014 works in both WebGL1 and WebGL2)
  if (u_useLut3d > 0.5) {
    vec3 lutColor = sampleLUT3D(c);
    c = mix(c, lutColor, u_lutIntensity);
  }
`}

  // \u2463 White Balance
  c *= u_gains;

  // \u2464a Exposure (f-stop formula: pow(2, exposure/50))
  float expFactor = pow(2.0, u_exposure / 50.0);
  c *= expFactor;

  // \u2464b Contrast around perceptual mid-gray (0.46 = sRGB 18% reflectance)
  c = applyContrast(c, u_contrast);

  // \u2464c Blacks & Whites (window remap)
  c = applyWhitesBlacks(c);

  // \u2464d Shadows & Highlights (Bernstein basis)
  c = applyHighlightsShadows(c);

  // \u2464e Highlight Roll-Off (tanh shoulder compression)
  c = applyHighlightRollOff(c);

  c = clamp(c, 0.0, 1.0);

  // \u2465 Curves (1D LUT)
  if (u_useCurves > 0.5) {
  ${curveSampling}
  }

  // \u2466 HSL Adjustment
  if (u_useHSL > 0.5) {
    c = applyHSLAdjustment(c);
  }

  // \u2466b Saturation (Luma-Preserving, Rec.709)
  if (u_useSaturation > 0.5) {
    c = applySaturation(c);
  }

  // \u2467 Split Toning
  if (u_useSplitTone > 0.5) {
    c = applySplitTone(c);
  }

  ${FRAG_OUT} = vec4(c, 1.0);
}
`;
      }
      var VERTEX_SHADER = `
attribute vec2 a_pos;
attribute vec2 a_uv;
varying vec2 v_uv;

void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;
      var VERTEX_SHADER_GL2 = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;

void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;
      module.exports = {
        // 构建函数
        buildFragmentShader: buildFragmentShader2,
        buildMainFunction,
        // 顶点着色器
        VERTEX_SHADER,
        VERTEX_SHADER_GL2,
        // 独立模块（用于自定义组合）
        colorMath,
        hslAdjust,
        splitTone,
        saturation,
        filmCurve,
        tonemap,
        lut3d,
        inversion,
        baseDensity,
        uniforms,
        // 着色器版本标识（用于缓存失效）
        SHADER_VERSION: "2026-02-08-v3"
      };
    }
  });

  // electron-gpu/glsl-shared.js
  var require_glsl_shared = __commonJS({
    "electron-gpu/glsl-shared.js"(exports, module) {
      "use strict";
      var shaders = require_shaders();
      var GLSL_SHARED_UNIFORMS = shaders.uniforms.UNIFORMS_GLSL;
      var GLSL_COLOR_FUNCTIONS = shaders.colorMath.COLOR_MATH_GLSL;
      var GLSL_HSL_ADJUSTMENT = shaders.hslAdjust.HSL_ADJUST_GLSL;
      var GLSL_SPLIT_TONE = shaders.splitTone.SPLIT_TONE_GLSL;
      var GLSL_FILM_CURVE = shaders.filmCurve.FILM_CURVE_GLSL;
      function buildFragmentShader2(isGL2) {
        return shaders.buildFragmentShader({ isGL2, useCompositeCurve: true });
      }
      function buildShaderMain(isGL2) {
        return shaders.buildMainFunction({ isGL2 });
      }
      module.exports = {
        buildFragmentShader: buildFragmentShader2,
        // Exported for testing / inspection
        GLSL_SHARED_UNIFORMS,
        GLSL_COLOR_FUNCTIONS,
        GLSL_HSL_ADJUSTMENT,
        GLSL_SPLIT_TONE,
        GLSL_FILM_CURVE,
        buildShaderMain
      };
    }
  });

  // electron-gpu/gpu-renderer.js
  var gl;
  var canvas;
  var isWebGL2 = false;
  var _hasFloatTexture = false;
  var _hasFloatLinear = false;
  var { computeWBGains } = require_filmLabWhiteBalance();
  var { buildFragmentShader } = require_glsl_shared();
  var _cachedProgGL2 = null;
  var _cachedProgGL1 = null;
  function getOrCreateProgram(gl2, isGL2) {
    if (isGL2) {
      if (!_cachedProgGL2) _cachedProgGL2 = createProgram(gl2, VS_GL2, FS_GL2);
      return _cachedProgGL2;
    } else {
      if (!_cachedProgGL1) _cachedProgGL1 = createProgram(gl2, VS_GL1, FS_GL1);
      return _cachedProgGL1;
    }
  }
  function initGL() {
    canvas = document.getElementById("glc");
    const attribs = { preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false, antialias: false };
    gl = canvas.getContext("webgl2", attribs);
    isWebGL2 = !!gl;
    if (!gl) gl = canvas.getContext("webgl", attribs);
    if (!gl) {
      console.error("WebGL not available");
      return false;
    }
    if (isWebGL2) {
      _hasFloatTexture = true;
      _hasFloatLinear = true;
    } else {
      const extF = gl.getExtension("OES_texture_float");
      const extFL = gl.getExtension("OES_texture_float_linear");
      _hasFloatTexture = !!extF;
      _hasFloatLinear = !!extFL;
    }
    return true;
  }
  function createShader(gl2, type, src) {
    const sh = gl2.createShader(type);
    gl2.shaderSource(sh, src);
    gl2.compileShader(sh);
    if (!gl2.getShaderParameter(sh, gl2.COMPILE_STATUS)) {
      const log = gl2.getShaderInfoLog(sh);
      gl2.deleteShader(sh);
      throw new Error("Shader compile failed: " + log);
    }
    return sh;
  }
  function createProgram(gl2, vsSrc, fsSrc) {
    const vs = createShader(gl2, gl2.VERTEX_SHADER, vsSrc);
    const fs = createShader(gl2, gl2.FRAGMENT_SHADER, fsSrc);
    const prog = gl2.createProgram();
    gl2.attachShader(prog, vs);
    gl2.attachShader(prog, fs);
    gl2.linkProgram(prog);
    gl2.deleteShader(vs);
    gl2.deleteShader(fs);
    if (!gl2.getProgramParameter(prog, gl2.LINK_STATUS)) {
      const log = gl2.getProgramInfoLog(prog);
      gl2.deleteProgram(prog);
      throw new Error("Program link failed: " + log);
    }
    return prog;
  }
  var VS_GL2 = `#version 300 es
  in vec2 a_pos;
  in vec2 a_uv;
  out vec2 v_uv;
  void main(){
    v_uv = a_uv;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;
  var FS_GL2 = buildFragmentShader(true);
  var VS_GL1 = `
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main(){
    v_uv = a_uv;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;
  var FS_GL1 = buildFragmentShader(false);
  function runJob(job) {
    if (!gl) throw new Error("WebGL not initialized");
    const { jobId, params, image } = job;
    if (!image || !image.bytes) throw new Error("No image bytes");
    const runPipeline = (source, width, height, isRaw = false) => {
      try {
        const crop = params && params.cropRect ? params.cropRect : { x: 0, y: 0, w: 1, h: 1 };
        const rotation = (params && params.rotation || 0) + (params && params.orientation || 0);
        const rad = rotation * Math.PI / 180;
        const cos = Math.cos(-rad);
        const sin = Math.sin(-rad);
        const absCos = Math.abs(Math.cos(rad));
        const absSin = Math.abs(Math.sin(rad));
        const rotW = width * absCos + height * absSin;
        const rotH = width * absSin + height * absCos;
        canvas.width = Math.max(1, Math.round(rotW * crop.w));
        canvas.height = Math.max(1, Math.round(rotH * crop.h));
        const prog = getOrCreateProgram(gl, isWebGL2);
        gl.useProgram(prog);
        const mapUV = (u_rot, v_rot) => {
          const x_rot = u_rot * rotW;
          const y_rot = v_rot * rotH;
          const dx_rot = x_rot - rotW / 2;
          const dy_rot = y_rot - rotH / 2;
          const dx_src = dx_rot * cos - dy_rot * sin;
          const dy_src = dx_rot * sin + dy_rot * cos;
          const x_src = dx_src + width / 2;
          const y_src = dy_src + height / 2;
          return [x_src / width, y_src / height];
        };
        const uvTL = mapUV(crop.x, crop.y);
        const uvTR = mapUV(crop.x + crop.w, crop.y);
        const uvBL = mapUV(crop.x, crop.y + crop.h);
        const uvBR = mapUV(crop.x + crop.w, crop.y + crop.h);
        const quad = new Float32Array([
          //  pos      uv
          -1,
          -1,
          uvBL[0],
          uvBL[1],
          // BL
          1,
          -1,
          uvBR[0],
          uvBR[1],
          // BR
          -1,
          1,
          uvTL[0],
          uvTL[1],
          // TL
          1,
          1,
          uvTR[0],
          uvTR[1]
          // TR
        ]);
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
        const a_pos = gl.getAttribLocation(prog, "a_pos");
        const a_uv = gl.getAttribLocation(prog, "a_uv");
        gl.enableVertexAttribArray(a_pos);
        gl.enableVertexAttribArray(a_uv);
        gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(a_uv, 2, gl.FLOAT, false, 16, 8);
        gl.activeTexture(gl.TEXTURE0);
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        if (isRaw) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        }
        const toneCurveTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, toneCurveTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const hasFloatLut = params && params.toneCurveLutFloat && params.toneCurveLutFloat.length > 0;
        const useFloat = hasFloatLut && _hasFloatTexture;
        if (useFloat) {
          const floatArr = new Float32Array(params.toneCurveLutFloat);
          const resolution = floatArr.length / 4;
          const filterMode = _hasFloatLinear ? gl.LINEAR : gl.NEAREST;
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filterMode);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filterMode);
          if (isWebGL2) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, resolution, 1, 0, gl.RGBA, gl.FLOAT, floatArr);
          } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, resolution, 1, 0, gl.RGBA, gl.FLOAT, floatArr);
          }
        } else {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          let toneCurveData;
          if (params && params.toneCurveLut && params.toneCurveLut.length === 256 * 4) {
            toneCurveData = new Uint8Array(params.toneCurveLut);
          } else {
            toneCurveData = new Uint8Array(256 * 4);
            for (let i = 0; i < 256; i++) {
              toneCurveData[i * 4 + 0] = i;
              toneCurveData[i * 4 + 1] = i;
              toneCurveData[i * 4 + 2] = i;
              toneCurveData[i * 4 + 3] = 255;
            }
          }
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, toneCurveData);
        }
        let hasLut3d = false;
        let lut3dSize = 0;
        let lut3dTex = null;
        if (isWebGL2 && params && params.lut3d && params.lut3d.data && params.lut3d.size) {
          lut3dTex = gl.createTexture();
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_3D, lut3dTex);
          gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
          const size = params.lut3d.size;
          const data = new Float32Array(params.lut3d.data);
          gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB, size, size, size, 0, gl.RGB, gl.FLOAT, data);
          hasLut3d = true;
          lut3dSize = size;
        }
        gl.useProgram(prog);
        const u_image = gl.getUniformLocation(prog, "u_image");
        gl.uniform1i(u_image, 0);
        const u_toneCurveTex = gl.getUniformLocation(prog, "u_toneCurveTex");
        gl.uniform1i(u_toneCurveTex, 1);
        const u_lut3dTex = gl.getUniformLocation(prog, "u_lut3dTex");
        gl.uniform1i(u_lut3dTex, 2);
        const u_hasLut3d = gl.getUniformLocation(prog, "u_hasLut3d");
        gl.uniform1f(u_hasLut3d, hasLut3d ? 1 : 0);
        const u_lut3dSize = gl.getUniformLocation(prog, "u_lut3dSize");
        gl.uniform1f(u_lut3dSize, lut3dSize);
        const inverted = params && params.inverted ? 1 : 0;
        const u_inverted = gl.getUniformLocation(prog, "u_inverted");
        gl.uniform1f(u_inverted, inverted);
        const u_inversionMode = gl.getUniformLocation(prog, "u_inversionMode");
        gl.uniform1f(u_inversionMode, params && params.inversionMode === "log" ? 1 : 0);
        const [rBal, gBal, bBal] = computeWBGains({
          red: params?.red ?? 1,
          green: params?.green ?? 1,
          blue: params?.blue ?? 1,
          temp: params?.temp ?? 0,
          tint: params?.tint ?? 0
        });
        const u_gains = gl.getUniformLocation(prog, "u_gains");
        gl.uniform3f(u_gains, rBal, gBal, bBal);
        const u_exposure = gl.getUniformLocation(prog, "u_exposure");
        gl.uniform1f(u_exposure, params?.exposure ?? 0);
        const u_contrast = gl.getUniformLocation(prog, "u_contrast");
        gl.uniform1f(u_contrast, params?.contrast ?? 0);
        const u_highlights = gl.getUniformLocation(prog, "u_highlights");
        gl.uniform1f(u_highlights, params?.highlights ?? 0);
        const u_shadows = gl.getUniformLocation(prog, "u_shadows");
        gl.uniform1f(u_shadows, params?.shadows ?? 0);
        const u_whites = gl.getUniformLocation(prog, "u_whites");
        gl.uniform1f(u_whites, params?.whites ?? 0);
        const u_blacks = gl.getUniformLocation(prog, "u_blacks");
        gl.uniform1f(u_blacks, params?.blacks ?? 0);
        const u_filmCurveEnabled = gl.getUniformLocation(prog, "u_filmCurveEnabled");
        gl.uniform1f(u_filmCurveEnabled, params?.filmCurveEnabled ? 1 : 0);
        const u_filmCurveGamma = gl.getUniformLocation(prog, "u_filmCurveGamma");
        gl.uniform1f(u_filmCurveGamma, params?.filmCurveGamma ?? 0.6);
        const u_filmCurveGammaR = gl.getUniformLocation(prog, "u_filmCurveGammaR");
        gl.uniform1f(u_filmCurveGammaR, params?.filmCurveGammaR ?? params?.filmCurveGamma ?? 0.6);
        const u_filmCurveGammaG = gl.getUniformLocation(prog, "u_filmCurveGammaG");
        gl.uniform1f(u_filmCurveGammaG, params?.filmCurveGammaG ?? params?.filmCurveGamma ?? 0.6);
        const u_filmCurveGammaB = gl.getUniformLocation(prog, "u_filmCurveGammaB");
        gl.uniform1f(u_filmCurveGammaB, params?.filmCurveGammaB ?? params?.filmCurveGamma ?? 0.6);
        const u_filmCurveDMin = gl.getUniformLocation(prog, "u_filmCurveDMin");
        gl.uniform1f(u_filmCurveDMin, params?.filmCurveDMin ?? 0.1);
        const u_filmCurveDMax = gl.getUniformLocation(prog, "u_filmCurveDMax");
        gl.uniform1f(u_filmCurveDMax, params?.filmCurveDMax ?? 3);
        const u_filmCurveToe = gl.getUniformLocation(prog, "u_filmCurveToe");
        gl.uniform1f(u_filmCurveToe, params?.filmCurveToe ?? 0);
        const u_filmCurveShoulder = gl.getUniformLocation(prog, "u_filmCurveShoulder");
        gl.uniform1f(u_filmCurveShoulder, params?.filmCurveShoulder ?? 0);
        const baseMode = params?.baseMode === "log" ? 1 : 0;
        const baseGains = [params?.baseRed ?? 1, params?.baseGreen ?? 1, params?.baseBlue ?? 1];
        const baseDensity = [params?.baseDensityR ?? 0, params?.baseDensityG ?? 0, params?.baseDensityB ?? 0];
        const u_baseMode = gl.getUniformLocation(prog, "u_baseMode");
        gl.uniform1f(u_baseMode, baseMode);
        const u_baseGains = gl.getUniformLocation(prog, "u_baseGains");
        gl.uniform3fv(u_baseGains, new Float32Array(baseGains));
        const u_baseDensity = gl.getUniformLocation(prog, "u_baseDensity");
        gl.uniform3fv(u_baseDensity, new Float32Array(baseDensity));
        const densityLevelsEnabled = params?.densityLevelsEnabled && baseMode > 0.5 ? 1 : 0;
        const densityLevels = params?.densityLevels || { red: { min: 0, max: 3 }, green: { min: 0, max: 3 }, blue: { min: 0, max: 3 } };
        const u_densityLevelsEnabled = gl.getUniformLocation(prog, "u_densityLevelsEnabled");
        gl.uniform1f(u_densityLevelsEnabled, densityLevelsEnabled);
        const u_densityLevelsMin = gl.getUniformLocation(prog, "u_densityLevelsMin");
        gl.uniform3fv(u_densityLevelsMin, new Float32Array([
          densityLevels.red?.min ?? 0,
          densityLevels.green?.min ?? 0,
          densityLevels.blue?.min ?? 0
        ]));
        const u_densityLevelsMax = gl.getUniformLocation(prog, "u_densityLevelsMax");
        gl.uniform3fv(u_densityLevelsMax, new Float32Array([
          densityLevels.red?.max ?? 3,
          densityLevels.green?.max ?? 3,
          densityLevels.blue?.max ?? 3
        ]));
        const hslParams = params?.hslParams || {};
        const getHSL = (ch) => {
          const data = hslParams[ch] || {};
          return [data.hue ?? 0, data.saturation ?? 0, data.luminance ?? 0];
        };
        gl.uniform3fv(gl.getUniformLocation(prog, "u_hslRed"), new Float32Array(getHSL("red")));
        gl.uniform3fv(gl.getUniformLocation(prog, "u_hslOrange"), new Float32Array(getHSL("orange")));
        gl.uniform3fv(gl.getUniformLocation(prog, "u_hslYellow"), new Float32Array(getHSL("yellow")));
        gl.uniform3fv(gl.getUniformLocation(prog, "u_hslGreen"), new Float32Array(getHSL("green")));
        gl.uniform3fv(gl.getUniformLocation(prog, "u_hslCyan"), new Float32Array(getHSL("cyan")));
        gl.uniform3fv(gl.getUniformLocation(prog, "u_hslBlue"), new Float32Array(getHSL("blue")));
        gl.uniform3fv(gl.getUniformLocation(prog, "u_hslPurple"), new Float32Array(getHSL("purple")));
        gl.uniform3fv(gl.getUniformLocation(prog, "u_hslMagenta"), new Float32Array(getHSL("magenta")));
        gl.uniform1f(gl.getUniformLocation(prog, "u_useCurves"), 1);
        gl.uniform1f(gl.getUniformLocation(prog, "u_useHSL"), 1);
        gl.uniform1f(gl.getUniformLocation(prog, "u_useSplitTone"), 1);
        gl.uniform1f(gl.getUniformLocation(prog, "u_lutIntensity"), params?.lut3dIntensity ?? 1);
        gl.uniform1f(gl.getUniformLocation(prog, "u_lutSize"), lut3dSize);
        const splitToning = params?.splitToning || {};
        gl.uniform1f(gl.getUniformLocation(prog, "u_splitHighlightHue"), (splitToning.highlights?.hue ?? 0) / 360);
        gl.uniform1f(gl.getUniformLocation(prog, "u_splitHighlightSat"), (splitToning.highlights?.saturation ?? 0) / 100);
        gl.uniform1f(gl.getUniformLocation(prog, "u_splitMidtoneHue"), (splitToning.midtones?.hue ?? 0) / 360);
        gl.uniform1f(gl.getUniformLocation(prog, "u_splitMidtoneSat"), (splitToning.midtones?.saturation ?? 0) / 100);
        gl.uniform1f(gl.getUniformLocation(prog, "u_splitShadowHue"), (splitToning.shadows?.hue ?? 0) / 360);
        gl.uniform1f(gl.getUniformLocation(prog, "u_splitShadowSat"), (splitToning.shadows?.saturation ?? 0) / 100);
        gl.uniform1f(gl.getUniformLocation(prog, "u_splitBalance"), (splitToning.balance ?? 0) / 100);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.finish();
        gl.deleteTexture(tex);
        gl.deleteTexture(toneCurveTex);
        if (lut3dTex) gl.deleteTexture(lut3dTex);
        gl.deleteBuffer(vbo);
        canvas.toBlob((blobOut) => {
          if (!blobOut) {
            window.__gpu.sendResult({ jobId, ok: false, error: "toBlob_failed" });
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const arrBuf = reader.result;
            const bytes = new Uint8Array(arrBuf);
            window.__gpu.sendResult({ jobId, ok: true, width: canvas.width, height: canvas.height, jpegBytes: bytes });
          };
          reader.onerror = () => {
            window.__gpu.sendResult({ jobId, ok: false, error: "blob_read_failed" });
          };
          reader.readAsArrayBuffer(blobOut);
        }, "image/jpeg", params?.jpegQuality ?? 0.95);
      } catch (err) {
        window.__gpu.sendResult({ jobId, ok: false, error: err && err.message || String(err) });
      } finally {
        if (!isRaw && source && source.close) source.close();
      }
    };
    if (image.format === "rgba" && image.width && image.height) {
      const pixels = new Uint8Array(image.bytes);
      runPipeline(pixels, image.width, image.height, true);
    } else {
      const blob = new Blob([image.bytes], { type: image.mime || "image/jpeg" });
      createImageBitmap(blob).then((bmp) => {
        runPipeline(bmp, bmp.width, bmp.height, false);
      }).catch((e) => {
        window.__gpu.sendResult({ jobId, ok: false, error: "decode_failed: " + (e && e.message) });
      });
    }
  }
  window.addEventListener("DOMContentLoaded", () => {
    initGL();
    window.__gpu.onRun((job) => {
      try {
        runJob(job);
      } catch (err) {
        window.__gpu.sendResult({ jobId: job && job.jobId, ok: false, error: err && err.message || String(err) });
      }
    });
  });
})();
