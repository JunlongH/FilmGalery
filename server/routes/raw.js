/**
 * RAW File Routes
 * 
 * RAW 文件处理 API 端点
 * 
 * @module server/routes/raw
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');
const rawDecoder = require('../services/raw-decoder');
const { SUPPORTED_EXTENSIONS } = require('../services/raw-decoder');
const { runAsync, getAsync, allAsync } = require('../utils/db-helpers');
const { uploadsDir, tmpUploadDir } = require('../config/paths');

// 配置 multer 用于 RAW 文件上传
const rawUploadDir = path.join(tmpUploadDir, 'raw');
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(rawUploadDir, { recursive: true });
    cb(null, rawUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `raw-${uniqueSuffix}${ext}`);
  }
});

const rawUpload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB - support pixel-shift RAW files
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (SUPPORTED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file format: ${ext}`));
    }
  }
});

/**
 * GET /api/raw/status
 * 
 * 获取 RAW 解码器状态
 */
router.get('/status', async (req, res, next) => {
  try {
    const isAvailable = await rawDecoder.isAvailable();
    const version = await rawDecoder.getVersion();
    
    res.json({
      success: true,
      available: isAvailable,
      ...version
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/raw/supported-formats
 * 
 * 获取支持的 RAW 格式列表
 */
router.get('/supported-formats', async (req, res, next) => {
  try {
    const formats = rawDecoder.getSupportedFormats();
    const isAvailable = await rawDecoder.isAvailable();
    
    res.json({
      success: true,
      available: isAvailable,
      formats
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/raw/decode
 * 
 * 解码 RAW 文件
 * 
 * Request Body (multipart/form-data):
 * - file: RAW 文件
 * - colorSpace: 'srgb' | 'adobe' | 'prophoto' (default: 'srgb')
 * - whiteBalance: 'camera' | 'auto' | 'daylight' (default: 'camera')
 * - quality: 0-3 (default: 3)
 * - outputBits: 8 | 16 (default: 16)
 * - halfSize: boolean (default: false)
 */
router.post('/decode', rawUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const isAvailable = await rawDecoder.isAvailable();
    if (!isAvailable) {
      // 清理上传的文件
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(503).json({ 
        success: false, 
        error: 'RAW decoder is not available. Please install dcraw.' 
      });
    }

    const options = {
      colorSpace: req.body.colorSpace || 'srgb',
      whiteBalance: req.body.whiteBalance || 'camera',
      quality: parseInt(req.body.quality) || 3,
      outputBits: parseInt(req.body.outputBits) || 16,
      halfSize: req.body.halfSize === 'true' || req.body.halfSize === true
    };

    const result = await rawDecoder.decode(req.file.path, options);

    // 清理原始 RAW 文件
    await fs.unlink(req.file.path).catch(() => {});

    res.json({
      success: true,
      result: {
        tempPath: result.outputPath,
        // 返回可访问的 URL
        previewUrl: `/uploads/tmp/${path.basename(result.outputPath)}`,
        metadata: result.metadata,
        processingTimeMs: result.processingInfo.processingTimeMs
      }
    });
  } catch (error) {
    // 清理文件
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    console.error('RAW decode error:', error);
    next(error);
  }
});

/**
 * POST /api/raw/preview
 * 
 * 快速预览 RAW 文件 (低质量，用于 UI 预览)
 */
router.post('/preview', rawUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const isAvailable = await rawDecoder.isAvailable();
    if (!isAvailable) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(503).json({ 
        success: false, 
        error: 'RAW decoder is not available' 
      });
    }

    const result = await rawDecoder.decodePreview(req.file.path);

    // 清理原始文件
    await fs.unlink(req.file.path).catch(() => {});

    res.json({
      success: true,
      result: {
        tempPath: result.outputPath,
        previewUrl: `/uploads/tmp/${path.basename(result.outputPath)}`,
        metadata: result.metadata,
        processingTimeMs: result.processingInfo.processingTimeMs
      }
    });
  } catch (error) {
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    next(error);
  }
});

/**
 * POST /api/raw/metadata
 * 
 * 提取 RAW 文件元数据 (不解码)
 */
router.post('/metadata', rawUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const isAvailable = await rawDecoder.isAvailable();
    if (!isAvailable) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(503).json({ 
        success: false, 
        error: 'RAW decoder is not available' 
      });
    }

    const metadata = await rawDecoder.extractMetadata(req.file.path);

    // 清理文件
    await fs.unlink(req.file.path).catch(() => {});

    res.json({
      success: true,
      metadata,
      originalName: req.file.originalname
    });
  } catch (error) {
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    next(error);
  }
});

/**
 * POST /api/raw/import
 * 
 * 导入 RAW 文件到相册
 * 
 * Request Body (multipart/form-data):
 * - file: RAW 文件
 * - rollId: 目标 Roll ID
 * - colorSpace: 色彩空间
 * - whiteBalance: 白平衡
 * - quality: 解码质量
 * - saveOriginalRaw: 是否保存原始 RAW 文件
 */
router.post('/import', rawUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const rollId = parseInt(req.body.rollId);
    if (!rollId) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ success: false, error: 'rollId is required' });
    }

    const isAvailable = await rawDecoder.isAvailable();
    if (!isAvailable) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(503).json({ 
        success: false, 
        error: 'RAW decoder is not available' 
      });
    }

    // 验证 roll 存在
    const roll = await getAsync('SELECT * FROM rolls WHERE id = ?', [rollId]);
    if (!roll) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ success: false, error: 'Roll not found' });
    }

    // 解码选项
    const options = {
      colorSpace: req.body.colorSpace || 'srgb',
      whiteBalance: req.body.whiteBalance || 'camera',
      quality: parseInt(req.body.quality) || 3,
      outputBits: 16,
      halfSize: false
    };

    // 解码 RAW
    const result = await rawDecoder.decode(req.file.path, options);

    // 生成最终文件名
    const originalName = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const timestamp = Date.now();
    const finalFileName = `${originalName}_${timestamp}.tiff`;
    const finalPath = path.join(uploadsDir, 'rolls', `roll_${rollId}`, finalFileName);

    // 确保目录存在
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    // 移动解码后的文件
    await fs.rename(result.outputPath, finalPath);

    // 可选：保存原始 RAW 文件
    let rawPath = null;
    if (req.body.saveOriginalRaw === 'true' || req.body.saveOriginalRaw === true) {
      const rawFileName = `${originalName}_${timestamp}_raw${path.extname(req.file.originalname)}`;
      rawPath = path.join(uploadsDir, 'raw', rawFileName);
      await fs.mkdir(path.dirname(rawPath), { recursive: true });
      await fs.copyFile(req.file.path, rawPath);
    }

    // 清理临时 RAW 文件
    await fs.unlink(req.file.path).catch(() => {});

    // 获取当前最大 sequence
    const maxSeq = await getAsync(
      'SELECT MAX(sequence_in_roll) as max FROM photos WHERE roll_id = ?',
      [rollId]
    );
    const nextSeq = (maxSeq?.max || 0) + 1;

    // 插入数据库
    const insertResult = await runAsync(
      `INSERT INTO photos (roll_id, filename, path, sequence_in_roll, created_at, raw_path, raw_metadata)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
      [
        rollId,
        finalFileName,
        finalPath,
        nextSeq,
        rawPath,
        JSON.stringify(result.metadata)
      ]
    );

    res.json({
      success: true,
      photoId: insertResult.lastID,
      filename: finalFileName,
      path: finalPath,
      rawPath,
      metadata: result.metadata,
      processingTimeMs: result.processingInfo.processingTimeMs
    });
  } catch (error) {
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    console.error('RAW import error:', error);
    next(error);
  }
});

/**
 * POST /api/raw/cleanup
 * 
 * 清理临时 RAW 文件
 */
router.post('/cleanup', async (req, res, next) => {
  try {
    const olderThanMs = parseInt(req.body.olderThanMs) || 3600000;
    await rawDecoder.cleanup(olderThanMs);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
