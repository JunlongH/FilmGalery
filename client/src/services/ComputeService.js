/**
 * Compute Service - 混合模式计算抽象层
 * 
 * 当连接到 NAS 服务器时，计算密集型任务需要在本地执行。
 * 此模块检测服务器能力并智能路由请求。
 * 
 * 渲染回退顺序：
 * 1. 服务器渲染（standalone 模式）
 * 2. 本地 GPU 渲染（Electron + WebGL）
 * 3. 本地 CPU 渲染（RenderCore 纯 JavaScript）
 */

import { getApiBase } from '../api';
import CpuRenderService from './CpuRenderService';

// 缓存服务器能力
let serverCapabilities = null;
let lastCapabilityCheck = 0;
const CAPABILITY_CACHE_MS = 60000; // 1分钟缓存
const CAPABILITY_NEGATIVE_CACHE_MS = 10000; // 探测失败时的负缓存（避免热路径重复 fetch）

// 格式 → MIME 映射（三处渲染路径共用，避免漂移）
const FORMAT_MIME = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  tiff: 'image/tiff',
  tiff16: 'image/tiff',
};

// 预览请求序号（防竞态：仅最新请求的结果被采用）
let previewRequestSeq = 0;

/**
 * 发起带序号守卫的预览调用：仅当这是最新请求时才返回结果，
 * 否则返回 { ok: false, stale: true }，调用方应丢弃。
 */
export async function smartFilmlabPreviewLatest(args) {
  const seq = ++previewRequestSeq;
  const result = await smartFilmlabPreview(args);
  if (seq !== previewRequestSeq) {
    return { ok: false, stale: true, error: 'superseded by newer preview request' };
  }
  return result;
}

// 进度回调注册表
const progressCallbacks = new Map();
let progressCallbackId = 0;

// 错误类型定义
export const ComputeErrorCodes = {
  NO_GPU_PROCESSOR: 'E_NO_GPU_PROCESSOR',
  PHOTO_NOT_FOUND: 'E_PHOTO_NOT_FOUND',
  SERVER_UNAVAILABLE: 'E_SERVER_UNAVAILABLE',
  NAS_NO_COMPUTE: 'E_NAS_NO_COMPUTE',
  UPLOAD_FAILED: 'E_UPLOAD_FAILED',
  PROCESSING_FAILED: 'E_PROCESSING_FAILED',
  NETWORK_ERROR: 'E_NETWORK_ERROR',
  TIMEOUT: 'E_TIMEOUT'
};

/**
 * 创建标准化错误对象
 */
export function createError(code, message, details = {}) {
  return {
    ok: false,
    error: message,
    code,
    details,
    timestamp: Date.now()
  };
}

/**
 * 获取服务器能力（带缓存）
 */
export async function getServerCapabilities() {
  const now = Date.now();
  if (serverCapabilities && (now - lastCapabilityCheck) < CAPABILITY_CACHE_MS) {
    return serverCapabilities;
  }
  
  try {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/api/discover`);
    if (res.ok) {
      const data = await res.json();
      serverCapabilities = {
        mode: data.mode || 'standalone',
        compute: data.capabilities?.compute ?? true,
        // 与服务端 schema 对齐（data/compute/storage），保留旧字段名兼容
        database: data.capabilities?.data ?? data.capabilities?.database ?? true,
        files: data.capabilities?.storage ?? data.capabilities?.files ?? true,
        version: data.version
      };
      lastCapabilityCheck = now;
      return serverCapabilities;
    }
  } catch (e) {
    console.warn('[ComputeService] Failed to fetch capabilities:', e);
  }

  // 探测失败：混合模式（NAS）下不能假设服务器有算力，默认本地处理；
  // 非混合模式按 standalone 处理（保持旧行为）。结果做短 TTL 负缓存。
  const fallback = {
    mode: isHybridMode() ? 'nas' : 'standalone',
    compute: !isHybridMode(),
    database: true,
    files: true
  };
  serverCapabilities = fallback;
  lastCapabilityCheck = Date.now() - CAPABILITY_CACHE_MS + CAPABILITY_NEGATIVE_CACHE_MS;
  return fallback;
}

/**
 * 检查服务器是否支持计算功能
 */
export async function isComputeAvailable() {
  const caps = await getServerCapabilities();
  return caps.compute === true;
}

/**
 * 检查是否处于混合模式（NAS + 本地算力）
 */
export function isHybridMode() {
  const isElectron = !!window.__electron;
  if (!isElectron) return false;
  
  // 检查配置的服务器模式
  // 这个值在 preload 阶段同步加载
  return window.__electron?.serverMode === 'hybrid';
}

/**
 * 获取本地 Electron GPU 处理器
 */
export function getLocalGpuProcessor() {
  if (!window.__electron?.filmlabGpuProcess) {
    return null;
  }
  return window.__electron.filmlabGpuProcess;
}

/**
 * 智能 FilmLab 预览
 * 在混合模式下使用本地 GPU，否则使用服务器
 */
export async function smartFilmlabPreview({ photoId, params, maxWidth = 1400, sourceType = 'original' }) {
  const hasCompute = await isComputeAvailable();
  
  // 如果服务器有计算能力，使用服务器
  if (hasCompute) {
    const apiBase = getApiBase();
    const resp = await fetch(`${apiBase}/api/filmlab/preview`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({ photoId, params, maxWidth, sourceType }),
      cache: 'no-store'
    });
    
    const ct = resp.headers.get('content-type') || '';
    if (ct.startsWith('image/')) {
      const blob = await resp.blob();
      return { ok: true, blob, source: 'server' };
    }
    
    // 检查是否是计算不可用错误
    if (resp.status === 503) {
      const data = await resp.json().catch(() => ({}));
      if (data.code === 'E_NAS_NO_COMPUTE') {
        // 服务器明确表示无计算能力，尝试本地处理（必须透传 sourceType）
        return await localGpuPreview({ photoId, params, maxWidth, sourceType });
      }
    }
    
    const text = await resp.text();
    let err;
    try { err = JSON.parse(text); } catch { err = { error: text }; }
    return { ok: false, error: err?.error || err?.message || text };
  }
  
  // 服务器无计算能力，使用本地 GPU
  return await localGpuPreview({ photoId, params, maxWidth, sourceType });
}

/**
 * 本地预览处理（GPU 优先，CPU 回退）
 * 
 * 渲染顺序：
 * 1. 尝试 Electron GPU 渲染（最快）
 * 2. 失败则回退到 CPU 渲染（RenderCore）
 */
async function localGpuPreview({ photoId, params, maxWidth, sourceType = 'original' }) {
  // 获取图片 URL
  const imageUrl = await getPhotoImageUrl(photoId, sourceType);
  if (!imageUrl) {
    return { ok: false, error: `Cannot get photo image URL for sourceType: ${sourceType}` };
  }
  
  const gpuProcessor = getLocalGpuProcessor();
  
  // 尝试 GPU 渲染
  if (gpuProcessor) {
    try {
      const result = await gpuProcessor({ 
        params, 
        photoId, 
        imageUrl,
        previewMode: true,
        maxWidth,
        sourceType 
      });
      
      if (result?.ok && result.blob?.size > 0) {
        return {
          ok: true,
          blob: result.blob,
          source: 'local-gpu'
        };
      }

      console.warn('[ComputeService] GPU preview failed or returned empty blob, falling back to CPU:', result?.error);
    } catch (e) {
      console.warn('[ComputeService] GPU preview exception, falling back to CPU:', e.message);
    }
  } else {
    console.log('[ComputeService] GPU processor not available, using CPU fallback');
  }
  
  // CPU 回退
  console.log('[ComputeService] Using CPU fallback for preview');
  return await CpuRenderService.localCpuPreview({ imageUrl, params, maxWidth });
}

/**
 * 获取照片的图片 URL（SSOT：委托到 CpuRenderService.getPhotoImageUrl，消除两份重复实现）
 * @param {number} photoId - 照片 ID
 * @param {string} sourceType - 源类型: 'original' | 'negative' | 'positive'
 */
const getPhotoImageUrl = (photoId, sourceType = 'original') =>
  CpuRenderService.getPhotoImageUrl(photoId, sourceType);


/**
 * 智能渲染正片
 * 在混合模式下使用本地 GPU，否则使用服务器
 */
export async function smartRenderPositive(photoId, params, { format = 'jpeg', sourceType = 'original' } = {}) {
  const hasCompute = await isComputeAvailable();
  
  if (hasCompute) {
    // 使用服务器渲染
    const apiBase = getApiBase();
    const resp = await fetch(`${apiBase}/api/photos/${photoId}/render-positive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params, format, sourceType })
    });
    
    const ct = resp.headers.get('content-type') || '';
    if (ct.startsWith('image/')) {
      const blob = await resp.blob();
      return { ok: true, blob, contentType: ct, source: 'server' };
    }
    
    // 检查是否是计算不可用错误
    if (resp.status === 503) {
      const data = await resp.json().catch(() => ({}));
      if (data.code === 'E_NAS_NO_COMPUTE') {
        return await localRenderPositive(photoId, params, { format, sourceType });
      }
    }
    
    const text = await resp.text();
    let err;
    try { err = JSON.parse(text); } catch { err = { error: text }; }
    return { ok: false, error: err?.error || err?.message || text };
  }
  
  // 使用本地渲染
  return await localRenderPositive(photoId, params, { format, sourceType });
}

/**
 * 本地渲染正片（GPU 优先，CPU 回退）
 * 
 * 渲染顺序：
 * 1. 尝试 Electron GPU 渲染
 * 2. 失败则回退到 CPU 渲染（RenderCore）
 */
async function localRenderPositive(photoId, params, { format = 'jpeg', sourceType = 'original' } = {}) {
  // 获取图片 URL
  const imageUrl = await getPhotoImageUrl(photoId, sourceType);
  if (!imageUrl) {
    return { ok: false, error: `Cannot get photo image URL for sourceType: ${sourceType}` };
  }
  
  const gpuProcessor = getLocalGpuProcessor();
  
  // 尝试 GPU 渲染
  if (gpuProcessor) {
    try {
      const result = await gpuProcessor({ 
        params, 
        photoId, 
        imageUrl,
        previewMode: false,
        outputFormat: format,
        sourceType
      });
      
      if (result?.ok && result.blob?.size > 0) {
        return {
          ok: true,
          blob: result.blob,
          contentType: FORMAT_MIME[format] || 'image/jpeg',
          source: 'local-gpu'
        };
      }

      console.warn('[ComputeService] GPU render failed or returned empty blob, falling back to CPU:', result?.error);
    } catch (e) {
      console.warn('[ComputeService] GPU render exception, falling back to CPU:', e.message);
    }
  } else {
    console.log('[ComputeService] GPU processor not available, using CPU fallback');
  }
  
  // CPU 回退
  console.log('[ComputeService] Using CPU fallback for render, format:', format);
  return await CpuRenderService.localCpuRender({ imageUrl, params, format, maxWidth: 0 });
}

/**
 * 清除能力缓存（配置变更后调用）
 */
export function clearCapabilityCache() {
  serverCapabilities = null;
  lastCapabilityCheck = 0;
}

/**
 * 智能导出正片
 * 在混合模式下使用本地 GPU 渲染后上传，否则使用服务器
 * @param {number} photoId - 照片 ID
 * @param {object} params - FilmLab 参数
 * @param {object} options - 选项 (format, sourceType)
 * @returns {Promise<{ok: boolean, error?: string, photo?: object}>}
 */
export async function smartExportPositive(photoId, params, { format = 'jpeg', sourceType = 'original' } = {}) {
  const hasCompute = await isComputeAvailable();
  
  if (hasCompute) {
    // 服务器有计算能力，使用服务器导出
    const apiBase = getApiBase();
    try {
      const resp = await fetch(`${apiBase}/api/filmlab/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId, params, format, sourceType })
      });
      
      if (resp.ok) {
        const data = await resp.json();
        return { ok: true, ...data, source: 'server' };
      }
      
      // 检查是否是计算不可用错误
      if (resp.status === 503) {
        const data = await resp.json().catch(() => ({}));
        if (data.code === 'E_NAS_NO_COMPUTE') {
          // 服务器明确表示无计算能力，尝试本地处理
          return await localExportPositive(photoId, params, { format, sourceType });
        }
      }
      
      const err = await resp.json().catch(() => ({}));
      return { ok: false, error: err?.error || `Server export failed: ${resp.status}` };
    } catch (e) {
      console.error('[ComputeService] Server export failed:', e);
      return { ok: false, error: e.message || 'Server export failed' };
    }
  }
  
  // 服务器无计算能力，使用本地处理
  return await localExportPositive(photoId, params, { format, sourceType });
}

/**
 * 本地导出正片（GPU 优先，CPU 回退 + 上传到服务器）
 * 
 * 渲染顺序：
 * 1. 尝试 Electron GPU 渲染（自动上传）
 * 2. 失败则回退到 CPU 渲染 + 手动上传
 */
async function localExportPositive(photoId, params, { format = 'jpeg', sourceType = 'original' } = {}) {
  // 获取图片 URL
  const imageUrl = await getPhotoImageUrl(photoId, sourceType);
  if (!imageUrl) {
    return createError(
      ComputeErrorCodes.PHOTO_NOT_FOUND,
      `Cannot get photo image URL for sourceType: ${sourceType}`
    );
  }
  
  const gpuProcessor = getLocalGpuProcessor();
  
  // 尝试 GPU 渲染
  if (gpuProcessor) {
    try {
      console.log('[ComputeService] Attempting GPU export, photoId:', photoId);
      
      const result = await gpuProcessor({ 
        params, 
        photoId, 
        imageUrl,
        previewMode: false,
        outputFormat: format,
        sourceType
      });
      
      if (result?.ok) {
        console.log('[ComputeService] GPU export successful');
        return { 
          ok: true, 
          photo: result.photo,
          filePath: result.filePath,
          source: 'local-gpu' 
        };
      }
      
      console.warn('[ComputeService] GPU export failed, falling back to CPU:', result?.error);
    } catch (e) {
      console.warn('[ComputeService] GPU export exception, falling back to CPU:', e.message);
    }
  } else {
    console.log('[ComputeService] GPU processor not available, using CPU fallback');
  }
  
  // CPU 回退 + 上传
  console.log('[ComputeService] Using CPU fallback for export');
  return await CpuRenderService.localCpuExport(
    { photoId, imageUrl, params, format },
    uploadProcessedResult
  );
}

// ========================================
// Phase 3.4: 处理结果上传
// ========================================

/**
 * 上传处理结果到远程服务器
 * @param {Blob} blob - 处理后的图片 Blob
 * @param {Object} options - 上传选项
 * @returns {Promise<{ok: boolean, url?: string, error?: string}>}
 */
export async function uploadProcessedResult(blob, options = {}) {
  const { 
    photoId, 
    filename, 
    type = 'processed',
    onProgress 
  } = options;
  
  if (!blob) {
    return createError(ComputeErrorCodes.PROCESSING_FAILED, 'No blob to upload');
  }
  
  const formData = new FormData();
  const finalFilename = filename || `processed_${photoId}_${Date.now()}.jpg`;
  formData.append('file', blob, finalFilename);
  formData.append('type', type);
  if (photoId) formData.append('photoId', photoId);
  
  try {
    // 使用 XMLHttpRequest 支持进度
    return await new Promise((resolve, reject) => {
      const apiBase = getApiBase();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${apiBase}/api/uploads/processed`);
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve({ ok: true, ...data, source: 'remote-upload' });
          } catch {
            resolve({ ok: true, url: xhr.responseText, source: 'remote-upload' });
          }
        } else {
          resolve(createError(
            ComputeErrorCodes.UPLOAD_FAILED, 
            `Upload failed: ${xhr.statusText}`,
            { status: xhr.status }
          ));
        }
      };
      
      xhr.onerror = () => {
        resolve(createError(
          ComputeErrorCodes.NETWORK_ERROR,
          'Network error during upload'
        ));
      };
      
      xhr.ontimeout = () => {
        resolve(createError(ComputeErrorCodes.TIMEOUT, 'Upload timed out'));
      };
      
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress({
              phase: 'upload',
              loaded: e.loaded,
              total: e.total,
              percent: Math.round((e.loaded / e.total) * 100)
            });
          }
        };
      }
      
      xhr.timeout = 120000; // 2分钟超时
      xhr.send(formData);
    });
  } catch (e) {
    console.error('[ComputeService] Upload failed:', e);
    return createError(ComputeErrorCodes.UPLOAD_FAILED, e.message);
  }
}

/**
 * 智能处理并上传结果
 * 本地处理 + 上传到远程服务器
 */
export async function processAndUpload(photoId, params, options = {}) {
  const { 
    format = 'jpeg',
    sourceType = 'original',
    onProgress,
    uploadToServer = true 
  } = options;
  
  // 阶段1: 本地处理
  if (onProgress) {
    onProgress({ phase: 'processing', percent: 0, message: '开始处理...' });
  }
  
  const result = await localRenderPositive(photoId, params, { format, sourceType });
  
  if (!result.ok) {
    return result;
  }
  
  if (onProgress) {
    onProgress({ phase: 'processing', percent: 100, message: '处理完成' });
  }
  
  // 如果不需要上传，直接返回
  if (!uploadToServer) {
    return result;
  }
  
  // 阶段2: 上传到服务器
  if (onProgress) {
    onProgress({ phase: 'upload', percent: 0, message: '开始上传...' });
  }
  
  const uploadResult = await uploadProcessedResult(result.blob, {
    photoId,
    filename: `filmlab_${photoId}_${Date.now()}.${format === 'tiff16' ? 'tiff' : 'jpg'}`,
    type: 'processed',
    onProgress: (p) => {
      if (onProgress) {
        onProgress({ 
          phase: 'upload', 
          ...p, 
          message: `上传中 ${p.percent}%` 
        });
      }
    }
  });
  
  if (!uploadResult.ok) {
    // 上传失败但处理成功，返回本地结果
    return {
      ...result,
      uploadError: uploadResult.error,
      uploadFailed: true
    };
  }
  
  if (onProgress) {
    onProgress({ phase: 'complete', percent: 100, message: '完成' });
  }
  
  return {
    ok: true,
    blob: result.blob,
    remoteUrl: uploadResult.url,
    source: 'local-gpu-uploaded'
  };
}

// ========================================
// Phase 4.2: 进度反馈系统
// ========================================

/**
 * 注册进度回调
 * @param {string} taskId - 任务ID
 * @param {Function} callback - 进度回调函数
 * @returns {number} 回调ID
 */
export function registerProgressCallback(taskId, callback) {
  const id = ++progressCallbackId;
  progressCallbacks.set(id, { taskId, callback });
  return id;
}

/**
 * 取消注册进度回调
 * @param {number} callbackId - 回调ID
 */
export function unregisterProgressCallback(callbackId) {
  progressCallbacks.delete(callbackId);
}

/**
 * 触发进度更新
 * @param {string} taskId - 任务ID
 * @param {Object} progress - 进度信息
 */
export function emitProgress(taskId, progress) {
  for (const [, { taskId: tid, callback }] of progressCallbacks) {
    if (tid === taskId) {
      try {
        callback(progress);
      } catch (e) {
        console.warn('[ComputeService] Progress callback error:', e);
      }
    }
  }
}

/**
 * 创建带进度追踪的任务
 */
export function createProgressTask(taskId) {
  let currentPhase = 'init';
  let currentPercent = 0;
  
  return {
    taskId,
    
    update(phase, percent, message) {
      currentPhase = phase;
      currentPercent = percent;
      emitProgress(taskId, { phase, percent, message, timestamp: Date.now() });
    },
    
    getProgress() {
      return { phase: currentPhase, percent: currentPercent };
    },
    
    complete(result) {
      emitProgress(taskId, { 
        phase: 'complete', 
        percent: 100, 
        result,
        timestamp: Date.now() 
      });
    },
    
    error(err) {
      emitProgress(taskId, { 
        phase: 'error', 
        error: err,
        timestamp: Date.now() 
      });
    }
  };
}

// ========================================
// Phase 4.3: 批量处理支持
// ========================================

/**
 * 批量处理照片
 * @param {Array} photoIds - 照片ID列表
 * @param {Object} params - 处理参数
 * @param {Object} options - 选项
 */
export async function batchProcess(photoIds, params, options = {}) {
  const {
    format = 'jpeg',
    concurrency = 1,
    uploadToServer = true,
    onProgress,
    onItemComplete
  } = options;
  
  const results = [];
  const total = photoIds.length;
  let completed = 0;
  let failed = 0;
  
  // 进度更新
  const updateProgress = () => {
    if (onProgress) {
      onProgress({
        total,
        completed,
        failed,
        percent: Math.round(((completed + failed) / total) * 100),
        current: completed + failed
      });
    }
  };
  
  // 处理单个照片
  const processOne = async (photoId) => {
    try {
      const result = await processAndUpload(photoId, params, {
        format,
        uploadToServer,
        onProgress: (p) => {
          // 可以细化到单个任务的进度
        }
      });
      
      if (result.ok) {
        completed++;
      } else {
        failed++;
      }
      
      if (onItemComplete) {
        onItemComplete({ photoId, result });
      }
      
      updateProgress();
      return { photoId, ...result };
    } catch (e) {
      failed++;
      updateProgress();
      return { 
        photoId, 
        ok: false, 
        error: e.message,
        code: ComputeErrorCodes.PROCESSING_FAILED 
      };
    }
  };
  
  // 按并发数处理
  for (let i = 0; i < photoIds.length; i += concurrency) {
    const batch = photoIds.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processOne));
    results.push(...batchResults);
  }
  
  return {
    ok: failed === 0,
    total,
    completed,
    failed,
    results
  };
}

const ComputeService = {
  // 能力检测
  getServerCapabilities,
  isComputeAvailable,
  isHybridMode,
  getLocalGpuProcessor,
  clearCapabilityCache,
  
  // 智能处理
  smartFilmlabPreview,
  smartFilmlabPreviewLatest,
  smartRenderPositive,
  smartExportPositive,
  
  // 上传
  uploadProcessedResult,
  processAndUpload,
  
  // 进度系统
  registerProgressCallback,
  unregisterProgressCallback,
  emitProgress,
  createProgressTask,
  
  // 批量处理
  batchProcess,
  
  // 错误码
  ComputeErrorCodes
};

export default ComputeService;
