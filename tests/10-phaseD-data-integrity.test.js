/**
 * Phase D — 参数数据完整性测试（非烟测）
 *
 * 覆盖：
 * 1. 版本迁移：原始 version 不被提前盖章，v1→v2→v3 迁移分支真实执行
 * 2. 旧 HSL 结构迁移：aqua→cyan 映射不被 cyan 迭代覆盖清零
 * 3. createDefaultParams 深拷贝隔离：原地修改不污染全局常量
 * 4. buildExportParams 深合并：preset/overrides 的嵌套对象不整体替换丢兄弟字段
 */

const {
  buildExportParams,
  migrateParams,
  createDefaultParams,
  DEFAULT_PROCESSING_PARAMS,
  DEFAULT_HSL_PARAMS,
  PARAMS_VERSION,
} = require('../packages/shared/filmLabExport');

describe('Phase D.1 版本迁移分支真实执行（旧 bug：version 提前盖章致迁移死代码）', () => {
  test('v1 数据触发 v1→v2 与 v2→v3 迁移（添加 hslParams/splitToning/saturation）', () => {
    const v1 = { version: 1, exposure: 10, contrast: 5 };
    const result = migrateParams(v1);
    expect(result.hslParams).toBeDefined();
    expect(result.splitToning).toBeDefined();
    expect(result.saturation).toBe(0);
    expect(result.exposure).toBe(10); // 原始字段保留
  });

  test('v2 数据触发 v2→v3 迁移（添加 saturation）', () => {
    const v2 = { version: 2, exposure: 5, hslParams: { red: { hue: 1 } }, splitToning: { balance: 10 } };
    const result = migrateParams(v2);
    expect(result.saturation).toBe(0);
    expect(result.hslParams.red.hue).toBe(1);
  });

  test('buildExportParams 不提前盖章 version（迁移按原始版本号执行）', () => {
    // 输入一个 version:1 的旧数据，应执行迁移；若提前盖章则 hslParams 仍缺失
    const result = buildExportParams(null, { version: 1, exposure: 10 });
    expect(result.hslParams).toBeDefined();
    expect(result.splitToning).toBeDefined();
    expect(result.version).toBe(PARAMS_VERSION);
  });

  test('最终输出 version 始终为 PARAMS_VERSION', () => {
    expect(buildExportParams(null, { version: 1 }).version).toBe(PARAMS_VERSION);
    expect(buildExportParams(null, {}).version).toBe(PARAMS_VERSION);
    expect(buildExportParams(null, { version: 5 }).version).toBe(PARAMS_VERSION);
  });
});

describe('Phase D.2 旧 HSL 结构迁移：aqua→cyan 不被覆盖', () => {
  test('仅含 aqua 的旧数据正确迁移到 cyan 通道', () => {
    const oldHSL = {
      hue: { aqua: 50 },
      saturation: { aqua: 30 },
      luminance: { aqua: -10 },
    };
    const result = migrateParams({ version: 2, hslParams: oldHSL });
    expect(result.hslParams.cyan).toEqual({ hue: 50, saturation: 30, luminance: -10 });
  });

  test('同时含 aqua 和 cyan 的旧数据：cyan 优先（aqua 被忽略，符合后写覆盖）', () => {
    const oldHSL = {
      hue: { aqua: 50, cyan: 70 },
      saturation: {},
      luminance: {},
    };
    const result = migrateParams({ version: 2, hslParams: oldHSL });
    expect(result.hslParams.cyan.hue).toBe(70);
  });

  test('含多个通道的旧数据完整迁移', () => {
    const oldHSL = {
      hue: { red: 10, green: 20, blue: 30, aqua: 40 },
      saturation: { red: 5, green: 0, blue: -5, aqua: 15 },
      luminance: { red: 0, green: 0, blue: 0, aqua: 0 },
    };
    const result = migrateParams({ version: 2, hslParams: oldHSL });
    expect(result.hslParams.red.hue).toBe(10);
    expect(result.hslParams.green.hue).toBe(20);
    expect(result.hslParams.blue.hue).toBe(30);
    expect(result.hslParams.cyan.hue).toBe(40);
    expect(result.hslParams.cyan.saturation).toBe(15);
  });
});

describe('Phase D.3 createDefaultParams 深拷贝隔离', () => {
  test('两次调用返回独立实例', () => {
    const a = createDefaultParams();
    const b = createDefaultParams();
    expect(a).not.toBe(b);
    expect(a.curves).not.toBe(b.curves);
    expect(a.curves.rgb).not.toBe(b.curves.rgb);
    expect(a.hslParams).not.toBe(b.hslParams);
  });

  test('原地修改实例不污染全局 DEFAULT_PROCESSING_PARAMS', () => {
    const before = JSON.stringify(DEFAULT_PROCESSING_PARAMS.curves.rgb);
    const p = createDefaultParams();
    p.curves.rgb.push({ x: 128, y: 140 });
    p.hslParams.red.hue = 50;
    p.cropRect.x = 0.5;
    // 全局常量应保持不变
    expect(JSON.stringify(DEFAULT_PROCESSING_PARAMS.curves.rgb)).toBe(before);
    expect(DEFAULT_HSL_PARAMS.red.hue).toBe(0);
  });

  test('buildExportParams 返回值与全局默认独立', () => {
    const p = buildExportParams(null, {});
    p.curves.rgb.push({ x: 100, y: 100 });
    const p2 = buildExportParams(null, {});
    expect(p2.curves.rgb.length).toBe(DEFAULT_PROCESSING_PARAMS.curves.rgb.length);
  });
});

describe('Phase D.4 buildExportParams 深合并', () => {
  test('preset 仅含部分嵌套字段时，兄弟字段保留默认', () => {
    const result = buildExportParams({ splitToning: { balance: 10 } }, {});
    expect(result.splitToning.balance).toBe(10);
    expect(result.splitToning.highlights).toBeDefined();
    expect(result.splitToning.shadows).toBeDefined();
    expect(result.splitToning.midtones).toBeDefined();
  });

  test('preset 字符串解析失败时降级为忽略 preset（不抛异常）', () => {
    expect(() => buildExportParams('{not json', {})).not.toThrow();
    const result = buildExportParams('{not json', {});
    expect(result).toBeDefined();
    expect(result.version).toBe(PARAMS_VERSION);
  });

  test('overrides 深合并嵌套对象', () => {
    const result = buildExportParams(null, {
      hslParams: { red: { hue: 30 } },
    });
    expect(result.hslParams.red.hue).toBe(30);
    expect(result.hslParams.red.saturation).toBe(0); // 兄弟字段保留默认
    expect(result.hslParams.blue).toBeDefined(); // 其他通道保留
  });
});
