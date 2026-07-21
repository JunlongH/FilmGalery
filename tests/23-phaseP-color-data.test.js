/**
 * Phase P — Color Algorithms & Data Integrity
 *
 * 覆盖：
 *   - P.1: validateExportParams 补 splitToning + NaN 校验
 *   - P.2: hasParamsDifference 用 stableSerializeParams（键序无关）
 *   - P.3: mergeDeep 数组深拷贝（不污染输入）
 *   - P.4: filmLabExport 使用 canonical 默认值
 *   - P.6: WB Y 保持块死代码删除（max 归一化等价）
 *   - P.7: filmLabConstants 死导出删除
 *   - P.9: 对比度除零防护
 *   - P.10: gamma 非零校验
 *   - P.11: sampleLUT3D 输出 clamp
 */

const {
  validateExportParams,
  hasParamsDifference,
  mergeDeep,
  buildExportParams,
  DEFAULT_HSL_PARAMS,
  DEFAULT_SPLIT_TONING,
} = require('../packages/shared/filmLabExport');
const filmLabConstants = require('../packages/shared/filmLabConstants');
const { DEFAULT_HSL_PARAMS: HSL_CANONICAL } = require('../packages/shared/filmLabHSL');
const { DEFAULT_SPLIT_TONE_PARAMS: ST_CANONICAL } = require('../packages/shared/filmLabSplitTone');
const { buildToneLUT } = require('../packages/shared/filmLabToneLUT');
const { applyFilmCurve, applyFilmCurveFloat } = require('../packages/shared/filmLabCurve');
const { sampleLUT3D } = require('../packages/shared/filmLabHelpers');
const { computeWBGains } = require('../packages/shared/filmLabWhiteBalance');

describe('Phase P.1 — validateExportParams: splitToning + NaN 校验', () => {
  test('拒绝 NaN 的 HSL.hue', () => {
    const params = buildExportParams(null, {
      hslParams: { red: { hue: NaN, saturation: 0, luminance: 0 } },
    });
    const result = validateExportParams(params);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('red.hue'))).toBe(true);
  });

  test('拒绝 NaN 的 HSL.saturation', () => {
    const params = buildExportParams(null, {
      hslParams: { blue: { hue: 0, saturation: NaN, luminance: 0 } },
    });
    const result = validateExportParams(params);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('blue.saturation'))).toBe(true);
  });

  test('拒绝越界 splitToning.highlights.hue', () => {
    const params = buildExportParams(null, {
      splitToning: { highlights: { hue: 400, saturation: 50 } },
    });
    const result = validateExportParams(params);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('splitToning.highlights.hue'))).toBe(true);
  });

  test('拒绝 splitToning.shadows.saturation 越界', () => {
    const params = buildExportParams(null, {
      splitToning: { shadows: { hue: 220, saturation: 150 } },
    });
    const result = validateExportParams(params);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('splitToning.shadows.saturation'))).toBe(true);
  });

  test('合法参数通过校验', () => {
    const params = buildExportParams(null, {
      hslParams: { red: { hue: 10, saturation: 20, luminance: -5 } },
      splitToning: { highlights: { hue: 30, saturation: 40 } },
    });
    const result = validateExportParams(params);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('Phase P.2 — hasParamsDifference: stableSerializeParams', () => {
  test('键序不同的对象被视为相等', () => {
    const p1 = buildExportParams(null, {
      hslParams: { red: { hue: 10, saturation: 0, luminance: 0 } },
    });
    // 构造一个键序不同的对象（hslParams 字段顺序不同）
    const p2 = buildExportParams(null, {});
    p2.hslParams = {
      red: { luminance: 0, hue: 10, saturation: 0 },
    };
    expect(hasParamsDifference(p1, p2)).toBe(false);
  });

  test('splitToning 键序不同但值相等 → 无差异', () => {
    const p1 = buildExportParams(null, {});
    p1.splitToning = { highlights: { hue: 30, saturation: 0 }, shadows: { hue: 220, saturation: 0 }, balance: 0 };
    const p2 = buildExportParams(null, {});
    p2.splitToning = { balance: 0, shadows: { saturation: 0, hue: 220 }, highlights: { saturation: 0, hue: 30 } };
    expect(hasParamsDifference(p1, p2)).toBe(false);
  });

  test('实际有差异时正确检测', () => {
    const p1 = buildExportParams(null, { exposure: 10 });
    const p2 = buildExportParams(null, { exposure: 20 });
    expect(hasParamsDifference(p1, p2)).toBe(true);
  });
});

describe('Phase P.3 — mergeDeep: 数组深拷贝', () => {
  test('返回值中的数组与输入不共享引用', () => {
    const src = { curves: { rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }] } };
    const dst = {};
    mergeDeep(dst, src);

    // 修改 dst 中的数组元素，src 不应被影响
    dst.curves.rgb[0].x = 100;
    expect(src.curves.rgb[0].x).toBe(0);
  });

  test('数组整体替换时不共享引用', () => {
    const src = { tags: ['a', 'b', 'c'] };
    const dst = {};
    mergeDeep(dst, src);
    dst.tags.push('d');
    expect(src.tags).toHaveLength(3);
    expect(src.tags).not.toContain('d');
  });

  test('嵌套对象数组的深拷贝', () => {
    const src = { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
    const dst = {};
    mergeDeep(dst, src);
    dst.points[0].x = 999;
    expect(src.points[0].x).toBe(1);
  });

  test('原始 mergeDeep 语义保留（嵌套对象合并）', () => {
    const dst = { a: { b: 1, c: 2 } };
    const src = { a: { c: 3, d: 4 } };
    mergeDeep(dst, src);
    expect(dst.a).toEqual({ b: 1, c: 3, d: 4 });
  });
});

describe('Phase P.4 — filmLabExport 使用 canonical 默认值', () => {
  test('DEFAULT_HSL_PARAMS 与 filmLabHSL canonical 一致（同一引用）', () => {
    expect(DEFAULT_HSL_PARAMS).toBe(HSL_CANONICAL);
  });

  test('DEFAULT_SPLIT_TONING 与 filmLabSplitTone canonical 一致（同一引用）', () => {
    expect(DEFAULT_SPLIT_TONING).toBe(ST_CANONICAL);
  });

  test('filmLabExport 模块源码不再有本地 DEFAULT_HSL_PARAMS 定义', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'packages', 'shared', 'filmLabExport.js'),
      'utf-8'
    );
    // 不应再出现重复的字面量定义（red:{hue:0,...} 直接内联）
    expect(src).not.toMatch(/DEFAULT_HSL_PARAMS\s*=\s*\{/);
    expect(src).not.toMatch(/DEFAULT_SPLIT_TONING\s*=\s*\{/);
  });
});

describe('Phase P.6 — WB Y 保持块死代码删除', () => {
  test('computeWBGains 返回值仍然是 max 通道归一化结果', () => {
    // 测试一个常见色温（5500K）
    const gains = computeWBGains(0, 0);
    expect(gains).toHaveLength(3);
    // 至少一个通道应接近 1.0（max 归一化）
    const maxGain = Math.max(...gains);
    expect(maxGain).toBeCloseTo(1.0, 1);
  });

  test('filmLabWhiteBalance 源码不再包含 von Kries 死代码', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'packages', 'shared', 'filmLabWhiteBalance.js'),
      'utf-8'
    );
    // 实际代码不应包含死代码标识符（注释里允许提及以便维护者理解历史）
    // 检查不应有实际的变量赋值或运算逻辑
    expect(src).not.toMatch(/const\s+Y_original/);
    expect(src).not.toMatch(/r_chroma\s*=/);
    expect(src).not.toMatch(/luminance_scale/);
  });
});

describe('Phase P.7 — filmLabConstants 死导出删除', () => {
  test('filmLabConstants 不再导出 DEFAULT_BASE_GAINS / DEFAULT_BASE_CORRECTION', () => {
    expect(filmLabConstants.DEFAULT_BASE_GAINS).toBeUndefined();
    expect(filmLabConstants.DEFAULT_BASE_CORRECTION).toBeUndefined();
  });

  test('filmLabConstants 仍导出其他必要常量', () => {
    expect(filmLabConstants.DEFAULT_TONE_PARAMS).toBeDefined();
    expect(filmLabConstants.DEFAULT_WB_PARAMS).toBeDefined();
    expect(filmLabConstants.EXPORT_MAX_WIDTH).toBeDefined();
  });
});

describe('Phase P.9 — 对比度除零防护', () => {
  test('contrast=100 时不抛错（合法范围）', () => {
    expect(() => buildToneLUT({ exposure: 0, contrast: 100 })).not.toThrow();
  });

  test('contrast=101（越界，绕过 validateExportParams）时不抛错', () => {
    expect(() => buildToneLUT({ exposure: 0, contrast: 101 })).not.toThrow();
    expect(() => buildToneLUT({ exposure: 0, contrast: 200 })).not.toThrow();
  });

  test('contrast=-200（极端负值）时不抛错', () => {
    expect(() => buildToneLUT({ exposure: 0, contrast: -200 })).not.toThrow();
  });
});

describe('Phase P.10 — gamma 非零校验', () => {
  test('gamma=0 时回退到默认值 0.6（不输出恒定值）', () => {
    const v1 = applyFilmCurve(128, { gamma: 0 });
    const vDefault = applyFilmCurve(128, { gamma: 0.6 });
    expect(v1).toBeCloseTo(vDefault, 1);
  });

  test('gamma=NaN 时回退到默认值', () => {
    const v1 = applyFilmCurve(128, { gamma: NaN });
    const vDefault = applyFilmCurve(128, { gamma: 0.6 });
    expect(v1).toBeCloseTo(vDefault, 1);
  });

  test('applyFilmCurveFloat gamma=0 时回退到默认值', () => {
    const v1 = applyFilmCurveFloat(0.5, { gamma: 0 });
    const vDefault = applyFilmCurveFloat(0.5, { gamma: 0.6 });
    expect(v1).toBeCloseTo(vDefault, 5);
  });

  test('合法 gamma 仍按指定值计算', () => {
    const v1 = applyFilmCurve(128, { gamma: 0.6 });
    const v2 = applyFilmCurve(128, { gamma: 0.8 });
    expect(v1).not.toBeCloseTo(v2, 1);
  });
});

describe('Phase P.11 — sampleLUT3D 输出 clamp', () => {
  test('LUT 数据 >1.0 时输出被 clamp 到 255', () => {
    // 构造 size=2 的 LUT，数据全部为 2.0（HDR 越界）
    const size = 2;
    const data = new Float32Array(size * size * size * 3).fill(2.0);
    const result = sampleLUT3D(128, 128, 128, { size, data, intensity: 1 });
    expect(result[0]).toBeLessThanOrEqual(255);
    expect(result[1]).toBeLessThanOrEqual(255);
    expect(result[2]).toBeLessThanOrEqual(255);
  });

  test('LUT 数据为负数时输出被 clamp 到 0', () => {
    const size = 2;
    const data = new Float32Array(size * size * size * 3).fill(-0.5);
    const result = sampleLUT3D(128, 128, 128, { size, data, intensity: 1 });
    expect(result[0]).toBeGreaterThanOrEqual(0);
    expect(result[1]).toBeGreaterThanOrEqual(0);
    expect(result[2]).toBeGreaterThanOrEqual(0);
  });

  test('正常 LUT 数据 [0,1] 输出在 [0, 255] 范围内', () => {
    const size = 2;
    const data = new Float32Array(size * size * size * 3);
    for (let i = 0; i < data.length; i++) data[i] = i / data.length;
    const result = sampleLUT3D(128, 128, 128, { size, data, intensity: 1 });
    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});
