/**
 * Phase A — 渲染一致性修复的回归测试（非烟测）
 *
 * 覆盖：
 * 1. 对比度 ×2.55 缩放三路径统一（buildToneLUT / processPixelFloat / 参考公式）
 * 2. shadows/highlights Bernstein 基函数 clamp 行为（val>1 时权重不反转）
 * 3. splitTone 单位分解：全 luminance 区间权重和≡1、连续性、CPU 两实现一致
 * 4. HSL satRamp 连续性 + CPU 行为断言
 * 5. Film profile 回退：normalizeParams 不吞 profile；getGLSLUniforms 输出 profile 参数
 * 6. 曲线健壮性：重复 x 控制点不产生 NaN；dMax===dMin 不产生 NaN；逐通道 gamma
 * 7. 饱和度越界防护
 */

const { buildToneLUT } = require('../packages/shared/filmLabToneLUT');
const { calculateZoneWeights, applySplitTone, prepareSplitTone, applySplitToneFast, mergeSplitToneParams, validateSplitToneParams } = require('../packages/shared/filmLabSplitTone');
const { applyHSL } = require('../packages/shared/filmLabHSL');
const { applySaturation, applySaturationFloat } = require('../packages/shared/filmLabSaturation');
const { createSpline } = require('../packages/shared/filmLabCurves');
const { applyFilmCurve, applyFilmCurveRGB, FILM_CURVE_PROFILES } = require('../packages/shared/filmLabCurve');
const { RenderCore } = require('../packages/shared/render/RenderCore');
const { SPLIT_TONE_GLSL } = require('../packages/shared/shaders/splitTone');
const { HSL_ADJUST_GLSL } = require('../packages/shared/shaders/hslAdjust');
const { TONEMAP_GLSL } = require('../packages/shared/shaders/tonemap');

// 参考对比度公式（与 tests/helpers.js 的 BUG-11 规范语义一致）
function referenceContrast(v, contrastUI) {
  const C = contrastUI * 2.55;
  const factor = (259 * (C + 255)) / (255 * (259 - C));
  return (v - 0.46) * factor + 0.46;
}

describe('Phase A.1 对比度 ×2.55 统一', () => {
  test('buildToneLUT 与 ×2.55 参考公式一致（±1 灰阶量化误差）', () => {
    const lut = buildToneLUT({ contrast: 50 });
    for (let i = 10; i < 246; i += 17) {
      const expected = Math.min(255, Math.max(0, Math.round(referenceContrast(i / 255, 50) * 255)));
      expect(Math.abs(lut[i] - expected)).toBeLessThanOrEqual(1);
    }
  });

  test('processPixelFloat 与 ×2.55 参考公式一致（含 clamp 与 highlight roll-off）', () => {
    const core = new RenderCore({ contrast: 50 });
    const rollOff = (v) => {
      if (v <= 0.8) return v;
      const t = Math.min((v - 0.8) / 0.2, 10);
      return 0.8 + 0.2 * Math.tanh(t);
    };
    for (const v of [0.1, 0.25, 0.46, 0.6, 0.8, 0.95]) {
      const [r] = core.processPixelFloat(v, v, v);
      // RenderCore 顺序：对比度 → (未 clamp) roll-off → clamp
      const contrasted = referenceContrast(v, 50);
      expect(r).toBeCloseTo(Math.min(1, Math.max(0, rollOff(contrasted))), 4);
    }
  });

  test('buildToneLUT 与 processPixelFloat 互相一致（量化容差 1/255）', () => {
    const lut = buildToneLUT({ contrast: -40 });
    const core = new RenderCore({ contrast: -40 });
    for (let i = 0; i < 256; i += 5) {
      const [r] = core.processPixelFloat(i / 255, i / 255, i / 255);
      expect(Math.abs(r * 255 - lut[i])).toBeLessThanOrEqual(1.5);
    }
  });

  test('GLSL 端保持 ×2.55（字符串契约）', () => {
    expect(TONEMAP_GLSL).toContain('contrast * 2.55');
  });
});

describe('Phase A.2 shadows/highlights 基函数 clamp', () => {
  test('buildToneLUT：过曝像素 (曝光推高) highlights>0 不再压暗死白', () => {
    // 输入 250，曝光+100 (×4) 后 val≈3.9；未 clamp 时 highlights 项符号反转
    const lutPos = buildToneLUT({ exposure: 100, highlights: 50 });
    const lutZero = buildToneLUT({ exposure: 100, highlights: 0 });
    // clamp 后基函数为 0，两者应一致
    expect(lutPos[250]).toBe(lutZero[250]);
  });

  test('GLSL 端基函数使用 clamp 后的 cc（字符串契约）', () => {
    expect(TONEMAP_GLSL).toContain('vec3 cc = clamp(c, 0.0, 1.0)');
    expect(TONEMAP_GLSL).toContain('pow(1.0 - cc, vec3(2.0))');
  });
});

describe('Phase A.3 splitTone 单位分解', () => {
  test('全 luminance 区间权重和 ≡ 1（balance ∈ {-100, -30, 0, 50, 100}）', () => {
    for (const balance of [-100, -30, 0, 50, 100]) {
      for (let i = 0; i <= 1000; i++) {
        const lum = i / 1000;
        const w = calculateZoneWeights(lum, balance);
        expect(w.shadow + w.midtone + w.highlight).toBeCloseTo(1, 10);
        expect(w.shadow).toBeGreaterThanOrEqual(0);
        expect(w.midtone).toBeGreaterThanOrEqual(0);
        expect(w.highlight).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('权重连续：相邻采样点权重差有界（无跳变）', () => {
    for (const balance of [-100, 0, 100]) {
      let prev = calculateZoneWeights(0, balance);
      for (let i = 1; i <= 2000; i++) {
        const cur = calculateZoneWeights(i / 2000, balance);
        for (const k of ['shadow', 'midtone', 'highlight']) {
          expect(Math.abs(cur[k] - prev[k])).toBeLessThan(0.02);
        }
        prev = cur;
      }
    }
  });

  test('极端 balance 下中点被钳制，阴影/高光平台仍存在', () => {
    const wLow = calculateZoneWeights(0.1, 100); // balance=+100 极端
    expect(wLow.shadow).toBe(1);
    const wHigh = calculateZoneWeights(0.9, -100);
    expect(wHigh.highlight).toBe(1);
  });

  test('applySplitTone 与 applySplitToneFast 结果一致（±1）', () => {
    const params = {
      highlights: { hue: 40, saturation: 30 },
      midtones: { hue: 180, saturation: 20 },
      shadows: { hue: 220, saturation: 25 },
      balance: 20,
    };
    const ctx = prepareSplitTone(params);
    for (let i = 0; i < 256; i += 8) {
      const a = applySplitTone(i, 128, 255 - i, params);
      const b = applySplitToneFast(i, 128, 255 - i, ctx);
      for (let c = 0; c < 3; c++) expect(Math.abs(a[c] - b[c])).toBeLessThanOrEqual(1);
    }
  });

  test('GLSL 端同样为单位分解（字符串契约）', () => {
    expect(SPLIT_TONE_GLSL).toContain('1.0 - shadowWeight - highlightWeight');
    expect(SPLIT_TONE_GLSL).not.toContain('abs(lum - midpoint)');
  });

  test('mergeSplitToneParams 保留 midtones', () => {
    const merged = mergeSplitToneParams(
      { midtones: { hue: 100, saturation: 50 } },
      { highlights: { hue: 40, saturation: 10 } }
    );
    expect(merged.midtones).toEqual({ hue: 100, saturation: 50 });
  });

  test('validateSplitToneParams 校验 midtones', () => {
    const r = validateSplitToneParams({ midtones: { hue: 400, saturation: 0 } });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('midtones.hue');
  });
});

describe('Phase A.4 HSL satRamp 连续性', () => {
  test('近灰像素调整随饱和度连续变化（无 s=0.05 阶跃）', () => {
    // 构造一串饱和度递增的近灰像素，输出应连续变化
    const params = { red: { hue: 0, saturation: 50, luminance: 30 } };
    let prev = null;
    for (let i = 0; i <= 40; i++) {
      // 从纯灰(128,128,128) 逐渐增加红色偏移 → s 从 0 增大
      const r = 128 + i;
      const cur = applyHSL(r, 128, 128, params);
      if (prev) {
        for (let c = 0; c < 3; c++) {
          expect(Math.abs(cur[c] - prev[c])).toBeLessThanOrEqual(8);
        }
      }
      prev = cur;
    }
  });

  test('灰像素 luminance 调整仍生效（保留旧灰像素语义）', () => {
    const params = { red: { hue: 0, saturation: 0, luminance: 50 } };
    const [r, g, b] = applyHSL(128, 128, 128, params);
    expect(r).toBeGreaterThan(128);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  test('灰像素 hue/sat 调整被 satRamp 抑制（无色斑）', () => {
    const params = { red: { hue: 90, saturation: 80, luminance: 0 } };
    const [r, g, b] = applyHSL(128, 128, 128, params);
    expect(r).toBe(128);
    expect(g).toBe(128);
    expect(b).toBe(128);
  });

  test('GLSL 端包含 satRamp（字符串契约）', () => {
    expect(HSL_ADJUST_GLSL).toContain('satRamp');
    expect(HSL_ADJUST_GLSL).toContain('mix(linearDelta, asymDelta, satRamp)');
  });
});

describe('Phase A.5 Film profile 回退', () => {
  test('normalizeParams 不吞 profile：gamma/dMin/dMax 默认 undefined', () => {
    const core = new RenderCore({ filmCurveEnabled: true, filmCurveProfile: 'portra800' });
    expect(core.params.filmCurveGamma).toBeUndefined();
    expect(core.params.filmCurveDMin).toBeUndefined();
    expect(core.params.filmCurveDMax).toBeUndefined();
  });

  test('getGLSLUniforms 输出 profile 的 toe/shoulder/gammaR/dMax', () => {
    const core = new RenderCore({ inverted: true, filmCurveEnabled: true, filmCurveProfile: 'portra800' });
    const u = core.getGLSLUniforms();
    const profile = FILM_CURVE_PROFILES.portra800;
    expect(u.u_filmCurveToe).toBe(profile.toe);
    expect(u.u_filmCurveShoulder).toBe(profile.shoulder);
    expect(u.u_filmCurveGammaR).toBe(profile.gammaR);
    expect(u.u_filmCurveGammaB).toBe(profile.gammaB);
    expect(u.u_filmCurveDMax).toBe(profile.dMax);
    expect(u.u_filmCurveDMin).toBe(profile.dMin);
  });

  test('显式参数优先于 profile', () => {
    const core = new RenderCore({
      inverted: true, filmCurveEnabled: true, filmCurveProfile: 'portra800',
      filmCurveGamma: 0.9, filmCurveGammaR: 0.91, filmCurveDMax: 2.5,
    });
    const u = core.getGLSLUniforms();
    expect(u.u_filmCurveGamma).toBe(0.9);
    expect(u.u_filmCurveGammaR).toBe(0.91);
    expect(u.u_filmCurveDMax).toBe(2.5);
    // 未显式指定的仍走 profile
    expect(u.u_filmCurveGammaB).toBe(FILM_CURVE_PROFILES.portra800.gammaB);
  });

  test('processPixelFloat 使用 profile 逐通道 gamma（与默认 gamma 结果不同）', () => {
    const coreProfile = new RenderCore({ inverted: true, filmCurveEnabled: true, filmCurveProfile: 'portra800' });
    const coreDefault = new RenderCore({ inverted: true, filmCurveEnabled: true, filmCurveProfile: 'default' });
    const a = coreProfile.processPixelFloat(0.5, 0.5, 0.5);
    const b = coreDefault.processPixelFloat(0.5, 0.5, 0.5);
    // portra800 dMax=3.2 vs default 3.0，且 toe>0 → 输出必然不同
    expect(a[0]).not.toBeCloseTo(b[0], 6);
  });
});

describe('Phase A.6 曲线健壮性', () => {
  test('重复 x 控制点不产生 NaN', () => {
    const s = createSpline([0, 0.5, 0.5, 1], [0, 0.4, 0.6, 1]);
    for (let i = 0; i <= 100; i++) {
      expect(Number.isFinite(s(i / 100))).toBe(true);
    }
  });

  test('乱序控制点不产生 NaN 且单调取样可用', () => {
    const s = createSpline([1, 0, 0.5], [1, 0, 0.5]);
    expect(s(0.25)).toBeCloseTo(0.25, 6);
    expect(s(0.75)).toBeCloseTo(0.75, 6);
  });

  test('dMax === dMin 不产生 NaN', () => {
    const v = applyFilmCurve(128, { dMin: 1.5, dMax: 1.5 });
    expect(Number.isFinite(v)).toBe(true);
  });

  test('applyFilmCurveRGB 使用逐通道 gamma', () => {
    const [r, g, b] = applyFilmCurveRGB(128, 128, 128, {
      gamma: 0.6, gammaR: 0.3, gammaB: 0.9, dMin: 0.1, dMax: 3.0,
    });
    // 逐通道 gamma 不同 → 三通道输出两两不同
    expect(r).not.toBe(g);
    expect(g).not.toBe(b);
    // 与单通道 applyFilmCurve 对应 gamma 一致
    expect(r).toBe(applyFilmCurve(128, { gamma: 0.3, dMin: 0.1, dMax: 3.0 }));
    expect(g).toBe(applyFilmCurve(128, { gamma: 0.6, dMin: 0.1, dMax: 3.0 }));
    expect(b).toBe(applyFilmCurve(128, { gamma: 0.9, dMin: 0.1, dMax: 3.0 }));
  });
});

describe('Phase A.7 饱和度越界防护', () => {
  test('strength < -100 不产生色度反转', () => {
    const [r, g, b] = applySaturation(200, 100, 50, -200);
    const lum = 0.2126 * 200 + 0.7152 * 100 + 0.0722 * 50;
    expect(r).toBe(Math.round(lum));
    expect(g).toBe(Math.round(lum));
    expect(b).toBe(Math.round(lum));
  });

  test('float 版本同样防护', () => {
    const [r] = applySaturationFloat(0.9, 0.2, 0.1, -500);
    const lum = 0.2126 * 0.9 + 0.7152 * 0.2 + 0.0722 * 0.1;
    expect(r).toBeCloseTo(lum, 6);
  });
});
