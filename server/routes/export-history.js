/**
 * 导出历史 API 路由
 * 
 * @module routes/export-history
 */

const express = require('express');
const router = express.Router();
const exportHistory = require('../services/export-history-service');

/**
 * GET /api/export-history
 * 获取导出历史列表
 */
router.get('/', (req, res, next) => {
  try {
    const { limit, offset, rollId, jobType } = req.query;
    
    const history = exportHistory.getHistory({
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      rollId: rollId ? parseInt(rollId) : undefined,
      jobType
    });
    
    res.json({ history });
  } catch (e) {
    console.error('[ExportHistory] Get history error:', e);
    next(e);
  }
});

/**
 * GET /api/export-history/stats
 * 获取导出统计
 */
router.get('/stats', (req, res, next) => {
  try {
    const stats = exportHistory.getStats();
    res.json({ stats });
  } catch (e) {
    console.error('[ExportHistory] Get stats error:', e);
    next(e);
  }
});

/**
 * DELETE /api/export-history/cleanup
 * 清理旧历史
 */
router.delete('/cleanup', (req, res, next) => {
  try {
    const { keepCount } = req.query;
    const result = exportHistory.cleanupOldHistory(keepCount ? parseInt(keepCount) : 100);
    res.json(result);
  } catch (e) {
    console.error('[ExportHistory] Cleanup error:', e);
    next(e);
  }
});

module.exports = router;
