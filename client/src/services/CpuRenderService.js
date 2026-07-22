/**
 * CPU Render Service - 本地 CPU 渲染服务
 * 
 * 当 GPU 不可用时，使用 RenderCore 进行纯 JavaScript CPU 渲染。
 * 此模块提供与 GPU 渲染相同的接口，确保渲染结果一致性。
 * 
 * @module CpuRenderService
 * @since 2026-01-31
 */

import { RenderCore, processCanvasChunkedSync, processBlock, PREVIEW_MAX_WIDTH_CLIENT, EXPORT_MAX_WIDTH, stableSerializeParams } from '@filmgallery/shared';
import { getApiBase } from '../api';

const _yieldChannel = typeof MessageChannel !== 'undefined' 
  ? new MessageChannel() 
  : null;
const _yieldToMain = _yieldChannel 
  ? () => new Promise(resolve => {
      _yieldChannel.port1.onmessage = () => resolve();
      _yieldChannel.port2.postMessage(null);
    })
  : () => new Promise(resolve => setTimeout(resolve, 0));

// ============================================================================
// 常量定义
// ============================================================================

// P1-22: 从 shared 导入避免漂移（旧本地常量：PREVIEW_MAX_WIDTH=1400, EXPORT_MAX_WIDTH=4000
// 与 shared PREVIEW_MAX_WIDTH_CLIENT=1200, EXPORT_MAX_WIDTH=8000 不一致）
const PREVIEW_MAX_WIDTH = PREVIEW_MAX_WIDTH_CLIENT;
const JPEG_QUALITY = 0.95;
const JPEG_HQ_QUALITY = 1.0;

// ============================================================================
// 图像加载工具
// ============================================================================

/**
 * 加载图片到 Canvas
 * @param {string} imageUrl - 图片 URL
 * @param {number|null} maxWidth - 最大宽度限制（null 表示不限制）
 * @returns {Promise<{canvas, ctx, width, height, originalWidth, originalHeight, image}>}
 */
export async function loadImageToCanvas(imageUrl, maxWidth = null) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    // 设置超时
    const timeout = setTimeout(() => {
      reject(new Error('Image load timeout'));
    }, 30000);

    img.onload = () => {
      clearTimeout(timeout);
      const scale = maxWidth ? Math.min(1, maxWidth / img.width) : 1;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      
      resolve({ 
        canvas, 
        ctx, 
        width: w, 
        height: h, 
        originalWidth: img.width, 
        originalHeight: img.height,
        image: img
      });
    };
    
    img.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to load image: ${imageUrl}`));
    };
    
    img.src = imageUrl;
  });
}

// ============================================================================
// 几何变换工具
// ============================================================================

/**
 * 应用几何变换（旋转 + 裁剪）
 * @param {HTMLCanvasElement} sourceCanvas - 源 Canvas
 * @param {Object} params - 参数对象
 * @returns {HTMLCanvasElement} 变换后的 Canvas
 */
export function applyGeometry(sourceCanvas, params) {
  // P0-5: 补 rotationOffset（FilmLab.jsx 所有几何用 rotation+orientation+rotationOffset）
  // 旧实现漏 rotationOffset，CPU fallback 旋转角度与 GPU/主路径不一致
  const rotation = (params.rotation || 0) + (params.orientation || 0) + (params.rotationOffset || 0);
  const cropRect = params.cropRect || { x: 0, y: 0, w: 1, h: 1 };
  
  // 无需变换的情况
  if (rotation === 0 && 
      cropRect.x === 0 && cropRect.y === 0 && 
      cropRect.w === 1 && cropRect.h === 1) {
    return sourceCanvas;
  }
  
  const rad = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  const rotatedW = srcW * cos + srcH * sin;
  const rotatedH = srcW * sin + srcH * cos;
  
  // 计算裁剪区域（像素坐标）
  let cropX = Math.round(cropRect.x * rotatedW);
  let cropY = Math.round(cropRect.y * rotatedH);
  let cropW = Math.max(1, Math.round(cropRect.w * rotatedW));
  let cropH = Math.max(1, Math.round(cropRect.h * rotatedH));
  
  // 边界检查
  cropX = Math.max(0, Math.min(cropX, Math.round(rotatedW) - 1));
  cropY = Math.max(0, Math.min(cropY, Math.round(rotatedH) - 1));
  cropW = Math.min(cropW, Math.round(rotatedW) - cropX);
  cropH = Math.min(cropH, Math.round(rotatedH) - cropY);
  
  const outCanvas = document.createElement('canvas');
  outCanvas.width = cropW;
  outCanvas.height = cropH;
  const ctx = outCanvas.getContext('2d');
  
  ctx.save();
  ctx.translate(-cropX, -cropY);
  ctx.translate(rotatedW / 2, rotatedH / 2);
  ctx.rotate(rad);
  ctx.drawImage(sourceCanvas, -srcW / 2, -srcH / 2);
  ctx.restore();
  
  return outCanvas;
}

// P1-14: 模块级 RenderCore 缓存 —— 避免每次 processCanvasWithRenderCore* 都 new + prepareLUTs
// 单条目缓存（LRU）：params 序列化键相同则复用，不同则重建。旧实例由 GC 回收。
let _cachedRenderCore = null;
let _cachedRenderCoreKey = '';

function getCachedRenderCore(params) {
  const key = stableSerializeParams(params);
  if (!_cachedRenderCore || _cachedRenderCoreKey !== key) {
    _cachedRenderCore = new RenderCore(params);
    _cachedRenderCore.prepareLUTs();
    _cachedRenderCoreKey = key;
  }
  return _cachedRenderCore;
}

// ============================================================================
// RenderCore 像素处理
// ============================================================================

/**
 * 使用 RenderCore 处理 Canvas 像素 (Float Pipeline)
 * Uses processPixelFloat() for consistency with GPU and server rendering.
 * Input pixels are treated as sRGB 8-bit, linearized internally.
 *
 * @param {HTMLCanvasElement} canvas - 要处理的 Canvas
 * @param {Object} params - RenderCore 参数
 * @returns {HTMLCanvasElement} 处理后的 Canvas（同一个）
 */
export function processCanvasWithRenderCore(canvas, params) {
  // SSOT 循环逻辑在 packages/shared/renderChunked.js（chunkRows=全图 = 同步单块）
  // P1-14: 复用 RenderCore 实例（getCachedRenderCore 内部按 params key 缓存）
  const core = getCachedRenderCore(params);
  processCanvasChunkedSync(canvas, params, { chunkRows: canvas.height || 64, core });
  return canvas;
}

/**
 * 异步分块处理 Canvas（与 processCanvasWithRenderCore 等价，但周期性让出主线程）。
 * 用于大图导出，避免 4000 万像素全分辨率导出阻塞 UI 数秒。
 *
 * @param {HTMLCanvasElement} canvas - 要处理的 Canvas
 * @param {Object} params - RenderCore 参数
 * @param {Object} [opts]
 * @param {number} [opts.chunkRows=64] - 每块处理的行数（让出频率）
 * @param {AbortSignal} [opts.signal] - P1-23: 统一 abort 机制（替代 shouldAbort 回调）
 * @param {() => boolean} [opts.shouldAbort] - 已废弃，保留向后兼容（signal 优先）
 * @returns {Promise<HTMLCanvasElement>} 处理后的 Canvas（同一个）
 */
export async function processCanvasWithRenderCoreAsync(canvas, params, opts = {}) {
  const { chunkRows = 64, shouldAbort = null, signal = null } = opts;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const width = canvas.width;
  const height = canvas.height;
  // P1-14: 复用 RenderCore 实例（getCachedRenderCore 内部按 params key 缓存）
  const core = getCachedRenderCore(params);

  // P1-23: 统一 abort 检查（signal 优先，shouldAbort 向后兼容）
  const isAborted = () => (signal && signal.aborted) || (shouldAbort && shouldAbort());

  // 按行分块处理，每块后 await 让出主线程。
  // 块内处理复用 SSOT processBlock（与同步版数值一致）。
  for (let y0 = 0; y0 < height; y0 += chunkRows) {
    if (isAborted()) throw new DOMException('Render aborted', 'AbortError');
    const y1 = Math.min(y0 + chunkRows, height);
    const blockHeight = y1 - y0;
    const imageData = ctx.getImageData(0, y0, width, blockHeight);
    processBlock(imageData.data, core);
    ctx.putImageData(imageData, 0, y0);
    await _yieldToMain();
  }
  return canvas;
}

// ============================================================================
// Canvas 转 Blob
// ============================================================================

/**
 * 将 Canvas 转换为 Blob
 * @param {HTMLCanvasElement} canvas - 源 Canvas
 * @param {string} format - 输出格式: 'jpeg' | 'png' | 'tiff16'
 * @param {number} quality - JPEG 质量 (0-1)
 * @returns {Promise<{blob: Blob, contentType: string, warning?: string}>}
 */
export async function canvasToBlob(canvas, format = 'jpeg', quality = JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    try {
      if (format === 'jpeg') {
        canvas.toBlob(
          blob => {
            if (blob) {
              resolve({ blob, contentType: 'image/jpeg' });
            } else {
              reject(new Error('Failed to create JPEG blob'));
            }
          },
          'image/jpeg',
          quality
        );
      } else if (format === 'png') {
        canvas.toBlob(
          blob => {
            if (blob) {
              resolve({ blob, contentType: 'image/png' });
            } else {
              reject(new Error('Failed to create PNG blob'));
            }
          },
          'image/png'
        );
      } else if (format === 'tiff16') {
        // Canvas 不支持 TIFF，使用 PNG 作为无损替代
        canvas.toBlob(
          blob => {
            if (blob) {
              resolve({ 
                blob, 
                contentType: 'image/png',
                warning: 'TIFF16 not supported in CPU mode, using PNG as lossless alternative'
              });
            } else {
              reject(new Error('Failed to create PNG blob (TIFF fallback)'));
            }
          },
          'image/png'
        );
      } else {
        reject(new Error(`Unsupported format: ${format}`));
      }
    } catch (e) {
      reject(e);
    }
  });
}

// ============================================================================
// 完整渲染流程
// ============================================================================

/**
 * 本地 CPU 预览渲染
 * @param {Object} options - 渲染选项
 * @returns {Promise<{ok: boolean, blob?: Blob, error?: string, source: string}>}
 */
export async function localCpuPreview({ imageUrl, params, maxWidth = PREVIEW_MAX_WIDTH }) {
  try {
    const startTime = performance.now();
    
    // 加载图片
    const { canvas, width, height } = await loadImageToCanvas(imageUrl, maxWidth);

    // 像素处理（异步分块，避免大图阻塞主线程）
    await processCanvasWithRenderCoreAsync(canvas, params);

    // 应用几何变换
    const finalCanvas = applyGeometry(canvas, params);

    // 转换为 Blob
    const { blob } = await canvasToBlob(finalCanvas, 'jpeg', JPEG_QUALITY);
    
    const elapsed = performance.now() - startTime;
    if (process.env.NODE_ENV !== 'production') console.log(`[CpuRenderService] CPU preview completed in ${elapsed.toFixed(0)}ms`);
    
    return { ok: true, blob, source: 'local-cpu' };
  } catch (e) {
    console.error('[CpuRenderService] CPU preview failed:', e);
    return { ok: false, error: e.message || 'CPU preview failed', source: 'local-cpu' };
  }
}

/**
 * 本地 CPU 高质量渲染
 * @param {Object} options - 渲染选项
 * @returns {Promise<{ok: boolean, blob?: Blob, contentType?: string, error?: string, source: string, warning?: string}>}
 */
export async function localCpuRender({ imageUrl, params, format = 'jpeg', maxWidth = null }) {
  try {
    const startTime = performance.now();
    
    // 加载图片（不限制宽度以保持原始分辨率）
    // 如果 maxWidth 为 0，明确表示不限制宽度；否则使用传入值或默认限制
    const effectiveMaxWidth = (maxWidth === 0) ? 0 : (maxWidth || EXPORT_MAX_WIDTH);
    const { canvas, width, height } = await loadImageToCanvas(imageUrl, effectiveMaxWidth);

    // 像素处理（异步分块，避免大图阻塞主线程）
    await processCanvasWithRenderCoreAsync(canvas, params);

    // 应用几何变换
    const finalCanvas = applyGeometry(canvas, params);

    // 转换为 Blob
    const quality = format === 'jpeg' ? JPEG_HQ_QUALITY : undefined;
    const { blob, contentType, warning } = await canvasToBlob(finalCanvas, format, quality);
    
    const elapsed = performance.now() - startTime;
    if (process.env.NODE_ENV !== 'production') console.log(`[CpuRenderService] CPU render completed in ${elapsed.toFixed(0)}ms, size: ${(blob.size / 1024).toFixed(0)}KB`);
    
    return { 
      ok: true, 
      blob, 
      contentType, 
      source: 'local-cpu',
      ...(warning && { warning })
    };
  } catch (e) {
    console.error('[CpuRenderService] CPU render failed:', e);
    return { ok: false, error: e.message || 'CPU render failed', source: 'local-cpu' };
  }
}

/**
 * 本地 CPU 导出渲染（含上传）
 * 
 * Unified result shape (matches electron-main.js GPU export):
 *   { ok, source, stored, photo, filePath, blob, contentType, width, height }
 * - source: always 'local-cpu' or 'local-cpu-uploaded'
 * - stored: true if uploaded to backend, false if local-only
 * - blob: the rendered Blob (for download without re-fetch)
 * - width/height: rendered image dimensions
 *
 * @param {Object} options - 渲染选项
 * @param {Function} uploadFn - 上传函数
 * @returns {Promise<{ok: boolean, photo?: object, filePath?: string, error?: string, source: string}>}
 */
export async function localCpuExport({ photoId, imageUrl, params, format = 'jpeg' }, uploadFn) {
  try {
    // 渲染图片 (Explicitly disable size limit for export)
    const renderResult = await localCpuRender({ imageUrl, params, format, maxWidth: 0 });
    
    if (!renderResult.ok) {
      return renderResult;
    }
    
    // 上传到服务器
    if (uploadFn) {
      const ext = format === 'tiff16' ? 'png' : (format === 'jpeg' ? 'jpg' : format);
      const uploadResult = await uploadFn(renderResult.blob, {
        photoId,
        filename: `filmlab_${photoId}_${Date.now()}.${ext}`,
        type: 'positive'
      });
      
      if (!uploadResult.ok) {
        // 上传失败但渲染成功
        return { 
          ok: false, 
          error: uploadResult.error || 'Upload failed',
          blob: renderResult.blob,
          source: 'local-cpu',
          stored: false,
        };
      }
      
      return {
        ok: true,
        photo: uploadResult.photo,
        filePath: uploadResult.filePath,
        source: 'local-cpu-uploaded',
        stored: true,
        blob: renderResult.blob,
        contentType: renderResult.contentType,
      };
    }
    
    // 无上传函数，仅返回渲染结果
    return {
      ok: true,
      blob: renderResult.blob,
      contentType: renderResult.contentType,
      source: 'local-cpu',
      stored: false,
    };
  } catch (e) {
    console.error('[CpuRenderService] CPU export failed:', e);
    return { ok: false, error: e.message || 'CPU export failed', source: 'local-cpu', stored: false };
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取照片的图片 URL
 * @param {number} photoId - 照片 ID
 * @param {string} sourceType - 源类型: 'original' | 'negative' | 'positive'
 * @returns {Promise<string|null>}
 */
export async function getPhotoImageUrl(photoId, sourceType = 'original') {
  try {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/api/photos/${photoId}`);
    if (res.ok) {
      const photo = await res.json();
      switch (sourceType) {
        case 'positive':
          return photo.positive_rel_path ? `${apiBase}/uploads/${photo.positive_rel_path}` : null;
        case 'negative':
          return photo.negative_rel_path ? `${apiBase}/uploads/${photo.negative_rel_path}` :
                 photo.original_rel_path ? `${apiBase}/uploads/${photo.original_rel_path}` :
                 photo.full_rel_path ? `${apiBase}/uploads/${photo.full_rel_path}` : null;
        case 'original':
        default:
          return photo.original_rel_path ? `${apiBase}/uploads/${photo.original_rel_path}` :
                 photo.negative_rel_path ? `${apiBase}/uploads/${photo.negative_rel_path}` :
                 photo.full_rel_path ? `${apiBase}/uploads/${photo.full_rel_path}` : null;
      }
    }
  } catch (e) {
    console.error('[CpuRenderService] Failed to get photo info:', e);
  }
  return null;
}

/**
 * 检查 CPU 渲染是否可用
 * @returns {boolean}
 */
export function isCpuRenderAvailable() {
  // CPU 渲染在所有支持 Canvas 的环境中可用
  if (typeof document === 'undefined') return false;
  
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    return !!ctx;
  } catch {
    return false;
  }
}

// ============================================================================
// 导出
// ============================================================================

const CpuRenderService = {
  // 核心渲染函数
  localCpuPreview,
  localCpuRender,
  localCpuExport,
  
  // 工具函数
  loadImageToCanvas,
  applyGeometry,
  processCanvasWithRenderCore,
  canvasToBlob,
  getPhotoImageUrl,
  isCpuRenderAvailable,
  
  // 常量
  PREVIEW_MAX_WIDTH,
  EXPORT_MAX_WIDTH,
  JPEG_QUALITY,
  JPEG_HQ_QUALITY
};

export default CpuRenderService;
