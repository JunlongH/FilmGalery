/**
 * 外部正片导入 API 路由
 * 
 * @module routes/import
 * @description 导入外部软件处理的正片并与底片匹配
 */

const express = require('express');
const router = express.Router();
const { isPathAllowed } = require('../utils/path-security');
const {
  MATCH_STRATEGY,
  MATCH_STATUS,
  CONFLICT_RESOLUTION,
  previewImport,
  executeImport,
  updateManualMatch,
  getPhotosForRoll
} = require('../services/import-service');

// Deny any source path outside the allow-list (defense-in-depth against
// arbitrary file read via /api/import).
function filterAllowedPaths(filePaths) {
  if (!Array.isArray(filePaths)) return [];
  return filePaths.filter(p => typeof p === 'string' && isPathAllowed(p));
}

// ============================================================================
// 任务管理
// ============================================================================

// 活跃任务存储（内存中）
const activeImportJobs = new Map();

/**
 * 创建任务 ID
 */
function createJobId() {
  return `import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// API 端点
// ============================================================================

/**
 * POST /api/import/preview
 * 预览导入匹配结果
 */
router.post('/preview', async (req, res) => {
  try {
    const { rollId, filePaths, strategy = 'filename' } = req.body;
    
    if (!rollId) {
      return res.status(400).json({ error: 'rollId is required' });
    }
    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return res.status(400).json({ error: 'filePaths is required and must be a non-empty array' });
    }

    // SECURITY: only allow paths within configured allow-lists
    const safePaths = filterAllowedPaths(filePaths);
    if (safePaths.length === 0) {
      return res.status(403).json({ error: 'No accessible paths in filePaths' });
    }

    const result = await previewImport(rollId, safePaths, strategy);
    res.json(result);
  } catch (e) {
    console.error('[Import] Preview error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/import/manual-match
 * 更新手动匹配
 */
router.post('/manual-match', async (req, res) => {
  try {
    const { rollId, matches, fileIndex, photoId } = req.body;
    
    if (!rollId || !matches || fileIndex === undefined) {
      return res.status(400).json({ error: 'rollId, matches, and fileIndex are required' });
    }
    
    const photos = await getPhotosForRoll(rollId);
    const updated = updateManualMatch(matches, fileIndex, photoId, photos);
    
    // 重新计算统计
    const stats = {
      total: updated.length,
      matched: updated.filter(m => m.status === MATCH_STATUS.MATCHED).length,
      conflict: updated.filter(m => m.status === MATCH_STATUS.CONFLICT).length,
      unmatched: updated.filter(m => 
        m.status === MATCH_STATUS.UNMATCHED || 
        m.status === MATCH_STATUS.NO_NEGATIVE
      ).length
    };
    
    res.json({
      success: true,
      matches: updated,
      stats,
      unmatchedPhotos: photos.filter(p => 
        !updated.some(m => m.photoId === p.id)
      ).map(p => ({
        id: p.id,
        frameNumber: p.frame_number,
        filename: p.filename,
        hasPositive: !!p.positive_rel_path
      }))
    });
  } catch (e) {
    console.error('[Import] Manual match error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/import/execute
 * 执行导入
 */
router.post('/execute', async (req, res) => {
  try {
    const { 
      rollId, 
      matches, 
      conflictResolution = 'overwrite' 
    } = req.body;
    
    if (!rollId) {
      return res.status(400).json({ error: 'rollId is required' });
    }
    if (!matches || !Array.isArray(matches)) {
      return res.status(400).json({ error: 'matches is required and must be an array' });
    }

    // SECURITY: reject any match whose source path is outside the allow-list
    const blockedMatch = matches.find(m => m && m.file && !isPathAllowed(m.file));
    if (blockedMatch) {
      return res.status(403).json({ error: 'A source path is not accessible' });
    }

    // 过滤可导入的匹配项
    const importable = matches.filter(m => {
      if (!m.photoId) return false;
      if (m.status === MATCH_STATUS.CONFLICT) {
        return conflictResolution === CONFLICT_RESOLUTION.OVERWRITE;
      }
      return m.status === MATCH_STATUS.MATCHED;
    });
    
    if (importable.length === 0) {
      return res.json({
        success: true,
        message: 'No files to import',
        imported: 0,
        skipped: matches.length,
        failed: 0
      });
    }
    
    // 创建异步任务
    const jobId = createJobId();
    const job = {
      id: jobId,
      rollId,
      status: 'processing',
      total: importable.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      current: null,
      results: [],
      errors: [],
      createdAt: new Date().toISOString()
    };
    
    activeImportJobs.set(jobId, job);
    
    // 异步执行
    executeImportJob(job, matches, { conflictResolution }).catch(e => {
      console.error('[Import] Job execution error:', e);
      const j = activeImportJobs.get(jobId);
      if (j) {
        j.status = 'failed';
        j.error = e.message;
      }
    });
    
    res.json({
      jobId,
      status: 'processing',
      total: importable.length
    });
  } catch (e) {
    console.error('[Import] Execute error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * 执行导入任务
 */
async function executeImportJob(job, matches, options) {
  try {
    const result = await executeImport(job.rollId, matches, {
      ...options,
      onProgress: (current, total, match) => {
        job.completed = current;
        job.current = {
          filename: match.filename,
          photoId: match.photoId
        };
      }
    });
    
    job.status = 'completed';
    job.completed = result.success;
    job.failed = result.failed;
    job.skipped = result.skipped;
    job.results = result.files;
    job.errors = result.errors;
    job.current = null;
  } catch (e) {
    job.status = 'failed';
    job.error = e.message;
  }
}

/**
 * GET /api/import/:jobId/progress
 * 查询任务进度
 */
router.get('/:jobId/progress', (req, res) => {
  const { jobId } = req.params;
  const job = activeImportJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json({
    jobId: job.id,
    status: job.status,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    skipped: job.skipped,
    current: job.current,
    results: job.status === 'completed' ? job.results : undefined,
    errors: job.errors.length > 0 ? job.errors : undefined,
    error: job.error
  });
});

/**
 * POST /api/import/:jobId/cancel
 * 取消任务（标记为取消，实际复制可能无法中断）
 */
router.post('/:jobId/cancel', (req, res) => {
  const { jobId } = req.params;
  const job = activeImportJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  if (job.status === 'processing') {
    job.status = 'cancelled';
  }
  
  res.json({ ok: true, status: job.status });
});

/**
 * DELETE /api/import/:jobId
 * 删除任务记录
 */
router.delete('/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  if (activeImportJobs.has(jobId)) {
    activeImportJobs.delete(jobId);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Job not found' });
  }
});

/**
 * GET /api/import/strategies
 * 获取可用的匹配策略
 */
router.get('/strategies', (req, res) => {
  res.json({
    strategies: [
      { 
        id: MATCH_STRATEGY.FILENAME, 
        name: '文件名匹配', 
        description: '根据文件名匹配（去除扩展名和常见后缀后比较）',
        recommended: true
      },
      { 
        id: MATCH_STRATEGY.FRAME, 
        name: '帧号顺序匹配', 
        description: '按文件排序顺序与帧号对应' 
      },
      { 
        id: MATCH_STRATEGY.MANUAL, 
        name: '手动匹配', 
        description: '手动指定每个文件对应的照片' 
      }
    ]
  });
});

module.exports = router;
