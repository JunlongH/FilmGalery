/**
 * FilmLab 曲线处理模块
 * 
 * @module filmLabCurves
 * @description 实现自然三次样条插值 + 可选单调约束 + 浮点精度曲线 LUT
 * 
 * v2.0 更新:
 * - 自然三次样条 (Thomas 算法求解三对角方程组，C² 连续)
 * - 可选 Fritsch-Carlson 单调约束 (防止过冲超过阈值)
 * - 新增 Float32 LUT 输出 (buildCurveLUTFloat)
 * - 保留向后兼容的 Uint8 LUT 接口
 */

import { DEFAULT_CURVES } from './filmLabConstants.mjs';

// ============================================================================
// 自然三次样条 (Natural Cubic Spline)
// ============================================================================

/**
 * 创建自然三次样条插值函数
 *
 * 使用 Thomas 算法求解三对角线性方程组，得到 C² 连续的三次多项式插值。
 * 相比 Fritsch-Carlson 单调样条，自然三次样条允许受控的过冲 (overshoot)，
 * 在 S 曲线拐点处产生更自然、更接近 Lightroom/Photoshop 的曲线形状。
 *
 * 可选参数:
 * - monotoneClamp: 启用 Fritsch-Carlson 单调约束 (防止过冲)
 * - maxOvershoot: 允许的最大过冲比例 (默认 0.05 = 5%)
 *   过冲 = 样条输出超出 [min(y), max(y)] 范围的部分，按 y 范围的比例限制。
 *   仅在 monotoneClamp=false 时生效；monotoneClamp=true 时过冲已被 Fritsch-Carlson 消除。
 *
 * @param {number[]} xs - X 坐标数组 (必须严格单调递增)
 * @param {number[]} ys - Y 坐标数组
 * @param {Object} [options] - 选项
 * @param {boolean} [options.monotoneClamp=false] - 启用单调约束
 * @param {number} [options.maxOvershoot=0.05] - 最大过冲比例 (0-1)
 * @returns {Function} 插值函数 (x) => y
 */
function createSpline(xs, ys, options = {}) {
  const n = xs.length;
  const monotoneClamp = options.monotoneClamp ?? false;
  const maxOvershoot = options.maxOvershoot ?? 0.05;

  // 边界检查
  if (n < 2) {
    return (x) => (n === 1 ? ys[0] : x);
  }

  // 防御：重复/非递增 x 会导致 h=0 除零（NaN 扩散到全 LUT）。
  // 按 x 升序去重（后写覆盖），保证严格单调递增
  {
    const pairs = xs.map((x, i) => [x, ys[i]]).sort((p, q) => p[0] - q[0]);
    const ux = [pairs[0][0]];
    const uy = [pairs[0][1]];
    for (let i = 1; i < pairs.length; i++) {
      if (pairs[i][0] === ux[ux.length - 1]) {
        uy[uy.length - 1] = pairs[i][1]; // 重复 x：保留后者
      } else {
        ux.push(pairs[i][0]);
        uy.push(pairs[i][1]);
      }
    }
    if (ux.length < n) {
      return createSpline(ux, uy, options);
    }
  }

  if (n === 2) {
    // 两点线性插值
    const slope = (ys[1] - ys[0]) / (xs[1] - xs[0]);
    return (x) => ys[0] + slope * (x - xs[0]);
  }
  
  // 计算间距和斜率
  const h = new Array(n - 1);  // h[i] = xs[i+1] - xs[i]
  const delta = new Array(n - 1); // delta[i] = (ys[i+1] - ys[i]) / h[i]
  
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    delta[i] = (ys[i + 1] - ys[i]) / h[i];
  }
  
  // ===================================================================
  // Thomas 算法求解自然三次样条的切线 m[i]
  // 
  // 自然边界条件: m''(x0) = 0, m''(xn) = 0
  // 这产生的三对角方程组:
  //   2*m[0] + m[1] = 3*delta[0]                          (自然边界)
  //   h[i]*m[i] + 2*(h[i]+h[i+1])*m[i+1] + h[i+1]*m[i+2] 
  //     = 3*(h[i+1]*delta[i] + h[i]*delta[i+1])           (内部节点)
  //   m[n-2] + 2*m[n-1] = 3*delta[n-2]                    (自然边界)
  // ===================================================================
  
  // 构建三对角系统 (a, b, c, d) 其中 a*m[i-1] + b*m[i] + c*m[i+1] = d
  const a = new Array(n);  // 下对角
  const b = new Array(n);  // 主对角
  const c = new Array(n);  // 上对角
  const d = new Array(n);  // 右端
  
  // 自然边界: m''(x0) = 0 → 2*m[0] + 1*m[1] = 3*delta[0]
  a[0] = 0;
  b[0] = 2;
  c[0] = 1;
  d[0] = 3 * delta[0];
  
  // 内部节点
  for (let i = 1; i < n - 1; i++) {
    a[i] = h[i];
    b[i] = 2 * (h[i - 1] + h[i]);
    c[i] = h[i - 1];
    d[i] = 3 * (h[i] * delta[i - 1] + h[i - 1] * delta[i]);
  }
  
  // 自然边界: m''(xn) = 0 → 1*m[n-2] + 2*m[n-1] = 3*delta[n-2]
  a[n - 1] = 1;
  b[n - 1] = 2;
  c[n - 1] = 0;
  d[n - 1] = 3 * delta[n - 2];
  
  // 前向消元
  for (let i = 1; i < n; i++) {
    const factor = a[i] / b[i - 1];
    b[i] -= factor * c[i - 1];
    d[i] -= factor * d[i - 1];
  }
  
  // 回代
  const m = new Array(n);
  m[n - 1] = d[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    m[i] = (d[i] - c[i] * m[i + 1]) / b[i];
  }
  
  // 可选: Fritsch-Carlson 单调约束
  if (monotoneClamp) {
    for (let i = 0; i < n - 1; i++) {
      if (delta[i] === 0) {
        // 平坦段: 切线必须为 0
        m[i] = 0;
        m[i + 1] = 0;
      } else {
        const alpha = m[i] / delta[i];
        const beta = m[i + 1] / delta[i];
        // Fritsch-Carlson 条件: alpha² + beta² <= 9
        const s2 = alpha * alpha + beta * beta;
        if (s2 > 9) {
          const tau = 3 / Math.sqrt(s2);
          m[i] = tau * alpha * delta[i];
          m[i + 1] = tau * beta * delta[i];
        }
      }
    }
  }
  
  // 计算三次多项式系数
  // 对每段 [xs[i], xs[i+1]], 多项式为:
  // p(t) = ys[i] + m[i]*dt + c2*dt² + c3*dt³  其中 dt = x - xs[i]
  const c2 = new Array(n - 1);
  const c3 = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const invH = 1 / h[i];
    c2[i] = (3 * delta[i] - 2 * m[i] - m[i + 1]) * invH;
    c3[i] = (m[i] + m[i + 1] - 2 * delta[i]) * invH * invH;
  }
  
  // P2-11: maxOvershoot 实现 — 限制样条输出超出 [min(y), max(y)] 的过冲量
  // 计算 y 范围和允许的上下界
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (ys[i] < yMin) yMin = ys[i];
    if (ys[i] > yMax) yMax = ys[i];
  }
  const yRange = Math.max(1e-6, yMax - yMin);
  const allowedHigh = yMax + yRange * maxOvershoot;
  const allowedLow = yMin - yRange * maxOvershoot;

  // 返回插值函数
  return (x) => {
    // 二分查找段落索引 (比线性搜索更高效)
    let lo = 0, hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid + 1] < x) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    const dt = x - xs[lo];
    const val = ys[lo] + m[lo] * dt + c2[lo] * dt * dt + c3[lo] * dt * dt * dt;

    // P2-11: clamp 过冲到 [allowedLow, allowedHigh]
    // 仅在 monotoneClamp=false 时生效 (monotoneClamp 已消除过冲)
    if (!monotoneClamp) {
      if (val > allowedHigh) return allowedHigh;
      if (val < allowedLow) return allowedLow;
    }
    return val;
  };
}

// ============================================================================
// LUT 构建
// ============================================================================

/**
 * 从控制点构建 256 级曲线 LUT (8-bit, 向后兼容)
 * 
 * @param {Array<{x: number, y: number}>} points - 控制点数组 (0-255 坐标)
 * @param {Object} [options] - 样条选项
 * @returns {Uint8Array} 256 级查找表
 */
function buildCurveLUT(points, options = {}) {
  const lut = new Uint8Array(256);
  
  // 排序控制点 (按 x 坐标)
  const sorted = Array.isArray(points) && points.length > 0
    ? [...points].sort((a, b) => a.x - b.x)
    : [{ x: 0, y: 0 }, { x: 255, y: 255 }];
  
  // 少于 2 个点时返回恒等映射
  if (sorted.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }

  const xs = sorted.map(p => p.x);
  const ys = sorted.map(p => p.y);
  const spline = createSpline(xs, ys, options);

  for (let i = 0; i < 256; i++) {
    let val;
    
    // 边界处理: 端点外使用线性外推 (匹配 LR 行为)
    if (i <= sorted[0].x) {
      val = sorted[0].y;
    } else if (i >= sorted[sorted.length - 1].x) {
      val = sorted[sorted.length - 1].y;
    } else {
      val = spline(i);
    }
    
    lut[i] = Math.min(255, Math.max(0, Math.round(val)));
  }
  
  return lut;
}

/**
 * 从控制点构建浮点精度曲线 LUT
 * 
 * 输出 Float32Array，分辨率可选 (默认 1024 级)
 * 用于 GPU 浮点纹理上传和高精度 CPU 曲线采样
 * 
 * @param {Array<{x: number, y: number}>} points - 控制点数组 (0-255 坐标)
 * @param {Object} [options] - 选项
 * @param {number} [options.resolution=1024] - LUT 分辨率
 * @param {boolean} [options.monotoneClamp=false] - 启用单调约束
 * @returns {Float32Array} 浮点 LUT (值域 0.0-1.0)
 */
function buildCurveLUTFloat(points, options = {}) {
  const resolution = options.resolution ?? 1024;
  const lut = new Float32Array(resolution);
  
  const sorted = Array.isArray(points) && points.length > 0
    ? [...points].sort((a, b) => a.x - b.x)
    : [{ x: 0, y: 0 }, { x: 255, y: 255 }];
  
  if (sorted.length < 2) {
    for (let i = 0; i < resolution; i++) lut[i] = i / (resolution - 1);
    return lut;
  }

  const xs = sorted.map(p => p.x);
  const ys = sorted.map(p => p.y);
  const spline = createSpline(xs, ys, { monotoneClamp: options.monotoneClamp });

  for (let i = 0; i < resolution; i++) {
    // 将 LUT 索引映射到 0-255 输入坐标
    const x = (i / (resolution - 1)) * 255;
    let val;
    
    if (x <= sorted[0].x) {
      val = sorted[0].y;
    } else if (x >= sorted[sorted.length - 1].x) {
      val = sorted[sorted.length - 1].y;
    } else {
      val = spline(x);
    }
    
    // 归一化到 0-1 并钳制
    lut[i] = Math.max(0, Math.min(1, val / 255));
  }
  
  return lut;
}

/**
 * 构建所有通道的曲线 LUT
 * 
 * @param {Object} curves - 曲线配置
 * @param {Array} curves.rgb - RGB 曲线控制点
 * @param {Array} curves.red - 红色通道控制点
 * @param {Array} curves.green - 绿色通道控制点
 * @param {Array} curves.blue - 蓝色通道控制点
 * @returns {Object} 包含所有通道 LUT 的对象
 */
function buildAllCurveLUTs(curves = {}) {
  const mergedCurves = { ...DEFAULT_CURVES, ...curves };
  
  return {
    lutRGB: buildCurveLUT(mergedCurves.rgb),
    lutR: buildCurveLUT(mergedCurves.red),
    lutG: buildCurveLUT(mergedCurves.green),
    lutB: buildCurveLUT(mergedCurves.blue),
  };
}

/**
 * 构建所有通道的浮点曲线 LUT
 * 
 * @param {Object} curves - 曲线配置
 * @param {Object} [options] - LUT 构建选项
 * @param {number} [options.resolution=1024] - LUT 分辨率
 * @returns {Object} 包含所有通道 Float32 LUT 的对象
 */
function buildAllCurveLUTsFloat(curves = {}, options = {}) {
  const mergedCurves = { ...DEFAULT_CURVES, ...curves };
  
  return {
    lutRGB: buildCurveLUTFloat(mergedCurves.rgb, options),
    lutR: buildCurveLUTFloat(mergedCurves.red, options),
    lutG: buildCurveLUTFloat(mergedCurves.green, options),
    lutB: buildCurveLUTFloat(mergedCurves.blue, options),
  };
}

/**
 * 应用曲线到单个值
 * 
 * @param {number} value - 输入值 (0-255)
 * @param {Array<{x: number, y: number}>} points - 控制点
 * @returns {number} 映射后的值
 */
function applyCurve(value, points) {
  const lut = buildCurveLUT(points);
  return lut[Math.min(255, Math.max(0, Math.round(value)))];
}

// ============================================================================
// GPU 复合浮点曲线纹理 (Phase 2.4)
// ============================================================================

/**
 * 线性插值采样 Float32 LUT
 * @param {number} val - 归一化输入 (0.0–1.0)
 * @param {Float32Array} lut - Float32 LUT
 * @returns {number} 插值输出
 */
function _sampleFloatLUT(val, lut) {
  const maxIdx = lut.length - 1;
  const pos = Math.max(0, Math.min(1, val)) * maxIdx;
  const lo = Math.floor(pos);
  const hi = Math.min(maxIdx, lo + 1);
  const frac = pos - lo;
  return (1 - frac) * lut[lo] + frac * lut[hi];
}

/**
 * 构建 GPU 复合浮点曲线 LUT (Phase 2.4)
 *
 * 将 RGB 主曲线 + R/G/B 逐通道曲线复合为单张 RGBA Float32 纹理数据。
 * 处理链: 输入 → RGB 主曲线 → 逐通道曲线 → 输出
 * 对应 CPU 的 _sampleCurveLUTFloatHQ(masterRGB, then per-channel) 管线。
 *
 * 输出: Float32Array(resolution × 4)，每个纹素 [R, G, B, 1.0]
 * GPU 采样: texture(u_toneCurveTex, vec2(c.r, 0.5)).r 等
 *
 * @param {Object} curves - 曲线控制点 { rgb, red, green, blue }
 * @param {Object} [options]
 * @param {number} [options.resolution=1024] - 纹理宽度
 * @returns {Float32Array} RGBA float 纹理数据 (resolution × 4 元素)
 */
function buildCompositeFloatCurveLUT(curves = {}, options = {}) {
  const resolution = options.resolution ?? 1024;
  const defaultPts = DEFAULT_CURVES.rgb;

  // 构建各通道独立 Float32 LUT
  const lutRGB = buildCurveLUTFloat(curves.rgb || defaultPts, { resolution });
  const lutR   = buildCurveLUTFloat(curves.red || defaultPts, { resolution });
  const lutG   = buildCurveLUTFloat(curves.green || defaultPts, { resolution });
  const lutB   = buildCurveLUTFloat(curves.blue || defaultPts, { resolution });

  // 复合: 先过 RGB 主曲线，再过逐通道曲线
  const composite = new Float32Array(resolution * 4);
  for (let i = 0; i < resolution; i++) {
    const masterVal = lutRGB[i]; // 主曲线输出 (0.0–1.0)

    // 逐通道采样 (线性插值，匹配 CPU _sampleCurveLUTFloatHQ)
    composite[i * 4 + 0] = _sampleFloatLUT(masterVal, lutR); // R
    composite[i * 4 + 1] = _sampleFloatLUT(masterVal, lutG); // G
    composite[i * 4 + 2] = _sampleFloatLUT(masterVal, lutB); // B
    composite[i * 4 + 3] = 1.0;                               // A (unused)
  }

  return composite;
}

// ============================================================================
// 模块导出 (CommonJS)
// ============================================================================

const _sharedExports = {
  createSpline,
  buildCurveLUT,
  buildCurveLUTFloat,
  buildAllCurveLUTs,
  buildAllCurveLUTsFloat,
  buildCompositeFloatCurveLUT,
  applyCurve,
};
const _e_createSpline = _sharedExports.createSpline;
export { _e_createSpline as createSpline };
const _e_buildCurveLUT = _sharedExports.buildCurveLUT;
export { _e_buildCurveLUT as buildCurveLUT };
const _e_buildCurveLUTFloat = _sharedExports.buildCurveLUTFloat;
export { _e_buildCurveLUTFloat as buildCurveLUTFloat };
const _e_buildAllCurveLUTs = _sharedExports.buildAllCurveLUTs;
export { _e_buildAllCurveLUTs as buildAllCurveLUTs };
const _e_buildAllCurveLUTsFloat = _sharedExports.buildAllCurveLUTsFloat;
export { _e_buildAllCurveLUTsFloat as buildAllCurveLUTsFloat };
const _e_buildCompositeFloatCurveLUT = _sharedExports.buildCompositeFloatCurveLUT;
export { _e_buildCompositeFloatCurveLUT as buildCompositeFloatCurveLUT };
const _e_applyCurve = _sharedExports.applyCurve;
export { _e_applyCurve as applyCurve };
export default _sharedExports;
