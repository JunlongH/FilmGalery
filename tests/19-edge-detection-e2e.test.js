/**
 * Phase M.1 — Edge Detection End-to-End (synthetic fixtures)
 *
 * 覆盖 detectEdges 主入口（P0-12），先暴露 P1-N 的 bug，用 test.failing 标记的待 Phase N 修复。
 *
 * 合成图策略：
 *   - 黑底 + 中央白矩形：模拟底片边框
 *   - 纯白图：模拟无边框图片
 *   - 旋转 10° 矩形：模拟倾斜底片
 *   - 35mm (3:2) 宽高比：filmFormat 约束
 */

const {
  detectEdges,
  isResultValid,
  getExpectedAspectRatio,
  getThresholdsFromSensitivity,
} = require('../packages/shared/edgeDetection');

/**
 * 合成 RGBA 图像：黑底 + 中央白矩形（带清晰边框）
 * @param {number} W
 * @param {number} H
 * @param {number} rectX  矩形左上角 x（像素）
 * @param {number} rectY  矩形左上角 y
 * @param {number} rectW  矩形宽
 * @param {number} rectH  矩形高
 * @param {number} [fill=255] 矩形亮度 0-255
 */
function makeImageWithRect(W, H, rectX, rectY, rectW, rectH, fill = 255) {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const inside =
        x >= rectX && x < rectX + rectW && y >= rectY && y < rectY + rectH;
      const v = inside ? fill : 0;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }
  }
  return { data, width: W, height: H, channels: 4 };
}

/** 合成纯白 RGBA 图像（无边框） */
function makeUniformImage(W, H, value = 255) {
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const idx = i * 4;
    data[idx] = value;
    data[idx + 1] = value;
    data[idx + 2] = value;
    data[idx + 3] = 255;
  }
  return { data, width: W, height: H, channels: 4 };
}

/** 合成旋转矩形图像：先把图像旋转 angle 度，再嵌入黑底 */
function makeRotatedRectImage(W, H, cx, cy, rectW, rectH, angleDeg) {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      // 反向旋转像素坐标到矩形局部坐标系
      const a = (-angleDeg * Math.PI) / 180;
      const dx = x - cx;
      const dy = y - cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      const inside =
        Math.abs(lx) <= rectW / 2 && Math.abs(ly) <= rectH / 2;
      const v = inside ? 255 : 0;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }
  }
  return { data, width: W, height: H, channels: 4 };
}

// 静默 console.log 副作用（P3-3 在 Phase N 修复）
let origLog;
beforeAll(() => {
  origLog = console.log;
  console.log = jest.fn();
});
afterAll(() => {
  console.log = origLog;
});

describe('Phase M.1 — detectEdges 端到端合成图', () => {
  test('黑底中央白矩形：检测到合理裁剪区域', () => {
    const W = 200, H = 200;
    const img = makeImageWithRect(W, H, 25, 25, 150, 150);
    const result = detectEdges(img, { sensitivity: 50 });

    expect(result.cropRect).toBeDefined();
    expect(result.cropRect.w).toBeGreaterThan(0.3);
    expect(result.cropRect.h).toBeGreaterThan(0.3);
    expect(result.confidence).toBeGreaterThan(0.1);
    expect(Math.abs(result.rotation)).toBeLessThan(5);
  });

  test('纯白图（无边框）：confidence < 0.2，cropRect 接近全图，borderDetected=false', () => {
    const W = 200, H = 200;
    const img = makeUniformImage(W, H, 255);
    const result = detectEdges(img, { sensitivity: 50 });

    expect(result.confidence).toBeLessThan(0.2);
    expect(result.cropRect.w).toBeGreaterThan(0.95);
    expect(result.cropRect.h).toBeGreaterThan(0.95);
    expect(result.borderDetected).toBe(false);
  });

  test('黑底中央白矩形：borderDetected=true，debugInfo 含 fallbackUsed 标志', () => {
    const W = 200, H = 200;
    const img = makeImageWithRect(W, H, 25, 25, 150, 150);
    const result = detectEdges(img, { sensitivity: 50, returnDebugInfo: true });

    expect(result.borderDetected).toBe(true);
    expect(result.debugInfo).toBeDefined();
    expect(typeof result.debugInfo.fallbackUsed).toBe('boolean');
  });

  test('旋转 10° 矩形：检测到旋转角度近 10°', () => {
    const W = 220, H = 220;
    // 中心 150x150 矩形旋转 10°
    const img = makeRotatedRectImage(W, H, 110, 110, 150, 150, 10);
    const result = detectEdges(img, { sensitivity: 60 });

    // 期望角度接近 10°（或 -10°，取决于检测方向）
    const angleDiff = Math.min(
      Math.abs(result.rotation - 10),
      Math.abs(result.rotation + 10)
    );
    expect(angleDiff).toBeLessThan(5);
  });

  test('35mm (3:2) 宽高比约束：检测到的像素宽高比在 [1.3, 1.7]', () => {
    // 3:2 图像：300x200，中央 240x160 白矩形（同样 3:2）
    const W = 300, H = 200;
    const img = makeImageWithRect(W, H, 30, 20, 240, 160);
    const result = detectEdges(img, { sensitivity: 50, filmFormat: '35mm' });

    if (result.confidence > 0.2) {
      // 注意：normalizeRect 独立归一化 w/h，比例丢失；需还原到像素空间
      const pixW = result.cropRect.w * W;
      const pixH = result.cropRect.h * H;
      const aspect = pixW / pixH;
      expect(aspect).toBeGreaterThanOrEqual(1.3);
      expect(aspect).toBeLessThanOrEqual(1.7);
    }
  });

  test('isResultValid：confidence 低于阈值返回 false', () => {
    expect(isResultValid({ cropRect: { x: 0, y: 0, w: 0.5, h: 0.5 }, confidence: 0.1, rotation: 0 }, 0.5)).toBe(false);
  });

  test('isResultValid：confidence 高、合理 cropRect 返回 true', () => {
    expect(isResultValid({ cropRect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, confidence: 0.6, rotation: 5 }, 0.5)).toBe(true);
  });

  test('isResultValid：rotation > 15 返回 false', () => {
    expect(isResultValid({ cropRect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, confidence: 0.9, rotation: 20 }, 0.5)).toBe(false);
  });

  test('isResultValid：cropRect.x < 0 返回 false', () => {
    expect(isResultValid({ cropRect: { x: -0.1, y: 0.1, w: 0.8, h: 0.8 }, confidence: 0.9, rotation: 5 }, 0.5)).toBe(false);
  });

  test('isResultValid：cropRect.w < 0.1 返回 false', () => {
    expect(isResultValid({ cropRect: { x: 0.1, y: 0.1, w: 0.05, h: 0.8 }, confidence: 0.9, rotation: 5 }, 0.5)).toBe(false);
  });
});

describe('Phase M.1 — getExpectedAspectRatio / getThresholdsFromSensitivity', () => {
  test('getExpectedAspectRatio("35mm") 返回 3:2 范围', () => {
    const r = getExpectedAspectRatio('35mm');
    expect(r.minAspect).toBeLessThanOrEqual(1.5);
    expect(r.maxAspect).toBeGreaterThanOrEqual(1.5);
  });

  test('getExpectedAspectRatio("auto") 宽松范围', () => {
    const r = getExpectedAspectRatio('auto');
    expect(r.minAspect).toBeLessThanOrEqual(0.5);
    expect(r.maxAspect).toBeGreaterThanOrEqual(2.5);
  });

  test('getExpectedAspectRatio("4x5") 4:5 范围', () => {
    const r = getExpectedAspectRatio('4x5');
    expect(r.minAspect).toBeLessThanOrEqual(1.25);
    expect(r.maxAspect).toBeGreaterThanOrEqual(1.25);
  });

  // P1-38：'120' 别名已补全（120 系最宽 0.9-1.4）
  test('getExpectedAspectRatio("120") 返回 120 系列范围而非 auto', () => {
    const r = getExpectedAspectRatio('120');
    // auto 的 maxAspect=2.5，120 系列应明显更窄
    expect(r.maxAspect).toBeLessThan(2.0);
  });

  test('getThresholdsFromSensitivity(0) 高阈值', () => {
    const t = getThresholdsFromSensitivity(0);
    expect(t.low).toBe(100);
    expect(t.high).toBe(200);
  });

  test('getThresholdsFromSensitivity(100) 低阈值', () => {
    const t = getThresholdsFromSensitivity(100);
    expect(t.low).toBe(30);
    expect(t.high).toBe(100);
  });

  test('getThresholdsFromSensitivity(50) 中等阈值', () => {
    const t = getThresholdsFromSensitivity(50);
    expect(t.low).toBe(65);
    expect(t.high).toBe(150);
  });
});
