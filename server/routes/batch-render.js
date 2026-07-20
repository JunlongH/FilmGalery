/**
 * 批量渲染 API 路由
 * 
 * @module routes/batch-render
 * @description 批量 FilmLab 渲染 API
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../db');
const { renderToLibrary, renderToDirectory, getPresetParams, mergeParams } = require('../services/render-service');
const exportHistory = require('../services/export-history-service');
const { parseLUT } = require('../utils/lut-parser');

// LUT 文件存储目录
const LUT_DIR = path.join(__dirname, '..', 'data', 'luts');

// ============================================================================
// 任务管理
// ============================================================================

// 活跃任务存储 (内存中)
const activeJobs = new Map();

/**
 * 创建任务 ID
 */
function createJobId() {
  return `batch-render-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 获取照片列表
 */
async function getPhotosByScope(rollId, scope, photoIds = []) {
  return new Promise((resolve, reject) => {
    let sql, params;
    
    switch (scope) {
      case 'selected':
        if (!photoIds || photoIds.length === 0) {
          return resolve([]);
        }
        const placeholders = photoIds.map(() => '?').join(',');
        sql = `SELECT id, filename FROM photos WHERE id IN (${placeholders})`;
        params = photoIds;
        break;
        
      case 'all':
        sql = 'SELECT id, filename FROM photos WHERE roll_id = ?';
        params = [rollId];
        break;
        
      case 'no-positive':
        sql = 'SELECT id, filename FROM photos WHERE roll_id = ? AND (positive_rel_path IS NULL OR positive_rel_path = "")';
        params = [rollId];
        break;
        
      default:
        return resolve([]);
    }
    
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * 获取渲染参数
 */
async function resolveParams(paramsSource) {
  if (!paramsSource) return {};
  
  switch (paramsSource.type) {
    case 'preset':
      if (paramsSource.presetId) {
        const presetParams = await getPresetParams(paramsSource.presetId);
        return mergeParams(presetParams || {}, paramsSource.overrides || {});
      }
      return paramsSource.overrides || {};
      
    case 'lut':
      // LUT 文件处理：加载并解析 LUT 文件
      if (paramsSource.lutPath) {
        try {
          const lutFilePath = path.join(LUT_DIR, paramsSource.lutPath);
          const lutData = await parseLUT(lutFilePath);
          return {
            lut1: {
              ...lutData,
              name: paramsSource.lutPath,
              intensity: paramsSource.lutIntensity || 1.0
            },
            lut1Intensity: paramsSource.lutIntensity || 1.0,
            ...paramsSource.overrides
          };
        } catch (e) {
          console.error('Failed to parse LUT file:', e);
          throw new Error(`LUT 文件解析失败: ${e.message}`);
        }
      }
      return paramsSource.overrides || {};
      
    case 'custom':
      return paramsSource.params || {};
      
    default:
      return {};
  }
}

/**
 * 执行批量渲染任务
 */
async function executeBatchJob(job, mode, outputDir = null, outputOptions = {}) {
  const { id, photos, params } = job;
  const total = photos.length;
  
  for (let i = 0; i < total; i++) {
    // 检查是否已取消
    const currentJob = activeJobs.get(id);
    if (!currentJob || currentJob.status === 'cancelled') {
      return;
    }
    
    // 检查是否暂停
    while (currentJob.status === 'paused') {
      await new Promise(resolve => setTimeout(resolve, 500));
      const checkJob = activeJobs.get(id);
      if (!checkJob || checkJob.status === 'cancelled') return;
    }
    
    const photo = photos[i];
    
    // 更新当前处理状态
    currentJob.current = { photoId: photo.id, filename: photo.filename };
    currentJob.processing = i + 1;
    
    try {
      if (mode === 'library') {
        // 渲染并写入库
        const result = await renderToLibrary(photo.id, params);
        currentJob.results.push({ photoId: photo.id, success: true, ...result });
      } else {
        // 渲染并下载到目录
        const result = await renderToDirectory(photo.id, params, outputDir, null, outputOptions);
        currentJob.results.push({ photoId: photo.id, success: true, ...result });
      }
      currentJob.completed++;
    } catch (e) {
      console.error(`[BatchRender] Failed to render photo ${photo.id}:`, e.message);
      currentJob.failed++;
      currentJob.results.push({ photoId: photo.id, success: false, error: e.message });
      currentJob.failedItems.push({ photoId: photo.id, error: e.message });
    }
  }
  
  // 完成
  const finalJob = activeJobs.get(id);
  if (finalJob && finalJob.status !== 'cancelled') {
    finalJob.status = 'completed';
    finalJob.current = null;
    
    // 更新历史记录
    exportHistory.completeJob(id, finalJob.completed, finalJob.failed);
  }
}

// ============================================================================
// API 端点
// ============================================================================

/**
 * POST /api/batch-render/library
 * 创建批量渲染任务 (写入库)
 */
router.post('/library', async (req, res, next) => {
  try {
    const { rollId, scope, photoIds, paramsSource } = req.body;
    
    if (!rollId) {
      return res.status(400).json({ error: 'rollId is required' });
    }
    
    // 获取照片列表
    const photos = await getPhotosByScope(rollId, scope, photoIds);
    if (photos.length === 0) {
      return res.status(400).json({ error: 'No photos to process' });
    }
    
    // 解析参数
    const params = await resolveParams(paramsSource);
    
    // 创建任务
    const jobId = createJobId();
    const job = {
      id: jobId,
      type: 'library',
      rollId,
      photos,
      params,
      status: 'processing',
      total: photos.length,
      completed: 0,
      failed: 0,
      processing: 0,
      current: null,
      results: [],
      failedItems: [],
      createdAt: new Date().toISOString()
    };
    
    activeJobs.set(jobId, job);
    
    // 记录到历史
    exportHistory.recordJob({
      jobId,
      jobType: 'render',
      rollId,
      totalPhotos: photos.length,
      outputDir: null,
      params: { type: 'library', paramsSource }
    });
    
    // 异步执行任务
    executeBatchJob(job, 'library').catch(e => {
      console.error('[BatchRender] Job execution error:', e);
      const j = activeJobs.get(jobId);
      if (j) j.status = 'failed';
      exportHistory.failJob(jobId, e.message);
    });
    
    res.json({
      jobId,
      totalPhotos: photos.length,
      status: 'processing'
    });
  } catch (e) {
    console.error('[BatchRender] Create library job error:', e);
    next(e);
  }
});

/**
 * POST /api/batch-render/download
 * 创建批量渲染任务 (下载到目录)
 */
router.post('/download', async (req, res, next) => {
  try {
    const { rollId, scope, photoIds, paramsSource, outputDir, format, quality, maxWidth, namingPattern } = req.body;
    
    if (!rollId) {
      return res.status(400).json({ error: 'rollId is required' });
    }
    if (!outputDir) {
      return res.status(400).json({ error: 'outputDir is required' });
    }
    
    // 获取照片列表
    const photos = await getPhotosByScope(rollId, scope, photoIds);
    if (photos.length === 0) {
      return res.status(400).json({ error: 'No photos to process' });
    }
    
    // 解析参数
    const params = await resolveParams(paramsSource);
    
    // 创建任务
    const jobId = createJobId();
    const job = {
      id: jobId,
      type: 'download',
      rollId,
      photos,
      params,
      outputDir,
      outputOptions: { format: format || 'jpeg', quality: quality || 95, maxWidth },
      status: 'processing',
      total: photos.length,
      completed: 0,
      failed: 0,
      processing: 0,
      current: null,
      results: [],
      failedItems: [],
      createdAt: new Date().toISOString()
    };
    
    activeJobs.set(jobId, job);
    
    // 记录到历史
    exportHistory.recordJob({
      jobId,
      jobType: 'render',
      rollId,
      totalPhotos: photos.length,
      outputDir,
      params: { type: 'download', paramsSource, format, quality }
    });
    
    // 异步执行任务
    executeBatchJob(job, 'download', outputDir, job.outputOptions).catch(e => {
      console.error('[BatchRender] Job execution error:', e);
      const j = activeJobs.get(jobId);
      if (j) j.status = 'failed';
      exportHistory.failJob(jobId, e.message);
    });
    
    res.json({
      jobId,
      totalPhotos: photos.length,
      outputDir,
      status: 'processing'
    });
  } catch (e) {
    console.error('[BatchRender] Create download job error:', e);
    next(e);
  }
});

/**
 * GET /api/batch-render/:jobId/progress
 * 查询任务进度
 */
router.get('/:jobId/progress', (req, res, next) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json({
    jobId: job.id,
    status: job.status,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    processing: job.processing,
    current: job.current,
    failedItems: job.failedItems
  });
});

/**
 * POST /api/batch-render/:jobId/cancel
 * 取消任务
 */
router.post('/:jobId/cancel', (req, res, next) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  job.status = 'cancelled';
  res.json({ ok: true, status: 'cancelled' });
});

/**
 * POST /api/batch-render/:jobId/pause
 * 暂停任务
 */
router.post('/:jobId/pause', (req, res, next) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  if (job.status === 'processing') {
    job.status = 'paused';
  }
  
  res.json({ ok: true, status: job.status });
});

/**
 * POST /api/batch-render/:jobId/resume
 * 恢复任务
 */
router.post('/:jobId/resume', (req, res, next) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  if (job.status === 'paused') {
    job.status = 'processing';
  }
  
  res.json({ ok: true, status: job.status });
});

/**
 * GET /api/batch-render/jobs
 * 获取所有活跃任务
 */
router.get('/jobs', (req, res, next) => {
  const jobs = Array.from(activeJobs.values()).map(job => ({
    jobId: job.id,
    type: job.type,
    status: job.status,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    createdAt: job.createdAt
  }));
  
  res.json({ jobs });
});

/**
 * DELETE /api/batch-render/:jobId
 * 删除任务记录
 */
router.delete('/:jobId', (req, res, next) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  // 先取消正在执行的任务
  if (job.status === 'processing' || job.status === 'paused') {
    job.status = 'cancelled';
  }
  
  activeJobs.delete(jobId);
  res.json({ ok: true });
});

module.exports = router;
