/**
 * LUT 文件管理 API
 * 
 * @module routes/luts
 * @description 支持 LUT 文件的上传、列表、删除等操作
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');

// ============================================================================
// 配置
// ============================================================================

// LUT 文件存储目录
const LUT_DIR = path.join(__dirname, '..', 'data', 'luts');

// 确保目录存在
if (!fsSync.existsSync(LUT_DIR)) {
  fsSync.mkdirSync(LUT_DIR, { recursive: true });
}

// Multer 配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LUT_DIR),
  filename: (req, file, cb) => {
    // 保持原始文件名，但处理空格和特殊字符
    const safeName = file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/__+/g, '_');
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.cube', '.3dl', '.csp', '.lut'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}`), false);
    }
  }
});

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取 LUT 文件信息
 */
async function getLutInfo(filename) {
  const filepath = path.join(LUT_DIR, filename);
  const stats = await fs.stat(filepath);
  const ext = path.extname(filename).toLowerCase();
  
  let type = 'unknown';
  if (ext === '.cube') type = '3D CUBE';
  else if (ext === '.3dl') type = '3D LUT';
  else if (ext === '.csp') type = 'CSP';
  else if (ext === '.lut') type = 'Generic LUT';
  
  return {
    name: filename,
    path: filepath,
    size: stats.size,
    type,
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime
  };
}

// ============================================================================
// 路由
// ============================================================================

/**
 * GET /api/luts
 * 获取所有 LUT 文件列表
 */
router.get('/', async (req, res, next) => {
  try {
    const files = await fs.readdir(LUT_DIR);
    const luts = [];
    
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (['.cube', '.3dl', '.csp', '.lut'].includes(ext)) {
        try {
          const info = await getLutInfo(file);
          luts.push(info);
        } catch (e) {
          console.warn(`Failed to get info for ${file}:`, e.message);
        }
      }
    }
    
    // 按修改时间降序
    luts.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    
    res.json({ luts });
  } catch (e) {
    console.error('Failed to list LUTs:', e);
    next(e);
  }
});

/**
 * POST /api/luts/upload
 * 上传 LUT 文件
 */
router.post('/upload', (req, res, next) => {
  upload.single('lut')(req, res, (err) => {
    if (err) {
      console.error('LUT upload error:', err);
      // multer 错误返回 JSON 而非默认的 HTML
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '文件太大，最大支持 50MB' });
      }
      return res.status(400).json({ error: err.message || '上传失败' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    
    res.json({
      success: true,
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size
    });
  });
});

/**
 * DELETE /api/luts/:name
 * 删除 LUT 文件
 */
router.delete('/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    const filepath = path.join(LUT_DIR, name);
    
    // 安全检查 - 确保路径在 LUT_DIR 内
    const resolved = path.resolve(filepath);
    if (!resolved.startsWith(LUT_DIR)) {
      return res.status(400).json({ error: '无效的文件路径' });
    }
    
    await fs.unlink(filepath);
    res.json({ success: true });
  } catch (e) {
    console.error('Failed to delete LUT:', e);
    next(e);
  }
});

/**
 * GET /api/luts/:name
 * 获取 LUT 文件内容
 */
router.get('/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    const filepath = path.join(LUT_DIR, name);
    
    // 安全检查
    const resolved = path.resolve(filepath);
    if (!resolved.startsWith(LUT_DIR)) {
      return res.status(400).json({ error: '无效的文件路径' });
    }
    
    res.sendFile(filepath);
  } catch (e) {
    console.error('Failed to get LUT:', e);
    next(e);
  }
});

/**
 * GET /api/luts/:name/info
 * 获取 LUT 文件详细信息
 */
router.get('/:name/info', async (req, res, next) => {
  try {
    const { name } = req.params;
    const info = await getLutInfo(name);
    res.json(info);
  } catch (e) {
    console.error('Failed to get LUT info:', e);
    next(e);
  }
});

module.exports = router;
