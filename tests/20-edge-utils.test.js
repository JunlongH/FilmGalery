/**
 * Phase M.2 — Edge Detection Utils
 *
 * 覆盖 normalizeRect/lineIntersection/calculateIoU 等工具函数（P0-12, P2-5）。
 * 部分 normalizeRect 测试预期失败，暴露 P1-36（x+w 不保证 ≤1）。
 */

const {
  normalizeRect,
  denormalizeRect,
  calculateIoU,
  lineIntersection,
  angleDifference,
  arePerpendicular,
  areParallel,
  pointToLineDistance,
} = require('../packages/shared/edgeDetection/utils');

describe('Phase M.2 — normalizeRect', () => {
  test('正常像素矩形归一化', () => {
    const r = normalizeRect({ x: 100, y: 100, w: 200, h: 200 }, 400, 400);
    expect(r).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });

  test('支持 width/height 字段名', () => {
    const r = normalizeRect({ x: 0, y: 0, width: 200, height: 200 }, 400, 400);
    expect(r).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
  });

  test('负 x 被 clamp 到 0', () => {
    const r = normalizeRect({ x: -50, y: 0, w: 200, h: 200 }, 400, 400);
    expect(r.x).toBe(0);
  });

  test('超界 w 被 clamp 到 1', () => {
    const r = normalizeRect({ x: 0, y: 0, w: 1000, h: 200 }, 400, 400);
    expect(r.w).toBe(1);
  });

  // P1-36：normalizeRect 已保证 x+w ≤ 1
  test('normalizeRect 保证 x+w ≤ 1（防止越界）', () => {
    // x=300, w=300 → x_norm=0.75, w_norm=0.75 → x+w=1.5（越界！）
    const r = normalizeRect({ x: 300, y: 0, w: 300, h: 200 }, 400, 400);
    expect(r.x + r.w).toBeLessThanOrEqual(1.0);
  });

  test('normalizeRect 保证 y+h ≤ 1', () => {
    const r = normalizeRect({ x: 0, y: 300, w: 200, h: 300 }, 400, 400);
    expect(r.y + r.h).toBeLessThanOrEqual(1.0);
  });
});

describe('Phase M.2 — lineIntersection', () => {
  test('正交直线相交', () => {
    // x = 5: theta=0, rho=5
    // y = 3: theta=π/2, rho=3
    const p = lineIntersection({ rho: 5, theta: 0 }, { rho: 3, theta: Math.PI / 2 });
    expect(p).not.toBeNull();
    expect(p.x).toBeCloseTo(5, 5);
    expect(p.y).toBeCloseTo(3, 5);
  });

  test('平行线返回 null', () => {
    // 两条垂直线 x=5, x=10
    const p = lineIntersection({ rho: 5, theta: 0 }, { rho: 10, theta: 0 });
    expect(p).toBeNull();
  });

  test('近似平行线返回 null', () => {
    const p = lineIntersection(
      { rho: 5, theta: 0 },
      { rho: 10, theta: 1e-12 }
    );
    expect(p).toBeNull();
  });
});

describe('Phase M.2 — calculateIoU', () => {
  test('相同矩形 IoU=1', () => {
    const r = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(calculateIoU(r, r)).toBeCloseTo(1, 5);
  });

  test('完全相离 IoU=0', () => {
    const r1 = { x: 0, y: 0, w: 0.2, h: 0.2 };
    const r2 = { x: 0.8, y: 0.8, w: 0.2, h: 0.2 };
    expect(calculateIoU(r1, r2)).toBe(0);
  });

  test('部分重叠 IoU∈(0,1)', () => {
    const r1 = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const r2 = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    const iou = calculateIoU(r1, r2);
    expect(iou).toBeGreaterThan(0);
    expect(iou).toBeLessThan(1);
  });

  test('包含关系 IoU = 交集 / 并集', () => {
    const outer = { x: 0, y: 0, w: 1, h: 1 };
    const inner = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    // 交集=0.25, 并集=1 → IoU=0.25
    expect(calculateIoU(outer, inner)).toBeCloseTo(0.25, 5);
  });
});

describe('Phase M.2 — angleDifference / arePerpendicular / areParallel', () => {
  test('angleDifference 处理周期性', () => {
    expect(angleDifference(0, Math.PI)).toBeCloseTo(Math.PI, 5);
    expect(angleDifference(0, 2 * Math.PI - 0.1)).toBeCloseTo(0.1, 5);
  });

  test('arePerpendicular 判定', () => {
    expect(arePerpendicular({ theta: 0 }, { theta: Math.PI / 2 })).toBe(true);
    expect(arePerpendicular({ theta: 0 }, { theta: 0 })).toBe(false);
  });

  test('areParallel 判定', () => {
    expect(areParallel({ theta: 0 }, { theta: 0.01 })).toBe(true);
    expect(areParallel({ theta: 0 }, { theta: Math.PI - 0.01 })).toBe(true);
    expect(areParallel({ theta: 0 }, { theta: Math.PI / 2 })).toBe(false);
  });

  test('pointToLineDistance: 点到 x=5 的距离', () => {
    const line = { rho: 5, theta: 0 }; // x*cos(0) + y*sin(0) = 5 → x = 5
    expect(pointToLineDistance({ x: 10, y: 100 }, line)).toBeCloseTo(5, 5);
    expect(pointToLineDistance({ x: 0, y: 100 }, line)).toBeCloseTo(5, 5);
  });
});

describe('Phase M.2 — denormalizeRect', () => {
  test('归一化矩形转像素坐标', () => {
    const r = denormalizeRect({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 400, 400);
    expect(r).toEqual({ x: 100, y: 100, w: 200, h: 200 });
  });
});
