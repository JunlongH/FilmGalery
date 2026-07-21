/**
 * Phase G — types.d.ts 与运行时一致性测试（非烟测）
 *
 * types.d.ts 不参与编译（项目为纯 JS，仅作 IDE 提示），但若与运行时不符会误导维护者。
 * 本测试断言"类型文档声称的结构"与"运行时实际常量/形状"一致。
 */

const { createDefaultParams } = require('../packages/shared/filmLabExport');
const { FILM_PROFILES } = require('../packages/shared/filmLabConstants');

describe('Phase G types.d.ts 与运行时一致性', () => {
  test('baseMode 默认与文档枚举一致（仅 linear/log）', () => {
    expect(['linear', 'log']).toContain(createDefaultParams().baseMode);
  });

  test('inversionMode 默认 linear（文档仅 linear/log，无 filmic）', () => {
    const p = createDefaultParams();
    expect(p.inversionMode).toBe('linear');
    expect(['linear', 'log']).toContain(p.inversionMode);
  });

  test('DensityLevels 运行时为按通道嵌套 {red:{min,max},...}（非扁平 minR/maxR）', () => {
    const p = createDefaultParams();
    // DEFAULT_PROCESSING_PARAMS 不含 densityLevels（RenderCore normalize 才填充），
    // 这里通过 RenderCore 验证运行时形状
    const { RenderCore } = require('../packages/shared/render/RenderCore');
    const core = new RenderCore({ densityLevelsEnabled: true, baseMode: 'log' });
    const dl = core.params.densityLevels;
    expect(dl).toBeDefined();
    expect(dl.red).toEqual({ min: 0.0, max: 3.0 });
    expect(dl.green).toEqual({ min: 0.0, max: 3.0 });
    expect(dl.blue).toEqual({ min: 0.0, max: 3.0 });
    // 反例：扁平结构不应存在
    expect(dl.minR).toBeUndefined();
    expect(dl.maxB).toBeUndefined();
  });

  test('FilmCurveParams 含 gammaR/G/B + toe/shoulder（Q13）', () => {
    const profile = FILM_PROFILES.portra400;
    expect(profile).toHaveProperty('gammaR');
    expect(profile).toHaveProperty('gammaG');
    expect(profile).toHaveProperty('gammaB');
    expect(profile).toHaveProperty('toe');
    expect(profile).toHaveProperty('shoulder');
    expect(profile).toHaveProperty('dMin');
    expect(profile).toHaveProperty('dMax');
  });

  test('DEFAULT_PROCESSING_PARAMS 字段集与文档 RenderParams 对齐', () => {
    const p = createDefaultParams();
    // 文档列出的核心字段必须全部存在
    for (const key of [
      'inverted', 'inversionMode', 'exposure', 'contrast', 'highlights', 'shadows',
      'whites', 'blacks', 'temp', 'tint', 'red', 'green', 'blue',
      'baseMode', 'baseRed', 'baseGreen', 'baseBlue', 'baseDensityR', 'baseDensityG', 'baseDensityB',
      'filmCurveEnabled', 'filmCurveProfile',
      'curves', 'hslParams', 'saturation', 'splitToning',
      'cropRect', 'rotation', 'version',
    ]) {
      expect(p).toHaveProperty(key);
    }
  });

  test('CurvesParams 默认每通道 2 个端点（0,0 / 255,255）', () => {
    const p = createDefaultParams();
    expect(p.curves.rgb).toEqual([{ x: 0, y: 0 }, { x: 255, y: 255 }]);
    expect(p.curves.red.length).toBe(2);
  });

  test('HSLParams 含 8 通道（无 aqua）', () => {
    const p = createDefaultParams();
    for (const ch of ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta']) {
      expect(p.hslParams[ch]).toEqual({ hue: 0, saturation: 0, luminance: 0 });
    }
    expect(p.hslParams.aqua).toBeUndefined();
  });

  test('SplitToneParams 含 midtones 区', () => {
    const p = createDefaultParams();
    expect(p.splitToning.highlights).toBeDefined();
    expect(p.splitToning.midtones).toBeDefined();
    expect(p.splitToning.shadows).toBeDefined();
    expect(p.splitToning.balance).toBe(0);
  });
});
