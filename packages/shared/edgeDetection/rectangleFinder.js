/**
 * Rectangle Finder
 * 
 * 从检测到的直线中找到最可能的矩形边框
 * 
 * @module packages/shared/edgeDetection/rectangleFinder
 */

// P3: arePerpendicular/areParallel 死导入已删除（rectangleFinder 自带 angleDiffWrap 内联，从不调用这两个工具函数）
const { lineIntersection } = require('./utils');
const { classifyLines, parallelLineDistance, mergeLines } = require('./houghTransform');

/**
 * 四边形顶点
 * @typedef {Object} Quadrilateral
 * @property {Object} topLeft - 左上角 {x, y}
 * @property {Object} topRight - 右上角 {x, y}
 * @property {Object} bottomLeft - 左下角 {x, y}
 * @property {Object} bottomRight - 右下角 {x, y}
 */

/**
 * 矩形检测结果
 * @typedef {Object} RectangleResult
 * @property {Object} rect - 像素坐标矩形 {x, y, w, h}
 * @property {number} rotation - 倾斜角度 (度)
 * @property {number} confidence - 置信度 (0-1)
 * @property {Quadrilateral} [corners] - 四个角点
 */

/**
 * 从直线集合中找到最佳矩形
 * 
 * @param {Array} lines - Hough 变换检测到的直线
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @param {Object} aspectRatioRange - 期望的宽高比范围 {minAspect, maxAspect}
 * @returns {RectangleResult|null}
 */
function findBestRectangle(lines, width, height, aspectRatioRange = { minAspect: 0.5, maxAspect: 2.5 }) {
  if (!lines || lines.length < 4) {
    return null;
  }
  
  // 1. 合并相似直线
  const mergedLines = mergeLines(lines, 20, 10);
  
  // 2. 分类为水平和垂直
  const { horizontal, vertical } = classifyLines(mergedLines, 25);
  
  if (horizontal.length < 2 || vertical.length < 2) {
    // 尝试放宽角度容差
    const relaxed = classifyLines(mergedLines, 35);
    if (relaxed.horizontal.length < 2 || relaxed.vertical.length < 2) {
      return null;
    }
    horizontal.length = 0;
    vertical.length = 0;
    horizontal.push(...relaxed.horizontal);
    vertical.push(...relaxed.vertical);
  }
  
  // 3. 找到最佳的两对平行线
  const bestPair = findBestLinePairs(horizontal, vertical, width, height, aspectRatioRange);
  
  if (!bestPair) {
    return null;
  }
  
  const { h1, h2, v1, v2, score } = bestPair;
  
  // 4. 计算四个交点
  const corners = computeCorners(h1, h2, v1, v2);
  
  if (!corners) {
    return null;
  }
  
  // 5. 验证四边形合理性
  if (!isValidQuadrilateral(corners, width, height)) {
    return null;
  }
  
  // 6. 计算包围矩形和旋转角度
  const result = computeRectangleFromCorners(corners, width, height);
  result.confidence = Math.min(1, score / 1000);
  result.corners = corners;
  
  return result;
}

/**
 * 找到最佳的两对平行线
 * 
 * @param {Array} horizontal - 水平线
 * @param {Array} vertical - 垂直线
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @param {Object} aspectRatioRange - 宽高比范围
 * @returns {Object|null} { h1, h2, v1, v2, score }
 */
function findBestLinePairs(horizontal, vertical, width, height, aspectRatioRange) {
  let bestScore = -Infinity;
  let bestPair = null;
  
  // 按票数排序
  horizontal.sort((a, b) => b.votes - a.votes);
  vertical.sort((a, b) => b.votes - a.votes);
  
  // 限制搜索空间
  const maxHLines = Math.min(horizontal.length, 6);
  const maxVLines = Math.min(vertical.length, 6);
  
  for (let i = 0; i < maxHLines; i++) {
    for (let j = i + 1; j < maxHLines; j++) {
      const h1 = horizontal[i];
      const h2 = horizontal[j];
      const hDist = parallelLineDistance(h1, h2);
      
      // 过滤太近或太远的线对
      if (hDist < height * 0.2 || hDist > height * 0.98) continue;
      
      for (let k = 0; k < maxVLines; k++) {
        for (let l = k + 1; l < maxVLines; l++) {
          const v1 = vertical[k];
          const v2 = vertical[l];
          const vDist = parallelLineDistance(v1, v2);
          
          // 过滤太近或太远的线对
          if (vDist < width * 0.2 || vDist > width * 0.98) continue;
          
          // 检查宽高比
          const aspect = vDist / hDist;
          if (aspect < aspectRatioRange.minAspect || aspect > aspectRatioRange.maxAspect) {
            continue;
          }
          
          // 计算评分
          const score = computePairScore(h1, h2, v1, v2, hDist, vDist, width, height);
          
          if (score > bestScore) {
            bestScore = score;
            bestPair = { h1, h2, v1, v2, score };
          }
        }
      }
    }
  }
  
  return bestPair;
}

/**
 * 计算线对的评分
 * 
 * @param {Object} h1 - 水平线 1
 * @param {Object} h2 - 水平线 2
 * @param {Object} v1 - 垂直线 1
 * @param {Object} v2 - 垂直线 2
 * @param {number} hDist - 水平线间距
 * @param {number} vDist - 垂直线间距
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @returns {number} 评分
 */
function computePairScore(h1, h2, v1, v2, hDist, vDist, width, height) {
  let score = 0;
  
  // 1. 票数权重
  score += (h1.votes + h2.votes + v1.votes + v2.votes) * 0.1;
  
  // 2. 面积权重 (偏好较大的矩形)
  const area = hDist * vDist;
  const imageArea = width * height;
  const areaRatio = area / imageArea;
  score += areaRatio * 500;
  
  // 3. 中心位置权重 (偏好居中的矩形)
  // 计算矩形中心与图像中心的距离
  const centerPenalty = 0; // 暂时不计算，需要交点
  score -= centerPenalty;
  
  // 4. 平行度权重（θ 轴周期性：-89° 与 +89° 是平行线，直接求差会得 ~3.14 rad）
  const angleDiffWrap = (a, b) => {
    let d = Math.abs(a - b) % Math.PI;
    return Math.min(d, Math.PI - d);
  };
  const hAngleDiff = angleDiffWrap(h1.theta, h2.theta);
  const vAngleDiff = angleDiffWrap(v1.theta, v2.theta);
  score -= (hAngleDiff + vAngleDiff) * 100;

  // 5. 垂直度权重
  const perpRaw = Math.abs(angleDiffWrap(h1.theta, v1.theta));
  const perpAngle = Math.abs(perpRaw - Math.PI / 2);
  score -= perpAngle * 50;

  return score;
}

/**
 * 计算四个交点
 * 
 * @param {Object} h1 - 水平线 1 (上)
 * @param {Object} h2 - 水平线 2 (下)
 * @param {Object} v1 - 垂直线 1 (左)
 * @param {Object} v2 - 垂直线 2 (右)
 * @returns {Quadrilateral|null}
 */
function computeCorners(h1, h2, v1, v2) {
  // 计算全部 4 个交点（不依赖 ρ 排序 —— ρ 在 θ≈-90° 时方向相反，旧实现误判上下导致自交）
  const p1 = lineIntersection(h1, v1);
  const p2 = lineIntersection(h1, v2);
  const p3 = lineIntersection(h2, v1);
  const p4 = lineIntersection(h2, v2);

  if (!p1 || !p2 || !p3 || !p4) {
    return null;
  }

  // 按实际坐标排序：先按 y 分上下两行，再按 x 分左右
  // 取 y 较小的两点为 top，y 较大的两点为 bottom
  const sortedByY = [p1, p2, p3, p4].sort((a, b) => a.y - b.y);
  const topPair = sortedByY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottomPair = sortedByY.slice(2, 4).sort((a, b) => a.x - b.x);

  return {
    topLeft: topPair[0],
    topRight: topPair[1],
    bottomLeft: bottomPair[0],
    bottomRight: bottomPair[1],
  };
}

/**
 * 验证四边形是否合理
 * 
 * @param {Quadrilateral} corners - 四个角点
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @returns {boolean}
 */
function isValidQuadrilateral(corners, width, height) {
  const { topLeft, topRight, bottomLeft, bottomRight } = corners;
  const points = [topLeft, topRight, bottomLeft, bottomRight];
  
  // 1. 所有点在图像范围内 (允许一定容差)
  const margin = Math.max(width, height) * 0.1;
  for (const p of points) {
    if (p.x < -margin || p.x > width + margin || 
        p.y < -margin || p.y > height + margin) {
      return false;
    }
  }
  
  // 2. 检查是凸四边形
  if (!isConvexQuadrilateral(corners)) {
    return false;
  }
  
  // 3. 最小面积检查
  const area = quadrilateralArea(corners);
  if (area < width * height * 0.1) {
    return false;
  }
  
  return true;
}

/**
 * 检查是否为凸四边形
 * 
 * @param {Quadrilateral} corners
 * @returns {boolean}
 */
function isConvexQuadrilateral(corners) {
  const { topLeft, topRight, bottomRight, bottomLeft } = corners;
  const points = [topLeft, topRight, bottomRight, bottomLeft];
  
  // 计算相邻边的叉积符号
  let sign = null;
  
  for (let i = 0; i < 4; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % 4];
    const p3 = points[(i + 2) % 4];
    
    const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
    
    if (sign === null) {
      sign = Math.sign(cross);
    } else if (Math.sign(cross) !== sign && Math.abs(cross) > 1e-10) {
      return false;
    }
  }
  
  return true;
}

/**
 * 计算四边形面积
 * 
 * @param {Quadrilateral} corners
 * @returns {number}
 */
function quadrilateralArea(corners) {
  const { topLeft, topRight, bottomRight, bottomLeft } = corners;
  
  // 使用鞋带公式
  const x = [topLeft.x, topRight.x, bottomRight.x, bottomLeft.x];
  const y = [topLeft.y, topRight.y, bottomRight.y, bottomLeft.y];
  
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += x[i] * y[j] - x[j] * y[i];
  }
  
  return Math.abs(area) / 2;
}

/**
 * 从四个角点计算轴对齐的包围矩形和旋转角度
 * 
 * @param {Quadrilateral} corners
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @returns {Object} { rect, rotation }
 */
function computeRectangleFromCorners(corners, width, height) {
  const { topLeft, topRight, bottomLeft, bottomRight } = corners;
  
  // 计算旋转角度 (基于上边的倾斜)
  const dx = topRight.x - topLeft.x;
  const dy = topRight.y - topLeft.y;
  const rotation = Math.atan2(dy, dx) * 180 / Math.PI;
  
  // 计算包围矩形
  const minX = Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);
  
  // 如果旋转角度较小，直接使用四边形的边界
  if (Math.abs(rotation) < 5) {
    return {
      rect: {
        x: Math.max(0, minX),
        y: Math.max(0, minY),
        w: Math.min(width, maxX) - Math.max(0, minX),
        h: Math.min(height, maxY) - Math.max(0, minY)
      },
      rotation: rotation
    };
  }
  
  // 计算旋转后的内接矩形
  // 使用四边形的中心和平均尺寸
  const cx = (topLeft.x + topRight.x + bottomLeft.x + bottomRight.x) / 4;
  const cy = (topLeft.y + topRight.y + bottomLeft.y + bottomRight.y) / 4;
  
  // 边长
  const topWidth = Math.sqrt(dx * dx + dy * dy);
  const leftHeight = Math.sqrt(
    Math.pow(bottomLeft.x - topLeft.x, 2) + 
    Math.pow(bottomLeft.y - topLeft.y, 2)
  );
  
  return {
    rect: {
      x: cx - topWidth / 2,
      y: cy - leftHeight / 2,
      w: topWidth,
      h: leftHeight
    },
    rotation: rotation
  };
}

/**
 * 备用方法：基于边缘密度的矩形检测
 * 当 Hough 检测失败时使用
 * 
 * @param {Uint8Array} edges - 边缘图
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @returns {Object|null} { rect, rotation: 0, confidence }
 */
function findRectangleByDensity(edges, width, height) {
  // 计算行列边缘密度
  const rowDensity = new Float32Array(height);
  const colDensity = new Float32Array(width);
  
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (edges[y * width + x] > 0) count++;
    }
    rowDensity[y] = count / width;
  }
  
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      if (edges[y * width + x] > 0) count++;
    }
    colDensity[x] = count / height;
  }
  
  // 找到密度峰值
  const threshold = 0.1;
  
  const topPeaks = findPeaks(rowDensity, threshold);
  const leftPeaks = findPeaks(colDensity, threshold);
  
  if (topPeaks.length < 2 || leftPeaks.length < 2) {
    return null;
  }
  
  // 取第一个和最后一个峰值作为边界
  const top = topPeaks[0];
  const bottom = topPeaks[topPeaks.length - 1];
  const left = leftPeaks[0];
  const right = leftPeaks[leftPeaks.length - 1];
  
  if (bottom - top < height * 0.3 || right - left < width * 0.3) {
    return null;
  }
  
  return {
    rect: {
      x: left,
      y: top,
      w: right - left,
      h: bottom - top
    },
    rotation: 0,
    confidence: 0.5
  };
}

/**
 * 在一维数组中找到峰值位置
 * 
 * @param {Float32Array} data
 * @param {number} threshold
 * @returns {Array<number>}
 */
function findPeaks(data, threshold) {
  const peaks = [];
  const n = data.length;
  
  for (let i = 1; i < n - 1; i++) {
    if (data[i] > threshold && 
        data[i] >= data[i - 1] && 
        data[i] >= data[i + 1]) {
      peaks.push(i);
    }
  }
  
  return peaks;
}

module.exports = {
  findBestRectangle,
  findRectangleByDensity,
  computeCorners,
  isValidQuadrilateral,
  quadrilateralArea,
  computeRectangleFromCorners
};
