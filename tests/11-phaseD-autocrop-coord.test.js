/**
 * Phase D.5 — 自动裁剪坐标系变换测试（非烟测）
 */

const { remapDetectedCropRect, nearestOrthogonal } = require('../packages/shared/autoCropCoord');

describe('Phase D.5 自动裁剪坐标系重映射', () => {
  test('无额外旋转：原样返回', () => {
    const detected = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    const r = remapDetectedCropRect(detected, 0, { orientation: 0, rotationOffset: 0, currentRotation: 0 });
    expect(r.cropRect).toEqual(detected);
    expect(r.rotation).toBe(0);
  });

  test('EXIF orientation=90：检测系需反向旋转 90° 到客户端系', () => {
    const detected = { x: 0.1, y: 0.2, w: 0.6, h: 0.5 };
    const r = remapDetectedCropRect(detected, 90, { orientation: 90, rotationOffset: 0, currentRotation: 0 });
    // 客户端 rotation = detected(90) - orientation(90) - offset(0) = 0
    expect(r.rotation).toBe(0);
    // cropRect 应在 [0,1] 范围内且为有效矩形
    expect(r.cropRect.w).toBeGreaterThan(0);
    expect(r.cropRect.h).toBeGreaterThan(0);
    expect(r.cropRect.x).toBeGreaterThanOrEqual(0);
    expect(r.cropRect.y).toBeGreaterThanOrEqual(0);
    expect(r.cropRect.x + r.cropRect.w).toBeLessThanOrEqual(1.0001);
    expect(r.cropRect.y + r.cropRect.h).toBeLessThanOrEqual(1.0001);
  });

  test('已有用户旋转 45°：旋转角应减去 orientation+rotationOffset', () => {
    const r = remapDetectedCropRect(
      { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
      50,
      { orientation: 0, rotationOffset: 10, currentRotation: 20 }
    );
    // rotation = 50 - 0 - 10 = 40
    expect(r.rotation).toBe(40);
  });

  test('钳制：超界矩形被收敛到 [0,1]', () => {
    const r = remapDetectedCropRect(
      { x: -0.1, y: -0.1, w: 1.5, h: 1.5 },
      180,
      { orientation: 0, rotationOffset: 0, currentRotation: 0 }
    );
    expect(r.cropRect.x).toBeGreaterThanOrEqual(0);
    expect(r.cropRect.y).toBeGreaterThanOrEqual(0);
    expect(r.cropRect.x + r.cropRect.w).toBeLessThanOrEqual(1.0001);
    expect(r.cropRect.y + r.cropRect.h).toBeLessThanOrEqual(1.0001);
  });

  test('nearestOrthogonal', () => {
    expect(nearestOrthogonal(0)).toBe(0);
    expect(nearestOrthogonal(89)).toBe(90);
    expect(nearestOrthogonal(91)).toBe(90);
    expect(nearestOrthogonal(270)).toBe(270);
    expect(nearestOrthogonal(-90)).toBe(270);
  });
});

describe('Phase D.6 rectangleFinder 角点排序（θ≈-90° 不再自交）', () => {
  const { computeCorners } = require('../packages/shared/edgeDetection/rectangleFinder');

  test('水平线 θ=-90° (ρ=-y 形式) 角点仍按实际 y 排序', () => {
    // 模拟 θ=-90° 的两条水平线：rho=-100 (y=100, 顶) 和 rho=-300 (y=300, 底)
    // 旧实现按 rho 排序会反转上下，新实现按交点 y 排序
    const h1 = { theta: -Math.PI / 2, rho: -100 }; // y=100
    const h2 = { theta: -Math.PI / 2, rho: -300 }; // y=300
    const v1 = { theta: 0, rho: 50 };              // x=50
    const v2 = { theta: 0, rho: 250 };             // x=250
    const corners = computeCorners(h1, h2, v1, v2);
    expect(corners).not.toBeNull();
    expect(corners.topLeft.y).toBeLessThan(corners.bottomLeft.y);
    expect(corners.topLeft.x).toBeLessThan(corners.topRight.x);
    expect(corners.bottomLeft.x).toBeLessThan(corners.bottomRight.x);
  });
});
