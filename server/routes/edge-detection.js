/**
 * Edge Detection Routes
 * 
 * 边缘检测 API 端点
 * 
 * @module server/routes/edge-detection
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { getAsync, allAsync, runAsync } = require('../utils/db-helpers');
const edgeDetectionService = require('../services/edge-detection-service');
const { uploadsDir } = require('../config/paths');
const { getStrictSourcePath, SOURCE_TYPE } = require('../../packages/shared/sourcePathResolver');

/**
 * POST /api/photos/:id/detect-edges
 * 
 * 检测单张照片的边缘
 * 
 * Request Body:
 * {
 *   sensitivity: number (0-100),
 *   filmFormat: 'auto' | '35mm' | '120' | '4x5',
 *   sourceType: 'original' | 'negative' | 'positive'
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   result: {
 *     cropRect: { x, y, w, h },
 *     rotation: number,
 *     confidence: number,
 *     isValid: boolean,
 *     debugInfo: { ... }
 *   }
 * }
 */
router.post('/photos/:id/detect-edges', async (req, res, next) => {
  try {
    const photoId = parseInt(req.params.id);
    const { 
      sensitivity = 50, 
      filmFormat = 'auto',
      sourceType = 'original'
    } = req.body;

    // 获取照片信息
    const photo = await getAsync('SELECT * FROM photos WHERE id = ?', [photoId]);
    
    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }

    // 获取源文件路径
    const sourceResult = getStrictSourcePath(photo, sourceType, {
      allowFallbackWithinType: true,
      allowCrossTypeFallback: false
    });
    
    let imagePath;
    if (sourceResult.path) {
      imagePath = path.join(uploadsDir, sourceResult.path);
    } else {
      // 回退到原始文件
      imagePath = path.join(uploadsDir, photo.filename || photo.original_rel_path || photo.full_rel_path);
    }

    // 执行边缘检测
    const result = await edgeDetectionService.detectEdges(imagePath, {
      sensitivity,
      filmFormat
    });

    res.json(result);
  } catch (error) {
    console.error('Edge detection error:', error);
    next(error);
  }
});

/**
 * POST /api/photos/batch-detect-edges
 * 
 * 批量检测边缘
 * 
 * Request Body:
 * {
 *   photoIds: number[],
 *   sensitivity: number (0-100),
 *   filmFormat: 'auto' | '35mm' | '120' | '4x5',
 *   sourceType: 'original' | 'negative' | 'positive'
 * }
 */
router.post('/photos/batch-detect-edges', async (req, res, next) => {
  try {
    const { 
      photoIds, 
      sensitivity = 50, 
      filmFormat = 'auto',
      sourceType = 'original'
    } = req.body;

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ success: false, error: 'photoIds is required' });
    }

    // 限制批量处理数量
    const maxBatch = 50;
    const limitedIds = photoIds.slice(0, maxBatch);

    // 获取照片信息
    const placeholders = limitedIds.map(() => '?').join(',');
    const photos = await allAsync(
      `SELECT * FROM photos WHERE id IN (${placeholders})`, 
      limitedIds
    );

    // 构建图像列表
    const images = photos.map(photo => {
      const sourceResult = getStrictSourcePath(photo, sourceType, {
        allowFallbackWithinType: true,
        allowCrossTypeFallback: false
      });
      
      let imagePath;
      if (sourceResult.path) {
        imagePath = path.join(uploadsDir, sourceResult.path);
      } else {
        imagePath = path.join(uploadsDir, photo.filename || photo.original_rel_path || photo.full_rel_path);
      }
      return { id: photo.id, path: imagePath };
    });

    // 批量检测
    const results = await edgeDetectionService.detectEdgesBatch(images, {
      sensitivity,
      filmFormat
    });

    res.json({
      success: true,
      results,
      processed: results.length,
      total: photoIds.length,
      truncated: photoIds.length > maxBatch
    });
  } catch (error) {
    console.error('Batch edge detection error:', error);
    next(error);
  }
});

/**
 * POST /api/photos/:id/apply-edge-detection
 * 
 * 应用边缘检测结果到照片参数
 * 
 * Request Body:
 * {
 *   cropRect: { x, y, w, h },
 *   rotation: number,
 *   preserveManualCrop: boolean  // 如果为 true 且已有手动裁剪，则不覆盖
 * }
 */
router.post('/photos/:id/apply-edge-detection', async (req, res, next) => {
  try {
    const photoId = parseInt(req.params.id);
    const { cropRect, rotation = 0, preserveManualCrop = true } = req.body;

    if (!cropRect) {
      return res.status(400).json({ success: false, error: 'cropRect is required' });
    }

    // 获取现有照片参数
    const photo = await getAsync('SELECT * FROM photos WHERE id = ?', [photoId]);
    
    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }

    // 解析现有 filmlab_params
    let existingParams = {};
    if (photo.filmlab_params) {
      try {
        existingParams = JSON.parse(photo.filmlab_params);
      } catch (e) {
        // 忽略解析错误
      }
    }

    // 检查是否有手动裁剪
    const hasManualCrop = existingParams.cropRect && 
      (existingParams.cropRect.x !== 0 || 
       existingParams.cropRect.y !== 0 || 
       existingParams.cropRect.w !== 1 || 
       existingParams.cropRect.h !== 1);

    if (preserveManualCrop && hasManualCrop) {
      return res.json({
        success: false,
        error: 'Photo has existing manual crop',
        code: 'HAS_MANUAL_CROP',
        existingCrop: existingParams.cropRect
      });
    }

    // 更新参数
    const newParams = {
      ...existingParams,
      cropRect,
      rotation: existingParams.rotation !== undefined 
        ? existingParams.rotation + rotation 
        : rotation,
      autoEdgeDetected: true,
      autoEdgeDetectedAt: new Date().toISOString()
    };

    // 保存到数据库
    await runAsync(
      'UPDATE photos SET filmlab_params = ? WHERE id = ?',
      [JSON.stringify(newParams), photoId]
    );

    res.json({
      success: true,
      params: newParams
    });
  } catch (error) {
    console.error('Apply edge detection error:', error);
    next(error);
  }
});

/**
 * POST /api/rolls/:id/apply-edge-detection-to-all
 * 
 * 将边缘检测结果应用到整卷胶卷的所有照片
 * 
 * Request Body:
 * {
 *   sensitivity: number,
 *   filmFormat: 'auto' | '35mm' | '120' | '4x5',
 *   sourceType: 'original' | 'negative' | 'positive',
 *   skipExistingCrop: boolean  // 跳过已有手动裁剪的照片
 * }
 */
router.post('/rolls/:id/apply-edge-detection-to-all', async (req, res, next) => {
  try {
    const rollId = parseInt(req.params.id);
    const { 
      sensitivity = 50, 
      filmFormat = 'auto',
      sourceType = 'original',
      skipExistingCrop = true
    } = req.body;

    // 获取卷中的所有照片
    const photos = await allAsync(
      'SELECT * FROM photos WHERE roll_id = ? ORDER BY sequence_in_roll',
      [rollId]
    );

    if (photos.length === 0) {
      return res.json({ success: true, processed: 0, message: 'No photos in roll' });
    }

    const results = {
      processed: 0,
      skipped: 0,
      failed: 0,
      details: []
    };

    for (const photo of photos) {
      try {
        // 检查现有裁剪
        let existingParams = {};
        if (photo.filmlab_params) {
          try {
            existingParams = JSON.parse(photo.filmlab_params);
          } catch (e) {}
        }

        const hasManualCrop = existingParams.cropRect && 
          (existingParams.cropRect.x !== 0 || 
           existingParams.cropRect.y !== 0 || 
           existingParams.cropRect.w !== 1 || 
           existingParams.cropRect.h !== 1);

        if (skipExistingCrop && hasManualCrop) {
          results.skipped++;
          results.details.push({ id: photo.id, status: 'skipped', reason: 'has_manual_crop' });
          continue;
        }

        // 获取源文件路径
        const sourceResult = getStrictSourcePath(photo, sourceType, {
          allowFallbackWithinType: true,
          allowCrossTypeFallback: false
        });
        
        let imagePath;
        if (sourceResult.path) {
          imagePath = path.join(uploadsDir, sourceResult.path);
        } else {
          imagePath = path.join(uploadsDir, photo.filename || photo.original_rel_path || photo.full_rel_path);
        }

        // 执行边缘检测
        const detectResult = await edgeDetectionService.detectEdges(imagePath, {
          sensitivity,
          filmFormat
        });

        if (!detectResult.success || !detectResult.result.isValid) {
          results.failed++;
          results.details.push({ 
            id: photo.id, 
            status: 'failed', 
            reason: detectResult.error || 'low_confidence' 
          });
          continue;
        }

        // 更新参数
        const newParams = {
          ...existingParams,
          cropRect: detectResult.result.cropRect,
          rotation: (existingParams.rotation || 0) + detectResult.result.rotation,
          autoEdgeDetected: true,
          autoEdgeDetectedAt: new Date().toISOString()
        };

        await runAsync(
          'UPDATE photos SET filmlab_params = ? WHERE id = ?',
          [JSON.stringify(newParams), photo.id]
        );

        results.processed++;
        results.details.push({ 
          id: photo.id, 
          status: 'success', 
          confidence: detectResult.result.confidence 
        });
      } catch (error) {
        results.failed++;
        results.details.push({ id: photo.id, status: 'error', reason: error.message });
      }
    }

    res.json({
      success: true,
      rollId,
      totalPhotos: photos.length,
      ...results
    });
  } catch (error) {
    console.error('Apply edge detection to roll error:', error);
    next(error);
  }
});

module.exports = router;
