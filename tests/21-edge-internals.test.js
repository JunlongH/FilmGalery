/**
 * Phase M.3 — Edge Detection Internals
 *
 * 覆盖 houghTransform/rectangleFinder/isResultValid 内部分支（P0-13, P0-14, P2-7）。
 * 部分 classifyLines/mergeLines 测试预期失败，暴露 P1-33/P1-34。
 */

const {
  detect: houghDetect,
  mergeLines,
  classifyLines,
  parallelLineDistance,
} = require('../packages/shared/edgeDetection/houghTransform');
const {
  findBestRectangle,
  findRectangleByDensity,
  computeCorners,
  computeRectangleFromCorners,
  isValidQuadrilateral,
  isConvexQuadrilateral,
  quadrilateralArea,
} = require('../packages/shared/edgeDetection/rectangleFinder');
const { isResultValid } = require('../packages/shared/edgeDetection');

// 静默 console.log
let origLog;
beforeAll(() => {
  origLog = console.log;
  console.log = jest.fn();
});
afterAll(() => {
  console.log = origLog;
});

describe('Phase M.3 — classifyLines 4 个主方向', () => {
  test('θ≈0 归类为 vertical', () => {
    const { vertical, horizontal } = classifyLines([{ theta: 0, rho: 100, votes: 50 }]);
    expect(vertical).toHaveLength(1);
    expect(horizontal).toHaveLength(0);
  });

  test('θ≈π/2 归类为 horizontal', () => {
    const { vertical, horizontal } = classifyLines([{ theta: Math.PI / 2, rho: 100, votes: 50 }]);
    expect(vertical).toHaveLength(0);
    expect(horizontal).toHaveLength(1);
  });

  test('θ≈π 归类为 vertical', () => {
    const { vertical, horizontal } = classifyLines([{ theta: Math.PI - 0.05, rho: 100, votes: 50 }], 25);
    expect(vertical).toHaveLength(1);
    expect(horizontal).toHaveLength(0);
  });

  // P1-33：3π/2 已通过环形距离判定归类为 horizontal
  test('θ≈3π/2 归类为 horizontal（环形距离判定）', () => {
    const { horizontal } = classifyLines([{ theta: (3 * Math.PI) / 2, rho: 100, votes: 50 }], 25);
    expect(horizontal).toHaveLength(1);
  });

  test('容差 35 接受 π/2 ± 35° 内的线', () => {
    // tolerance=35° → θ=80° (距 π/2=90° 差 10°) 应归类为 horizontal
    const { horizontal } = classifyLines(
      [{ theta: 80 * Math.PI / 180, rho: 100, votes: 50 }],
      35
    );
    expect(horizontal).toHaveLength(1);
  });
});

describe('Phase M.3 — mergeLines 数值断言', () => {
  test('相同方向直线合并后 theta/rho 正确', () => {
    const lines = [
      { theta: 0.01, rho: 100, votes: 50 },
      { theta: 0.02, rho: 101, votes: 50 },
    ];
    const merged = mergeLines(lines, 20, 10);
    expect(merged).toHaveLength(1);
    expect(merged[0].rho).toBeCloseTo(100.5, 1);
    expect(merged[0].theta).toBeCloseTo(0.015, 4);
  });

  // P1-34：0/2π 边界合并使用环形均值
  test('0/2π 边界合并使用环形均值（非算术均值）', () => {
    const lines = [
      { theta: 0.01, rho: 100, votes: 50 },
      { theta: 2 * Math.PI - 0.01, rho: 100, votes: 50 },
    ];
    const merged = mergeLines(lines, 20, 10);
    expect(merged).toHaveLength(1);
    // 算术均值 = π → 错误；环形均值 = 0/2π 边界 → 0
    expect(merged[0].theta).toBeLessThan(Math.PI / 4);
    expect(merged[0].rho).toBeCloseTo(100, 1);
  });

  test('(-89°, ρ=100) 与 (89°, ρ=-100) 等价合并', () => {
    const lines = [
      { theta: -89 * Math.PI / 180, rho: 100, votes: 50 },
      { theta: 89 * Math.PI / 180, rho: -100, votes: 50 },
    ];
    const merged = mergeLines(lines, 20, 10);
    expect(merged).toHaveLength(1);
    expect(merged[0].mergedCount).toBe(2);
  });

  test('不相近的直线不合并', () => {
    const lines = [
      { theta: 0, rho: 100, votes: 50 },
      { theta: Math.PI / 2, rho: 100, votes: 50 },
    ];
    const merged = mergeLines(lines, 20, 10);
    expect(merged).toHaveLength(2);
  });
});

describe('Phase M.3 — isResultValid 全分支覆盖', () => {
  test('null result → false', () => {
    expect(isResultValid(null, 0.5)).toBe(false);
  });

  test('missing cropRect → false', () => {
    expect(isResultValid({ confidence: 0.9, rotation: 0 }, 0.5)).toBe(false);
  });

  test('confidence < minConfidence → false（borderDetected=true 严格路径）', () => {
    expect(isResultValid({ cropRect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, confidence: 0.3, rotation: 0, borderDetected: true }, 0.5)).toBe(false);
  });

  test('cropRect.w < 0.1 → false', () => {
    expect(isResultValid({ cropRect: { x: 0.1, y: 0.1, w: 0.05, h: 0.5 }, confidence: 0.9, rotation: 0, borderDetected: true }, 0.5)).toBe(false);
  });

  test('borderDetected=false + 全图 cropRect + 低 confidence → true（无边框回退）', () => {
    expect(isResultValid({ cropRect: { x: 0, y: 0, w: 1, h: 1 }, confidence: 0.1, rotation: 0, borderDetected: false }, 0.5)).toBe(true);
  });

  test('borderDetected=false + 几何违规 → false（仍校验几何）', () => {
    expect(isResultValid({ cropRect: { x: -0.1, y: 0, w: 0.5, h: 0.5 }, confidence: 0.1, rotation: 0, borderDetected: false }, 0.5)).toBe(false);
    expect(isResultValid({ cropRect: { x: 0, y: 0, w: 0.05, h: 0.5 }, confidence: 0.1, rotation: 0, borderDetected: false }, 0.5)).toBe(false);
    expect(isResultValid({ cropRect: { x: 0, y: 0, w: 0.5, h: 0.5 }, confidence: 0.1, rotation: 20, borderDetected: false }, 0.5)).toBe(false);
  });

  test('cropRect.x < 0 → false', () => {
    expect(isResultValid({ cropRect: { x: -0.1, y: 0, w: 0.5, h: 0.5 }, confidence: 0.9, rotation: 0, borderDetected: true }, 0.5)).toBe(false);
  });

  test('cropRect.x + w > 1.01 → false', () => {
    expect(isResultValid({ cropRect: { x: 0.5, y: 0, w: 0.8, h: 0.5 }, confidence: 0.9, rotation: 0, borderDetected: true }, 0.5)).toBe(false);
  });

  test('|rotation| > 15 → false', () => {
    expect(isResultValid({ cropRect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, confidence: 0.9, rotation: 20, borderDetected: true }, 0.5)).toBe(false);
  });

  test('正常情况 → true', () => {
    expect(isResultValid({ cropRect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, confidence: 0.7, rotation: 5, borderDetected: true }, 0.5)).toBe(true);
  });

  test('向后兼容：缺 borderDetected 字段按 true 严格路径处理', () => {
    // 老调用方/老结果不传 borderDetected，应走严格路径
    expect(isResultValid({ cropRect: { x: 0, y: 0, w: 1, h: 1 }, confidence: 0.1, rotation: 0 }, 0.5)).toBe(false);
  });
});

describe('Phase M.3 — computeCorners / isValidQuadrilateral / quadrilateralArea', () => {
  test('computeCorners 计算四角点', () => {
    // 矩形：上边 y=10, 下边 y=110, 左边 x=10, 右边 x=110
    const h1 = { rho: 10, theta: Math.PI / 2, votes: 50 };  // y=10
    const h2 = { rho: 110, theta: Math.PI / 2, votes: 50 }; // y=110
    const v1 = { rho: 10, theta: 0, votes: 50 };  // x=10
    const v2 = { rho: 110, theta: 0, votes: 50 }; // x=110
    const c = computeCorners(h1, h2, v1, v2);
    expect(c).not.toBeNull();
    expect(c.topLeft.x).toBeCloseTo(10, 5);
    expect(c.topLeft.y).toBeCloseTo(10, 5);
    expect(c.topRight.x).toBeCloseTo(110, 5);
    expect(c.topRight.y).toBeCloseTo(10, 5);
    expect(c.bottomLeft.x).toBeCloseTo(10, 5);
    expect(c.bottomLeft.y).toBeCloseTo(110, 5);
    expect(c.bottomRight.x).toBeCloseTo(110, 5);
    expect(c.bottomRight.y).toBeCloseTo(110, 5);
  });

  test('computeCorners 平行线返回 null', () => {
    const h1 = { rho: 10, theta: Math.PI / 2, votes: 50 };
    const h2 = { rho: 110, theta: Math.PI / 2, votes: 50 };
    const v1 = { rho: 10, theta: Math.PI / 2, votes: 50 }; // 与 h1 平行
    const v2 = { rho: 110, theta: 0, votes: 50 };
    const c = computeCorners(h1, h2, v1, v2);
    expect(c).toBeNull();
  });

  test('isValidQuadrilateral: 凸四边形 → true', () => {
    const corners = {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 100, y: 10 },
      bottomLeft: { x: 10, y: 100 },
      bottomRight: { x: 100, y: 100 },
    };
    expect(isValidQuadrilateral(corners, 200, 200)).toBe(true);
  });

  test('isValidQuadrilateral: 凹四边形 → false', () => {
    // 凹四边形：BL=(60,40) 位于 TL-TR-BR 三角形内部
    // 顺序 [TL, TR, BR, BL] = [(0,0), (100,0), (100,100), (60,40)]
    const corners = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 100 },
      bottomLeft: { x: 60, y: 40 },
    };
    expect(isValidQuadrilateral(corners, 200, 200)).toBe(false);
  });

  test('isValidQuadrilateral: 角点超界 → false', () => {
    const corners = {
      topLeft: { x: -100, y: 10 },
      topRight: { x: 100, y: 10 },
      bottomLeft: { x: 10, y: 100 },
      bottomRight: { x: 100, y: 100 },
    };
    expect(isValidQuadrilateral(corners, 200, 200)).toBe(false);
  });

  test('quadrilateralArea: 100x100 矩形面积 = 10000', () => {
    const corners = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 100 },
      bottomLeft: { x: 0, y: 100 },
    };
    expect(quadrilateralArea(corners)).toBeCloseTo(10000, 0);
  });
});

describe('Phase M.3 — computeRectangleFromCorners', () => {
  test('rotation=0 直接使用边界', () => {
    const corners = {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 110, y: 10 },
      bottomLeft: { x: 10, y: 110 },
      bottomRight: { x: 110, y: 110 },
    };
    const r = computeRectangleFromCorners(corners, 200, 200);
    expect(r.rotation).toBeCloseTo(0, 5);
    expect(r.rect.x).toBe(10);
    expect(r.rect.y).toBe(10);
    expect(r.rect.w).toBe(100);
    expect(r.rect.h).toBe(100);
  });

  test('rotation>0 旋转路径返回合理矩形', () => {
    // 倾斜矩形（旋转 10°）
    const angle = 10 * Math.PI / 180;
    const cx = 100, cy = 100;
    const w = 100, h = 80;
    const corners = {
      topLeft:     { x: cx - w / 2 * Math.cos(angle) + h / 2 * Math.sin(angle), y: cy - w / 2 * Math.sin(angle) - h / 2 * Math.cos(angle) },
      topRight:    { x: cx + w / 2 * Math.cos(angle) + h / 2 * Math.sin(angle), y: cy + w / 2 * Math.sin(angle) - h / 2 * Math.cos(angle) },
      bottomLeft:  { x: cx - w / 2 * Math.cos(angle) - h / 2 * Math.sin(angle), y: cy - w / 2 * Math.sin(angle) + h / 2 * Math.cos(angle) },
      bottomRight: { x: cx + w / 2 * Math.cos(angle) - h / 2 * Math.sin(angle), y: cy + w / 2 * Math.sin(angle) + h / 2 * Math.cos(angle) },
    };
    const r = computeRectangleFromCorners(corners, 200, 200);
    expect(Math.abs(r.rotation - 10)).toBeLessThan(1);
    // 旋转路径返回的 rect 应该有合理的 w/h
    expect(r.rect.w).toBeGreaterThan(50);
    expect(r.rect.h).toBeGreaterThan(30);
  });
});

describe('Phase M.3 — findBestRectangle 构造场景', () => {
  test('4 条线形成矩形 → 找到 rect', () => {
    const lines = [
      { rho: 25, theta: 0, votes: 100 },         // x=25
      { rho: 175, theta: 0, votes: 100 },        // x=175
      { rho: 25, theta: Math.PI / 2, votes: 100 },  // y=25
      { rho: 175, theta: Math.PI / 2, votes: 100 }, // y=175
    ];
    const r = findBestRectangle(lines, 200, 200, { minAspect: 0.5, maxAspect: 2.5 });
    expect(r).not.toBeNull();
    expect(r.rect.w).toBeGreaterThan(100);
    expect(r.rect.h).toBeGreaterThan(100);
    expect(r.confidence).toBeGreaterThan(0);
  });

  test('不足 4 条线 → null', () => {
    const lines = [
      { rho: 25, theta: 0, votes: 100 },
      { rho: 175, theta: 0, votes: 100 },
    ];
    const r = findBestRectangle(lines, 200, 200);
    expect(r).toBeNull();
  });

  test('宽高比不匹配 → null', () => {
    // 4 条线形成 10x10 的小矩形，宽高比 1:1，但要求 2:1
    const lines = [
      { rho: 95, theta: 0, votes: 100 },
      { rho: 105, theta: 0, votes: 100 },
      { rho: 95, theta: Math.PI / 2, votes: 100 },
      { rho: 105, theta: Math.PI / 2, votes: 100 },
    ];
    const r = findBestRectangle(lines, 200, 200, { minAspect: 1.8, maxAspect: 2.5 });
    // 由于距离过近（10<200*0.2=40），会被过滤
    expect(r).toBeNull();
  });
});

describe('Phase M.3 — findRectangleByDensity', () => {
  test('上下左右各一行高密度边缘 → 找到 rect', () => {
    const W = 100, H = 100;
    const edges = new Uint8Array(W * H);
    // 上下边框：y=10 和 y=90
    for (let x = 0; x < W; x++) {
      edges[10 * W + x] = 255;
      edges[90 * W + x] = 255;
    }
    // 左右边框：x=10 和 x=90
    for (let y = 0; y < H; y++) {
      edges[y * W + 10] = 255;
      edges[y * W + 90] = 255;
    }
    const r = findRectangleByDensity(edges, W, H);
    expect(r).not.toBeNull();
    expect(r.rect.w).toBeGreaterThan(50);
    expect(r.rect.h).toBeGreaterThan(50);
  });

  test('无边缘 → null', () => {
    const W = 100, H = 100;
    const edges = new Uint8Array(W * H);
    const r = findRectangleByDensity(edges, W, H);
    expect(r).toBeNull();
  });
});

describe('Phase M.3 — parallelLineDistance', () => {
  test('两条平行线距离 = |rho 差|', () => {
    expect(parallelLineDistance({ rho: 10, theta: 0 }, { rho: 100, theta: 0 })).toBe(90);
  });
});
