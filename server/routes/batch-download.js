/**
 * 批量下载 API 路由
 * 
 * @module routes/batch-download
 * @description 批量下载已有文件 API (不渲染)
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const fs = require('fs');
const { 
  batchDownload, 
  prepareDownload, 
  cleanupTempFile, 
  getAvailableCount,
  DOWNLOAD_TYPE,
  NAMING_PATTERNS 
} = require('../services/download-service');
const { uploadsDir } = require('../config/paths');
const { isPathAllowed } = require('../utils/path-security');
const exportHistory = require('../services/export-history-service');

// ============================================================================
// 任务管理
// ============================================================================

// 活跃任务存储 (内存中)
const activeDownloadJobs = new Map();

/**
 * 创建任务 ID
 */
function createJobId() {
  return `batch-download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 获取照片 ID 列表
 */
async function getPhotoIdsByScope(rollId, scope, photoIds = []) {
  return new Promise((resolve, reject) => {
    if (scope === 'selected') {
      return resolve(photoIds || []);
    }
    
    const sql = 'SELECT id FROM photos WHERE roll_id = ?';
    db.all(sql, [rollId], (err, rows) => {
      if (err) reject(err);
      else resolve((rows || []).map(r => r.id));
    });
  });
}

// ============================================================================
// API 端点
// ============================================================================

/**
 * POST /api/batch-download
 * 创建批量下载任务
 */
router.post('/', async (req, res, next) => {
  try {
    const { 
      rollId, 
      scope, 
      photoIds, 
      type = 'positive',
      outputDir,
      exif = { enabled: false },
      namingPattern = NAMING_PATTERNS.FILENAME
    } = req.body;
    
    if (!rollId) {
      return res.status(400).json({ error: 'rollId is required' });
    }
    if (!outputDir) {
      return res.status(400).json({ error: 'outputDir is required' });
    }

    // SECURITY: outputDir must be inside a configured allow-list to prevent
    // arbitrary file writes anywhere on the host filesystem.
    if (!isPathAllowed(outputDir)) {
      return res.status(403).json({ error: 'outputDir is not in an allowed location' });
    }

    // 获取照片 ID 列表
    const ids = await getPhotoIdsByScope(rollId, scope, photoIds);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'No photos to download' });
    }
    
    // 检查可用数量
    const availability = await getAvailableCount(ids, type);
    
    // 创建任务
    const jobId = createJobId();
    const job = {
      id: jobId,
      type: 'download',
      downloadType: type,
      rollId,
      photoIds: ids,
      outputDir,
      exif,
      namingPattern,
      status: 'processing',
      total: ids.length,
      available: availability.available,
      completed: 0,
      failed: 0,
      skipped: 0,
      current: null,
      results: [],
      errors: [],
      createdAt: new Date().toISOString()
    };
    
    activeDownloadJobs.set(jobId, job);
    
    // 记录到历史
    exportHistory.recordJob({
      jobId,
      jobType: 'download',
      rollId,
      totalPhotos: ids.length,
      outputDir,
      params: { type, namingPattern, exif }
    });
    
    // 异步执行下载
    executeDownloadJob(job).catch(e => {
      console.error('[BatchDownload] Job execution error:', e);
      const j = activeDownloadJobs.get(jobId);
      if (j) j.status = 'failed';
      exportHistory.failJob(jobId, e.message);
    });
    
    res.json({
      jobId,
      totalPhotos: ids.length,
      availablePhotos: availability.available,
      skippedPhotos: ids.length - availability.available,
      outputDir,
      status: 'processing'
    });
  } catch (e) {
    console.error('[BatchDownload] Create job error:', e);
    next(e);
  }
});

/**
 * 执行批量下载任务
 */
async function executeDownloadJob(job) {
  const exifOptions = job.exif?.enabled ? {
    camera: job.exif.camera !== false,
    shooting: job.exif.shooting !== false,
    datetime: job.exif.datetime !== false,
    gps: job.exif.gps !== false,
    description: job.exif.description !== false
  } : {};
  
  const result = await batchDownload(
    job.photoIds,
    job.downloadType,
    job.outputDir,
    {
      writeExif: job.exif?.enabled || false,
      exifOptions,
      namingPattern: job.namingPattern,
      onProgress: (current, total, photo) => {
        job.current = { photoId: photo.id, filename: photo.filename };
        job.completed = current;
      }
    }
  );
  
  job.completed = result.success;
  job.failed = result.failed;
  job.skipped = result.skipped;
  job.results = result.files;
  job.errors = result.errors;
  job.status = 'completed';
  job.current = null;
  
  // 更新历史记录
  exportHistory.completeJob(job.id, result.success, result.failed);
}

/**
 * GET /api/batch-download/:jobId/progress
 * 查询任务进度
 */
router.get('/:jobId/progress', (req, res, next) => {
  const { jobId } = req.params;
  const job = activeDownloadJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json({
    jobId: job.id,
    status: job.status,
    total: job.total,
    available: job.available,
    completed: job.completed,
    failed: job.failed,
    skipped: job.skipped,
    current: job.current,
    errors: job.errors
  });
});

/**
 * POST /api/batch-download/:jobId/cancel
 * 取消任务
 */
router.post('/:jobId/cancel', (req, res, next) => {
  const { jobId } = req.params;
  const job = activeDownloadJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  job.status = 'cancelled';
  res.json({ ok: true, status: 'cancelled' });
});

/**
 * GET /api/batch-download/availability
 * 检查某类型文件的可用性
 */
router.get('/availability', async (req, res, next) => {
  try {
    const { rollId, scope, photoIds, type = 'positive' } = req.query;
    
    if (!rollId) {
      return res.status(400).json({ error: 'rollId is required' });
    }
    
    const ids = await getPhotoIdsByScope(
      parseInt(rollId), 
      scope || 'all', 
      photoIds ? JSON.parse(photoIds) : []
    );
    
    const result = await getAvailableCount(ids, type);
    
    res.json({
      type,
      total: result.total,
      available: result.available,
      missing: result.total - result.available
    });
  } catch (e) {
    console.error('[BatchDownload] Availability check error:', e);
    next(e);
  }
});

/**
 * DELETE /api/batch-download/:jobId
 * 删除任务记录
 */
router.delete('/:jobId', (req, res, next) => {
  const { jobId } = req.params;
  const job = activeDownloadJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  if (job.status === 'processing') {
    job.status = 'cancelled';
  }
  
  activeDownloadJobs.delete(jobId);
  res.json({ ok: true });
});

// ============================================================================
// 单张下载 (与 ImageViewer 共享)
// ============================================================================

/**
 * GET /api/photos/:id/download
 * 单张照片下载
 */
router.get('/single/:id', async (req, res, next) => {
  try {
    const photoId = parseInt(req.params.id);
    const { type = 'positive', exif = 'false' } = req.query;
    const shouldWriteExif = exif === 'true' || exif === '1';
    
    const result = await prepareDownload({
      photoId,
      type,
      writeExif: shouldWriteExif
    });
    
    // 设置下载响应头
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
    
    // 发送文件
    const stream = fs.createReadStream(result.filePath);
    stream.pipe(res);
    
    // 如果是临时文件，发送完成后清理
    stream.on('end', () => {
      if (result.isTemp) {
        cleanupTempFile(result.filePath);
      }
    });
    
    stream.on('error', (err) => {
      console.error('[BatchDownload] Stream error:', err);
      if (!res.headersSent) {
        next(err);
      }
      if (result.isTemp) {
        cleanupTempFile(result.filePath);
      }
    });
  } catch (e) {
    console.error('[BatchDownload] Single download error:', e);
    next(e);
  }
});

module.exports = router;
