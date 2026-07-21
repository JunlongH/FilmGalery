/**
 * FilmLab 统一渲染核心
 * 
 * @module RenderCore
 * @description 统一的渲染核心，确保 CPU/WebGL/GPU Export 使用相同的处理逻辑
 * 
 * 设计目标：
 * - 单一参数规范化入口
 * - 统一的 Pipeline 描述
 * - 为 WebGL 着色器生成 Uniforms
 * - 为 CPU 路径提供 processPixel
 * 
 * 处理流水线顺序：
 * ① 胶片曲线 (Film Curve - H&D 密度模型)
 * ② 反转 (Inversion)
 * ③ 白平衡 (White Balance)
 * ④ 色调映射 (Tone Mapping via LUT)
 * ⑤ 曲线 (Curves)
 * ⑥ HSL 调整 (色相/饱和度/明度)
 * ⑦ 分离色调 (Split Toning)
 * ⑧ 3D LUT
 */

'use strict';

const { DEFAULT_CURVES, DEFAULT_WB_PARAMS, CONTRAST_MID_GRAY } = require('../filmLabConstants');
const { buildToneLUT } = require('../filmLabToneLUT');
const { buildCurveLUT, buildCurveLUTFloat } = require('../filmLabCurves');
const { computeWBGains } = require('../filmLabWhiteBalance');
const { applyInversion, applyLogBaseCorrectionRGB, applyLinearBaseCorrectionRGB } = require('../filmLabInversion');
const { applyFilmCurve, applyFilmCurveFloat, FILM_CURVE_PROFILES } = require('../filmLabCurve');
const { applyHSL, DEFAULT_HSL_PARAMS, isDefaultHSL } = require('../filmLabHSL');
const { applySplitTone, DEFAULT_SPLIT_TONE_PARAMS, isDefaultSplitTone, prepareSplitTone, applySplitToneFast } = require('../filmLabSplitTone');
const { applySaturationFloat, applySaturation, isDefaultSaturation } = require('../filmLabSaturation');
const MathOps = require('./math');

// ============================================================================
// 默认值常量
// ============================================================================

const DEFAULT_FILM_CURVE = {
  gamma: 0.6,
  dMin: 0.1,
  dMax: 3.0,
};

const DEFAULT_CROP_RECT = { x: 0, y: 0, w: 1, h: 1 };

// ============================================================================
// RenderCore 类
// ============================================================================

/**
 * 统一渲染核心
 * 
 * 用法示例：
 * ```javascript
 * const core = new RenderCore(params);
 * 
 * // CPU 路径
 * core.prepareLUTs();
 * for (...) {
 *   const [r, g, b] = core.processPixel(r, g, b);
 * }
 * 
 * // WebGL 路径
 * const uniforms = core.getGLSLUniforms();
 * gl.uniform3fv(locations.u_wbGains, uniforms.u_wbGains);
 * ```
 */
class RenderCore {
  /**
   * @param {Object} params - 原始参数对象（来自 UI 或数据库）
   */
  constructor(params = {}) {
    this.rawParams = params;
    this.params = this.normalizeParams(params);
    this.luts = null;
  }

  // ==========================================================================
  // 参数规范化
  // ==========================================================================

  /**
   * 规范化参数，填充默认值
   * 
   * @param {Object} input - 原始参数
   * @returns {Object} 规范化后的参数
   */
  normalizeParams(input) {
    return {
      // 反转
      inverted: input.inverted ?? false,
      inversionMode: input.inversionMode ?? 'linear',

      // Film Curve
      // 注意：gamma/dMin/dMax 默认 undefined，让 profile 回退生效（FILM_CURVE_PROFILES）；
      // 最终缺省值由解析层（processPixel*/getGLSLUniforms）统一兜底
      filmCurveEnabled: input.filmCurveEnabled ?? false,
      filmCurveProfile: input.filmCurveProfile ?? 'default',
      filmCurveGamma: input.filmCurveGamma ?? undefined, // falls back to profile, then DEFAULT_FILM_CURVE
      filmCurveGammaR: input.filmCurveGammaR ?? undefined, // Q13: per-channel, falls back to profile
      filmCurveGammaG: input.filmCurveGammaG ?? undefined,
      filmCurveGammaB: input.filmCurveGammaB ?? undefined,
      filmCurveDMin: input.filmCurveDMin ?? undefined,
      filmCurveDMax: input.filmCurveDMax ?? undefined,
      filmCurveToe: input.filmCurveToe ?? undefined,       // Q13: 3-segment toe
      filmCurveShoulder: input.filmCurveShoulder ?? undefined, // Q13: 3-segment shoulder

      // 片基校正 (Pre-Inversion, 独立于场景白平衡)
      // 线性模式参数
      baseRed: input.baseRed ?? 1.0,
      baseGreen: input.baseGreen ?? 1.0,
      baseBlue: input.baseBlue ?? 1.0,
      // 对数域模式参数
      baseMode: input.baseMode ?? 'linear',  // 'linear' | 'log'
      baseDensityR: input.baseDensityR ?? 0.0,
      baseDensityG: input.baseDensityG ?? 0.0,
      baseDensityB: input.baseDensityB ?? 0.0,

      // 密度域色阶 (Density Levels) - Log 域 AutoLevels
      densityLevelsEnabled: input.densityLevelsEnabled ?? false,
      densityLevels: input.densityLevels ?? {
        red: { min: 0.0, max: 3.0 },
        green: { min: 0.0, max: 3.0 },
        blue: { min: 0.0, max: 3.0 }
      },

      // 白平衡
      red: input.red ?? DEFAULT_WB_PARAMS.red,
      green: input.green ?? DEFAULT_WB_PARAMS.green,
      blue: input.blue ?? DEFAULT_WB_PARAMS.blue,
      temp: input.temp ?? DEFAULT_WB_PARAMS.temp,
      tint: input.tint ?? DEFAULT_WB_PARAMS.tint,

      // 色调
      exposure: input.exposure ?? 0,
      contrast: input.contrast ?? 0,
      highlights: input.highlights ?? 0,
      shadows: input.shadows ?? 0,
      whites: input.whites ?? 0,
      blacks: input.blacks ?? 0,

      // 曲线
      curves: input.curves ?? DEFAULT_CURVES,

      // HSL (兼容 hsl 和 hslParams 字段名)
      hslParams: input.hslParams ?? input.hsl ?? DEFAULT_HSL_PARAMS,

      // 全局饱和度 (Luma-preserving, -100~100)
      saturation: input.saturation ?? 0,

      // 分离色调 (兼容 splitTone 和 splitToning 字段名)
      splitToning: input.splitToning ?? input.splitTone ?? DEFAULT_SPLIT_TONE_PARAMS,

      // 3D LUT
      lut1: input.lut1 ?? null,
      lut1Intensity: input.lut1Intensity ?? 1.0,
      lut2: input.lut2 ?? null,
      lut2Intensity: input.lut2Intensity ?? 1.0,

      // 几何 (由调用者处理，这里仅记录)
      rotation: input.rotation ?? 0,
      orientation: input.orientation ?? 0,
      cropRect: input.cropRect ?? DEFAULT_CROP_RECT,

      // Phase I：线性域反转（opt-in，默认 false 保持现有观感）
      // true 时：片基校正 + 反转在线性光下进行（sRGB→linear→操作→linear→sRGB），
      // 与 darktable negadoctor / RawTherapee filmnegative 的物理正确做法一致。
      // 注：GPU shader 路径尚未实现此模式（getGLSLUniforms 透传标志，shader 端为 RFC）。
      linearDomainInversion: input.linearDomainInversion ?? false,
    };
  }

  // ==========================================================================
  // LUT 预计算 (CPU 路径)
  // ==========================================================================

  /**
   * 预计算所有查找表
   * 
   * @returns {Object} LUT 对象集合
   */
  prepareLUTs() {
    if (this.luts) return this.luts;

    const p = this.params;

    // 构建色调 LUT
    const toneLUT = buildToneLUT({
      exposure: p.exposure,
      contrast: p.contrast,
      highlights: p.highlights,
      shadows: p.shadows,
      whites: p.whites,
      blacks: p.blacks,
    });

    // 构建曲线 LUT (8-bit for processPixel)
    const curves = p.curves;
    const lutRGB = buildCurveLUT(curves.rgb || DEFAULT_CURVES.rgb);
    const lutR = buildCurveLUT(curves.red || DEFAULT_CURVES.red);
    const lutG = buildCurveLUT(curves.green || DEFAULT_CURVES.green);
    const lutB = buildCurveLUT(curves.blue || DEFAULT_CURVES.blue);

    // 构建 Float32 曲线 LUT (for processPixelFloat - higher precision)
    const lutRGBf = buildCurveLUTFloat(curves.rgb || DEFAULT_CURVES.rgb);
    const lutRf = buildCurveLUTFloat(curves.red || DEFAULT_CURVES.red);
    const lutGf = buildCurveLUTFloat(curves.green || DEFAULT_CURVES.green);
    const lutBf = buildCurveLUTFloat(curves.blue || DEFAULT_CURVES.blue);

    // 计算白平衡增益
    const [rBal, gBal, bBal] = computeWBGains({
      red: p.red,
      green: p.green,
      blue: p.blue,
      temp: p.temp,
      tint: p.tint,
    }, {
      useKelvinModel: true,
    });

    this.luts = {
      toneLUT,
      lutRGB,
      lutR,
      lutG,
      lutB,
      lutRGBf,
      lutRf,
      lutGf,
      lutBf,
      rBal,
      gBal,
      bBal,
      lut1: p.lut1,
      lut1Intensity: p.lut1Intensity,
      lut2: p.lut2,
      lut2Intensity: p.lut2Intensity,
      // Q18: Precompute split tone tint colors once per frame
      splitToneCtx: prepareSplitTone(p.splitToning),
    };

    return this.luts;
  }

  // ==========================================================================
  // Float Processing (HDR / High Precision)
  // ==========================================================================

  /**
   * Process a single pixel using floating point math throughout.
   * This method mirrors the full processPixel() pipeline but operates in
   * float precision (0.0 – 1.0+) to preserve dynamic range and avoid
   * 8-bit quantization artifacts.
   *
   * Input: linear-light RGB (0.0 – 1.0+, may exceed 1.0 for HDR/16-bit).
   * Output: sRGB gamma-encoded RGB (0.0 – 1.0).
   *
   * Pipeline order (mirrors processPixel and GPU shader):
   *  ① Film Curve (H&D density model)
   *  ② Base Correction (linear or log)
   *  ②.5 Density Levels
   *  ③ Inversion
   *  ③b 3D LUT
   *  ④ White Balance
   *  ⑤ Tone Mapping (exposure, contrast, blacks/whites, shadows/highlights)
   *  ⑤b Highlight Roll-Off (shoulder compression)
   *  ⑥ Curves (RGB master + per-channel)
   *  ⑦ HSL Adjustment
   *  ⑧ Split Toning
   *
   * @param {number} r - Red   (Linear 0.0 – 1.0+)
   * @param {number} g - Green (Linear 0.0 – 1.0+)
   * @param {number} b - Blue  (Linear 0.0 – 1.0+)
   * @returns {Array<number>} [r, g, b] sRGB 0.0 – 1.0
   */
  processPixelFloat(r, g, b) {
    const p = this.params;
    const luts = this.luts || this.prepareLUTs();

    // ① Film Curve (H&D density model) — Q13: per-channel gamma + toe/shoulder
    // Only when inverting negatives and film curve is enabled
    if (p.inverted && p.filmCurveEnabled && p.filmCurveProfile) {
      const profile = FILM_CURVE_PROFILES[p.filmCurveProfile];
      if (profile) {
        const gammaMain = p.filmCurveGamma ?? profile.gamma;
        const dMin  = p.filmCurveDMin  ?? profile.dMin;
        const dMax  = p.filmCurveDMax  ?? profile.dMax;
        // Q13: prefer explicit params (from client), then profile, then defaults
        const toe   = p.filmCurveToe ?? profile.toe ?? 0;
        const shoulder = p.filmCurveShoulder ?? profile.shoulder ?? 0;

        // Per-channel gamma: prefer explicit params, then profile, then main gamma
        const gammaR = p.filmCurveGammaR ?? profile.gammaR ?? gammaMain;
        const gammaG = p.filmCurveGammaG ?? profile.gammaG ?? gammaMain;
        const gammaB = p.filmCurveGammaB ?? profile.gammaB ?? gammaMain;

        r = applyFilmCurveFloat(r, { gamma: gammaR, dMin, dMax, toe, shoulder });
        g = applyFilmCurveFloat(g, { gamma: gammaG, dMin, dMax, toe, shoulder });
        b = applyFilmCurveFloat(b, { gamma: gammaB, dMin, dMax, toe, shoulder });
      }
    }

    // Phase I：线性域反转 — 片基校正与反转在线性光下进行（物理正确，对齐 darktable/RawTherapee）。
    // 默认 false 保持现有观感；true 时仅包装 ②/②.5/③ 三步，① 与 ③b+ 仍在 sRGB 域。
    if (p.linearDomainInversion) {
      r = MathOps.srgbToLinear(r);
      g = MathOps.srgbToLinear(g);
      b = MathOps.srgbToLinear(b);
    }

    // ② Base Correction (neutralize film base color)
    if (p.baseMode === 'log') {
      // 注：log 模式的密度域减法在线性域语义更准确（D=-log10(T_linear)）；
      // linearDomainInversion 下 T 已是线性透射率，密度计算物理正确。
      if (p.baseDensityR !== 0 || p.baseDensityG !== 0 || p.baseDensityB !== 0) {
        const log10 = Math.log(10);
        const minT = 0.001;
        const Tr = Math.max(r, minT);
        const Tg = Math.max(g, minT);
        const Tb = Math.max(b, minT);
        r = Math.pow(10, -(-Math.log(Tr) / log10 - p.baseDensityR));
        g = Math.pow(10, -(-Math.log(Tg) / log10 - p.baseDensityG));
        b = Math.pow(10, -(-Math.log(Tb) / log10 - p.baseDensityB));
        r = Math.max(0, Math.min(1, r));
        g = Math.max(0, Math.min(1, g));
        b = Math.max(0, Math.min(1, b));
      }
    } else {
      // Linear domain multiplication
      if (p.baseRed !== 1.0 || p.baseGreen !== 1.0 || p.baseBlue !== 1.0) {
        r = Math.max(0, Math.min(1, r * p.baseRed));
        g = Math.max(0, Math.min(1, g * p.baseGreen));
        b = Math.max(0, Math.min(1, b * p.baseBlue));
      }
    }

    // ②.5 Density Levels (log domain auto-levels)
    if (p.densityLevelsEnabled && p.baseMode === 'log') {
      [r, g, b] = this._applyDensityLevelsFloat(r, g, b);
    }

    // ③ Inversion — inline float version
    if (p.inverted) {
      if (p.inversionMode === 'log') {
        // Log inversion: out = 1 - log(in*255 + 1) / log(256)
        // Adapted from invertLog() for 0-1 float range
        const log256 = Math.log(256);
        r = 1.0 - Math.log(r * 255 + 1) / log256;
        g = 1.0 - Math.log(g * 255 + 1) / log256;
        b = 1.0 - Math.log(b * 255 + 1) / log256;
      } else {
        // Linear inversion（linearDomainInversion 下这是线性光反转，物理正确）
        r = 1.0 - r;
        g = 1.0 - g;
        b = 1.0 - b;
      }
    }

    // Phase I：转回 sRGB 编码域（LUT/WB/Tone 在 sRGB 域处理，保持与现有观感一致）
    if (p.linearDomainInversion) {
      r = MathOps.linearToSrgb(r);
      g = MathOps.linearToSrgb(g);
      b = MathOps.linearToSrgb(b);
    }

    // ③b 3D LUT (after inversion — supports "Inversion LUT" workflows)
    if (luts.lut1) {
      [r, g, b] = this._sampleLUT3DFloat(r, g, b, luts.lut1, luts.lut1Intensity);
    }
    if (luts.lut2) {
      [r, g, b] = this._sampleLUT3DFloat(r, g, b, luts.lut2, luts.lut2Intensity);
    }

    // ④ White Balance — single call with cached gains
    r *= luts.rBal;
    g *= luts.gBal;
    b *= luts.bBal;

    // NaN guard
    if (!Number.isFinite(r)) r = 0;
    if (!Number.isFinite(g)) g = 0;
    if (!Number.isFinite(b)) b = 0;

    // ⑤ Tone Mapping — inline float math (replaces 8-bit toneLUT lookup)
    // This matches the exact same formulas in buildToneLUT() / GPU shader,
    // but without 8-bit quantization.

    // 5a. Exposure (f-stop formula: 2^(exposure/50))
    const expFactor = Math.pow(2, (Number(p.exposure) || 0) / 50);
    r *= expFactor;
    g *= expFactor;
    b *= expFactor;

    // 5b. Contrast (around perceptual mid-grey — Q11: 18% reflectance ≈ sRGB 0.46)
    // UI 值 (-100..100) ×2.55 缩放到标准公式域 (-255..255)，与 GPU shader / buildToneLUT 一致 (BUG-11)
    const ctr = (Number(p.contrast) || 0) * 2.55;
    if (ctr !== 0) {
      const contrastFactor = (259 * (ctr + 255)) / (255 * (259 - ctr));
      r = (r - CONTRAST_MID_GRAY) * contrastFactor + CONTRAST_MID_GRAY;
      g = (g - CONTRAST_MID_GRAY) * contrastFactor + CONTRAST_MID_GRAY;
      b = (b - CONTRAST_MID_GRAY) * contrastFactor + CONTRAST_MID_GRAY;
    }

    // 5c. Blacks & Whites (window remap)
    const blackPoint = -(Number(p.blacks) || 0) * 0.002;
    const whitePoint = 1.0 - (Number(p.whites) || 0) * 0.002;
    if (blackPoint !== 0 || whitePoint !== 1) {
      const range = whitePoint - blackPoint;
      if (range > 0.001) {
        r = (r - blackPoint) / range;
        g = (g - blackPoint) / range;
        b = (b - blackPoint) / range;
      }
    }

    // 5d. Shadows (Bernstein basis, peak ~0.33)
    const sFactor = (Number(p.shadows) || 0) * 0.005;
    if (sFactor !== 0) {
      const applyS = (v) => {
        const c = Math.max(0, Math.min(1, v));
        return v + sFactor * (1 - c) * (1 - c) * c * 4;
      };
      r = applyS(r);
      g = applyS(g);
      b = applyS(b);
    }

    // 5e. Highlights (Bernstein basis, peak ~0.67)
    const hFactor = (Number(p.highlights) || 0) * 0.005;
    if (hFactor !== 0) {
      const applyH = (v) => {
        const c = Math.max(0, Math.min(1, v));
        return v + hFactor * c * c * (1 - c) * 4;
      };
      r = applyH(r);
      g = applyH(g);
      b = applyH(b);
    }

    // ⑤b Highlight Roll-Off (Shoulder Compression)
    // Softly compress values > 0.8 into [0.8, 1.0] preserving color ratios
    const maxVal = Math.max(r, Math.max(g, b));
    const threshold = 0.8;
    if (maxVal > threshold) {
      const compressed = MathOps.highlightRollOff(maxVal, threshold);
      const scale = compressed / maxVal;
      r *= scale;
      g *= scale;
      b *= scale;
    }

    // Clamp to [0, 1] before perceptual-domain operations
    r = Math.max(0, Math.min(1, r));
    g = Math.max(0, Math.min(1, g));
    b = Math.max(0, Math.min(1, b));

    // ⑥ Curves — sample Float32 1024-entry LUTs with linear interpolation
    // This gives true float-precision output from the natural cubic spline data
    if (luts.lutRGBf) {
      r = this._sampleCurveLUTFloatHQ(r, luts.lutRGBf);
      g = this._sampleCurveLUTFloatHQ(g, luts.lutRGBf);
      b = this._sampleCurveLUTFloatHQ(b, luts.lutRGBf);
    }
    if (luts.lutRf) r = this._sampleCurveLUTFloatHQ(r, luts.lutRf);
    if (luts.lutGf) g = this._sampleCurveLUTFloatHQ(g, luts.lutGf);
    if (luts.lutBf) b = this._sampleCurveLUTFloatHQ(b, luts.lutBf);

    // ⑦ HSL Adjustment (perceptual domain — scale to 0-255 for existing code)
    if (p.hslParams && !isDefaultHSL(p.hslParams)) {
      const [hr, hg, hb] = applyHSL(r * 255, g * 255, b * 255, p.hslParams);
      r = hr / 255;
      g = hg / 255;
      b = hb / 255;
    }

    // ⑦b Saturation (Luma-Preserving, Rec.709)
    if (!isDefaultSaturation(p.saturation)) {
      [r, g, b] = applySaturationFloat(r, g, b, p.saturation);
    }

    // ⑧ Split Toning (perceptual domain — Q18: use precomputed tint colors)
    if (luts.splitToneCtx) {
      const [sr, sg, sb] = applySplitToneFast(r * 255, g * 255, b * 255, luts.splitToneCtx);
      r = sr / 255;
      g = sg / 255;
      b = sb / 255;
    }

    // Final clamp to [0, 1]
    return [
      Math.max(0, Math.min(1, r)),
      Math.max(0, Math.min(1, g)),
      Math.max(0, Math.min(1, b)),
    ];
  }

  // ==========================================================================
  // CPU 像素处理
  // ==========================================================================

  /**
   * 处理单个像素 (CPU 路径)
   * 
   * @param {number} r - 红色 (0-255)
   * @param {number} g - 绿色 (0-255)
   * @param {number} b - 蓝色 (0-255)
   * @returns {[number, number, number]} 处理后的 RGB
   */
  processPixel(r, g, b) {
    const p = this.params;
    const luts = this.luts || this.prepareLUTs();

    // ① 胶片曲线 (Film Curve)
    if (p.inverted && p.filmCurveEnabled && p.filmCurveProfile) {
      const profile = FILM_CURVE_PROFILES[p.filmCurveProfile];
      if (profile) {
        const curveParams = {
          gamma: p.filmCurveGamma ?? profile.gamma,
          dMin: p.filmCurveDMin ?? profile.dMin,
          dMax: p.filmCurveDMax ?? profile.dMax,
        };
        r = applyFilmCurve(r, curveParams);
        g = applyFilmCurve(g, curveParams);
        b = applyFilmCurve(b, curveParams);
      }
    }

    // ② 片基校正 (Base Correction)
    // 将负片片基颜色中和为白色
    // 支持两种模式：线性域乘法 (linear) 或 对数域减法 (log)
    if (p.baseMode === 'log') {
      // 对数域减法：在密度域进行校正，更精确
      if (p.baseDensityR !== 0 || p.baseDensityG !== 0 || p.baseDensityB !== 0) {
        [r, g, b] = applyLogBaseCorrectionRGB(r, g, b, p.baseDensityR, p.baseDensityG, p.baseDensityB);
      }
    } else {
      // 线性域乘法：传统方式，兼容旧预设
      if (p.baseRed !== 1.0 || p.baseGreen !== 1.0 || p.baseBlue !== 1.0) {
        [r, g, b] = applyLinearBaseCorrectionRGB(r, g, b, p.baseRed, p.baseGreen, p.baseBlue);
      }
    }

    // ②.5 密度域色阶 (Density Levels)
    // 在密度域进行自动色阶，独立于后处理 AutoLevels
    if (p.densityLevelsEnabled && p.baseMode === 'log') {
      [r, g, b] = this._applyDensityLevels(r, g, b);
    }

    // ③ 反转 (Inversion)
    if (p.inverted) {
      r = applyInversion(r, p);
      g = applyInversion(g, p);
      b = applyInversion(b, p);
    }

    // ③ 3D LUT (Moved to Step 3 to support Inversion LUTs acting on base image)
    if (luts.lut1) {
      [r, g, b] = this._sampleLUT3D(r, g, b, luts.lut1, luts.lut1Intensity);
    }
    if (luts.lut2) {
      [r, g, b] = this._sampleLUT3D(r, g, b, luts.lut2, luts.lut2Intensity);
    }

    // ④ 白平衡 (White Balance)
    r *= luts.rBal;
    g *= luts.gBal;
    b *= luts.bBal;

    // 钳制
    r = this._clamp255(r);
    g = this._clamp255(g);
    b = this._clamp255(b);

    // NaN 保护
    if (!Number.isFinite(r)) r = 0;
    if (!Number.isFinite(g)) g = 0;
    if (!Number.isFinite(b)) b = 0;

    // ④ 色调映射 (Tone LUT)
    r = luts.toneLUT[Math.floor(r)];
    g = luts.toneLUT[Math.floor(g)];
    b = luts.toneLUT[Math.floor(b)];

    // ④b Highlight Roll-Off (Shoulder Compression)
    // Matches processPixelFloat step ⑤b — compress overbrights into [0.8, 1.0]
    const maxV = Math.max(r, Math.max(g, b));
    if (maxV > 204) { // 204 ≈ 0.8 * 255
      const nR = r / 255, nG = g / 255, nB = b / 255;
      const nMax = maxV / 255;
      const compressed = MathOps.highlightRollOff(nMax, 0.8);
      const scale = compressed / nMax;
      r = this._clamp255(Math.round(nR * scale * 255));
      g = this._clamp255(Math.round(nG * scale * 255));
      b = this._clamp255(Math.round(nB * scale * 255));
    }

    // ⑤ 曲线 (Curves)
    r = luts.lutRGB[r];
    g = luts.lutRGB[g];
    b = luts.lutRGB[b];
    r = luts.lutR[r];
    g = luts.lutG[g];
    b = luts.lutB[b];

    // ⑥ HSL 调整
    if (p.hslParams && !isDefaultHSL(p.hslParams)) {
      [r, g, b] = applyHSL(r, g, b, p.hslParams);
    }

    // ⑥b 饱和度 (Luma-Preserving, Rec.709)
    if (!isDefaultSaturation(p.saturation)) {
      [r, g, b] = applySaturation(r, g, b, p.saturation);
    }

    // ⑦ 分离色调 (Q18: use precomputed tint colors)
    if (luts.splitToneCtx) {
      [r, g, b] = applySplitToneFast(r, g, b, luts.splitToneCtx);
    }

    return [
      this._clamp255(Math.round(r)),
      this._clamp255(Math.round(g)),
      this._clamp255(Math.round(b)),
    ];
  }

  // ==========================================================================
  // WebGL Uniforms 生成
  // ==========================================================================

  /**
   * 生成 GLSL 着色器所需的 uniform 值
   * 
   * @returns {Object} uniform 名称到值的映射
   */
  getGLSLUniforms() {
    const p = this.params;
    const luts = this.luts || this.prepareLUTs();

    // 计算白平衡增益 (归一化到 0-1 范围)
    const wbGains = [luts.rBal, luts.gBal, luts.bBal];

    // Film Curve 参数解析：显式参数 → profile 回退 → 全局缺省（与 processPixelFloat 同一语义）
    const fcProfile = FILM_CURVE_PROFILES[p.filmCurveProfile] || null;
    const fcGammaMain = p.filmCurveGamma ?? fcProfile?.gamma ?? DEFAULT_FILM_CURVE.gamma;

    return {
      // 反转
      u_inverted: p.inverted ? 1.0 : 0.0,
      u_inversionMode: p.inversionMode === 'log' ? 1.0 : 0.0,

      // Film Curve (per-channel gamma + toe/shoulder, matching shared shader)
      u_filmCurveEnabled: p.filmCurveEnabled ? 1.0 : 0.0,
      u_filmCurveGamma: fcGammaMain,
      u_filmCurveGammaR: p.filmCurveGammaR ?? fcProfile?.gammaR ?? fcGammaMain,
      u_filmCurveGammaG: p.filmCurveGammaG ?? fcProfile?.gammaG ?? fcGammaMain,
      u_filmCurveGammaB: p.filmCurveGammaB ?? fcProfile?.gammaB ?? fcGammaMain,
      u_filmCurveDMin: p.filmCurveDMin ?? fcProfile?.dMin ?? DEFAULT_FILM_CURVE.dMin,
      u_filmCurveDMax: p.filmCurveDMax ?? fcProfile?.dMax ?? DEFAULT_FILM_CURVE.dMax,
      u_filmCurveToe: p.filmCurveToe ?? fcProfile?.toe ?? 0,
      u_filmCurveShoulder: p.filmCurveShoulder ?? fcProfile?.shoulder ?? 0,

      // 片基校正 (Pre-Inversion)
      u_baseMode: p.baseMode === 'log' ? 1.0 : 0.0,
      u_baseGains: [p.baseRed, p.baseGreen, p.baseBlue],  // 线性模式
      u_baseDensity: [p.baseDensityR, p.baseDensityG, p.baseDensityB],  // 对数模式

      // 密度域色阶 (Density Levels)
      u_densityLevelsEnabled: (p.densityLevelsEnabled && p.baseMode === 'log') ? 1.0 : 0.0,
      u_densityLevelsMin: [
        p.densityLevels?.red?.min ?? 0.0,
        p.densityLevels?.green?.min ?? 0.0,
        p.densityLevels?.blue?.min ?? 0.0
      ],
      u_densityLevelsMax: [
        p.densityLevels?.red?.max ?? 3.0,
        p.densityLevels?.green?.max ?? 3.0,
        p.densityLevels?.blue?.max ?? 3.0
      ],

      // 白平衡
      u_gains: wbGains,

      // 色调 — 传递原始 UI 值 (-100..100)，着色器内部完成缩放
      // 共享着色器: pow(2, u_exposure / 50.0)  和  contrast * 2.55 → 标准公式
      u_exposure: p.exposure,
      u_contrast: p.contrast,
      u_highlights: p.highlights,
      u_shadows: p.shadows,
      u_whites: p.whites,
      u_blacks: p.blacks,

      // 曲线 (作为 1D 纹理上传，需要调用者处理)
      u_useCurves: this._hasCurves(p.curves) ? 1.0 : 0.0,
      curveLUTs: {
        rgb: luts.lutRGB,
        red: luts.lutR,
        green: luts.lutG,
        blue: luts.lutB,
      },

      // HSL 参数 (作为数组上传)
      u_useHSL: !isDefaultHSL(p.hslParams) ? 1.0 : 0.0,
      u_hslParams: this._packHSLParams(p.hslParams),

      // 饱和度 (Luma-Preserving, Rec.709)
      u_useSaturation: !isDefaultSaturation(p.saturation) ? 1.0 : 0.0,
      u_saturation: p.saturation ?? 0,

      // 分离色调 (u_split* 前缀匹配共享着色器 uniforms.js)
      u_useSplitTone: !isDefaultSplitTone(p.splitToning) ? 1.0 : 0.0,
      u_splitHighlightHue: (p.splitToning?.highlights?.hue ?? 30) / 360.0,
      u_splitHighlightSat: (p.splitToning?.highlights?.saturation ?? 0) / 100.0,
      u_splitMidtoneHue: (p.splitToning?.midtones?.hue ?? 0) / 360.0,
      u_splitMidtoneSat: (p.splitToning?.midtones?.saturation ?? 0) / 100.0,
      u_splitShadowHue: (p.splitToning?.shadows?.hue ?? 220) / 360.0,
      u_splitShadowSat: (p.splitToning?.shadows?.saturation ?? 0) / 100.0,
      u_splitBalance: (p.splitToning?.balance ?? 0) / 100.0,

      // 3D LUT (需要调用者上传纹理)
      u_hasLut3d: p.lut1 ? 1.0 : 0.0,
      u_lutIntensity: p.lut1Intensity ?? 1.0,

      // Phase I：线性域反转标志（CPU + GPU 客户端均消费，shader main 中 srgbToLinear/linearToSrb 切换）
      u_linearDomainInversion: p.linearDomainInversion ? 1.0 : 0.0,
    };
  }


  // ==========================================================================
  // 私有辅助方法
  // ==========================================================================

  _clamp255(v) {
    return Math.max(0, Math.min(255, v));
  }

  // ==========================================================================
  // Float Pipeline Helper Methods
  // ==========================================================================


  /**
   * Density levels — float version (0.0–1.0 transmittance)
   * Matches _applyDensityLevels() but without 0-255 scaling.
   *
   * @param {number} r - Red transmittance
   * @param {number} g - Green transmittance
   * @param {number} b - Blue transmittance
   * @returns {[number, number, number]} Corrected transmittance
   */
  _applyDensityLevelsFloat(r, g, b) {
    const levels = this.params.densityLevels;
    if (!levels) return [r, g, b];

    const minT = 0.001;
    const log10 = Math.log(10);

    const rangeR = levels.red.max - levels.red.min;
    const rangeG = levels.green.max - levels.green.min;
    const rangeB = levels.blue.max - levels.blue.min;

    let avgRange = (rangeR + rangeG + rangeB) / 3;
    avgRange = Math.max(0.5, Math.min(2.5, avgRange));

    const processChannel = (val, channelLevels, inputRange) => {
      const T = Math.max(val, minT);
      const D = -Math.log(T) / log10;
      if (inputRange <= 0.001) return val;
      const normalized = Math.max(0, Math.min(1, (D - channelLevels.min) / inputRange));
      const Dnew = normalized * avgRange;
      return Math.max(0, Math.min(1, Math.pow(10, -Dnew)));
    };

    return [
      processChannel(r, levels.red, rangeR),
      processChannel(g, levels.green, rangeG),
      processChannel(b, levels.blue, rangeB),
    ];
  }

  /**
   * 3D LUT sampling — float version (0.0–1.0)
   * Trilinear interpolation on the LUT, operating in normalized range.
   *
   * @param {number} r - Red (0.0–1.0)
   * @param {number} g - Green (0.0–1.0)
   * @param {number} b - Blue (0.0–1.0)
   * @param {Object} lut - LUT object { data, size }
   * @param {number} intensity - LUT blend intensity (0–1)
   * @returns {[number, number, number]} LUT-mapped color
   */
  _sampleLUT3DFloat(r, g, b, lut, intensity = 1) {
    if (!lut || !lut.data || !lut.size) return [r, g, b];

    const { size, data } = lut;
    const maxIndex = size - 1;

    const rNorm = Math.max(0, Math.min(1, r));
    const gNorm = Math.max(0, Math.min(1, g));
    const bNorm = Math.max(0, Math.min(1, b));

    const rPos = rNorm * maxIndex;
    const gPos = gNorm * maxIndex;
    const bPos = bNorm * maxIndex;

    const r0 = Math.floor(rPos);
    const r1 = Math.min(maxIndex, r0 + 1);
    const g0 = Math.floor(gPos);
    const g1 = Math.min(maxIndex, g0 + 1);
    const b0 = Math.floor(bPos);
    const b1 = Math.min(maxIndex, b0 + 1);

    const fr = rPos - r0;
    const fg = gPos - g0;
    const fb = bPos - b0;

    const getIdx = (ri, gi, bi) => (ri + gi * size + bi * size * size) * 3;

    const interp = (offset) => {
      const v000 = data[getIdx(r0, g0, b0) + offset];
      const v100 = data[getIdx(r1, g0, b0) + offset];
      const v010 = data[getIdx(r0, g1, b0) + offset];
      const v110 = data[getIdx(r1, g1, b0) + offset];
      const v001 = data[getIdx(r0, g0, b1) + offset];
      const v101 = data[getIdx(r1, g0, b1) + offset];
      const v011 = data[getIdx(r0, g1, b1) + offset];
      const v111 = data[getIdx(r1, g1, b1) + offset];

      const c00 = v000 * (1 - fr) + v100 * fr;
      const c10 = v010 * (1 - fr) + v110 * fr;
      const c01 = v001 * (1 - fr) + v101 * fr;
      const c11 = v011 * (1 - fr) + v111 * fr;

      const c0 = c00 * (1 - fg) + c10 * fg;
      const c1 = c01 * (1 - fg) + c11 * fg;

      return c0 * (1 - fb) + c1 * fb;
    };

    // LUT data is already normalized 0–1 (cube file format)
    const rOut = interp(0);
    const gOut = interp(1);
    const bOut = interp(2);

    if (intensity >= 1) return [rOut, gOut, bOut];

    return [
      r + (rOut - r) * intensity,
      g + (gOut - g) * intensity,
      b + (bOut - b) * intensity,
    ];
  }


  /**
   * Sample a Float32 curve LUT with linear interpolation.
   * Higher precision than the 8-bit variant — output is already normalized 0-1.
   *
   * @param {number} val - Input value (0.0–1.0)
   * @param {Float32Array} lut - Float32 curve LUT (values in 0.0–1.0)
   * @returns {number} Interpolated output (0.0–1.0)
   */
  _sampleCurveLUTFloatHQ(val, lut) {
    const maxIdx = lut.length - 1;
    const pos = Math.max(0, Math.min(1, val)) * maxIdx;
    const lo = Math.floor(pos);
    const hi = Math.min(maxIdx, lo + 1);
    const frac = pos - lo;
    return (1 - frac) * lut[lo] + frac * lut[hi];
  }

  // ==========================================================================
  // 8-bit Pipeline Helper Methods (legacy)
  // ==========================================================================

  /**
   * 应用密度域色阶校正
   * 在密度域进行线性拉伸，将实际密度范围映射到标准输出范围
   * 
   * @param {number} r - 红色 (0-255)
   * @param {number} g - 绿色 (0-255)
   * @param {number} b - 蓝色 (0-255)
   * @returns {[number, number, number]} 处理后的 RGB
   */
  _applyDensityLevels(r, g, b) {
    const levels = this.params.densityLevels;
    if (!levels) return [r, g, b];

    const minT = 0.001;
    const log10 = Math.log(10);

    // 计算三个通道的输入范围
    const rangeR = levels.red.max - levels.red.min;
    const rangeG = levels.green.max - levels.green.min;
    const rangeB = levels.blue.max - levels.blue.min;
    
    // 使用平均范围作为输出范围，保持整体对比度
    let avgRange = (rangeR + rangeG + rangeB) / 3;
    avgRange = Math.max(0.5, Math.min(2.5, avgRange)); // 限制在合理范围内

    // 处理每个通道
    // 将每个通道的 [Dmin, Dmax] 归一化到共同的输出范围 [0, avgRange]
    // 这"拉平"了 RGB 通道，补偿：
    // 1. 彩色负片的橙色遮罩
    // 2. 每层染料的不同特性
    // 3. 扫描仪/光源的色彩不平衡
    const processChannel = (value, channelLevels, inputRange) => {
      // 转换到透射率 (0-1)
      const T = Math.max(value / 255, minT);
      
      // 转换到密度域
      const D = -Math.log(T) / log10;
      
      if (inputRange <= 0.001) return value; // 避免除零
      
      // 归一化到 [0, 1]，然后缩放到 avgRange
      const normalized = Math.max(0, Math.min(1, (D - channelLevels.min) / inputRange));
      const Dnew = normalized * avgRange;
      
      // 转回透射率
      const Tnew = Math.pow(10, -Dnew);
      
      // 转回 0-255
      return Math.max(0, Math.min(255, Tnew * 255));
    };

    return [
      processChannel(r, levels.red, rangeR),
      processChannel(g, levels.green, rangeG),
      processChannel(b, levels.blue, rangeB)
    ];
  }

  _hasCurves(curves) {
    if (!curves) return false;
    // 检查是否有非默认曲线
    // 默认曲线控制点为 {x:0,y:0} → {x:255,y:255} (参见 filmLabConstants.DEFAULT_CURVES)
    const isDefault = (pts) => {
      if (!pts || pts.length !== 2) return false;
      return pts[0]?.x === 0 && pts[0]?.y === 0 && pts[1]?.x === 255 && pts[1]?.y === 255;
    };
    return !isDefault(curves.rgb) || !isDefault(curves.red) || 
           !isDefault(curves.green) || !isDefault(curves.blue);
  }

  _packHSLParams(hslParams) {
    // 打包 HSL 参数为 8x3 数组 (用于 GLSL uniform)
    const channels = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];
    const result = [];
    
    for (const ch of channels) {
      const data = hslParams?.[ch] || { hue: 0, saturation: 0, luminance: 0 };
      result.push([
        data.hue ?? 0,
        data.saturation ?? 0,
        data.luminance ?? 0,
      ]);
    }
    
    return result;
  }

  _sampleLUT3D(r, g, b, lut, intensity = 1) {
    if (!lut || !lut.data || !lut.size) {
      return [r, g, b];
    }

    const { size, data } = lut;
    const maxIndex = size - 1;

    const rNorm = this._clamp255(r) / 255;
    const gNorm = this._clamp255(g) / 255;
    const bNorm = this._clamp255(b) / 255;

    const rPos = rNorm * maxIndex;
    const gPos = gNorm * maxIndex;
    const bPos = bNorm * maxIndex;

    const r0 = Math.floor(rPos);
    const r1 = Math.min(maxIndex, r0 + 1);
    const g0 = Math.floor(gPos);
    const g1 = Math.min(maxIndex, g0 + 1);
    const b0 = Math.floor(bPos);
    const b1 = Math.min(maxIndex, b0 + 1);

    const fr = rPos - r0;
    const fg = gPos - g0;
    const fb = bPos - b0;

    const getIdx = (ri, gi, bi) => (ri + gi * size + bi * size * size) * 3;

    const interp = (offset) => {
      const v000 = data[getIdx(r0, g0, b0) + offset];
      const v100 = data[getIdx(r1, g0, b0) + offset];
      const v010 = data[getIdx(r0, g1, b0) + offset];
      const v110 = data[getIdx(r1, g1, b0) + offset];
      const v001 = data[getIdx(r0, g0, b1) + offset];
      const v101 = data[getIdx(r1, g0, b1) + offset];
      const v011 = data[getIdx(r0, g1, b1) + offset];
      const v111 = data[getIdx(r1, g1, b1) + offset];

      const c00 = v000 * (1 - fr) + v100 * fr;
      const c10 = v010 * (1 - fr) + v110 * fr;
      const c01 = v001 * (1 - fr) + v101 * fr;
      const c11 = v011 * (1 - fr) + v111 * fr;

      const c0 = c00 * (1 - fg) + c10 * fg;
      const c1 = c01 * (1 - fg) + c11 * fg;

      return c0 * (1 - fb) + c1 * fb;
    };

    const rOut = interp(0) * 255;
    const gOut = interp(1) * 255;
    const bOut = interp(2) * 255;

    if (intensity >= 1) {
      return [rOut, gOut, bOut];
    }

    return [
      r + (rOut - r) * intensity,
      g + (gOut - g) * intensity,
      b + (bOut - b) * intensity,
    ];
  }
}

// ============================================================================
// 模块导出
// ============================================================================

module.exports = {
  RenderCore,
  DEFAULT_FILM_CURVE,
  DEFAULT_CROP_RECT,
};
