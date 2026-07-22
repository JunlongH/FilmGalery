/**
 * Edge Detection Module - Unified Entry Point
 * 
 * 自动边缘检测模块，用于识别底片边框并自动裁剪
 * 
 * @module packages/shared/edgeDetection
 */

import cannyEdge from './cannyEdge.mjs';
import houghTransform from './houghTransform.mjs';
import rectangleFinder from './rectangleFinder.mjs';
import { gaussianBlur, toGrayscale, toGrayscaleEnhanced, normalizeRect } from './utils.mjs';

/**
 * 边缘检测配置选项
 * @typedef {Object} EdgeDetectionOptions
 * @property {number} [sensitivity=50] - 检测灵敏度 (0-100)
 * @property {string} [filmFormat='auto'] - 底片格式 ('auto' | '35mm' | '120' | '4x5')
 * @property {boolean} [expectDarkBorder=true] - 是否期望暗色边框
 * @property {number} [maxWidth=1200] - 预处理最大宽度
 * @property {boolean} [returnDebugInfo=false] - 是否返回调试信息
 */

/**
 * 边缘检测结果
 * @typedef {Object} EdgeDetectionResult
 * @property {Object} cropRect - 归一化裁剪区域 {x, y, w, h} (0-1)
 * @property {number} rotation - 检测到的倾斜角度 (度)
 * @property {number} confidence - 置信度 (0-1)
 * @property {boolean} borderDetected - 是否检测到明确边框（false=全图回退）
 * @property {Object} [debugInfo] - 调试信息
 */

/**
 * 默认配置
 */
const DEFAULT_OPTIONS = {
  sensitivity: 50,
  filmFormat: 'auto',
  expectDarkBorder: true,
  maxWidth: 1200,
  returnDebugInfo: false,
  verbose: false
};

/**
 * 根据灵敏度计算 Canny 阈值
 * @param {number} sensitivity - 灵敏度 (0-100)
 * @returns {{low: number, high: number}}
 */
function getThresholdsFromSensitivity(sensitivity) {
  // sensitivity 0 = 高阈值 (少边缘), sensitivity 100 = 低阈值 (多边缘)
  // 典型 Canny 阈值: low=30-100, high=100-200
  const normalizedSens = sensitivity / 100;
  
  // 反向映射: 高灵敏度 = 低阈值
  const low = Math.round(100 - normalizedSens * 70);   // 100 -> 30
  const high = Math.round(200 - normalizedSens * 100); // 200 -> 100
  
  return { low, high };
}

/**
 * 根据底片格式获取期望的宽高比范围
 * 
 * @param {string} filmFormat - 底片格式
 *   'auto' | '35mm' | '120' | '120_645' | '120_66' | '120_67' | '4x5'
 *   '120' 是 '120_66' (6×6, 方形) 的别名，因 120 系最常见为 6×6
 * @returns {{minAspect: number, maxAspect: number}}
 */
function getExpectedAspectRatio(filmFormat) {
  const formats = {
    '35mm': { minAspect: 1.4, maxAspect: 1.6 },      // 3:2 = 1.5
    '120_645': { minAspect: 1.2, maxAspect: 1.4 },   // 6x4.5 ≈ 1.33
    '120_66': { minAspect: 0.9, maxAspect: 1.1 },    // 6x6 = 1.0
    '120_67': { minAspect: 1.1, maxAspect: 1.3 },    // 6x7 ≈ 1.17
    // '120' 别名：覆盖 120 系最宽范围（6×6 ~ 6×7）
    '120': { minAspect: 0.9, maxAspect: 1.4 },
    '4x5': { minAspect: 1.2, maxAspect: 1.35 },      // 4:5 = 1.25
    'auto': { minAspect: 0.5, maxAspect: 2.5 }       // 宽松范围
  };
  return formats[filmFormat] || formats['auto'];
}

/**
 * 主入口：检测图像边缘并返回裁剪区域
 * 
 * @param {Object} imageData - 图像数据 { data: Uint8Array, width: number, height: number, channels: number }
 * @param {EdgeDetectionOptions} [options] - 检测选项
 * @returns {EdgeDetectionResult} 检测结果
 */
function detectEdges(imageData, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  
  const { data, width, height, channels } = imageData;
  
  // 1. 转换为灰度图 - 使用增强版本以更好地检测彩色边框
  // 彩色负片的边框通常是亮青色/蓝色，标准灰度转换可能降低对比度
  const grayscale = toGrayscaleEnhanced(data, width, height, channels);
  
  // 2. 高斯模糊降噪
  const blurred = gaussianBlur(grayscale, width, height, 1.4);
  
  // 3. Canny 边缘检测
  const thresholds = getThresholdsFromSensitivity(opts.sensitivity);
  const edges = cannyEdge.detect(blurred, width, height, thresholds.low, thresholds.high);
  
  // 4. Hough 变换检测直线
  // 降低阈值以检测更多直线（尤其是彩色边框可能产生较弱的边缘）
  // 原来是 0.15，改为 0.10，并根据灵敏度进一步调整
  const sensitivityFactor = 1 - (opts.sensitivity / 100) * 0.5; // 0.5 ~ 1.0
  const houghThreshold = Math.round(Math.min(width, height) * 0.10 * sensitivityFactor);
  const lines = houghTransform.detect(edges, width, height, houghThreshold);

  // 5. 从直线中找到最佳矩形
  const aspectRatioRange = getExpectedAspectRatio(opts.filmFormat);
  const rectangleResult = rectangleFinder.findBestRectangle(
    lines, 
    width, 
    height, 
    aspectRatioRange
  );

  // 5.5 密度法 fallback（Hough 失败时启用，避免边框可检测但 findBestRectangle 漏掉）
  const densityResult = !rectangleResult
    ? rectangleFinder.findRectangleByDensity(edges, width, height)
    : null;

  if (opts.verbose) {
    console.log(`🔍 Edge detection: Found ${lines.length} lines (threshold: ${houghThreshold}, sensitivity: ${opts.sensitivity})`);
    console.log('📐 Rectangle result:', rectangleResult
      ? `Found rectangle with confidence ${rectangleResult.confidence.toFixed(2)}`
      : (densityResult ? `Fallback density rectangle confidence ${densityResult.confidence.toFixed(2)}` : 'No rectangle found'));
  }

  // 6. 归一化结果
  let cropRect, rotation, confidence, borderDetected;

  if (rectangleResult) {
    // Hough + 矩形查找成功
    cropRect = normalizeRect(rectangleResult.rect, width, height);
    rotation = rectangleResult.rotation;
    confidence = rectangleResult.confidence;
    borderDetected = true;
  } else if (densityResult) {
    // 密度法 fallback：赋予中等置信度（高于"无边框"的 0.1，低于 Hough 的明确检测）
    cropRect = normalizeRect(densityResult.rect, width, height);
    rotation = densityResult.rotation;
    confidence = densityResult.confidence;
    borderDetected = true;
    if (opts.verbose) {
      console.log('⚠️ Hough rectangle not found, using density fallback.');
    }
  } else {
    // 没有找到矩形，可能是无边框图片
    // 提供一个保守的默认裁剪，但置信度设为很低，表示"没有检测到边框"
    cropRect = { x: 0, y: 0, w: 1, h: 1 }; // 不裁剪
    rotation = 0;
    confidence = 0.1;
    borderDetected = false;
    if (opts.verbose) {
      console.log('⚠️ No rectangle detected - image may have no borders. Suggesting no crop.');
    }
  }

  if (opts.verbose) {
    console.log('📊 Final normalized cropRect:', cropRect);
  }

  const result = {
    cropRect,
    rotation,
    confidence,
    borderDetected
  };

  // 调试信息
  if (opts.returnDebugInfo) {
    result.debugInfo = {
      processingTimeMs: Date.now() - startTime,
      edgePixelCount: edges.filter(v => v > 0).length,
      linesDetected: lines.length,
      thresholds,
      imageSize: { width, height },
      fallbackUsed: !rectangleResult && !!densityResult
    };
  }

  return result;
}

/**
 * 批量检测 - 对多张图像使用相同参数
 * 
 * @param {Array<Object>} imageDataArray - 图像数据数组
 * @param {EdgeDetectionOptions} [options] - 检测选项
 * @returns {Array<EdgeDetectionResult>} 检测结果数组
 */
function detectEdgesBatch(imageDataArray, options = {}) {
  return imageDataArray.map(imageData => detectEdges(imageData, options));
}

/**
 * 验证检测结果是否合理
 * 
 * 判定逻辑（基于 borderDetected 显式标志）：
 *   - borderDetected=false（无边框回退）：使用宽松阈值（minConfidence 默认 0.1）
 *     仅检查几何形状合理性，允许全图 cropRect
 *   - borderDetected=true（明确检测到边框）：使用 minConfidence（默认 0.5）
 *     严格检查所有约束
 * 
 * 兼容老调用方：result 无 borderDetected 字段时按 true 处理（严格路径）
 * 
 * @param {EdgeDetectionResult} result - 检测结果
 * @param {number} minConfidence - 最低置信度阈值（borderDetected=true 时使用）
 * @returns {boolean} 是否有效
 */
function isResultValid(result, minConfidence = 0.5) {
  if (!result || !result.cropRect) {
    if (result && result.verbose !== false) {
      // 仅在显式开启 verbose 时打印（保留向后兼容）
    }
    return false;
  }

  const { cropRect, confidence, rotation, borderDetected } = result;

  // 几何基础校验（所有路径都必须通过）
  if (cropRect.w < 0.1 || cropRect.h < 0.1) {
    return false;
  }
  if (cropRect.x < 0 || cropRect.y < 0) {
    return false;
  }
  if (cropRect.x + cropRect.w > 1.01 || cropRect.y + cropRect.h > 1.01) {
    return false;
  }
  if (Math.abs(rotation) > 15) {
    return false;
  }

  // 无边框回退路径：confidence 通常很低（0.1），允许通过让用户知道
  if (borderDetected === false) {
    return true;
  }

  // borderDetected=true：严格置信度检查
  if (confidence < minConfidence) {
    return false;
  }

  return true;
}

const _sharedExports = {
  detectEdges,
  detectEdgesBatch,
  isResultValid,
  getThresholdsFromSensitivity,
  getExpectedAspectRatio,
  DEFAULT_OPTIONS
};
const _e_detectEdges = _sharedExports.detectEdges;
export { _e_detectEdges as detectEdges };
const _e_detectEdgesBatch = _sharedExports.detectEdgesBatch;
export { _e_detectEdgesBatch as detectEdgesBatch };
const _e_isResultValid = _sharedExports.isResultValid;
export { _e_isResultValid as isResultValid };
const _e_getThresholdsFromSensitivity = _sharedExports.getThresholdsFromSensitivity;
export { _e_getThresholdsFromSensitivity as getThresholdsFromSensitivity };
const _e_getExpectedAspectRatio = _sharedExports.getExpectedAspectRatio;
export { _e_getExpectedAspectRatio as getExpectedAspectRatio };
const _e_DEFAULT_OPTIONS = _sharedExports.DEFAULT_OPTIONS;
export { _e_DEFAULT_OPTIONS as DEFAULT_OPTIONS };
export default _sharedExports;
