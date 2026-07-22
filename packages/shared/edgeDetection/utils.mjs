/**
 * Edge Detection Utilities
 * 
 * 边缘检测基础工具函数
 * 
 * @module packages/shared/edgeDetection/utils
 */

/**
 * 将图像数据转换为灰度
 * 
 * @param {Uint8Array|Uint8ClampedArray} data - 图像像素数据
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @param {number} channels - 通道数 (3=RGB, 4=RGBA)
 * @returns {Float32Array} 灰度图像数据 (0-255)
 */
function toGrayscale(data, width, height, channels = 4) {
  const size = width * height;
  const gray = new Float32Array(size);
  
  for (let i = 0; i < size; i++) {
    const idx = i * channels;
    // 使用 ITU-R BT.601 标准加权
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  
  return gray;
}

/**
 * 增强型灰度转换 - 对彩色边框更敏感
 * 
 * 彩色负片的边框通常是亮青色/蓝色（片基颜色），
 * 标准灰度转换可能会降低边框与画面的对比度。
 * 此函数使用多种灰度转换策略并选择对比度最高的结果。
 * 
 * @param {Uint8Array|Uint8ClampedArray} data - 图像像素数据
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @param {number} channels - 通道数 (3=RGB, 4=RGBA)
 * @returns {Float32Array} 灰度图像数据 (0-255)
 */
function toGrayscaleEnhanced(data, width, height, channels = 4) {
  const size = width * height;
  
  // 策略1: 标准 BT.601
  const gray1 = new Float32Array(size);
  // 策略2: 最大通道 (对彩色边框更敏感)
  const gray2 = new Float32Array(size);
  // 策略3: 饱和度增强 (色彩饱和区域会更亮)
  const gray3 = new Float32Array(size);
  
  for (let i = 0; i < size; i++) {
    const idx = i * channels;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    
    // 策略1: 标准灰度
    gray1[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    
    // 策略2: 最大通道值
    gray2[i] = Math.max(r, g, b);
    
    // 策略3: 饱和度增强
    // 高饱和度区域（如蓝色边框）会更亮
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const saturation = maxC > 0 ? (maxC - minC) / maxC : 0;
    gray3[i] = gray1[i] + saturation * 50; // 增加饱和度贡献
  }
  
  // 计算每种策略的边缘对比度
  const contrast1 = computeEdgeContrast(gray1, width, height);
  const contrast2 = computeEdgeContrast(gray2, width, height);
  const contrast3 = computeEdgeContrast(gray3, width, height);
  
  // 选择对比度最高的策略
  if (contrast2 > contrast1 && contrast2 > contrast3) {
    return gray2;
  } else if (contrast3 > contrast1) {
    return gray3;
  }
  return gray1;
}

/**
 * 计算边缘对比度 - 用于选择最佳灰度转换策略
 * 
 * @param {Float32Array} gray - 灰度图像
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @returns {number} 边缘对比度分数
 */
function computeEdgeContrast(gray, width, height) {
  let edgeSum = 0;
  const step = 4; // 采样步长以提高速度
  
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const idx = y * width + x;
      // Sobel 近似
      const gx = Math.abs(gray[idx + 1] - gray[idx - 1]);
      const gy = Math.abs(gray[idx + width] - gray[idx - width]);
      edgeSum += gx + gy;
    }
  }
  
  return edgeSum;
}

/**
 * 1D 高斯核
 * 
 * @param {number} sigma - 标准差
 * @param {number} size - 核大小 (奇数)
 * @returns {Float32Array} 归一化高斯核
 */
function createGaussianKernel(sigma, size = 0) {
  if (size === 0) {
    // 自动计算核大小 (3σ 规则)
    size = Math.ceil(sigma * 3) * 2 + 1;
  }
  
  // 确保是奇数
  if (size % 2 === 0) size++;
  
  const kernel = new Float32Array(size);
  const half = Math.floor(size / 2);
  const sigma2 = 2 * sigma * sigma;
  let sum = 0;
  
  for (let i = 0; i < size; i++) {
    const x = i - half;
    kernel[i] = Math.exp(-(x * x) / sigma2);
    sum += kernel[i];
  }
  
  // 归一化
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }
  
  return kernel;
}

/**
 * 高斯模糊 (可分离卷积)
 * 
 * @param {Float32Array} data - 灰度图像数据
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @param {number} sigma - 高斯标准差
 * @returns {Float32Array} 模糊后的图像
 */
function gaussianBlur(data, width, height, sigma = 1.4) {
  const kernel = createGaussianKernel(sigma);
  const half = Math.floor(kernel.length / 2);
  const temp = new Float32Array(width * height);
  const result = new Float32Array(width * height);
  
  // 水平方向卷积
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let weightSum = 0;
      
      for (let k = -half; k <= half; k++) {
        const nx = x + k;
        if (nx >= 0 && nx < width) {
          const weight = kernel[k + half];
          sum += data[y * width + nx] * weight;
          weightSum += weight;
        }
      }
      
      temp[y * width + x] = sum / weightSum;
    }
  }
  
  // 垂直方向卷积
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let weightSum = 0;
      
      for (let k = -half; k <= half; k++) {
        const ny = y + k;
        if (ny >= 0 && ny < height) {
          const weight = kernel[k + half];
          sum += temp[ny * width + x] * weight;
          weightSum += weight;
        }
      }
      
      result[y * width + x] = sum / weightSum;
    }
  }
  
  return result;
}

/**
 * 通用 3x3 卷积
 * 
 * @param {Float32Array} data - 灰度图像数据
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @param {number[]} kernel - 3x3 卷积核 (9 元素数组)
 * @returns {Float32Array} 卷积结果
 */
function convolve3x3(data, width, height, kernel) {
  const result = new Float32Array(width * height);
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sum = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = (y + ky) * width + (x + kx);
          const kidx = (ky + 1) * 3 + (kx + 1);
          sum += data[idx] * kernel[kidx];
        }
      }
      result[y * width + x] = sum;
    }
  }
  
  return result;
}

/**
 * 将像素坐标的矩形归一化为 0-1 范围
 * 
 * 保证四个分量均在 [0,1] 且 x+w ≤ 1、y+h ≤ 1
 * （下游 isResultValid 依赖 x+w 不超界以避免误判）
 * 
 * @param {Object} rect - 像素坐标矩形 {x, y, w, h} 或 {x, y, width, height}
 * @param {number} imageWidth - 图像宽度
 * @param {number} imageHeight - 图像高度
 * @returns {Object} 归一化矩形 {x, y, w, h}
 */
function normalizeRect(rect, imageWidth, imageHeight) {
  const w = rect.w !== undefined ? rect.w : rect.width;
  const h = rect.h !== undefined ? rect.h : rect.height;

  let nx = Math.max(0, Math.min(1, rect.x / imageWidth));
  let ny = Math.max(0, Math.min(1, rect.y / imageHeight));
  let nw = Math.max(0, Math.min(1, w / imageWidth));
  let nh = Math.max(0, Math.min(1, h / imageHeight));

  // 保证 x+w ≤ 1、y+h ≤ 1（防止右/下越界）
  if (nx + nw > 1) nw = 1 - nx;
  if (ny + nh > 1) nh = 1 - ny;
  if (nw < 0) nw = 0;
  if (nh < 0) nh = 0;

  return { x: nx, y: ny, w: nw, h: nh };
}

/**
 * 将归一化矩形转换为像素坐标
 * 
 * @param {Object} rect - 归一化矩形 {x, y, w, h}
 * @param {number} imageWidth - 图像宽度
 * @param {number} imageHeight - 图像高度
 * @returns {Object} 像素坐标矩形 {x, y, w, h}
 */
function denormalizeRect(rect, imageWidth, imageHeight) {
  return {
    x: Math.round(rect.x * imageWidth),
    y: Math.round(rect.y * imageHeight),
    w: Math.round(rect.w * imageWidth),
    h: Math.round(rect.h * imageHeight)
  };
}

/**
 * 计算两个矩形的 IoU (Intersection over Union)
 * 
 * @param {Object} rect1 - 矩形 1 {x, y, w, h}
 * @param {Object} rect2 - 矩形 2 {x, y, w, h}
 * @returns {number} IoU 值 (0-1)
 */
function calculateIoU(rect1, rect2) {
  const x1 = Math.max(rect1.x, rect2.x);
  const y1 = Math.max(rect1.y, rect2.y);
  const x2 = Math.min(rect1.x + rect1.w, rect2.x + rect2.w);
  const y2 = Math.min(rect1.y + rect1.h, rect2.y + rect2.h);
  
  if (x2 <= x1 || y2 <= y1) return 0;
  
  const intersection = (x2 - x1) * (y2 - y1);
  const area1 = rect1.w * rect1.h;
  const area2 = rect2.w * rect2.h;
  const union = area1 + area2 - intersection;
  
  return union > 0 ? intersection / union : 0;
}

/**
 * 计算两条直线的交点
 * 
 * @param {Object} line1 - 直线 1 {rho, theta} (极坐标)
 * @param {Object} line2 - 直线 2 {rho, theta} (极坐标)
 * @returns {Object|null} 交点 {x, y} 或 null (平行)
 */
function lineIntersection(line1, line2) {
  const cos1 = Math.cos(line1.theta);
  const sin1 = Math.sin(line1.theta);
  const cos2 = Math.cos(line2.theta);
  const sin2 = Math.sin(line2.theta);
  
  const det = cos1 * sin2 - sin1 * cos2;
  
  if (Math.abs(det) < 1e-10) {
    // 直线平行
    return null;
  }
  
  const x = (line1.rho * sin2 - line2.rho * sin1) / det;
  const y = (line2.rho * cos1 - line1.rho * cos2) / det;
  
  return { x, y };
}

/**
 * 计算两个角度之间的差值 (考虑周期性)
 * 
 * @param {number} angle1 - 角度 1 (弧度)
 * @param {number} angle2 - 角度 2 (弧度)
 * @returns {number} 角度差 (弧度, 0 到 π)
 */
function angleDifference(angle1, angle2) {
  let diff = Math.abs(angle1 - angle2);
  if (diff > Math.PI) {
    diff = 2 * Math.PI - diff;
  }
  return diff;
}

/**
 * 判断两条直线是否近似垂直
 * 
 * @param {Object} line1 - 直线 1 {theta}
 * @param {Object} line2 - 直线 2 {theta}
 * @param {number} tolerance - 容差 (度)
 * @returns {boolean}
 */
function arePerpendicular(line1, line2, tolerance = 15) {
  const diff = angleDifference(line1.theta, line2.theta);
  const perpAngle = Math.PI / 2;
  const tolRad = tolerance * Math.PI / 180;
  
  return Math.abs(diff - perpAngle) < tolRad;
}

/**
 * 判断两条直线是否近似平行
 * 
 * @param {Object} line1 - 直线 1 {theta}
 * @param {Object} line2 - 直线 2 {theta}
 * @param {number} tolerance - 容差 (度)
 * @returns {boolean}
 */
function areParallel(line1, line2, tolerance = 10) {
  const diff = angleDifference(line1.theta, line2.theta);
  const tolRad = tolerance * Math.PI / 180;
  
  return diff < tolRad || Math.abs(diff - Math.PI) < tolRad;
}

/**
 * 计算点到直线的距离
 * 
 * @param {Object} point - 点 {x, y}
 * @param {Object} line - 直线 {rho, theta}
 * @returns {number} 距离
 */
function pointToLineDistance(point, line) {
  const { x, y } = point;
  const { rho, theta } = line;
  
  // 点到直线 x*cos(θ) + y*sin(θ) = ρ 的距离
  return Math.abs(x * Math.cos(theta) + y * Math.sin(theta) - rho);
}

const _sharedExports = {
  toGrayscale,
  toGrayscaleEnhanced,
  computeEdgeContrast,
  createGaussianKernel,
  gaussianBlur,
  convolve3x3,
  normalizeRect,
  denormalizeRect,
  calculateIoU,
  lineIntersection,
  angleDifference,
  arePerpendicular,
  areParallel,
  pointToLineDistance
};
const _e_toGrayscale = _sharedExports.toGrayscale;
export { _e_toGrayscale as toGrayscale };
const _e_toGrayscaleEnhanced = _sharedExports.toGrayscaleEnhanced;
export { _e_toGrayscaleEnhanced as toGrayscaleEnhanced };
const _e_computeEdgeContrast = _sharedExports.computeEdgeContrast;
export { _e_computeEdgeContrast as computeEdgeContrast };
const _e_createGaussianKernel = _sharedExports.createGaussianKernel;
export { _e_createGaussianKernel as createGaussianKernel };
const _e_gaussianBlur = _sharedExports.gaussianBlur;
export { _e_gaussianBlur as gaussianBlur };
const _e_convolve3x3 = _sharedExports.convolve3x3;
export { _e_convolve3x3 as convolve3x3 };
const _e_normalizeRect = _sharedExports.normalizeRect;
export { _e_normalizeRect as normalizeRect };
const _e_denormalizeRect = _sharedExports.denormalizeRect;
export { _e_denormalizeRect as denormalizeRect };
const _e_calculateIoU = _sharedExports.calculateIoU;
export { _e_calculateIoU as calculateIoU };
const _e_lineIntersection = _sharedExports.lineIntersection;
export { _e_lineIntersection as lineIntersection };
const _e_angleDifference = _sharedExports.angleDifference;
export { _e_angleDifference as angleDifference };
const _e_arePerpendicular = _sharedExports.arePerpendicular;
export { _e_arePerpendicular as arePerpendicular };
const _e_areParallel = _sharedExports.areParallel;
export { _e_areParallel as areParallel };
const _e_pointToLineDistance = _sharedExports.pointToLineDistance;
export { _e_pointToLineDistance as pointToLineDistance };
export default _sharedExports;
