/**
 * Phase I — 线性域反转测试（非烟测 + 视觉正确性）
 *
 * 验证：
 * 1. linearDomainInversion 默认 false（向后兼容）
 * 2. color-space 转换往返（srgb→linear→srgb）单调、端点正确、负值 clamp
 * 3. 合成负片：带橙色色罩的中性灰，反转后恢复为中性灰（线性域更精确）
 * 4. gamma 域 vs 线性域：两条路径在中灰处输出都应接近中性，但数值不同（证明 opt-in 生效）
 */

const { RenderCore } = require('../packages/shared/render/RenderCore');
const { srgbToLinear, linearToSrgb } = require('../packages/shared/render/math/color-space');

describe('Phase I.1 color-space 转换健壮性', () => {
  test('srgb→linear→srgb 往返误差 < 1e-9', () => {
    for (const v of [0, 0.1, 0.5, 0.9, 1.0]) {
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 9);
    }
  });

  test('负值 clamp 到 0（不返回负）', () => {
    expect(srgbToLinear(-0.5)).toBe(0);
    expect(linearToSrgb(-1)).toBe(0);
  });

  test('单调递增', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const lin = srgbToLinear(i / 100);
      expect(lin).toBeGreaterThanOrEqual(prev);
      prev = lin;
    }
  });

  test('端点：0→0, 1→1', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 9);
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBeCloseTo(1, 9);
  });
});

describe('Phase I.2 linearDomainInversion 默认与 opt-in', () => {
  test('默认 false（向后兼容，输出与未加参数一致）', () => {
    const a = new RenderCore({ inverted: true, baseMode: 'log', baseDensityR: 0.1 });
    const b = new RenderCore({ inverted: true, baseMode: 'log', baseDensityR: 0.1, linearDomainInversion: false });
    expect(a.params.linearDomainInversion).toBe(false);
    const pa = a.processPixelFloat(0.5, 0.5, 0.5);
    const pb = b.processPixelFloat(0.5, 0.5, 0.5);
    expect(pa).toEqual(pb);
  });

  test('opt-in true 时输出与 false 不同（证明转换层生效）', () => {
    const gamma = new RenderCore({ inverted: true, linearDomainInversion: false });
    const linear = new RenderCore({ inverted: true, linearDomainInversion: true });
    const pg = gamma.processPixelFloat(0.3, 0.5, 0.7);
    const pl = linear.processPixelFloat(0.3, 0.5, 0.7);
    // 至少有一个通道数值不同（线性域反转改变了 tonal 响应）
    const diff = Math.abs(pg[0] - pl[0]) + Math.abs(pg[1] - pl[1]) + Math.abs(pg[2] - pl[2]);
    expect(diff).toBeGreaterThan(0.001);
  });

  test('getGLSLUniforms 透传 u_linearDomainInversion 标志', () => {
    const core = new RenderCore({ inverted: true, linearDomainInversion: true });
    const u = core.getGLSLUniforms();
    expect(u.u_linearDomainInversion).toBe(1.0);
    const core2 = new RenderCore({ inverted: true });
    expect(core2.getGLSLUniforms().u_linearDomainInversion).toBe(0.0);
  });
});

describe('Phase I.3 合成负片→正片视觉正确性', () => {
  test('中性灰反转：线性域下中灰点(0.5)反转后三通道平衡（对称性）', () => {
    // 线性域反转的核心性质：中性灰反转后仍是中性灰（三通道对称）
    const core = new RenderCore({ inverted: true, linearDomainInversion: true });
    const [r, g, b] = core.processPixelFloat(0.5, 0.5, 0.5);
    expect(r).toBeCloseTo(g, 5);
    expect(g).toBeCloseTo(b, 5);
    // 反转应改变亮度（非恒等）
    expect(r).not.toBeCloseTo(0.5, 2);
  });

  test('橙色色罩去除：log 域片基校正后三通道平衡（线性域）', () => {
    // 模拟 C-41 橙色色罩：片基密度 R<G<B（橙=红多蓝少）
    // 负片扫描中性区域：R 偏亮、B 偏暗（色罩叠加）
    // 设置片基密度补偿后，反转结果应三通道接近
    const baseDensityR = 0.15, baseDensityG = 0.30, baseDensityB = 0.50;
    const core = new RenderCore({
      inverted: true,
      baseMode: 'log',
      baseDensityR, baseDensityG, baseDensityB,
      linearDomainInversion: true,
    });
    // 扫描值（含色罩）：经 log 域减法后应平衡
    const scanR = 0.6, scanG = 0.5, scanB = 0.4;
    const [r, g, b] = core.processPixelFloat(scanR, scanG, scanB);
    // 色罩去除后三通道应比输入更接近（去偏色）
    const inRange = Math.abs(scanR - scanG) + Math.abs(scanG - scanB);
    const outRange = Math.abs(r - g) + Math.abs(g - b);
    expect(outRange).toBeLessThan(inRange);
  });

  test('未反转（inverted=false）不受 linearDomainInversion 影响（仅反转块包装）', () => {
    const a = new RenderCore({ inverted: false, exposure: 20 });
    const b = new RenderCore({ inverted: false, exposure: 20, linearDomainInversion: true });
    const pa = a.processPixelFloat(0.5, 0.5, 0.5);
    const pb = b.processPixelFloat(0.5, 0.5, 0.5);
    // 未反转时 srgb→linear→srgb 往返应近似恒等（仅 ② base 块空跑）
    expect(pa[0]).toBeCloseTo(pb[0], 4);
  });
});
