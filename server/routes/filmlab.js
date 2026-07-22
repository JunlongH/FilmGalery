const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
sharp.cache(false);
const { uploadsDir } = require('../config/paths');
const { buildPipeline } = require('../services/filmlab-service');
const { generatePositiveThumb, cleanupOldThumb } = require('../services/thumb-service');

// 使用统一渲染核心和源路径解析器
const {
  RenderCore,
  EXPORT_MAX_WIDTH,
  PREVIEW_MAX_WIDTH_SERVER,
  getEffectiveInverted
} = require('../../packages/shared');

const { 
  getStrictSourcePath, 
  SOURCE_TYPE 
} = require('../../packages/shared/sourcePathResolver');

// POST /api/filmlab/preview
// Body: { photoId, params, maxWidth, sourceType }
router.post('/preview', async (req, res, next) => {
  const { photoId, params, maxWidth, sourceType } = req.body || {};
  if (!photoId) return res.status(400).json({ error: 'photoId required' });
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT id, roll_id, original_rel_path, positive_rel_path, full_rel_path, negative_rel_path FROM photos WHERE id = ?', [photoId], (err, r) => err ? reject(err) : resolve(r));
    });
    if (!row) return res.status(404).json({ error: 'photo not found' });
    
    // 【重要】使用严格源路径选择，不允许跨类型回退
    const sourceResult = getStrictSourcePath(row, sourceType || 'original', {
      allowFallbackWithinType: true,
      allowCrossTypeFallback: false  // 绝不允许正片模式回退到负片
    });
    
    if (!sourceResult.path) {
      // 如果正片模式但无正片文件，返回明确错误
      return res.status(400).json({ 
        error: 'source_type_unavailable',
        message: sourceResult.warning || `No ${sourceType} file available for this photo`,
        sourceType,
        photoId
      });
    }
    
    const relSource = sourceResult.path;
    
    // 记录警告（如有）
    if (sourceResult.warning) {
      console.log(`[FilmLab Preview] Photo ${photoId}: ${sourceResult.warning}`);
    }
    
    const abs = path.join(uploadsDir, relSource);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'source missing on disk' });

    // Build pipeline: rotate/resize/crop only. All color ops applied via shared module for client/server parity.
    let img = await buildPipeline(abs, params || {}, { 
      maxWidth: maxWidth || PREVIEW_MAX_WIDTH_SERVER, 
      cropRect: (params && params.cropRect) || null, 
      toneAndCurvesInJs: true,
      skipColorOps: true // Skip all color ops in Sharp, do everything in JS for consistency
    });

    // Pull raw buffer — sharp 保留源数据原始位深
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const channels = info.channels; // expect 3
    const out = Buffer.allocUnsafe(width * height * 3);

    // 检测 16-bit 源
    const expectedBytes8 = width * height * channels;
    const is16bit = (data.length >= expectedBytes8 * 2);

    // 使用统一渲染核心
    // 使用 getEffectiveInverted 计算有效反转状态，正片模式不需要反转
    const effectiveInverted = getEffectiveInverted(sourceType, params?.inverted);
    const core = new RenderCore({ ...params, inverted: effectiveInverted });
    core.prepareLUTs();

    // 使用 processPixelFloat 全浮点处理（预览也用浮点以确保一致性）
    if (is16bit) {
      const pixels = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2);
      for (let i = 0, j = 0; i < pixels.length; i += channels, j += 3) {
        const [rF, gF, bF] = core.processPixelFloat(
          pixels[i] / 65535, pixels[i + 1] / 65535, pixels[i + 2] / 65535
        );
        out[j]     = Math.min(255, Math.max(0, Math.round(rF * 255)));
        out[j + 1] = Math.min(255, Math.max(0, Math.round(gF * 255)));
        out[j + 2] = Math.min(255, Math.max(0, Math.round(bF * 255)));
      }
    } else {
      for (let i = 0, j = 0; i < data.length; i += channels, j += 3) {
        const [rF, gF, bF] = core.processPixelFloat(
          data[i] / 255, data[i + 1] / 255, data[i + 2] / 255
        );
        out[j]     = Math.min(255, Math.max(0, Math.round(rF * 255)));
        out[j + 1] = Math.min(255, Math.max(0, Math.round(gF * 255)));
        out[j + 2] = Math.min(255, Math.max(0, Math.round(bF * 255)));
      }
    }

    // Encode to JPEG and send
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    const buf = await sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
    console.log('[Server Preview] JPEG buffer size:', buf.length, 'bytes');
    res.end(buf);
  } catch (e) {
    console.error('[FILMLAB] preview error', e);
    next(e);
  }
});

// POST /api/filmlab/render
// Body: { photoId, params, sourceType }
router.post('/render', async (req, res, next) => {
  const { photoId, params, sourceType } = req.body || {};
  if (!photoId) return res.status(400).json({ error: 'photoId required' });
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT id, roll_id, frame_number, original_rel_path, positive_rel_path, full_rel_path, negative_rel_path, positive_thumb_rel_path, filename FROM photos WHERE id = ?', [photoId], (err, r) => err ? reject(err) : resolve(r));
    });
    if (!row) return res.status(404).json({ error: 'photo not found' });
    
    // 使用严格源路径选择
    const sourceResult = getStrictSourcePath(row, sourceType || 'original', {
      allowFallbackWithinType: true,
      allowCrossTypeFallback: false
    });
    
    if (!sourceResult.path) {
      return res.status(400).json({ 
        error: 'source_type_unavailable',
        message: sourceResult.warning || `No ${sourceType} file available for this photo`,
        sourceType,
        photoId
      });
    }
    
    const relSource = sourceResult.path;
    if (sourceResult.warning) {
      console.log(`[FilmLab Render] Photo ${photoId}: ${sourceResult.warning}`);
    }
    
    const abs = path.join(uploadsDir, relSource);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'source missing on disk' });

    // Full resolution pipeline: geometry only; color ops via shared module
    let img = await buildPipeline(abs, params || {}, { 
      maxWidth: null, // No width limit for High Quality Render
      cropRect: (params && params.cropRect) || null, 
      toneAndCurvesInJs: true,
      skipColorOps: true
    });

    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const channels = info.channels;
    const out = Buffer.allocUnsafe(width * height * 3);

    // 检测 16-bit 源
    const expectedBytes8Render = width * height * channels;
    const is16bitRender = (data.length >= expectedBytes8Render * 2);
    if (is16bitRender) {
      console.log(`[FilmLab Render] High bit-depth source detected, using float pipeline`);
    }

    // 使用统一渲染核心（全浮点管线，充分利用源数据色深）
    const core = new RenderCore(params || {});
    core.prepareLUTs();

    if (is16bitRender) {
      const pixels = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2);
      for (let i = 0, j = 0; i < pixels.length; i += channels, j += 3) {
        const [rF, gF, bF] = core.processPixelFloat(
          pixels[i] / 65535, pixels[i + 1] / 65535, pixels[i + 2] / 65535
        );
        out[j]     = Math.min(255, Math.max(0, Math.round(rF * 255)));
        out[j + 1] = Math.min(255, Math.max(0, Math.round(gF * 255)));
        out[j + 2] = Math.min(255, Math.max(0, Math.round(bF * 255)));
      }
    } else {
      for (let i = 0, j = 0; i < data.length; i += channels, j += 3) {
        const [rF, gF, bF] = core.processPixelFloat(
          data[i] / 255, data[i + 1] / 255, data[i + 2] / 255
        );
        out[j]     = Math.min(255, Math.max(0, Math.round(rF * 255)));
        out[j + 1] = Math.min(255, Math.max(0, Math.round(gF * 255)));
        out[j + 2] = Math.min(255, Math.max(0, Math.round(bF * 255)));
      }
    }

    // Save to positive file
    // Unified naming: {rollId}_{frameNum}.jpg — matches all other endpoints
    // (ingest-positive, update-positive, export-positive, filmlab/export).
    const rollDir = path.dirname(path.join(uploadsDir, relSource));
    const rollIdRender = row.roll_id;
    const frameNumRender = row.frame_number || '00';
    const newName = `${rollIdRender}_${frameNumRender}.jpg`;
    
    let outDir = rollDir;
    if (relSource.includes('/negative')) {
        outDir = rollDir.replace(/negative$/, 'full').replace(/negative[\\/]$/, 'full');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    }
    
    const outPath = path.join(outDir, newName);
    
    await sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toFile(outPath);
    
    const relOut = path.relative(uploadsDir, outPath).replace(/\\/g, '/');
    
    // Generate positive thumbnail using shared thumb service
    let relThumb = null;
    try {
      const thumbResult = await generatePositiveThumb(outPath, row.roll_id, row.frame_number);
      relThumb = thumbResult.relPath;
      // Cleanup previous positive thumb if it was at a different path
      cleanupOldThumb(row.positive_thumb_rel_path, relThumb);
    } catch (thumbErr) {
      console.error('[FILMLAB] render thumb generation failed:', thumbErr.message);
    }

    // Update DB: positive_rel_path, full_rel_path, positive_thumb_rel_path.
    // Do NOT update filename — it should remain the original upload name.
    await new Promise((resolve, reject) => {
        const sql = relThumb
          ? 'UPDATE photos SET positive_rel_path = ?, full_rel_path = ?, positive_thumb_rel_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
          : 'UPDATE photos SET positive_rel_path = ?, full_rel_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        const params = relThumb
          ? [relOut, relOut, relThumb, photoId]
          : [relOut, relOut, photoId];
        db.run(sql, params, (err) => err ? reject(err) : resolve());
    });

    res.json({ ok: true, path: relOut });
  } catch (e) {
    console.error('[FILMLAB] render error', e);
    next(e);
  }
});

// POST /api/filmlab/export
// Body: { photoId, params, sourceType }
router.post('/export', async (req, res, next) => {
  const { photoId, params, sourceType } = req.body || {};
  if (!photoId) return res.status(400).json({ error: 'photoId required' });
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT id, roll_id, frame_number, filename, original_rel_path, positive_rel_path, full_rel_path, negative_rel_path, positive_thumb_rel_path FROM photos WHERE id = ?', [photoId], (err, r) => err ? reject(err) : resolve(r));
    });
    if (!row) return res.status(404).json({ error: 'photo not found' });
    
    // 使用严格源路径选择
    const sourceResult = getStrictSourcePath(row, sourceType || 'original', {
      allowFallbackWithinType: true,
      allowCrossTypeFallback: false
    });
    
    if (!sourceResult.path) {
      return res.status(400).json({ 
        error: 'source_type_unavailable',
        message: sourceResult.warning || `No ${sourceType} file available for this photo`,
        sourceType,
        photoId
      });
    }
    
    const relSource = sourceResult.path;
    if (sourceResult.warning) {
      console.log(`[FilmLab Export] Photo ${photoId}: ${sourceResult.warning}`);
    }
    
    const abs = path.join(uploadsDir, relSource);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'source missing on disk' });

    // Full resolution pipeline: geometry only; color ops via shared module
    let img = await buildPipeline(abs, params || {}, { 
      maxWidth: null, // No width limit for High Quality Export
      cropRect: (params && params.cropRect) || null, 
      toneAndCurvesInJs: true,
      skipColorOps: true
    });

    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const channels = info.channels;
    const out = Buffer.allocUnsafe(width * height * 3);

    // 检测 16-bit 源
    const expectedBytes8Export = width * height * channels;
    const is16bitExport = (data.length >= expectedBytes8Export * 2);
    if (is16bitExport) {
      console.log(`[FilmLab Export] High bit-depth source detected, using float pipeline`);
    }

    // 使用统一渲染核心（全浮点管线，充分利用源数据色深）
    const core = new RenderCore(params || {});
    core.prepareLUTs();

    if (is16bitExport) {
      const pixels = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2);
      for (let i = 0, j = 0; i < pixels.length; i += channels, j += 3) {
        const [rF, gF, bF] = core.processPixelFloat(
          pixels[i] / 65535, pixels[i + 1] / 65535, pixels[i + 2] / 65535
        );
        out[j]     = Math.min(255, Math.max(0, Math.round(rF * 255)));
        out[j + 1] = Math.min(255, Math.max(0, Math.round(gF * 255)));
        out[j + 2] = Math.min(255, Math.max(0, Math.round(bF * 255)));
      }
    } else {
      for (let i = 0, j = 0; i < data.length; i += channels, j += 3) {
        const [rF, gF, bF] = core.processPixelFloat(
          data[i] / 255, data[i + 1] / 255, data[i + 2] / 255
        );
        out[j]     = Math.min(255, Math.max(0, Math.round(rF * 255)));
        out[j + 1] = Math.min(255, Math.max(0, Math.round(gF * 255)));
        out[j + 2] = Math.min(255, Math.max(0, Math.round(bF * 255)));
      }
    }

    // Persist export to disk and update DB paths consistently
    // Determine output directory (prefer full/ under the same roll)
    const baseDir = path.dirname(path.join(uploadsDir, relSource));
    let outDir = baseDir;
    if (relSource.includes('/negative')) {
      outDir = baseDir.replace(/negative$/, 'full').replace(/negative[\\/]$/, 'full');
    } else if (!relSource.includes('/full')) {
      // If source is originals or other, use full directory sibling
      outDir = baseDir.replace(/originals$/, 'full').replace(/originals[\\/]$/, 'full');
    }
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Unified naming: {rollId}_{frameNum}.jpg — matches ingest-positive,
    // update-positive, and export-positive endpoints. Previously this used
    // {base}_pos{ext} which caused the "xxx-pos" vs original name inconsistency.
    const rollId = row.roll_id;
    const frameNum = row.frame_number || '00';
    const outName = `${rollId}_${frameNum}.jpg`;
    const outPath = path.join(outDir, outName);

    await sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toFile(outPath);
    const relOut = path.relative(uploadsDir, outPath).replace(/\\/g, '/');

    // Generate/update positive thumbnail using shared thumb service
    let relThumb = null;
    try {
      const thumbResult = await generatePositiveThumb(outPath, row.roll_id, row.frame_number);
      relThumb = thumbResult.relPath;
      cleanupOldThumb(row.positive_thumb_rel_path, relThumb);
    } catch (thumbErr) {
      console.error('[FILMLAB] export thumb generation failed:', thumbErr.message);
    }

    // Update DB: positive_rel_path, full_rel_path, positive_thumb_rel_path.
    // Do NOT update filename — it should remain the original upload name.
    // (Matches ingest-positive and export-positive behavior.)
    try {
      const sql = relThumb
        ? 'UPDATE photos SET positive_rel_path = ?, full_rel_path = ?, positive_thumb_rel_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        : 'UPDATE photos SET positive_rel_path = ?, full_rel_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
      const params = relThumb
        ? [relOut, relOut, relThumb, photoId]
        : [relOut, relOut, photoId];
      await new Promise((resolve, reject) => {
        db.run(sql, params, (err) => (err ? reject(err) : resolve()));
      });
    } catch (e) {
      // Fallback: update paths without thumbnail
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE photos SET filename = ?, positive_rel_path = ?, full_rel_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [outName, relOut, relOut, photoId],
          (err) => (err ? reject(err) : resolve())
        );
      });
    }

    res.json({ ok: true, path: relOut });
  } catch (e) {
    console.error('[FILMLAB] export error', e);
    next(e);
  }
});

module.exports = router;
