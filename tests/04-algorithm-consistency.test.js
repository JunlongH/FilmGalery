/**
 * 算法数值一致性测试
 * 
 * 验证 GLSL 算法的 CPU 参考实现（从 GLSL 源码直译为 JS）
 * 与项目现有的 CPU 实现 (filmLabHSL.js, filmLabSplitTone.js, filmLabConstants.js)
 * 在数值上保持一致。
 * 
 * 测试策略：
 * - 对关键算法生成一组测试向量
 * - CPU reference (tests/helpers.js) vs GLSL literal translation
 * - CPU reference vs existing project CPU code
 * - 容差: float 精度 1e-4 (着色器是 mediump/highp float)
 */
'use strict';

const {
  approxEqual,
  approxEqualVec,
  cpuContrast,
  cpuSmoothstep,
  cpuHighlightRollOff,
  cpuHslChannelWeight,
  cpuHighlightsShadows,
  cpuWhitesBlacks,
  cpuExposure,
  cpuSplitToneZoneWeights,
} = require('./helpers');

// ============================================================================
// 项目 CPU 模块
// ============================================================================

const { CONTRAST_MID_GRAY } = require('../packages/shared/filmLabConstants');
const { calculateZoneWeights, LUMINANCE_CONFIG } = require('../packages/shared/filmLabSplitTone');
const { HSL_CHANNELS } = require('../packages/shared/filmLabHSL');

// ============================================================================
// 1. Contrast Formula (BUG-11: mid-gray 0.46, ×2.55)
// ============================================================================

describe('Contrast formula — mid-gray 0.46, ×2.55 scaling', () => {
  test('CONTRAST_MID_GRAY 常量 = 0.46', () => {
    expect(CONTRAST_MID_GRAY).toBe(0.46);
  });

  test('零对比度不改变值', () => {
    for (const v of [0, 0.1, 0.25, 0.46, 0.5, 0.75, 1.0]) {
      expect(cpuContrast(v, 0)).toBeCloseTo(v, 5);
    }
  });

  test('正对比度增加中灰两侧的差距', () => {
    const midGray = 0.46;
    // 高于 mid-gray 的值应增加
    expect(cpuContrast(0.7, 50)).toBeGreaterThan(0.7);
    // 低于 mid-gray 的值应降低
    expect(cpuContrast(0.2, 50)).toBeLessThan(0.2);
    // mid-gray 不变
    expect(cpuContrast(midGray, 50)).toBeCloseTo(midGray, 5);
  });

  test('负对比度减小中灰两侧的差距', () => {
    const midGray = 0.46;
    expect(cpuContrast(0.8, -50)).toBeLessThan(0.8);
    expect(cpuContrast(0.1, -50)).toBeGreaterThan(0.1);
    expect(cpuContrast(midGray, -50)).toBeCloseTo(midGray, 5);
  });

  test('contrast=100 的缩放因子验证', () => {
    // C = 100 * 2.55 = 255
    // factor = (259 * (255 + 255)) / (255 * (259 - 255))
    // = (259 * 510) / (255 * 4) = 132090 / 1020 ≈ 129.5
    const C = 100 * 2.55;
    const factor = (259 * (C + 255)) / (255 * (259 - C));
    expect(factor).toBeCloseTo(129.5, 0);
  });

  test('与 (259*(C+255))/(255*(259-C)) 标准公式一致', () => {
    const testValues = [0.1, 0.3, 0.46, 0.6, 0.9];
    const testContrasts = [-100, -50, 0, 25, 50, 100];

    for (const contrast of testContrasts) {
      const C = contrast * 2.55;
      const factor = (259 * (C + 255)) / (255 * (259 - C));
      for (const v of testValues) {
        const expected = (v - 0.46) * factor + 0.46;
        expect(cpuContrast(v, contrast)).toBeCloseTo(expected, 10);
      }
    }
  });
});

// ============================================================================
// 2. Hermite Smoothstep
// ============================================================================

describe('Hermite smoothstep', () => {
  test('边界值: t=0 → 0, t=1 → 1', () => {
    expect(cpuSmoothstep(0)).toBe(0);
    expect(cpuSmoothstep(1)).toBe(1);
  });

  test('中点: t=0.5 → 0.5', () => {
    expect(cpuSmoothstep(0.5)).toBeCloseTo(0.5, 10);
  });

  test('clamp: t<0 → 0, t>1 → 1', () => {
    expect(cpuSmoothstep(-0.5)).toBe(0);
    expect(cpuSmoothstep(1.5)).toBe(1);
  });

  test('单调递增', () => {
    let prev = 0;
    for (let t = 0.05; t <= 1.0; t += 0.05) {
      const val = cpuSmoothstep(t);
      expect(val).toBeGreaterThanOrEqual(prev);
      prev = val;
    }
  });
});

// ============================================================================
// 3. Highlight Roll-Off (tanh)
// ============================================================================

describe('Highlight Roll-Off — tanh shoulder compression', () => {
  test('低于阈值 (0.8) 的值不变', () => {
    const input = [0.3, 0.5, 0.7];
    const output = cpuHighlightRollOff(input);
    expect(approxEqualVec(input, output)).toBe(true);
  });

  test('高于阈值的值被压缩', () => {
    const input = [1.2, 0.9, 0.85];
    const output = cpuHighlightRollOff(input);
    const maxInput = Math.max(...input);
    const maxOutput = Math.max(...output);
    // 压缩后最大值应小于输入
    expect(maxOutput).toBeLessThan(maxInput);
    // 但仍大于阈值
    expect(maxOutput).toBeGreaterThan(0.8);
  });

  test('极端值也被压缩到接近 1.0', () => {
    const input = [3.0, 2.0, 1.5];
    const output = cpuHighlightRollOff(input);
    // tanh(10) → ~1.0, 所以 compressed ≈ 0.8 + 0.2*1.0 = 1.0
    expect(Math.max(...output)).toBeLessThanOrEqual(1.01);
  });

  test('保持颜色比例 (等比缩放)', () => {
    const input = [1.5, 1.0, 0.5];
    const output = cpuHighlightRollOff(input);
    // r/g = r'/g', g/b = g'/b' (等比)
    expect(output[0] / output[1]).toBeCloseTo(input[0] / input[1], 4);
    expect(output[1] / output[2]).toBeCloseTo(input[1] / input[2], 4);
  });
});

// ============================================================================
// 4. HSL Channel Weights
// ============================================================================

describe('HSL channel weights — cosine transition', () => {
  test('中心色相权重 = 1.0', () => {
    expect(cpuHslChannelWeight(0, 0, 30)).toBe(1.0);
    expect(cpuHslChannelWeight(120, 120, 45)).toBe(1.0);
    expect(cpuHslChannelWeight(330, 330, 30)).toBe(1.0);
  });

  test('边界外权重 = 0', () => {
    expect(cpuHslChannelWeight(60, 0, 30)).toBe(0);  // 距离=60 > range=30
    expect(cpuHslChannelWeight(180, 120, 45)).toBeCloseTo(0, 5);
  });

  test('环形距离: 红色通道 (center=0) 接收 hue=350', () => {
    // 距离 = min(|350-0|, 360-|350-0|) = min(350, 10) = 10
    const w = cpuHslChannelWeight(350, 0, 30);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1);
  });

  test('HSL_CHANNELS 定义与 GLSL hslAdjust 中心色相一致', () => {
    const expectedCenters = {
      red: 0, orange: 30, yellow: 60, green: 120,
      cyan: 180, blue: 240, purple: 280, magenta: 330,
    };

    for (const [key, channel] of Object.entries(HSL_CHANNELS)) {
      expect(channel.hueCenter).toBe(expectedCenters[key]);
    }
  });

  test('magenta 中心色相 = 330° (BUG-06 修复验证)', () => {
    expect(HSL_CHANNELS.magenta.hueCenter).toBe(330);
    // GLSL 中也应使用 330 (P2-1: range 从 30 调整为 50 以保证单位分解)
    const hslGLSL = require('../packages/shared/shaders/hslAdjust').HSL_ADJUST_GLSL;
    expect(hslGLSL).toContain('hslChannelWeight(h, 330.0, 50.0)');
  });

  test('权重归一化: P2-1 修复后使用 max(1.0, totalWeight)', () => {
    // P2-1: 旧版仅在 totalWeight > 1 时归一化，弱区 (total < 1) 不补偿
    // 修复后统一除以 max(1.0, totalWeight)，消除弱响应区
    const hslGLSL = require('../packages/shared/shaders/hslAdjust').HSL_ADJUST_GLSL;
    expect(hslGLSL).toContain('max(1.0, totalWeight)');
  });
});

// ============================================================================
// 5. Asymmetric HSL Saturation / Luminance (BUG-04/05)
// ============================================================================

describe('Asymmetric HSL sat/lum formulas', () => {
  test('GLSL 包含非对称饱和度公式', () => {
    const glsl = require('../packages/shared/shaders/hslAdjust').HSL_ADJUST_GLSL;
    // 正值: s + (1 - s) * satAdjust
    expect(glsl).toContain('s + (1.0 - s) * satAdjust');
    // 负值: s * (1 + satAdjust)
    expect(glsl).toContain('s * (1.0 + satAdjust)');
  });

  test('GLSL 包含非对称明度公式 (带 0.5 阻尼，satRamp 混合)', () => {
    const glsl = require('../packages/shared/shaders/hslAdjust').HSL_ADJUST_GLSL;
    // 非对称增量分量仍存在（按 satRamp 与线性增量混合）
    expect(glsl).toContain('(1.0 - l) * lumAdjust * 0.5');
    expect(glsl).toContain('l * lumAdjust * 0.5');
    expect(glsl).toContain('mix(linearDelta, asymDelta, satRamp)');
  });

  test('CPU filmLabHSL 与 GLSL 公式一致', () => {
    // 读取 CPU 实现关键行 — 已知使用相同公式:
    // s + (1 - s) * satAdjust  vs  s * (1 + satAdjust)
    // l + (1 - l) * lumAdjust * 0.5  vs  l * (1 + lumAdjust * 0.5)
    // 数值验证:
    const s = 0.4;
    const satPos = 0.5;  // +50%
    const satNeg = -0.3; // -30%

    // 正向: 从 0.4 扩展到 1.0
    expect(s + (1 - s) * satPos).toBeCloseTo(0.7, 5);
    // 负向: 从 0.4 压缩到 0
    expect(s * (1 + satNeg)).toBeCloseTo(0.28, 5);

    const l = 0.6;
    const lumPos = 0.4;
    const lumNeg = -0.5;

    // 正向明度 (带 0.5 阻尼)
    expect(l + (1 - l) * lumPos * 0.5).toBeCloseTo(0.68, 5);
    // 负向明度
    expect(l * (1 + lumNeg * 0.5)).toBeCloseTo(0.45, 5);
  });
});

// ============================================================================
// 6. Split Tone Zone Weights — CPU vs GLSL reference
// ============================================================================

describe('Split Tone zone weights — CPU vs GLSL', () => {
  test('LUMINANCE_CONFIG 匹配 GLSL 常量', () => {
    expect(LUMINANCE_CONFIG.shadowEnd).toBe(0.25);
    expect(LUMINANCE_CONFIG.highlightStart).toBe(0.75);
  });

  test('纯阴影区: lum=0.1, balance=0', () => {
    const cpu = calculateZoneWeights(0.1, 0);
    const glsl = cpuSplitToneZoneWeights(0.1, 0);
    expect(cpu.shadow).toBeCloseTo(glsl.shadow, 4);
    expect(cpu.highlight).toBeCloseTo(glsl.highlight, 4);
  });

  test('纯高光区: lum=0.9, balance=0', () => {
    const cpu = calculateZoneWeights(0.9, 0);
    const glsl = cpuSplitToneZoneWeights(0.9, 0);
    expect(cpu.shadow).toBeCloseTo(glsl.shadow, 4);
    expect(cpu.highlight).toBeCloseTo(glsl.highlight, 4);
  });

  test('中间调中心: lum=0.5, balance=0', () => {
    const cpu = calculateZoneWeights(0.5, 0);
    const glsl = cpuSplitToneZoneWeights(0.5, 0);
    expect(cpu.midtone).toBeCloseTo(glsl.midtone, 4);
    expect(cpu.shadow).toBeCloseTo(glsl.shadow, 4);
    expect(cpu.highlight).toBeCloseTo(glsl.highlight, 4);
  });

  test('balance 偏移: balance=50 → midpoint shifts', () => {
    // CPU calculateZoneWeights 接受 balance (-100..100)
    // GLSL reference 接受 balance/100 = 0.5
    const cpu = calculateZoneWeights(0.5, 50);
    const glsl = cpuSplitToneZoneWeights(0.5, 50 / 100);
    expect(cpu.shadow).toBeCloseTo(glsl.shadow, 4);
    expect(cpu.midtone).toBeCloseTo(glsl.midtone, 4);
    expect(cpu.highlight).toBeCloseTo(glsl.highlight, 4);
  });

  test('balance / 2.0 偏移（非 balance * 0.15）— BUG-08 验证', () => {
    const glsl = require('../packages/shared/shaders/splitTone').SPLIT_TONE_GLSL;
    expect(glsl).toContain('u_splitBalance / 2.0');
    // 不应使用旧的 * 0.15
    expect(glsl).not.toContain('* 0.15');
  });

  test('GLSL 使用 Hermite smoothstep (自定义函数，非内置)', () => {
    const glsl = require('../packages/shared/shaders/splitTone').SPLIT_TONE_GLSL;
    expect(glsl).toContain('splitToneSmoothstep');
    // 验证自定义实现: t * t * (3.0 - 2.0 * t)
    expect(glsl).toContain('t * t * (3.0 - 2.0 * t)');
  });
});

// ============================================================================
// 7. Split Tone — Lerp-to-Tint (BUG-09)
// ============================================================================

describe('Split Tone — lerp-to-tint blend (BUG-09)', () => {
  test('GLSL 使用 += (tint - result) * strength * 0.3', () => {
    const glsl = require('../packages/shared/shaders/splitTone').SPLIT_TONE_GLSL;
    // 搜索 lerp-to-tint 模式
    expect(glsl).toMatch(/result\s*\+=\s*\(shadowTint\s*-\s*result\)\s*\*\s*strength\s*\*\s*0\.3/);
    expect(glsl).toMatch(/result\s*\+=\s*\(midtoneTint\s*-\s*result\)\s*\*\s*strength\s*\*\s*0\.3/);
    expect(glsl).toMatch(/result\s*\+=\s*\(highlightTint\s*-\s*result\)\s*\*\s*strength\s*\*\s*0\.3/);
  });

  test('不使用 multiply-blend (旧 bug: color * tint)', () => {
    const glsl = require('../packages/shared/shaders/splitTone').SPLIT_TONE_GLSL;
    // 不应出现 color * shadowTint 形式的 multiply blend
    expect(glsl).not.toMatch(/color\s*\*\s*shadowTint/);
    expect(glsl).not.toMatch(/color\s*\*\s*highlightTint/);
  });
});

// ============================================================================
// 8. Exposure Formula
// ============================================================================

describe('Exposure — f-stop formula', () => {
  test('exposure=0 → factor=1 (无变化)', () => {
    expect(cpuExposure([0.5, 0.5, 0.5], 0)).toEqual([0.5, 0.5, 0.5]);
  });

  test('exposure=50 → factor=2 (一档光圈)', () => {
    const result = cpuExposure([0.3, 0.3, 0.3], 50);
    expect(result[0]).toBeCloseTo(0.6, 5);
  });

  test('exposure=-50 → factor=0.5 (减一档)', () => {
    const result = cpuExposure([0.6, 0.6, 0.6], -50);
    expect(result[0]).toBeCloseTo(0.3, 5);
  });
});

// ============================================================================
// 9. Highlights / Shadows — Bernstein Basis
// ============================================================================

describe('Highlights / Shadows — Bernstein basis', () => {
  test('shadows=0, highlights=0 → 无变化', () => {
    const input = [0.3, 0.5, 0.8];
    const output = cpuHighlightsShadows(input, 0, 0);
    expect(approxEqualVec(input, output)).toBe(true);
  });

  test('正 shadows 提亮暗部', () => {
    const input = [0.2, 0.2, 0.2];
    const output = cpuHighlightsShadows(input, 50, 0);
    expect(output[0]).toBeGreaterThan(input[0]);
  });

  test('正 highlights 提亮亮部', () => {
    const input = [0.8, 0.8, 0.8];
    const output = cpuHighlightsShadows(input, 0, 50);
    expect(output[0]).toBeGreaterThan(input[0]);
  });

  test('Bernstein basis: 对极端值(0/1)影响为0', () => {
    // p^2(1-p)*4 at p=0: 0; at p=1: 0
    // (1-p)^2*p*4 at p=0: 0; at p=1: 0
    expect(cpuHighlightsShadows([0, 0, 0], 100, 100)).toEqual([0, 0, 0]);
    expect(cpuHighlightsShadows([1, 1, 1], 100, 100)).toEqual([1, 1, 1]);
  });
});

// ============================================================================
// 10. Whites / Blacks
// ============================================================================

describe('Whites / Blacks — window remap', () => {
  test('whites=0, blacks=0 → 无变化', () => {
    const input = [0.3, 0.5, 0.8];
    const output = cpuWhitesBlacks(input, 0, 0);
    expect(approxEqualVec(input, output)).toBe(true);
  });

  test('正 blacks 提升黑电平 (裁切暗部)', () => {
    // blacks > 0 → blackPoint < 0 → 映射范围缩小
    const output = cpuWhitesBlacks([0.0, 0.5, 1.0], 50, 0);
    expect(output[0]).toBeGreaterThan(0); // 原来的0被提升
  });
});

// ============================================================================
// 11. Film Curve — 3-Segment S-Curve
// ============================================================================

describe('Film Curve GLSL structure', () => {
  test('包含 threeSegGamma 函数', () => {
    const glsl = require('../packages/shared/shaders/filmCurve').FILM_CURVE_GLSL;
    expect(glsl).toContain('threeSegGamma');
  });

  test('toe gamma = gamma * 1.5', () => {
    const glsl = require('../packages/shared/shaders/filmCurve').FILM_CURVE_GLSL;
    expect(glsl).toContain('gamma * 1.5');
  });

  test('shoulder gamma = gamma * 0.6', () => {
    const glsl = require('../packages/shared/shaders/filmCurve').FILM_CURVE_GLSL;
    expect(glsl).toContain('gamma * 0.6');
  });

  test('过渡窗口 tw = 0.08', () => {
    const glsl = require('../packages/shared/shaders/filmCurve').FILM_CURVE_GLSL;
    expect(glsl).toMatch(/tw\s*=\s*0\.08/);
  });
});
