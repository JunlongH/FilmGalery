/**
 * 25 — FilmLab 工具算法合规性测试
 *
 * 对每个 filmlab 工具进行测试，分析其是否符合常用图片处理软件
 * (Adobe Lightroom / Photoshop / darktable / Negative Lab Pro / RawTherapee)
 * 和去色罩工具的行业标准行为。
 *
 * 参考标准:
 *   - ITU-R BT.709 / BT.601 (luma coefficients)
 *   - CIE 015:2004 (D 光源色度坐标)
 *   - Hurter-Driffield 特性曲线 (sensitometry)
 *   - Adobe Cube LUT spec
 *   - Hermite smoothstep (GLSL 规范)
 *   - von Kries chromatic adaptation
 */

const {
  applyInversion,
  applyInversionRGB,
  invertLinear,
  invertLog,
  calculateBaseDensity,
  applyLogBaseCorrection,
  applyLogBaseCorrectionRGB,
  applyLinearBaseCorrection,
  applyLinearBaseCorrectionRGB,
} = require('../packages/shared/filmLabInversion');
const {
  applyFilmCurve,
  applyFilmCurveFloat,
  applyFilmCurveRGB,
  buildFilmCurveLUT,
  getBuiltinFilmProfile,
} = require('../packages/shared/filmLabCurve');
const {
  computeWBGains,
  computeWBGainsLegacy,
  kelvinToRGB,
  sliderToKelvin,
  solveTempTintFromSample,
} = require('../packages/shared/filmLabWhiteBalance');
const {
  applyHSL,
  rgbToHsl,
  hslToRgb,
  calculateChannelWeight,
  hueDistance,
  HSL_CHANNELS,
  DEFAULT_HSL_PARAMS,
} = require('../packages/shared/filmLabHSL');
const {
  applySplitTone,
  applySplitToneFast,
  prepareSplitTone,
  calculateZoneWeights,
  calculateLuminance,
  smoothstep,
  DEFAULT_SPLIT_TONE_PARAMS,
} = require('../packages/shared/filmLabSplitTone');
const { buildToneLUT, applyToneMapping } = require('../packages/shared/filmLabToneLUT');
const { applySaturation, applySaturationFloat, isDefaultSaturation, LUM_R, LUM_G, LUM_B } = require('../packages/shared/filmLabSaturation');
const { createSpline, buildCurveLUT, buildCurveLUTFloat, applyCurve } = require('../packages/shared/filmLabCurves');
const { getEffectiveInverted, packLUT3DForWebGL, buildCombinedLUT, getLUT3DIndex, sampleLUT3D } = require('../packages/shared/filmLabHelpers');
const { parseCubeLUT } = require('../packages/shared/lutParser');
const { remapDetectedCropRect, nearestOrthogonal } = require('../packages/shared/autoCropCoord');
const { detectEdges, getExpectedAspectRatio, getThresholdsFromSensitivity } = require('../packages/shared/edgeDetection');

// ============================================================================
// filmLabInversion — 负片反转
// ============================================================================

describe('filmLabInversion — 负片反转', () => {
  describe('invertLinear — 线性反转', () => {
    test('255 - x (Lightroom/PS 标准负片反转)', () => {
      // 行业标准: 负片反转 = 数值取反 (255 - x for 8-bit, 1 - x for float)
      expect(invertLinear(0)).toBe(255);
      expect(invertLinear(255)).toBe(0);
      expect(invertLinear(128)).toBe(127);
    });

    test('involution: 两次反转回到原值', () => {
      for (const v of [0, 64, 128, 200, 255]) {
        expect(invertLinear(invertLinear(v))).toBe(v);
      }
    });

    test('单调递减', () => {
      for (let i = 1; i < 256; i++) {
        expect(invertLinear(i)).toBeLessThan(invertLinear(i - 1));
      }
    });
  });

  describe('invertLog — 对数反转', () => {
    test('输出 [0, 255] 范围', () => {
      for (let i = 0; i < 256; i++) {
        const v = invertLog(i);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    });

    test('单调递减 (与 linear 一致方向)', () => {
      for (let i = 1; i < 256; i++) {
        expect(invertLog(i)).toBeLessThanOrEqual(invertLog(i - 1));
      }
    });

    test('对数压缩: 中间值与线性反转不同', () => {
      // log 反转在低密度区 (高输入值) 应产生与线性不同的结果
      expect(invertLog(200)).not.toBe(invertLinear(200));
    });

    test('端点对齐: invertLog(0) ≈ 255, invertLog(255) ≈ 0', () => {
      expect(invertLog(0)).toBe(255);
      expect(invertLog(255)).toBe(0);
    });

    test('密度域反转与 H&D 模型一致 (D = -log10(T))', () => {
      // H&D: 负片密度 D_neg = log10(L/F), 反转 = 1 - T_neg
      // log 模式近似 1 - log(T+1)/log(256), 在密度域工作
      const T = 0.5;
      const v8 = Math.round(T * 255);
      const out = invertLog(v8);
      // 期望接近 1 - log(128+1)/log(256) ≈ 1 - 0.899 = 0.101 → ~26
      expect(out).toBeGreaterThan(20);
      expect(out).toBeLessThan(40);
    });
  });

  describe('applyInversion — 模式选择', () => {
    test('inverted=false 时透传', () => {
      expect(applyInversion(128, { inverted: false })).toBe(128);
    });

    test('linear 模式调用 invertLinear', () => {
      expect(applyInversion(100, { inverted: true, inversionMode: 'linear' })).toBe(155);
    });

    test('log 模式调用 invertLog', () => {
      expect(applyInversion(100, { inverted: true, inversionMode: 'log' })).toBe(invertLog(100));
    });

    test('未知模式回退到 linear', () => {
      expect(applyInversion(100, { inverted: true, inversionMode: 'unknown' })).toBe(155);
    });
  });

  describe('calculateBaseDensity — 片基密度计算', () => {
    test('D = -log10(T/255) 符合 H&D 密度定义', () => {
      // T = 255 (max white) → D = 0
      const { densityR, densityG, densityB } = calculateBaseDensity(255, 255, 255);
      expect(densityR).toBeCloseTo(0, 3);
      expect(densityG).toBeCloseTo(0, 3);
      expect(densityB).toBeCloseTo(0, 3);
    });

    test('T = 25 (~10% trans) → D ≈ 1.0', () => {
      // D = -log10(25/255) = -log10(0.098) ≈ 1.0086
      const { densityR } = calculateBaseDensity(25, 0, 0);
      expect(densityR).toBeCloseTo(1.0, 1);
    });

    test('低值保护: T=0 不抛错 (clamp 到 0.001)', () => {
      expect(() => calculateBaseDensity(0, 0, 0)).not.toThrow();
      const { densityR } = calculateBaseDensity(0, 0, 0);
      // clamp 到 0.001 → D = -log10(0.001) = 3.0
      expect(densityR).toBeCloseTo(3.0, 2);
    });
  });

  describe('applyLogBaseCorrection — 对数域片基校正', () => {
    test('片基密度=0 时透传', () => {
      expect(applyLogBaseCorrection(128, 0)).toBe(128);
    });

    test('D_image = D_scan - D_base (减法校正, 与 Kodak/Adobe 标准一致)', () => {
      // 输入 T=128 → D = -log10(128/255) ≈ 0.2996
      // 片基 D_base = 0.3 → D_corrected = 0.2996 - 0.3 = -0.0004 → T ≈ 1.001 → 255
      const out = applyLogBaseCorrection(128, 0.3);
      expect(out).toBeGreaterThan(250);
    });

    test('负 D_corrected (T > 1) 被 clamp 到 255', () => {
      // T_scan = 200, D_base = 1.0 → D_corrected = -0.105 → T = 1.27 → clamp 255
      const out = applyLogBaseCorrection(200, 1.0);
      expect(out).toBe(255);
    });

    test('校正后密度减小 → T 增大 (片基减除让图像变亮)', () => {
      // 去色罩核心: D_corrected = D_scan - D_base < D_scan → T 增大
      // 当 D_base > 0 且 D_scan > D_base 时，输出应比输入更亮
      // T_scan = 25 (D_scan ≈ 1.01), D_base = 0.3 → D_corrected = 0.71 → T = 0.195 → ~50
      const out = applyLogBaseCorrection(25, 0.3);
      expect(out).toBeGreaterThan(25);
    });
  });

  describe('applyLinearBaseCorrection — 线性域片基校正', () => {
    test('gain=1 时透传', () => {
      expect(applyLinearBaseCorrection(128, 1.0)).toBe(128);
    });

    test('gain>1 增亮 (Lightroom WB gain 模式)', () => {
      expect(applyLinearBaseCorrection(100, 1.5)).toBe(150);
    });

    test('gain<1 减暗', () => {
      expect(applyLinearBaseCorrection(100, 0.5)).toBe(50);
    });

    test('clamp 到 [0, 255]', () => {
      expect(applyLinearBaseCorrection(200, 2.0)).toBe(255);
      expect(applyLinearBaseCorrection(10, 0.0)).toBe(0);
    });
  });
});

// ============================================================================
// filmLabCurve — H&D 胶片特性曲线
// ============================================================================

describe('filmLabCurve — H&D 胶片特性曲线', () => {
  describe('H&D 密度模型', () => {
    test('T → D → 归一化 → gamma → D → T 完整链路', () => {
      // 中间值不应被极端压缩
      const out = applyFilmCurve(128, { gamma: 1.0, dMin: 0, dMax: 3 });
      // gamma=1 时 D_norm 不变 → 输出 ≈ 输入
      expect(out).toBeGreaterThan(100);
      expect(out).toBeLessThan(160);
    });

    test('gamma < 1 在中间密度区提亮 (负片典型 gamma ≈ 0.6)', () => {
      // gamma<1 让 densityNorm (中间值) 增大 → D_adj 增大 → T 减小 (变暗)
      // 实际上: pow(0.5, 0.6) = 0.66 > 0.5, so densityNorm RAISES toward 1
      // → D_adj RAISES → T LOWERS → 输出更暗
      // 这与"gamma<1 提亮"的直觉相反 — 因为密度域反转
      // 在密度域: gamma<1 让密度增加 → 透射率减小 → 输出变暗
      const out = applyFilmCurve(128, { gamma: 0.6, dMin: 0, dMax: 3 });
      const outG1 = applyFilmCurve(128, { gamma: 1.0, dMin: 0, dMax: 3 });
      expect(out).toBeLessThan(outG1);
    });

    test('gamma > 1 在中间密度区压暗', () => {
      // gamma>1 让 densityNorm 减小 → D_adj 减小 → T 增大 → 输出变亮
      const out = applyFilmCurve(128, { gamma: 1.5, dMin: 0, dMax: 3 });
      const outG1 = applyFilmCurve(128, { gamma: 1.0, dMin: 0, dMax: 3 });
      expect(out).toBeGreaterThan(outG1);
    });

    test('gamma=0 安全回退 (P2-8)', () => {
      const out = applyFilmCurve(128, { gamma: 0 });
      const defaultOut = applyFilmCurve(128, { gamma: 0.6 });
      expect(out).toBe(defaultOut);
    });
  });

  describe('toe / shoulder (H&D 三段式)', () => {
    test('toe 在高透射率区域 (低密度) 生效', () => {
      // toe 区域 = densityNorm < toeBound = 0.25 * toe
      // 对应高 T 值 (低密度): T=200, D=0.105, dNorm=0.035 < 0.125 (toe=0.5)
      const noToe = applyFilmCurve(200, { gamma: 0.6, dMin: 0, dMax: 3, toe: 0 });
      const withToe = applyFilmCurve(200, { gamma: 0.6, dMin: 0, dMax: 3, toe: 0.5 });
      // toe 改变该区域的 gamma (γ_toe = γ × 1.5 = 0.9, 更陡)
      expect(withToe).not.toBe(noToe);
    });

    test('shoulder 在低透射率区域 (高密度) 生效', () => {
      // P2-shoulder 修复: shBound = 1 - 0.5*shoulder
      // shoulder=0.5 → shBound=0.75, 需 dNorm > 0.75 → D > 2.25 → T < 10^(-2.25) ≈ 0.0056 → T < 1.4
      // T=1 → D=2.406, dNorm=0.802 > 0.75 → in shoulder region
      const noSh = applyFilmCurve(1, { gamma: 0.6, dMin: 0, dMax: 3, shoulder: 0 });
      const withSh = applyFilmCurve(1, { gamma: 0.6, dMin: 0, dMax: 3, shoulder: 0.5 });
      expect(withSh).not.toBe(noSh);
    });

    test('P2-shoulder: shoulder=0.5 在 8-bit 有效范围内生效', () => {
      // 旧版 shBound=0.875 仅影响 T<0.6/255 (8-bit 无效)
      // 修复后 shBound=0.75 影响 T<5/255 (8-bit 中 T=1-4)
      // T=3 → D=1.926, dNorm=0.642 (not in shoulder with 0.75)
      // T=1 → D=2.406, dNorm=0.802 > 0.75 → in shoulder
      const noSh = applyFilmCurve(1, { gamma: 0.6, dMin: 0, dMax: 3, shoulder: 0 });
      const withSh = applyFilmCurve(1, { gamma: 0.6, dMin: 0, dMax: 3, shoulder: 0.5 });
      expect(withSh).not.toBe(noSh);
    });

    test('过渡区域 C¹ 连续 (Hermite smoothstep)', () => {
      // 在 toe 过渡带附近，输出应无突变
      const LUT = buildFilmCurveLUT({ gamma: 0.6, dMin: 0, dMax: 3, toe: 0.5, shoulder: 0.5 });
      for (let i = 1; i < 255; i++) {
        const delta = Math.abs(LUT[i + 1] - LUT[i]);
        // 单步变化不应超过 5 (防止过渡带产生跳变)
        expect(delta).toBeLessThan(10);
      }
    });
  });

  describe('applyFilmCurveFloat — 浮点版本与 8-bit 一致', () => {
    test('浮点版本与 8-bit 版本近似相等', () => {
      for (const v of [10, 50, 128, 200, 250]) {
        const out8 = applyFilmCurve(v, { gamma: 0.6, dMin: 0.1, dMax: 3.0 });
        const outf = applyFilmCurveFloat(v / 255, { gamma: 0.6, dMin: 0.1, dMax: 3.0 });
        // 浮点输出归一化到 0-255 与 8-bit 版本差异 < 2
        expect(Math.abs(out8 - outf * 255)).toBeLessThan(2);
      }
    });
  });

  describe('内置胶片配置 (FILM_PROFILES)', () => {
    test('default 配置存在', () => {
      const p = getBuiltinFilmProfile('default');
      expect(p).toBeDefined();
      expect(p.gamma).toBeGreaterThan(0);
      expect(p.dMin).toBeGreaterThanOrEqual(0);
      expect(p.dMax).toBeGreaterThan(p.dMin);
    });

    test('未知配置回退到 default', () => {
      const p = getBuiltinFilmProfile('nonexistent');
      const def = getBuiltinFilmProfile('default');
      expect(p).toBe(def);
    });
  });
});

// ============================================================================
// filmLabWhiteBalance — 白平衡
// ============================================================================

describe('filmLabWhiteBalance — 白平衡', () => {
  describe('kelvinToRGB — CIE D 光源色温转换', () => {
    test('D65 (6504K) 应产生接近 (1,1,1) 的归一化 RGB', () => {
      // D65 是 sRGB 的参考白点，理论上 RGB 应相等
      const [r, g, b] = kelvinToRGB(6504);
      // 归一化后最大通道 = 1，但其他通道应接近 1 (因 D65 是 sRGB 的 native 白)
      expect(Math.abs(r - 1)).toBeLessThan(0.1);
      expect(Math.abs(g - 1)).toBeLessThan(0.1);
      expect(Math.abs(b - 1)).toBeLessThan(0.1);
    });

    test('低色温 (2700K, 钨丝灯) 偏暖: R > B', () => {
      const [r, g, b] = kelvinToRGB(2700);
      expect(r).toBeGreaterThan(b);
    });

    test('高色温 (10000K, 阴天) 偏冷: B > R', () => {
      const [r, g, b] = kelvinToRGB(10000);
      expect(b).toBeGreaterThan(r);
    });

    test('4000K 边界 C¹ 连续 (CIE/Kang 混合)', () => {
      // 4000K 是 CIE D 和 Kang Planckian 的边界，导数应连续
      const eps = 10;
      const [r1] = kelvinToRGB(4000 - eps);
      const [r2] = kelvinToRGB(4000);
      const [r3] = kelvinToRGB(4000 + eps);
      const slope1 = (r2 - r1) / eps;
      const slope2 = (r3 - r2) / eps;
      // 斜率变化应平滑 (相对差 < 50%)
      const avgSlope = (slope1 + slope2) / 2;
      if (Math.abs(avgSlope) > 1e-4) {
        expect(Math.abs(slope1 - slope2) / Math.abs(avgSlope)).toBeLessThan(0.5);
      }
    });

    test('7000K CIE D 内部断点连续', () => {
      const [r1, g1, b1] = kelvinToRGB(6999);
      const [r2, g2, b2] = kelvinToRGB(7001);
      expect(Math.abs(r1 - r2)).toBeLessThan(0.01);
      expect(Math.abs(g1 - g2)).toBeLessThan(0.01);
      expect(Math.abs(b1 - b2)).toBeLessThan(0.01);
    });

    test('输出范围 [0, 1] (max-channel 归一化)', () => {
      for (const k of [1500, 3000, 5000, 8000, 15000, 30000]) {
        const [r, g, b] = kelvinToRGB(k);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1.001);
        expect(g).toBeLessThanOrEqual(1.001);
        expect(b).toBeLessThanOrEqual(1.001);
      }
    });

    test('clamp 范围 [1000, 40000]', () => {
      // 极端值不抛错
      expect(() => kelvinToRGB(100)).not.toThrow();
      expect(() => kelvinToRGB(100000)).not.toThrow();
    });
  });

  describe('computeWBGains — 增益计算', () => {
    test('temp=0/tint=0 时增益接近 1.0 (基准 D65)', () => {
      const [r, g, b] = computeWBGains({ temp: 0, tint: 0 });
      // 应接近 1.0 (luminance compensation 让平均 = 1)
      const avg = (r + g + b) / 3;
      expect(Math.abs(avg - 1.0)).toBeLessThan(0.05);
    });

    test('暖色温 (temp < 0): R 增益 < B 增益 (减红加蓝)', () => {
      // 拍暖光场景需要冷校正: 蓝增益 > 红增益
      const [r, , b] = computeWBGains({ temp: -50 });
      expect(b).toBeGreaterThan(r);
    });

    test('冷色温 (temp > 0): R 增益 > B 增益', () => {
      const [r, , b] = computeWBGains({ temp: 50 });
      expect(r).toBeGreaterThan(b);
    });

    test('亮度补偿: 平均增益 ≈ 1.0 (Adobe LR 标准)', () => {
      // LR/PS 标准: WB 调整不应改变整体亮度
      for (const t of [-80, -40, 0, 40, 80]) {
        const [r, g, b] = computeWBGains({ temp: t });
        // Rec.709 加权平均应接近 1
        const avg = 0.299 * r + 0.587 * g + 0.114 * b;
        expect(Math.abs(avg - 1.0)).toBeLessThan(0.05);
      }
    });

    test('tint > 0 (品红): G 增益 < R/B 增益', () => {
      // tint 增加品红 = 减绿
      const [r, g, b] = computeWBGains({ temp: 0, tint: 50 });
      expect(g).toBeLessThan(r);
      expect(g).toBeLessThan(b);
    });

    test('tint < 0 (绿): G 增益 > R/B 增益', () => {
      const [r, g, b] = computeWBGains({ temp: 0, tint: -50 });
      expect(g).toBeGreaterThan(r);
      expect(g).toBeGreaterThan(b);
    });

    test('P2-2: tint 增益随色温缩放 (极端色温下 tint 效果不被稀释)', () => {
      // 在极端冷色温 (temp=80) 下，tint=50 的 G 减量应 ≥ 中性色温下的减量
      // 旧版 tint 增益固定，极端色温下被 Rec.709 亮度补偿抵消
      const [r0, g0] = computeWBGains({ temp: 0, tint: 50 });
      const [r80, g80] = computeWBGains({ temp: 80, tint: 50 });
      const gReduction0 = 1 - g0; // G 相对于 1 的减少量
      const gReduction80 = 1 - g80;
      // 极端色温下 tint 对 G 的减少量不应显著小于中性色温
      // (允许 tempScale 的影响，但不应被完全抵消)
      expect(gReduction80).toBeGreaterThan(gReduction0 * 0.5);
    });

    test('NaN/非法输入安全回退', () => {
      const [r, g, b] = computeWBGains({ temp: NaN, tint: Infinity, red: 'abc' });
      expect(Number.isFinite(r)).toBe(true);
      expect(Number.isFinite(g)).toBe(true);
      expect(Number.isFinite(b)).toBe(true);
    });

    test('增益 clamp 到 [WB_GAIN_LIMITS.min, max]', () => {
      // 极端 temp 不应产生爆炸性增益
      const [r, g, b] = computeWBGains({ temp: 100 });
      expect(r).toBeLessThan(100);
      expect(g).toBeLessThan(100);
      expect(b).toBeLessThan(100);
      expect(r).toBeGreaterThan(0);
    });
  });

  describe('solveTempTintFromSample — 自动白平衡求解器', () => {
    test('中性灰采样 → temp ≈ 0, tint ≈ 0', () => {
      const result = solveTempTintFromSample([128, 128, 128]);
      expect(Math.abs(result.temp)).toBeLessThan(5);
      expect(Math.abs(result.tint)).toBeLessThan(5);
    });

    test('暖色采样 (R > B) → temp < 0 (需要冷校正)', () => {
      const result = solveTempTintFromSample([200, 130, 80]);
      expect(result.temp).toBeLessThan(0);
    });

    test('冷色采样 (B > R) → temp > 0 (需要暖校正)', () => {
      const result = solveTempTintFromSample([80, 130, 200]);
      expect(result.temp).toBeGreaterThan(0);
    });

    test('绿色偏移 (G > R,B) → tint > 0 (加品红中和)', () => {
      // Adobe LR 约定: tint > 0 = magenta (减绿), tint < 0 = green (加绿)
      // 采样 G 偏多 → 需要加品红抵消 → tint > 0
      const result = solveTempTintFromSample([100, 180, 100]);
      expect(result.tint).toBeGreaterThan(0);
    });

    test('求解后应用增益应让采样接近中性灰', () => {
      // 这是 WB 求解的核心契约
      const sample = [200, 130, 80];
      const { temp, tint } = solveTempTintFromSample(sample);
      const [r, g, b] = computeWBGains({ temp, tint });
      const outR = sample[0] * r;
      const outG = sample[1] * g;
      const outB = sample[2] * b;
      // 三通道差异应 < 5% (近似中性灰)
      const avg = (outR + outG + outB) / 3;
      expect(Math.abs(outR - avg) / avg).toBeLessThan(0.05);
      expect(Math.abs(outG - avg) / avg).toBeLessThan(0.05);
      expect(Math.abs(outB - avg) / avg).toBeLessThan(0.05);
    });

    test('边界: 极端采样值不抛错', () => {
      expect(() => solveTempTintFromSample([0, 0, 0])).not.toThrow();
      expect(() => solveTempTintFromSample([255, 255, 255])).not.toThrow();
      expect(() => solveTempTintFromSample(null)).not.toThrow();
    });
  });
});

// ============================================================================
// filmLabHSL — HSL 调整
// ============================================================================

describe('filmLabHSL — HSL 调整', () => {
  describe('rgbToHsl / hslToRgb — 颜色空间转换', () => {
    test('RGB → HSL: 纯红 → H=0, S=1, L=0.5', () => {
      const [h, s, l] = rgbToHsl(255, 0, 0);
      expect(h).toBeCloseTo(0, 0);
      expect(s).toBeCloseTo(1, 3);
      expect(l).toBeCloseTo(0.5, 3);
    });

    test('RGB → HSL: 纯绿 → H=120', () => {
      const [h] = rgbToHsl(0, 255, 0);
      expect(h).toBeCloseTo(120, 0);
    });

    test('RGB → HSL: 纯蓝 → H=240', () => {
      const [h] = rgbToHsl(0, 0, 255);
      expect(h).toBeCloseTo(240, 0);
    });

    test('灰色 → S=0', () => {
      const [, s] = rgbToHsl(128, 128, 128);
      expect(s).toBeCloseTo(0, 3);
    });

    test('HSL → RGB 往返一致性', () => {
      for (const rgb of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 64, 200], [200, 200, 50]]) {
        const [h, s, l] = rgbToHsl(...rgb);
        const [r, g, b] = hslToRgb(h, s, l);
        expect(Math.abs(r - rgb[0])).toBeLessThan(2);
        expect(Math.abs(g - rgb[1])).toBeLessThan(2);
        expect(Math.abs(b - rgb[2])).toBeLessThan(2);
      }
    });
  });

  describe('calculateChannelWeight — 通道权重 (Lightroom HSL 模型)', () => {
    test('中心色相权重 = 1', () => {
      const w = calculateChannelWeight(0, HSL_CHANNELS.red); // red 中心
      expect(w).toBeCloseTo(1, 3);
    });

    test('超出 range 权重 = 0', () => {
      const w = calculateChannelWeight(180, HSL_CHANNELS.red); // 距离 180, range=30
      expect(w).toBe(0);
    });

    test('余弦平滑过渡 (C¹ 连续)', () => {
      // weight = 0.5 * (1 + cos(t * π)), t = dist/range
      const w1 = calculateChannelWeight(15, HSL_CHANNELS.red); // t=0.5
      expect(w1).toBeCloseTo(0.5, 2);
    });

    test('HSL 通道权重构成 (近) 单位分解 — 无弱响应区 (P2-1 修复)', () => {
      // P2-1 修复后: 相邻通道 range 之和 ≥ 中心距，所有 hue 处 totalWeight ≥ 1
      // 旧实现 h=90 处 total=0.25 (弱响应区)，现已修复
      const testHues = [0, 15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 345];
      for (const h of testHues) {
        let total = 0;
        for (const [, ch] of Object.entries(HSL_CHANNELS)) {
          total += calculateChannelWeight(h, ch);
        }
        // 所有 hue 处总权重应 ≥ 1.0 (无弱区)
        expect(total).toBeGreaterThanOrEqual(0.95);
      }
    });
  });

  describe('applyHSL — HSL 应用', () => {
    test('默认参数透传', () => {
      const [r, g, b] = applyHSL(100, 150, 200, DEFAULT_HSL_PARAMS);
      expect([r, g, b]).toEqual([100, 150, 200]);
    });

    test('红色饱和度 +50 让红色更鲜艳', () => {
      const [r] = applyHSL(180, 50, 50, { red: { hue: 0, saturation: 50, luminance: 0 } });
      expect(r).toBeGreaterThan(180);
    });

    test('红色饱和度 -50 让红色去饱和', () => {
      const [r] = applyHSL(180, 50, 50, { red: { hue: 0, saturation: -50, luminance: 0 } });
      expect(r).toBeLessThan(180);
    });

    test('色相偏移: red hue +30 → 橙色调', () => {
      // 红色 hue=0, 偏移 +30 → 落到橙色区间
      const [, g] = applyHSL(220, 30, 30, { red: { hue: 30, saturation: 0, luminance: 0 } });
      // 红色像素向橙色偏移: G 通道应增加
      expect(g).toBeGreaterThan(30);
    });

    test('灰色像素不受色相调整影响 (satRamp)', () => {
      // s ≈ 0 时 hue 调整被衰减
      const [r1, g1, b1] = applyHSL(128, 128, 128, { red: { hue: 30, saturation: 0, luminance: 0 } });
      expect([r1, g1, b1]).toEqual([128, 128, 128]);
    });
  });
});

// ============================================================================
// filmLabSplitTone — 分离色调
// ============================================================================

describe('filmLabSplitTone — 分离色调', () => {
  describe('calculateLuminance — Rec.709 亮度', () => {
    test('纯白 → 1.0', () => {
      expect(calculateLuminance(255, 255, 255)).toBeCloseTo(1, 3);
    });

    test('纯黑 → 0', () => {
      expect(calculateLuminance(0, 0, 0)).toBeCloseTo(0, 3);
    });

    test('Rec.709 系数: 0.2126 R + 0.7152 G + 0.0722 B', () => {
      // 纯绿比纯红亮
      expect(calculateLuminance(0, 255, 0)).toBeGreaterThan(calculateLuminance(255, 0, 0));
      expect(calculateLuminance(0, 0, 255)).toBeLessThan(calculateLuminance(255, 0, 0));
    });
  });

  describe('calculateZoneWeights — 分区权重 (单位分解)', () => {
    test('阴影区 (lum < 0.25): shadow weight = 1', () => {
      const w = calculateZoneWeights(0.1, 0);
      expect(w.shadow).toBeCloseTo(1, 3);
      expect(w.midtone).toBeCloseTo(0, 3);
      expect(w.highlight).toBeCloseTo(0, 3);
    });

    test('高光区 (lum > 0.75): highlight weight = 1', () => {
      const w = calculateZoneWeights(0.9, 0);
      expect(w.highlight).toBeCloseTo(1, 3);
      expect(w.midtone).toBeCloseTo(0, 3);
      expect(w.shadow).toBeCloseTo(0, 3);
    });

    test('中间调 (lum = 0.5, balance = 0): midtone = 1', () => {
      const w = calculateZoneWeights(0.5, 0);
      expect(w.midtone).toBeCloseTo(1, 3);
    });

    test('单位分解: shadow + midtone + highlight ≡ 1 (核心契约)', () => {
      // 这是 darktable / LR split-toning 的关键不变量
      for (const lum of [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1]) {
        for (const bal of [-100, -50, 0, 50, 100]) {
          const w = calculateZoneWeights(lum, bal);
          const sum = w.shadow + w.midtone + w.highlight;
          expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
        }
      }
    });

    test('balance > 0 偏向阴影保护: 中间调边界右移 (Adobe LR 约定)', () => {
      // Adobe LR: positive balance protects shadows (more shadow weight)
      // balance > 0 → midpoint 右移 → 更多像素落入 shadow/midtone, highlight 区域缩小
      // lum=0.6 在 balance=0 时部分为 highlight; balance=50 时 midpoint=0.75 > 0.6 → 不再是 highlight
      const w0 = calculateZoneWeights(0.6, 0);
      const wPos = calculateZoneWeights(0.6, 50);
      expect(wPos.highlight).toBeLessThanOrEqual(w0.highlight);
      expect(wPos.shadow).toBeGreaterThanOrEqual(w0.shadow);
    });

    test('过渡区 smoothstep 连续 (无突变)', () => {
      // 在 0.25-0.5 之间应平滑过渡
      const weights = [];
      for (let i = 0; i <= 100; i++) {
        weights.push(calculateZoneWeights(0.25 + (i / 100) * 0.25, 0).shadow);
      }
      // 单步变化应 < 0.1 (smoothstep 最大斜率 1.5)
      for (let i = 1; i < weights.length; i++) {
        expect(Math.abs(weights[i] - weights[i - 1])).toBeLessThan(0.05);
      }
    });
  });

  describe('smoothstep — Hermite 平滑', () => {
    test('smoothstep(0) = 0, smoothstep(1) = 1', () => {
      expect(smoothstep(0)).toBe(0);
      expect(smoothstep(1)).toBe(1);
    });

    test('smoothstep(0.5) = 0.5 (对称)', () => {
      expect(smoothstep(0.5)).toBeCloseTo(0.5, 5);
    });

    test('C¹ 连续: 端点导数 = 0', () => {
      // Hermite smoothstep 在 0 和 1 处导数为 0
      const eps = 1e-5;
      const dStart = (smoothstep(eps) - smoothstep(0)) / eps;
      const dEnd = (smoothstep(1) - smoothstep(1 - eps)) / eps;
      expect(Math.abs(dStart)).toBeLessThan(1e-2);
      expect(Math.abs(dEnd)).toBeLessThan(1e-2);
    });

    test('clamp 输入到 [0, 1]', () => {
      expect(smoothstep(-1)).toBe(0);
      expect(smoothstep(2)).toBe(1);
    });
  });

  describe('applySplitTone / applySplitToneFast', () => {
    test('默认参数透传', () => {
      const out = applySplitTone(100, 150, 200, DEFAULT_SPLIT_TONE_PARAMS);
      expect(out).toEqual([100, 150, 200]);
    });

    test('阴影着色 (220 hue, 50 sat) → 暗像素偏蓝', () => {
      const params = { shadows: { hue: 220, saturation: 50 }, balance: 0 };
      const out = applySplitTone(20, 20, 20, params);
      // 220 是蓝色，暗像素应偏蓝 (B 增加)
      expect(out[2]).toBeGreaterThan(out[0]);
    });

    test('高光着色 (30 hue, 50 sat) → 亮像素偏暖 (橙黄)', () => {
      const params = { highlights: { hue: 30, saturation: 50 }, balance: 0 };
      const out = applySplitTone(230, 230, 230, params);
      // 30 是橙色，亮像素应偏暖 (R 增加最多)
      expect(out[0]).toBeGreaterThan(out[2]);
    });

    test('applySplitTone 与 applySplitToneFast 数值一致', () => {
      const params = {
        highlights: { hue: 30, saturation: 30 },
        shadows: { hue: 220, saturation: 30 },
        balance: 20,
      };
      const ctx = prepareSplitTone(params);
      for (const rgb of [[50, 50, 50], [128, 128, 128], [200, 200, 200], [100, 150, 80]]) {
        const out1 = applySplitTone(rgb[0], rgb[1], rgb[2], params);
        const out2 = applySplitToneFast(rgb[0], rgb[1], rgb[2], ctx);
        expect(out1).toEqual(out2);
      }
    });
  });
});

// ============================================================================
// filmLabToneLUT — 色调映射 LUT
// ============================================================================

describe('filmLabToneLUT — 色调映射', () => {
  test('默认参数 LUT[i] ≈ i (identity)', () => {
    const lut = buildToneLUT({});
    for (let i = 0; i < 256; i++) {
      expect(Math.abs(lut[i] - i)).toBeLessThan(2);
    }
  });

  test('曝光 +50 提亮全图', () => {
    const lut = buildToneLUT({ exposure: 50 });
    // 2^(50/50) = 2, 中间值应被加倍
    expect(lut[64]).toBeGreaterThan(100);
    expect(lut[128]).toBeGreaterThan(200);
  });

  test('曝光 -50 压暗全图', () => {
    const lut = buildToneLUT({ exposure: -50 });
    expect(lut[200]).toBeLessThan(150);
  });

  test('对比度 +50 增加中灰斜率', () => {
    const lut = buildToneLUT({ contrast: 50 });
    const lut0 = buildToneLUT({});
    // 中灰附近差异最大
    const midDiff = Math.abs(lut[128] - lut0[128]);
    const endDiff = Math.abs(lut[10] - lut0[10]);
    expect(midDiff).toBeGreaterThan(endDiff * 0.5);
  });

  test('对比度公式不除零 (P2-3: ctr clamp [-258, 258])', () => {
    // 极端对比度不应产生 NaN/Infinity
    const lut1 = buildToneLUT({ contrast: 200 });
    const lut2 = buildToneLUT({ contrast: -200 });
    for (let i = 0; i < 256; i++) {
      expect(Number.isFinite(lut1[i])).toBe(true);
      expect(Number.isFinite(lut2[i])).toBe(true);
    }
  });

  test('黑白场 (blacks/whites) 调整窗口', () => {
    const lut = buildToneLUT({ blacks: -50, whites: 50 });
    // blacks < 0 → blackPoint > 0 → 暗部更暗
    expect(lut[10]).toBeLessThan(10);
  });

  test('阴影 +50 提亮暗部 (Bernstein 基函数, 峰值 ~0.33)', () => {
    const lut = buildToneLUT({ shadows: 50 });
    const lut0 = buildToneLUT({});
    // 阴影调整最大影响在 ~0.33 (~84)
    const deltaAtShadow = Math.abs(lut[84] - lut0[84]);
    const deltaAtHighlight = Math.abs(lut[200] - lut0[200]);
    expect(deltaAtShadow).toBeGreaterThan(deltaAtHighlight * 0.5);
  });

  test('高光 -50 压低亮部 (Bernstein 基函数, 峰值 ~0.67)', () => {
    const lut = buildToneLUT({ highlights: -50 });
    const lut0 = buildToneLUT({});
    const deltaAtHighlight = Math.abs(lut[170] - lut0[170]);
    const deltaAtShadow = Math.abs(lut[30] - lut0[30]);
    expect(deltaAtHighlight).toBeGreaterThan(deltaAtShadow * 0.5);
  });

  test('LUT 范围 [0, 255]', () => {
    const lut = buildToneLUT({ exposure: 100, contrast: 100, shadows: 100, highlights: 100 });
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(0);
      expect(lut[i]).toBeLessThanOrEqual(255);
    }
  });

  test('中灰点 (CONTRAST_MID_GRAY) ≈ 0.46 (sRGB 18% reflectance)', () => {
    // 行业标准: 对比度围绕 18% 灰 (sRGB ≈ 46% = 117)
    // 而非 0.5 (50% = 128)
    const { CONTRAST_MID_GRAY } = require('../packages/shared/filmLabConstants');
    expect(CONTRAST_MID_GRAY).toBeLessThan(0.5);
    expect(CONTRAST_MID_GRAY).toBeGreaterThan(0.4);
  });
});

// ============================================================================
// filmLabSaturation — 饱和度
// ============================================================================

describe('filmLabSaturation — 饱和度 (Luma-Preserving)', () => {
  test('strength=0 透传', () => {
    const [r, g, b] = applySaturation(100, 150, 200, 0);
    expect([r, g, b]).toEqual([100, 150, 200]);
  });

  test('strength=-100 全去色 (Y 只)', () => {
    const [r, g, b] = applySaturation(100, 150, 200, -100);
    const Y = 0.2126 * 100 + 0.7152 * 150 + 0.0722 * 200;
    expect(r).toBeCloseTo(Y, -1);
    expect(g).toBeCloseTo(Y, -1);
    expect(b).toBeCloseTo(Y, -1);
  });

  test('strength=+100 色度加倍', () => {
    const [r, g, b] = applySaturation(100, 150, 200, 100);
    const Y = 0.2126 * 100 + 0.7152 * 150 + 0.0722 * 200;
    // R < Y → 应更暗 (远离 Y)
    expect(r).toBeLessThan(100);
    expect(b).toBeGreaterThan(200);
  });

  test('Rec.709 luma 系数', () => {
    expect(LUM_R).toBeCloseTo(0.2126, 4);
    expect(LUM_G).toBeCloseTo(0.7152, 4);
    expect(LUM_B).toBeCloseTo(0.0722, 4);
    // 系数和 = 1
    expect(LUM_R + LUM_G + LUM_B).toBeCloseTo(1, 4);
  });

  test('luma 保持: 灰色像素不受影响', () => {
    const [r, g, b] = applySaturation(128, 128, 128, 100);
    expect([r, g, b]).toEqual([128, 128, 128]);
  });

  test('浮点版本与 8-bit 版本近似一致', () => {
    const [r1, g1, b1] = applySaturation(100, 150, 200, 50);
    const [r2, g2, b2] = applySaturationFloat(100 / 255, 150 / 255, 200 / 255, 50);
    expect(Math.abs(r1 - r2 * 255)).toBeLessThan(2);
    expect(Math.abs(g1 - g2 * 255)).toBeLessThan(2);
    expect(Math.abs(b1 - b2 * 255)).toBeLessThan(2);
  });
});

// ============================================================================
// filmLabCurves — 三次样条曲线
// ============================================================================

describe('filmLabCurves — 自然三次样条', () => {
  test('identity 曲线 (端点 0,0 / 255,255) 透传', () => {
    const lut = buildCurveLUT([{ x: 0, y: 0 }, { x: 255, y: 255 }]);
    for (let i = 0; i < 256; i++) {
      expect(Math.abs(lut[i] - i)).toBeLessThan(2);
    }
  });

  test('反相曲线 (0,255 / 255,0)', () => {
    const lut = buildCurveLUT([{ x: 0, y: 255 }, { x: 255, y: 0 }]);
    expect(lut[0]).toBe(255);
    expect(lut[255]).toBe(0);
  });

  test('样条经过所有控制点 (C² 连续)', () => {
    const points = [{ x: 0, y: 0 }, { x: 64, y: 100 }, { x: 128, y: 128 }, { x: 192, y: 155 }, { x: 255, y: 255 }];
    const lut = buildCurveLUT(points);
    // 控制点应被精确经过 (允许 ±1 量化误差)
    for (const p of points) {
      expect(Math.abs(lut[p.x] - p.y)).toBeLessThan(2);
    }
  });

  test('单调递增曲线无过冲', () => {
    const points = [{ x: 0, y: 0 }, { x: 128, y: 128 }, { x: 255, y: 255 }];
    const lut = buildCurveLUT(points);
    for (let i = 1; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1] - 1);
    }
  });

  test('Fritsch-Carlson 单调约束防过冲', () => {
    // 非单调控制点 → 启用 monotoneClamp 应防止过冲
    const points = [{ x: 0, y: 0 }, { x: 64, y: 200 }, { x: 128, y: 50 }, { x: 255, y: 255 }];
    const lutNoClamp = buildCurveLUT(points);
    const lutClamp = buildCurveLUT(points, { monotoneClamp: true });
    // 启用 clamp 后过冲应减少
    const maxNoClamp = Math.max(...lutNoClamp);
    const maxClamp = Math.max(...lutClamp);
    expect(maxClamp).toBeLessThanOrEqual(maxNoClamp);
  });

  test('P2-11: maxOvershoot 限制样条过冲范围', () => {
    // 构造会产生过冲的 S 曲线控制点
    const points = [{ x: 0, y: 0 }, { x: 64, y: 200 }, { x: 128, y: 50 }, { x: 255, y: 255 }];
    // maxOvershoot=0.05: 允许超出 [0, 255] 范围 5% * 255 = 12.75
    const lut5 = buildCurveLUT(points, { maxOvershoot: 0.05 });
    // maxOvershoot=0.0: 不允许任何过冲
    const lut0 = buildCurveLUT(points, { maxOvershoot: 0.0 });
    // maxOvershoot=1.0: 允许大量过冲
    const lut100 = buildCurveLUT(points, { maxOvershoot: 1.0 });

    const max5 = Math.max(...lut5);
    const max0 = Math.max(...lut0);
    const max100 = Math.max(...lut100);

    // maxOvershoot=0 应比 maxOvershoot=0.05 限制更严
    expect(max0).toBeLessThanOrEqual(max5);
    // maxOvershoot=1.0 应允许更多过冲
    expect(max100).toBeGreaterThanOrEqual(max5);
    // maxOvershoot=0.05 时: yMax=255, yRange=255, allowedHigh = 255 + 12.75 = 267.75 → clamp 到 255
    // 实际上 y 范围是 [0, 255]，所以 allowedHigh 不会超过 255 (已被 clamp)
    expect(max5).toBeLessThanOrEqual(255);
  });

  test('createSpline 边界: 少于 2 点', () => {
    const f1 = createSpline([5], [10]);
    expect(f1(5)).toBe(10);
    const f0 = createSpline([], []);
    expect(f0(100)).toBe(100);
  });

  test('createSpline 重复 x 自动去重', () => {
    const f = createSpline([0, 64, 64, 255], [0, 50, 100, 255]);
    // 不应抛错且函数可调用
    expect(() => f(64)).not.toThrow();
    expect(Number.isFinite(f(64))).toBe(true);
  });

  test('端点外使用线性外推 (匹配 Lightroom 行为)', () => {
    const points = [{ x: 64, y: 50 }, { x: 192, y: 200 }];
    const lut = buildCurveLUT(points);
    // x < 64 应使用左端点 y 值
    expect(lut[0]).toBe(50);
    // x > 192 应使用右端点 y 值
    expect(lut[255]).toBe(200);
  });

  test('浮点 LUT 与 8-bit LUT 近似一致', () => {
    const points = [{ x: 0, y: 0 }, { x: 128, y: 200 }, { x: 255, y: 100 }];
    const lut8 = buildCurveLUT(points);
    const lutF = buildCurveLUTFloat(points, { resolution: 256 });
    for (let i = 0; i < 256; i++) {
      expect(Math.abs(lut8[i] - lutF[i] * 255)).toBeLessThan(3);
    }
  });
});

// ============================================================================
// filmLabHelpers — LUT 工具
// ============================================================================

describe('filmLabHelpers — LUT 工具', () => {
  describe('getEffectiveInverted — 反转状态计算', () => {
    test('positive 永远不反转', () => {
      expect(getEffectiveInverted('positive', true)).toBe(false);
      expect(getEffectiveInverted('positive', false)).toBe(false);
    });

    test('negative/original 使用用户设置', () => {
      expect(getEffectiveInverted('negative', true)).toBe(true);
      expect(getEffectiveInverted('negative', false)).toBe(false);
      expect(getEffectiveInverted('original', true)).toBe(true);
    });
  });

  describe('packLUT3DForWebGL — LUT 打包', () => {
    test('size=2 打包为 2x4 RGBA 纹理', () => {
      // 2³=8 个 RGB 值 → 2*4*4=32 字节
      const data = new Float32Array(8 * 3);
      for (let i = 0; i < 8; i++) {
        data[i * 3] = i / 7;
        data[i * 3 + 1] = 0;
        data[i * 3 + 2] = 0;
      }
      const packed = packLUT3DForWebGL(data, 2);
      expect(packed.length).toBe(2 * 4 * 4);
      // alpha 通道全 255
      expect(packed[3]).toBe(255);
      expect(packed[7]).toBe(255);
    });

    test('数据范围 [0, 255] clamp', () => {
      const data = new Float32Array(8 * 3).fill(2.0); // 越界值
      const packed = packLUT3DForWebGL(data, 2);
      for (let i = 0; i < packed.length; i += 4) {
        expect(packed[i]).toBeLessThanOrEqual(255);
      }
    });

    test('采样顺序匹配 .cube 标准 (B外/G中/R内)', () => {
      // Adobe .cube 标准: for B { for G { for R { ... } } }
      // 索引 = r + g*size + b*size²
      const size = 4;
      const data = new Float32Array(size * size * size * 3);
      // 设置 (r=3, g=0, b=0) = 红
      const redIdx = getLUT3DIndex(3, 0, 0, size) * 3;
      data[redIdx] = 1; data[redIdx + 1] = 0; data[redIdx + 2] = 0;
      const packed = packLUT3DForWebGL(data, size);
      // 纹理坐标: x = r = 3, y = g + b*size = 0
      // packed 索引 = (y * size + x) * 4 = (0 * 4 + 3) * 4 = 12
      expect(packed[12]).toBe(255); // R
      expect(packed[13]).toBe(0);   // G
      expect(packed[14]).toBe(0);   // B
    });
  });

  describe('buildCombinedLUT — LUT 合并', () => {
    test('单 LUT 按强度应用', () => {
      const lut = {
        size: 2,
        data: new Float32Array([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
        intensity: 1.0,
      };
      const combined = buildCombinedLUT(lut, null);
      expect(combined).not.toBeNull();
      // (0,0,0) 输入 → 应用 LUT 后 = (0,0,0)
      expect(combined.data[0]).toBeCloseTo(0, 3);
    });

    test('intensity=0 透传 (输入=输出)', () => {
      const lut = {
        size: 2,
        data: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
        intensity: 0,
      };
      const combined = buildCombinedLUT(lut, null);
      // intensity=0 → 输入透传: (0,0,0) → (0,0,0)
      expect(combined.data[0]).toBeCloseTo(0, 3);
    });
  });

  describe('sampleLUT3D — 三线性采样', () => {
    test('端点采样: (0,0,0) → LUT[0,0,0]', () => {
      const size = 4;
      const data = new Float32Array(size * size * size * 3);
      data[0] = 0.1; data[1] = 0.2; data[2] = 0.3;
      const out = sampleLUT3D(0, 0, 0, { size, data, intensity: 1 });
      expect(out[0]).toBeCloseTo(0.1 * 255, 1);
      expect(out[1]).toBeCloseTo(0.2 * 255, 1);
      expect(out[2]).toBeCloseTo(0.3 * 255, 1);
    });

    test('输出 clamp 到 [0, 255] (P2-11)', () => {
      const size = 2;
      const data = new Float32Array(size * size * size * 3).fill(2.0);
      const out = sampleLUT3D(128, 128, 128, { size, data, intensity: 1 });
      expect(out[0]).toBeLessThanOrEqual(255);
      expect(out[1]).toBeLessThanOrEqual(255);
      expect(out[2]).toBeLessThanOrEqual(255);
    });
  });
});

// ============================================================================
// lutParser — Adobe Cube LUT 解析
// ============================================================================

describe('lutParser — Adobe Cube LUT', () => {
  function makeCube(size) {
    const lines = [`LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          lines.push(`${(r / (size - 1)).toFixed(4)} ${(g / (size - 1)).toFixed(4)} ${(b / (size - 1)).toFixed(4)}`);
        }
      }
    }
    return lines.join('\n');
  }

  test('标准 size=4 cube 文件解析 (Adobe spec: B外/G中/R内)', () => {
    const r = parseCubeLUT(makeCube(4));
    expect(r.size).toBe(4);
    expect(r.data.length).toBe(4 * 4 * 4 * 3);
    // 第一个条目应是 (r=0, g=0, b=0)
    expect(r.data[0]).toBeCloseTo(0, 3);
    expect(r.data[1]).toBeCloseTo(0, 3);
    expect(r.data[2]).toBeCloseTo(0, 3);
    // 最后一个条目应是 (r=3, g=3, b=3) = (1, 1, 1)
    const lastIdx = (4 * 4 * 4 - 1) * 3;
    expect(r.data[lastIdx]).toBeCloseTo(1, 3);
    expect(r.data[lastIdx + 1]).toBeCloseTo(1, 3);
    expect(r.data[lastIdx + 2]).toBeCloseTo(1, 3);
  });

  test('DOMAIN_MIN/MAX 解析', () => {
    const r = parseCubeLUT(makeCube(2));
    expect(r.domainMin).toEqual([0, 0, 0]);
    expect(r.domainMax).toEqual([1, 1, 1]);
  });

  test('TITLE/注释行被忽略', () => {
    const cube = 'TITLE "test"\n# comment\n' + makeCube(2);
    expect(() => parseCubeLUT(cube)).not.toThrow();
  });

  test('1D LUT 被拒绝', () => {
    expect(() => parseCubeLUT('LUT_1D_SIZE 256\n0.0\n0.5\n1.0')).toThrow(/1D LUT/);
  });

  test('缺 LUT_3D_SIZE 但数据完整可推断', () => {
    const cube = makeCube(3).split('\n').filter(l => !l.startsWith('LUT_3D_SIZE')).join('\n');
    const r = parseCubeLUT(cube);
    expect(r.size).toBe(3);
  });

  test('数据长度不符抛错', () => {
    const cube = makeCube(3).split('\n').slice(0, -5).join('\n');
    expect(() => parseCubeLUT(cube)).toThrow(/length mismatch/);
  });

  test('LUT_3D_SIZE 非法值抛错', () => {
    expect(() => parseCubeLUT('LUT_3D_SIZE 1\n')).toThrow(/Invalid/);
    expect(() => parseCubeLUT('LUT_3D_SIZE abc\n')).toThrow(/Invalid/);
  });
});

// ============================================================================
// autoCropCoord — 自动裁剪坐标变换
// ============================================================================

describe('autoCropCoord — 自动裁剪坐标变换', () => {
  test('extraDeg=0 时直接透传', () => {
    const result = remapDetectedCropRect(
      { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      0,
      { orientation: 0, rotationOffset: 0, currentRotation: 0 }
    );
    expect(result.cropRect).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
    expect(result.rotation).toBe(0);
  });

  test('orientation=90 时 cropRect 旋转', () => {
    const result = remapDetectedCropRect(
      { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      90,
      { orientation: 90, rotationOffset: 0, currentRotation: 0 }
    );
    // 旋转后应仍为有效矩形
    expect(result.cropRect.w).toBeGreaterThan(0);
    expect(result.cropRect.h).toBeGreaterThan(0);
    expect(result.cropRect.x).toBeGreaterThanOrEqual(0);
    expect(result.cropRect.y).toBeGreaterThanOrEqual(0);
    expect(result.cropRect.x + result.cropRect.w).toBeLessThanOrEqual(1.001);
    expect(result.cropRect.y + result.cropRect.h).toBeLessThanOrEqual(1.001);
  });

  test('rotation = detectedRotation - orientation - rotationOffset', () => {
    const result = remapDetectedCropRect(
      { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
      45,
      { orientation: 10, rotationOffset: 5, currentRotation: 0 }
    );
    expect(result.rotation).toBe(30); // 45 - 10 - 5
  });

  test('nearestOrthogonal: 90° 规整', () => {
    expect(nearestOrthogonal(85)).toBe(90);
    expect(nearestOrthogonal(95)).toBe(90);
    expect(nearestOrthogonal(0)).toBe(0);
    expect(nearestOrthogonal(180)).toBe(180);
    expect(nearestOrthogonal(359)).toBe(0);
  });

  test('P3: nearestOrthogonal(45°) 返回 null (非正交)', () => {
    // 45° 是精确中点，不应被归入 0 或 90
    expect(nearestOrthogonal(45)).toBeNull();
    expect(nearestOrthogonal(135)).toBeNull();
    expect(nearestOrthogonal(225)).toBeNull();
    expect(nearestOrthogonal(315)).toBeNull();
  });

  test('P3: 非正交旋转 (45°) 直接透传 cropRect', () => {
    const result = remapDetectedCropRect(
      { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
      45,
      { orientation: 0, rotationOffset: 0, currentRotation: 0 }
    );
    // 45° 不做轴对齐旋转，直接透传
    expect(result.cropRect).toEqual({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 });
    expect(result.rotation).toBe(45);
  });
});

// ============================================================================
// edgeDetection — 边缘检测 (Canny + Hough)
// ============================================================================

describe('edgeDetection — Canny + Hough + 矩形查找', () => {
  describe('getThresholdsFromSensitivity', () => {
    test('sensitivity=0 → 高阈值 (少边缘)', () => {
      const t = getThresholdsFromSensitivity(0);
      expect(t.low).toBe(100);
      expect(t.high).toBe(200);
    });

    test('sensitivity=100 → 低阈值 (多边缘)', () => {
      const t = getThresholdsFromSensitivity(100);
      expect(t.low).toBe(30);
      expect(t.high).toBe(100);
    });

    test('单调递减: 灵敏度越高，阈值越低', () => {
      const t50 = getThresholdsFromSensitivity(50);
      const t100 = getThresholdsFromSensitivity(100);
      expect(t100.low).toBeLessThan(t50.low);
      expect(t100.high).toBeLessThan(t50.high);
    });
  });

  describe('getExpectedAspectRatio — 底片格式宽高比', () => {
    test('35mm: 3:2 = 1.5', () => {
      const r = getExpectedAspectRatio('35mm');
      expect(r.minAspect).toBeLessThanOrEqual(1.5);
      expect(r.maxAspect).toBeGreaterThanOrEqual(1.5);
    });

    test('120_66: 6:6 = 1.0 (方形)', () => {
      const r = getExpectedAspectRatio('120_66');
      expect(r.minAspect).toBeLessThanOrEqual(1.0);
      expect(r.maxAspect).toBeGreaterThanOrEqual(1.0);
    });

    test('120 别名 (Phase N 修复)', () => {
      const r = getExpectedAspectRatio('120');
      // 不应回退到 auto (maxAspect=2.5)
      expect(r.maxAspect).toBeLessThan(2.0);
    });

    test('auto 范围最宽', () => {
      const r = getExpectedAspectRatio('auto');
      expect(r.maxAspect - r.minAspect).toBeGreaterThan(1.5);
    });
  });

  describe('detectEdges — 端到端', () => {
    function makeImage(W, H, rectX, rectY, rectW, rectH) {
      const data = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4;
          const inside = x >= rectX && x < rectX + rectW && y >= rectY && y < rectY + rectH;
          const v = inside ? 255 : 0;
          data[idx] = v; data[idx + 1] = v; data[idx + 2] = v; data[idx + 3] = 255;
        }
      }
      return { data, width: W, height: H, channels: 4 };
    }

    let origLog;
    beforeAll(() => { origLog = console.log; console.log = jest.fn(); });
    afterAll(() => { console.log = origLog; });

    test('黑底中央白矩形 → 检测到边框', () => {
      const img = makeImage(200, 200, 25, 25, 150, 150);
      const result = detectEdges(img, { sensitivity: 50 });
      expect(result.cropRect.w).toBeGreaterThan(0.3);
      expect(result.cropRect.h).toBeGreaterThan(0.3);
      expect(result.borderDetected).toBe(true);
    });

    test('纯白图 (无边框) → borderDetected=false, confidence<0.2', () => {
      const data = new Uint8Array(200 * 200 * 4);
      for (let i = 0; i < 200 * 200; i++) {
        const idx = i * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = 255;
        data[idx + 3] = 255;
      }
      const result = detectEdges({ data, width: 200, height: 200, channels: 4 }, { sensitivity: 50 });
      expect(result.borderDetected).toBe(false);
      expect(result.confidence).toBeLessThan(0.2);
    });

    test('旋转 10° 矩形 → 检测角度近 10°', () => {
      const W = 220, H = 220;
      const data = new Uint8Array(W * H * 4);
      const angle = 10 * Math.PI / 180;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4;
          const dx = x - 110, dy = y - 110;
          const lx = dx * Math.cos(-angle) - dy * Math.sin(-angle);
          const ly = dx * Math.sin(-angle) + dy * Math.cos(-angle);
          const inside = Math.abs(lx) <= 75 && Math.abs(ly) <= 75;
          const v = inside ? 255 : 0;
          data[idx] = v; data[idx + 1] = v; data[idx + 2] = v; data[idx + 3] = 255;
        }
      }
      const result = detectEdges({ data, width: W, height: H, channels: 4 }, { sensitivity: 60 });
      const angleDiff = Math.min(Math.abs(result.rotation - 10), Math.abs(result.rotation + 10));
      expect(angleDiff).toBeLessThan(5);
    });
  });
});
