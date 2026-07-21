/**
 * Services Index - 服务模块统一导出
 * 
 * 混合模式架构的核心服务：
 * - ComputeService: 计算任务智能路由
 * - CpuRenderService: 本地 CPU 渲染（RenderCore）
 * - FileAccessService: 文件访问抽象
 */

export { default as ComputeService } from './ComputeService';
export { default as CpuRenderService } from './CpuRenderService';
export { default as FileAccessService } from './FileAccessService';

// ========================================
// ComputeService 导出
// ========================================

// 核心能力检测
export { 
  getServerCapabilities, 
  isComputeAvailable,
  isHybridMode,
  clearCapabilityCache 
} from './ComputeService';

// 智能处理路由
export {
  smartFilmlabPreview,
  smartRenderPositive,
  smartExportPositive
} from './ComputeService';

// Phase 3.4: 结果上传
export {
  uploadProcessedResult,
  processAndUpload
} from './ComputeService';

// Phase 4.2: 进度反馈
export {
  registerProgressCallback,
  unregisterProgressCallback,
  emitProgress,
  createProgressTask
} from './ComputeService';

// Phase 4.3: 错误处理
export {
  ComputeErrorCodes,
  createError
} from './ComputeService';

// 批量处理
export {
  batchProcess
} from './ComputeService';

// ========================================
// CpuRenderService 导出
// ========================================

// CPU 渲染核心函数
export {
  localCpuPreview,
  localCpuRender,
  localCpuExport,
  isCpuRenderAvailable
} from './CpuRenderService';

// CPU 渲染工具函数
export {
  loadImageToCanvas,
  applyGeometry,
  processCanvasWithRenderCore,
  processCanvasWithRenderCoreAsync,
  canvasToBlob
} from './CpuRenderService';

// ========================================
// FileAccessService 导出
// ========================================

// 核心文件访问
export {
  getFileUrl,
  hasLocalFileAccess,
  getFileAsArrayBuffer,
  getFileAsBlob,
  getFileAsDataUrl,
  getFileAsImage
} from './FileAccessService';

// 预取和缓存预热
export {
  prefetchFile,
  prefetchFiles,
  warmCache
} from './FileAccessService';

// Phase 4.1: 缓存管理
export {
  clearFileCache,
  invalidateCache,
  getCacheStatus,
  getCacheStats,
  setCacheConfig
} from './FileAccessService';

// 持久化
export {
  saveCacheIndex,
  loadCacheIndex
} from './FileAccessService';
