/**
 * Phase C — 预览脏标记（paramsEqual 重写）回归测试（非烟测）
 *
 * 覆盖：
 * 1. stableSerializeParams 键序无关性
 * 2. 全参数字段变更检测（旧 paramsEqual 漏检的字段必须被检出）
 * 3. TypedArray（LUT）变更检测
 * 4. 嵌套对象原地修改的检测（旧浅拷贝缓存的盲区）
 * 5. 非有限数值/undefined 的稳定处理
 */

const { stableSerializeParams, renderParamsEqual } = require('../packages/shared/paramSerializer');

// 模拟 FilmLab 完整渲染参数集（字段名与 useFilmLabState/RenderCore 对齐）
function makeParams() {
  return {
    inverted: true,
    inversionMode: 'log',
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temp: 0, tint: 0, red: 1, green: 1, blue: 1,
    baseMode: 'log', baseRed: 1, baseGreen: 1, baseBlue: 1,
    baseDensityR: 0.5, baseDensityG: 0.3, baseDensityB: 0.2,
    densityLevelsEnabled: false,
    densityLevels: { red: { min: 0, max: 3 }, green: { min: 0, max: 3 }, blue: { min: 0, max: 3 } },
    rotation: 0,
    cropRect: { x: 0, y: 0, w: 1, h: 1 },
    curves: { rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }], red: [], green: [], blue: [] },
    hslParams: { red: { hue: 0, saturation: 0, luminance: 0 } },
    splitToning: { highlights: { hue: 30, saturation: 0 }, shadows: { hue: 220, saturation: 0 }, balance: 0 },
    saturation: 0,
    filmCurveEnabled: false,
    filmCurveProfile: 'portra400',
    lut1: null,
    lut2: null,
  };
}

describe('Phase C.1 stableSerializeParams 正确性', () => {
  test('键序无关', () => {
    const a = { x: 1, y: { p: 2, q: 3 } };
    const b = { y: { q: 3, p: 2 }, x: 1 };
    expect(stableSerializeParams(a)).toBe(stableSerializeParams(b));
  });

  test('NaN/Infinity 序列化稳定且不抛异常', () => {
    expect(() => stableSerializeParams({ v: NaN, w: Infinity })).not.toThrow();
    expect(stableSerializeParams({ v: NaN })).toBe(stableSerializeParams({ v: NaN }));
  });

  test('TypedArray 变更被检出（内容哈希）', () => {
    const lutA = { data: new Float32Array(100).fill(0.5), size: 5 };
    const lutB = { data: new Float32Array(100).fill(0.5), size: 5 };
    expect(renderParamsEqual(lutA, lutB)).toBe(true);
    lutB.data[50] = 0.9;
    expect(renderParamsEqual(lutA, lutB)).toBe(false);
  });
});

describe('Phase C.2 全字段变更检测（旧 paramsEqual 漏检回归）', () => {
  // 旧实现漏检的字段：temp/tint/red/green/blue/base*/densityLevels/curves/
  // hslParams/splitToning/filmCurveProfile/lut，以及错误键名 rotate（应为 rotation）
  const MUTATIONS = [
    ['temp', p => { p.temp = 20; }],
    ['tint', p => { p.tint = -5; }],
    ['red gain', p => { p.red = 1.2; }],
    ['baseMode', p => { p.baseMode = 'linear'; }],
    ['baseDensityR', p => { p.baseDensityR = 0.6; }],
    ['densityLevels.red.min', p => { p.densityLevels.red.min = 0.1; }],
    ['rotation（旧代码错检 rotate）', p => { p.rotation = 90; }],
    ['curves.rgb 控制点', p => { p.curves.rgb.push({ x: 128, y: 140 }); }],
    ['hslParams.red.hue', p => { p.hslParams.red.hue = 30; }],
    ['splitToning.balance', p => { p.splitToning.balance = 10; }],
    ['filmCurveProfile', p => { p.filmCurveProfile = 'ektar100'; }],
    ['lut1 挂载', p => { p.lut1 = { size: 33, data: new Float32Array(33 ** 3 * 3) }; }],
  ];

  test.each(MUTATIONS)('变更 %s 必须被判定为不等', (_, mutate) => {
    const a = makeParams();
    const b = makeParams();
    mutate(b);
    expect(renderParamsEqual(a, b)).toBe(false);
  });

  test('无变更时判定相等（含完整默认参数集）', () => {
    expect(renderParamsEqual(makeParams(), makeParams())).toBe(true);
  });

  test('嵌套对象原地修改（同一引用）被检出', () => {
    const a = makeParams();
    const snapshot = stableSerializeParams(a);
    a.cropRect.x = 0.1; // 原地修改，旧浅拷贝缓存会漏判
    expect(stableSerializeParams(a)).not.toBe(snapshot);
  });
});
