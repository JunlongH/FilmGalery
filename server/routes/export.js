/**
 * FilmLab 导出 API 路由
 * 
 * @module routes/export
 * @description 批量导出任务管理 API
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;

const { exportQueue, JOB_STATUS } = require('../services/export-queue');
const { validateExportParams } = require('../../packages/shared/filmLabExport');

// ============================================================================
// 中间件
// ============================================================================

/**
 * 初始化导出队列数据库连接
 */
router.use((req, res, next) => {
  if (req.app.locals.db && !exportQueue.db) {
    exportQueue.setDatabase(req.app.locals.db);
  }
  next();
});

// ============================================================================
// API 端点
// ============================================================================

/**
 * POST /api/export/batch
 * 创建批量导出任务
 * 
 * @body {number} [rollId] - 卷 ID (与 photoIds 二选一)
 * @body {number[]} [photoIds] - 照片 ID 列表
 * @body {string} [format='JPEG'] - 输出格式: JPEG | TIFF | PNG
 * @body {number} [quality=95] - JPEG 质量 (85-100)
 * @body {number} [maxWidth=4000] - 最大宽度
 * @body {string} outputDir - 输出目录
 * @body {string} [presetId] - 应用的预设 ID
 * @body {Object} [processingParams] - 覆盖处理参数
 */
router.post('/batch', async (req, res, next) => {
  try {
    const {
      rollId,
      photoIds,
      format = 'JPEG',
      quality = 95,
      maxWidth = 4000,
      outputDir,
      presetId,
      processingParams,
    } = req.body;

    // 验证必需参数
    if (!outputDir) {
      return res.status(400).json({
        success: false,
        error: 'outputDir is required',
      });
    }

    if (!rollId && (!photoIds || photoIds.length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'Either rollId or photoIds is required',
      });
    }

    // 验证格式
    if (!['JPEG', 'TIFF', 'PNG'].includes(format)) {
      return res.status(400).json({
        success: false,
        error: 'format must be JPEG, TIFF, or PNG',
      });
    }

    // 验证质量
    if (quality < 1 || quality > 100) {
      return res.status(400).json({
        success: false,
        error: 'quality must be between 1 and 100',
      });
    }

    // 验证处理参数
    if (processingParams) {
      const validation = validateExportParams(processingParams);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid processing parameters',
          details: validation.errors,
        });
      }
    }

    // 检查输出目录是否可写
    try {
      await fs.mkdir(outputDir, { recursive: true });
      await fs.access(outputDir, fs.constants.W_OK);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: `Cannot write to output directory: ${outputDir}`,
      });
    }

    // 如果提供了预设 ID，获取预设
    let presetParams = null;
    if (presetId && req.app.locals.db) {
      const preset = await req.app.locals.db.get(
        'SELECT params FROM presets WHERE id = ?',
        [presetId]
      );
      if (preset) {
        presetParams = JSON.parse(preset.params);
      }
    }

    // 合并预设和覆盖参数
    const finalParams = processingParams 
      ? { ...presetParams, ...processingParams }
      : presetParams;

    // 创建任务
    const job = await exportQueue.addJob({
      rollId,
      photoIds,
      format,
      quality,
      maxWidth,
      outputDir,
      presetId,
      processingParams: finalParams,
    });

    res.json({
      success: true,
      jobId: job.id,
      totalPhotos: job.photoIds.length,
      status: job.status,
    });
  } catch (err) {
    console.error('[Export API] Failed to create batch job:', err);
    next(err);
  }
});

/**
 * GET /api/export/jobs
 * 获取所有导出任务
 * 
 * @query {string} [status] - 过滤状态
 */
router.get('/jobs', (req, res, next) => {
  try {
    let jobs = exportQueue.getAllJobs();
    
    // 状态过滤
    if (req.query.status) {
      jobs = jobs.filter(j => j.status === req.query.status);
    }
    
    res.json({
      success: true,
      jobs: jobs.map(j => j.toJSON()),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/export/jobs/:jobId
 * 获取单个任务详情
 */
router.get('/jobs/:jobId', (req, res, next) => {
  try {
    const job = exportQueue.getJob(req.params.jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }
    
    res.json({
      success: true,
      job: job.toJSON(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/export/jobs/:jobId
 * 取消或删除任务
 */
router.delete('/jobs/:jobId', (req, res, next) => {
  try {
    const job = exportQueue.getJob(req.params.jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }
    
    if (job.status === JOB_STATUS.QUEUED || job.status === JOB_STATUS.PROCESSING) {
      // 取消进行中的任务
      const cancelled = exportQueue.cancelJob(req.params.jobId);
      res.json({
        success: cancelled,
        action: 'cancelled',
      });
    } else {
      // 删除已完成的任务
      const removed = exportQueue.removeJob(req.params.jobId);
      res.json({
        success: removed,
        action: 'removed',
      });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/export/jobs/:jobId/pause
 * 暂停任务
 */
router.post('/jobs/:jobId/pause', (req, res, next) => {
  try {
    const job = exportQueue.getJob(req.params.jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }
    
    if (job.status !== JOB_STATUS.PROCESSING) {
      return res.status(400).json({
        success: false,
        error: 'Can only pause processing jobs',
      });
    }
    
    exportQueue.pauseJob(req.params.jobId);
    res.json({
      success: true,
      status: 'paused',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/export/jobs/:jobId/resume
 * 恢复任务
 */
router.post('/jobs/:jobId/resume', (req, res, next) => {
  try {
    const job = exportQueue.getJob(req.params.jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }
    
    if (job.status !== JOB_STATUS.PAUSED) {
      return res.status(400).json({
        success: false,
        error: 'Can only resume paused jobs',
      });
    }
    
    exportQueue.resumeJob(req.params.jobId);
    res.json({
      success: true,
      status: 'processing',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/export/jobs
 * 清理所有已完成的任务
 */
router.delete('/jobs', (req, res, next) => {
  try {
    exportQueue.cleanupCompletedJobs();
    res.json({
      success: true,
      message: 'Completed jobs cleaned up',
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// WebSocket 进度推送设置
// ============================================================================

/**
 * 设置 WebSocket 服务器进行进度推送
 * 
 * @param {WebSocket.Server} wss - WebSocket 服务器实例
 */
function setupWebSocket(wss) {
  // 存储 jobId -> WebSocket 连接映射
  const jobSubscriptions = new Map();

  wss.on('connection', (ws, req) => {
    // 解析 URL 获取 jobId
    const match = req.url.match(/\/ws\/export\/([^/]+)/);
    if (!match) {
      ws.close(4000, 'Invalid WebSocket URL');
      return;
    }

    const jobId = match[1];
    
    // 验证任务存在
    const job = exportQueue.getJob(jobId);
    if (!job) {
      ws.close(4004, 'Job not found');
      return;
    }

    // 添加订阅
    if (!jobSubscriptions.has(jobId)) {
      jobSubscriptions.set(jobId, new Set());
    }
    jobSubscriptions.get(jobId).add(ws);

    // 发送当前状态
    ws.send(JSON.stringify({
      type: 'status',
      job: job.toJSON(),
    }));

    // 清理
    ws.on('close', () => {
      const subs = jobSubscriptions.get(jobId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) {
          jobSubscriptions.delete(jobId);
        }
      }
    });
  });

  // 监听队列事件并推送
  const broadcast = (jobId, message) => {
    const subs = jobSubscriptions.get(jobId);
    if (subs) {
      const data = JSON.stringify(message);
      for (const ws of subs) {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(data);
        }
      }
    }
  };

  exportQueue.on('jobProgress', (data) => {
    broadcast(data.jobId, { type: 'progress', ...data });
  });

  exportQueue.on('jobCompleted', (job) => {
    broadcast(job.id, { type: 'completed', job: job.toJSON() });
  });

  exportQueue.on('jobFailed', ({ job, error }) => {
    broadcast(job.id, { type: 'failed', job: job.toJSON(), error: error.message });
  });

  exportQueue.on('jobCancelled', (job) => {
    broadcast(job.id, { type: 'cancelled', job: job.toJSON() });
  });

  exportQueue.on('jobPaused', (job) => {
    broadcast(job.id, { type: 'paused', job: job.toJSON() });
  });

  exportQueue.on('jobResumed', (job) => {
    broadcast(job.id, { type: 'resumed', job: job.toJSON() });
  });
}

// ============================================================================
// 导出
// ============================================================================

module.exports = router;
module.exports.setupWebSocket = setupWebSocket;
module.exports.exportQueue = exportQueue;
