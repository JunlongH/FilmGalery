/**
 * Canny Edge Detection
 * 
 * 实现 Canny 边缘检测算法:
 * 1. Sobel 梯度计算
 * 2. 非极大值抑制
 * 3. 双阈值检测
 * 4. 边缘追踪 (滞后阈值)
 * 
 * @module packages/shared/edgeDetection/cannyEdge
 */

/**
 * Sobel 算子
 */
const SOBEL_X = new Float32Array([-1, 0, 1, -2, 0, 2, -1, 0, 1]);
const SOBEL_Y = new Float32Array([-1, -2, -1, 0, 0, 0, 1, 2, 1]);

/**
 * 计算 Sobel 梯度
 * 
 * @param {Float32Array} data - 灰度图像
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @returns {Object} { magnitude, direction }
 */
function sobelGradient(data, width, height) {
  const size = width * height;
  const magnitude = new Float32Array(size);
  const direction = new Float32Array(size);
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0;
      
      // 3x3 卷积
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const pixel = data[(y + ky) * width + (x + kx)];
          const kidx = (ky + 1) * 3 + (kx + 1);
          gx += pixel * SOBEL_X[kidx];
          gy += pixel * SOBEL_Y[kidx];
        }
      }
      
      const idx = y * width + x;
      magnitude[idx] = Math.sqrt(gx * gx + gy * gy);
      direction[idx] = Math.atan2(gy, gx);
    }
  }
  
  return { magnitude, direction };
}

/**
 * 非极大值抑制
 * 保留梯度方向上的局部最大值
 * 
 * @param {Float32Array} magnitude - 梯度幅值
 * @param {Float32Array} direction - 梯度方向
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @returns {Float32Array} 抑制后的梯度
 */
function nonMaxSuppression(magnitude, direction, width, height) {
  const output = new Float32Array(width * height);
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const mag = magnitude[idx];
      
      if (mag === 0) continue;
      
      // 将角度量化为 4 个主要方向 (0°, 45°, 90°, 135°)
      let angle = direction[idx] * 180 / Math.PI;
      if (angle < 0) angle += 180;
      
      let neighbor1, neighbor2;
      
      if ((angle >= 0 && angle < 22.5) || (angle >= 157.5 && angle <= 180)) {
        // 水平方向 (0°)
        neighbor1 = magnitude[idx - 1];
        neighbor2 = magnitude[idx + 1];
      } else if (angle >= 22.5 && angle < 67.5) {
        // 对角线方向 (45°)
        neighbor1 = magnitude[(y - 1) * width + x + 1];
        neighbor2 = magnitude[(y + 1) * width + x - 1];
      } else if (angle >= 67.5 && angle < 112.5) {
        // 垂直方向 (90°)
        neighbor1 = magnitude[(y - 1) * width + x];
        neighbor2 = magnitude[(y + 1) * width + x];
      } else {
        // 对角线方向 (135°)
        neighbor1 = magnitude[(y - 1) * width + x - 1];
        neighbor2 = magnitude[(y + 1) * width + x + 1];
      }
      
      // 只保留局部最大值
      if (mag >= neighbor1 && mag >= neighbor2) {
        output[idx] = mag;
      }
    }
  }
  
  return output;
}

/**
 * 双阈值检测和边缘追踪
 * 
 * @param {Float32Array} edges - 非极大值抑制后的边缘
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @param {number} lowThreshold - 低阈值
 * @param {number} highThreshold - 高阈值
 * @returns {Uint8Array} 二值边缘图 (255=边缘, 0=非边缘)
 */
function hysteresisThreshold(edges, width, height, lowThreshold, highThreshold) {
  const STRONG = 255;
  const WEAK = 50;
  
  const output = new Uint8Array(width * height);
  
  // 第一遍: 分类为强边缘、弱边缘
  for (let i = 0; i < edges.length; i++) {
    if (edges[i] >= highThreshold) {
      output[i] = STRONG;
    } else if (edges[i] >= lowThreshold) {
      output[i] = WEAK;
    }
  }
  
  // 第二遍: 边缘追踪（滞后连接）
  // 显式栈 BFS 洪泛：以所有 STRONG 像素为种子，连通的 WEAK 像素提升为 STRONG。
  // 旧实现用"全图迭代×10"会截断长弱边链（>10px 即丢失），与 OpenCV/标准 Canny 不符。
  const stack = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (output[y * width + x] === STRONG) stack.push(x, y);
    }
  }
  while (stack.length > 0) {
    const y = stack.pop();
    const x = stack.pop();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dy === 0 && dx === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1) continue;
        const nidx = ny * width + nx;
        if (output[nidx] === WEAK) {
          output[nidx] = STRONG;
          stack.push(nx, ny);
        }
      }
    }
  }
  
  // 第三遍: 移除剩余的弱边缘
  for (let i = 0; i < output.length; i++) {
    if (output[i] === WEAK) {
      output[i] = 0;
    }
  }
  
  return output;
}

/**
 * Canny 边缘检测主函数
 * 
 * @param {Float32Array} data - 灰度图像 (已模糊)
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @param {number} lowThreshold - 低阈值 (默认 30)
 * @param {number} highThreshold - 高阈值 (默认 100)
 * @returns {Uint8Array} 边缘图 (255=边缘, 0=非边缘)
 */
function detect(data, width, height, lowThreshold = 30, highThreshold = 100) {
  // 1. Sobel 梯度
  const { magnitude, direction } = sobelGradient(data, width, height);
  
  // 2. 非极大值抑制
  const suppressed = nonMaxSuppression(magnitude, direction, width, height);
  
  // 3. 双阈值和边缘追踪
  const edges = hysteresisThreshold(suppressed, width, height, lowThreshold, highThreshold);
  
  return edges;
}

/**
 * 获取边缘像素坐标列表
 * 
 * @param {Uint8Array} edges - 边缘图
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @returns {Array<{x: number, y: number}>} 边缘点列表
 */
function getEdgePoints(edges, width, height) {
  const points = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[y * width + x] > 0) {
        points.push({ x, y });
      }
    }
  }
  
  return points;
}

module.exports = {
  detect,
  sobelGradient,
  nonMaxSuppression,
  hysteresisThreshold,
  getEdgePoints
};
