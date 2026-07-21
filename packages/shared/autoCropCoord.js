/**
 * 自动裁剪坐标变换工具
 *
 * 服务端边缘检测在"EXIF 定向后的原图坐标系"返回归一化 cropRect + rotation，
 * 客户端 cropRect 工作在"总旋转（rotation + orientation + rotationOffset）后的
 * 旋转包围盒坐标系"。AutoCropButton/FilmLabControls 旧实现直接套用检测值，
 * 当 EXIF orientation ∈ {6,8} 或用户已旋转时裁剪框必然错位（U1）。
 *
 * 本模块提供纯函数：把检测系矩形 + 检测角 重映射到客户端坐标系。
 *
 * 约定：
 * - 所有坐标归一化到 [0,1]。
 * - 总旋转角 totalRotation = rotation + orientation + rotationOffset（度，顺时针为正）。
 * - 检测在原图（已应用 orientation，即 EXIF 定向）上进行 → 客户端"已应用 orientation"
 *   后的中间坐标系 = 检测系；只需额外补偿 rotation + rotationOffset。
 *
 * @module autoCropCoord
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

function norm2pi(a) {
  let r = a % 360;
  if (r < 0) r += 360;
  return r;
}

/**
 * 把 0/90/180/270 之外的旋转规整到 [0,90,180,270]（最近匹配）。
 * 用于判定是否需要做坐标轴对齐的快速路径。
 *
 * P3 修复: 45°/135°/225°/315° 等精确中点值不归入正交旋转。
 * 旧实现 Math.round(45/90)*90 = Math.round(0.5)*90 = 90 (JS Math.round 半数向上)，
 * 导致 45° 输入被错误当作 90° 处理。现在使用 Math.floor(deg/90 + 0.5) 但
 * 对精确 45°+90k 返回 null（表示非正交），由调用方走通用路径。
 *
 * @param {number} deg - 旋转角度
 * @returns {number|null} 0/90/180/270 或 null（非正交）
 */
function nearestOrthogonal(deg) {
  const r = norm2pi(deg);
  const mod = r % 90;
  // 精确的 45°+90k 中点：不归入任何正交方向
  if (Math.abs(mod - 45) < 0.01) return null;
  const quad = Math.round(r / 90) * 90;
  return norm2pi(quad);
}

/**
 * 将检测系归一化矩形重映射到客户端坐标系。
 *
 * 客户端裁剪框定义在"应用 userRotation + rotationOffset 之后"的图像上；
 * 检测返回的矩形定义在"原图"上。我们需要在归一化 UV 空间把矩形顶点反向旋转
 * userRotation + rotationOffset 角度（因为客户端裁剪框是在已旋转的显示图上画的，
 * 等价于在原图上反向旋转）。
 *
 * @param {Object} detectedRect - 检测系归一化矩形 {x, y, w, h}
 * @param {number} detectedRotation - 检测返回的建议旋转角（度，归一化系）
 * @param {Object} ctx - 当前几何上下文
 * @param {number} ctx.orientation - EXIF orientation (0/90/180/270)
 * @param {number} ctx.rotationOffset - 额外偏移角（度）
 * @param {number} [ctx.currentRotation] - 用户已应用的旋转角（度）
 * @returns {{ cropRect: {x,y,w,h}, rotation: number }}
 */
function remapDetectedCropRect(detectedRect, detectedRotation, ctx) {
  const { orientation = 0, rotationOffset = 0, currentRotation = 0 } = ctx;

  // 客户端最终应用的旋转角 = 检测角（替换式语义）。
  // 旧代码 setRotation(detectedRotation) 直接替换，正确语义：
  //   新的客户端 rotation = detectedRotation - orientation - rotationOffset
  //   （因为客户端 rotation 是相对 orientation+rotationOffset 的增量）
  const newClientRotation = (detectedRotation || 0) - orientation - rotationOffset;

  // 检测发生在"已应用 orientation 的原图"上，客户端 cropRect 是在
  // "再应用 userRotation(=newClientRotation) + rotationOffset 之后"的图像上。
  // 两者之间的额外旋转 = newClientRotation + rotationOffset。
  const extraDeg = newClientRotation + rotationOffset;
  const extraOrtho = nearestOrthogonal(extraDeg);

  // P3: 非正交旋转 (如 45°) 不做轴对齐重映射，直接返回检测系矩形
  // 旧实现把 45° 当 90° 处理，导致 cropRect 被错误旋转
  if (extraOrtho === null) {
    return { cropRect: { ...detectedRect }, rotation: newClientRotation };
  }

  if (extraOrtho === 0) {
    return { cropRect: { ...detectedRect }, rotation: newClientRotation };
  }

  // 正交旋转下做矩形轴对齐重映射（90/180/270）
  // 在归一化 UV 空间，把矩形四角绕中心 (0.5, 0.5) 旋转 extraOrtho
  const pts = [
    [detectedRect.x, detectedRect.y],
    [detectedRect.x + detectedRect.w, detectedRect.y],
    [detectedRect.x + detectedRect.w, detectedRect.y + detectedRect.h],
    [detectedRect.x, detectedRect.y + detectedRect.h],
  ];
  const rad = -extraOrtho * DEG; // 反向旋转：原图→客户端显示
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const mapped = pts.map(([px, py]) => {
    const dx = px - 0.5;
    const dy = py - 0.5;
    return [0.5 + (dx * cos - dy * sin), 0.5 + (dx * sin + dy * cos)];
  });

  const xs = mapped.map(p => p[0]);
  const ys = mapped.map(p => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // 旋转后包围盒可能超出 [0,1]，钳制并保持中心
  let x = minX, y = minY, w = maxX - minX, h = maxY - minY;
  // 钳制到 [0,1]，保证 x+w ≤ 1
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;

  return { cropRect: { x, y, w: Math.max(0, w), h: Math.max(0, h) }, rotation: newClientRotation };
}

module.exports = {
  remapDetectedCropRect,
  nearestOrthogonal,
  norm2pi,
};
