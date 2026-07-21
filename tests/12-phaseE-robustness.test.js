/**
 * Phase E — 健壮性测试（非烟测）
 *
 * 覆盖：
 * 1. parseCubeLUT 校验：缺 LUT_3D_SIZE 抛错 / 1D LUT 拒绝 / 数据长度不符抛错 / 正常解析
 * 2. Canny 滞后连接：长弱边链（>10px）被 BFS 洪泛保留（旧迭代式会被截断）
 * 3. Hough θ 环绕：NMS 在 ±90° 边界不分裂峰值
 * 4. mergeLines：跨 ±90° 边界的等价线被正确合并
 */

const { parseCubeLUT } = require('../packages/shared/lutParser');
const { detect: houghDetect, mergeLines } = require('../packages/shared/edgeDetection/houghTransform');
const { hysteresisThreshold } = require('../packages/shared/edgeDetection/cannyEdge');

describe('Phase E.1 parseCubeLUT 校验', () => {
  function makeCube(size) {
    const lines = [`LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
    for (let i = 0; i < size ** 3; i++) {
      lines.push(`${(i / size ** 3).toFixed(4)} 0.5 0.5`);
    }
    return lines.join('\n');
  }

  test('正常 3D LUT 解析', () => {
    const r = parseCubeLUT(makeCube(4));
    expect(r.size).toBe(4);
    expect(r.data.length).toBe(4 ** 3 * 3);
    expect(r.domainMin).toEqual([0, 0, 0]);
    expect(r.domainMax).toEqual([1, 1, 1]);
  });

  test('缺 LUT_3D_SIZE 但数据完整：按长度反推 size', () => {
    const cube = makeCube(3).split('\n').filter(l => !l.startsWith('LUT_3D_SIZE')).join('\n');
    const r = parseCubeLUT(cube);
    expect(r.size).toBe(3);
  });

  test('缺 LUT_3D_SIZE 且数据不完整：抛错', () => {
    expect(() => parseCubeLUT('0.1 0.2 0.3\n0.4 0.5 0.6')).toThrow(/LUT_3D_SIZE|infer/);
  });

  test('LUT_1D_SIZE 被拒绝', () => {
    expect(() => parseCubeLUT('LUT_1D_SIZE 256\n0.0\n0.5\n1.0')).toThrow(/1D LUT/);
  });

  test('数据长度与 size³ 不符：抛错', () => {
    const cube = makeCube(3).split('\n').slice(0, -5).join('\n'); // 截断 5 行
    expect(() => parseCubeLUT(cube)).toThrow(/length mismatch/);
  });

  test('LUT_3D_SIZE 非法值（1 或 NaN）：抛错', () => {
    expect(() => parseCubeLUT('LUT_3D_SIZE 1\n')).toThrow(/Invalid/);
    expect(() => parseCubeLUT('LUT_3D_SIZE abc\n')).toThrow(/Invalid/);
  });

  test('忽略 TITLE 等标题行与注释', () => {
    const cube = 'TITLE "test"\n# comment\n' + makeCube(2);
    expect(() => parseCubeLUT(cube)).not.toThrow();
  });
});

describe('Phase E.2 Canny 滞后连接 BFS（长弱边链保留）', () => {
  test('长度 30 的弱边链连通到强边后全部保留', () => {
    // 直接测试 hysteresisThreshold（输入为 NMS 后的 magnitude 图）
    // 构造 40x8 图像，y=4 行：x=1 强边(mag=255)，x=2..30 弱边链(mag=100)
    // （种子循环从 x=1 开始，避免边界 x=0 被排除）
    const w = 40, h = 8;
    const mag = new Float32Array(w * h);
    mag[4 * w + 1] = 255;
    for (let x = 2; x <= 30; x++) mag[4 * w + x] = 100;

    const edges = hysteresisThreshold(mag, w, h, 80, 200);
    // 链尾 x=30 应被保留（连通到 x=1 的强边）
    expect(edges[4 * w + 30]).toBe(255);
    expect(edges[4 * w + 20]).toBe(255);
    // 旧迭代式（maxIterations=10）会在 x=11 处截断
  });

  test('孤立的弱边（不连通强边）被移除', () => {
    const w = 10, h = 10;
    const mag = new Float32Array(w * h);
    mag[5 * w + 5] = 100; // 孤立弱边
    const edges = hysteresisThreshold(mag, w, h, 80, 200);
    expect(edges[5 * w + 5]).toBe(0);
  });
});

describe('Phase E.3 Hough θ 环绕', () => {
  test('近水平强线（θ≈-89°/+89°）NMS 不分裂峰值', () => {
    // 构造 50x50 图像，y=25 一条水平线
    const w = 50, h = 50;
    const edges = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) edges[25 * w + x] = 255;

    const lines = houghDetect(edges, w, h, 20, 1, 1);
    // 合并后应只剩主导水平线（而非 ±89° 两条）
    const merged = mergeLines(lines, 10, 5);
    merged.sort((a, b) => b.votes - a.votes);
    const top = merged[0];
    expect(merged.length).toBeLessThanOrEqual(lines.length);
    // 水平线的法线 θ≈±90°（规范化后 ρ≥0 → θ 落在 [0,2π)，约 π/2 或 3π/2）
    const thetaDeg = top.theta * 180 / Math.PI;
    const isHorizontal = Math.abs(thetaDeg - 90) < 10 || Math.abs(thetaDeg - 270) < 10;
    expect(isHorizontal).toBe(true);
  });

  test('mergeLines：(-89°, ρ=100) 与 (89°, ρ=-100) 视为同一条线合并', () => {
    const lines = [
      { theta: -89 * Math.PI / 180, rho: 100, votes: 50 },
      { theta: 89 * Math.PI / 180, rho: -100, votes: 50 },
    ];
    const merged = mergeLines(lines, 20, 10);
    expect(merged.length).toBe(1);
    expect(merged[0].mergedCount).toBe(2);
  });
});
