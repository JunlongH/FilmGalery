/**
 * 下载服务 - 统一的文件下载逻辑
 * 
 * @module download-service
 * @description 供单张下载和批量下载共用的下载服务，与 ImageViewer 共享
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db');
const { uploadsDir } = require('../config/paths');
const { buildExifData, writeExif, writeExifWithExiftool } = require('./exif-service');

// ============================================================================
// 常量定义
// ============================================================================

/**
 * 下载类型
 */
const DOWNLOAD_TYPE = {
  POSITIVE: 'positive',
  NEGATIVE: 'negative',
  ORIGINAL: 'original'
};

/**
 * 命名规则模板
 */
const NAMING_PATTERNS = {
  FILENAME: '{filename}',
  FRAME_FILENAME: '{frame}_{filename}',
  DATE_FRAME: '{date}_{frame}',
  ROLL_FRAME: '{roll}_{frame}',
  CUSTOM: 'custom'
};

// ============================================================================
// 照片查询
// ============================================================================

/**
 * Fetch a photo with all metadata needed for EXIF/export (LEFT JOIN rolls — roll fields are NULL for digital photos).
 * @param {number} photoId - 照片 ID
 * @returns {Promise<Object|null>}
 */
async function getPhotoForExport(photoId) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT p.*, r.title as roll_title, r.film_type, r.camera as roll_camera, r.lens as roll_lens,
             r.photographer as roll_photographer, r.start_date as roll_start_date,
             r.develop_lab, r.develop_process, r.develop_date, r.develop_note,
             -- Film info
             COALESCE(f.name, r.film_type) AS film_name,
             f.brand AS film_brand, f.iso AS film_iso, f.format AS film_format,
             f.category AS film_category, f.process AS film_process,
             -- Photo equipment
             pcam.name AS photo_camera_name, pcam.brand AS photo_camera_brand, pcam.model AS photo_camera_model,
             pcam.has_fixed_lens, pcam.fixed_lens_focal_length, pcam.fixed_lens_max_aperture,
             plens.name AS photo_lens_name, plens.brand AS photo_lens_brand, plens.model AS photo_lens_model,
             plens.focal_length_min AS photo_lens_focal_min, plens.focal_length_max AS photo_lens_focal_max,
             plens.max_aperture AS photo_lens_max_aperture,
             -- Roll equipment (fallback)
             rcam.name AS roll_camera_name, rcam.brand AS roll_camera_brand, rcam.model AS roll_camera_model,
             rcam.has_fixed_lens AS roll_has_fixed_lens, rcam.fixed_lens_focal_length AS roll_fixed_lens_focal,
             rcam.fixed_lens_max_aperture AS roll_fixed_lens_aperture,
             rlens.name AS roll_lens_name, rlens.brand AS roll_lens_brand, rlens.model AS roll_lens_model,
             rlens.focal_length_min AS roll_lens_focal_min, rlens.focal_length_max AS roll_lens_focal_max,
             rlens.max_aperture AS roll_lens_max_aperture,
             -- Scanner info
             pscan.name AS scanner_name, pscan.brand AS scanner_brand, pscan.model AS scanner_model,
             pscan.type AS scanner_type
      FROM photos p
       LEFT JOIN rolls r ON r.id = p.roll_id
      LEFT JOIN films f ON f.id = r.filmId
      LEFT JOIN equip_cameras pcam ON p.camera_equip_id = pcam.id
      LEFT JOIN equip_lenses plens ON p.lens_equip_id = plens.id
      LEFT JOIN equip_cameras rcam ON r.camera_equip_id = rcam.id
      LEFT JOIN equip_lenses rlens ON r.lens_equip_id = rlens.id
      LEFT JOIN equip_scanners pscan ON p.scanner_equip_id = pscan.id
      WHERE p.id = ?
    `;
    db.get(sql, [photoId], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

/**
 * 批量获取照片记录 (包含设备、胶片、扫描仪信息)
 * @param {number[]} photoIds - 照片 ID 列表
 * @returns {Promise<Object[]>}
 */
async function getPhotosWithRoll(photoIds) {
  if (!photoIds || photoIds.length === 0) return [];
  
  return new Promise((resolve, reject) => {
    const placeholders = photoIds.map(() => '?').join(',');
    const sql = `
      SELECT p.*, r.title as roll_title, r.film_type, r.camera as roll_camera, r.lens as roll_lens,
             r.photographer as roll_photographer, r.start_date as roll_start_date,
             r.develop_lab, r.develop_process, r.develop_date, r.develop_note,
             -- Film info
             COALESCE(f.name, r.film_type) AS film_name,
             f.brand AS film_brand, f.iso AS film_iso, f.format AS film_format,
             f.category AS film_category, f.process AS film_process,
             -- Photo equipment
             pcam.name AS photo_camera_name, pcam.brand AS photo_camera_brand, pcam.model AS photo_camera_model,
             pcam.has_fixed_lens, pcam.fixed_lens_focal_length, pcam.fixed_lens_max_aperture,
             plens.name AS photo_lens_name, plens.brand AS photo_lens_brand, plens.model AS photo_lens_model,
             plens.focal_length_min AS photo_lens_focal_min, plens.focal_length_max AS photo_lens_focal_max,
             plens.max_aperture AS photo_lens_max_aperture,
             -- Roll equipment (fallback)
             rcam.name AS roll_camera_name, rcam.brand AS roll_camera_brand, rcam.model AS roll_camera_model,
             rcam.has_fixed_lens AS roll_has_fixed_lens, rcam.fixed_lens_focal_length AS roll_fixed_lens_focal,
             rcam.fixed_lens_max_aperture AS roll_fixed_lens_aperture,
             rlens.name AS roll_lens_name, rlens.brand AS roll_lens_brand, rlens.model AS roll_lens_model,
             rlens.focal_length_min AS roll_lens_focal_min, rlens.focal_length_max AS roll_lens_focal_max,
             rlens.max_aperture AS roll_lens_max_aperture,
             -- Scanner info
             pscan.name AS scanner_name, pscan.brand AS scanner_brand, pscan.model AS scanner_model,
             pscan.type AS scanner_type
      FROM photos p
       LEFT JOIN rolls r ON r.id = p.roll_id
      LEFT JOIN films f ON f.id = r.filmId
      LEFT JOIN equip_cameras pcam ON p.camera_equip_id = pcam.id
      LEFT JOIN equip_lenses plens ON p.lens_equip_id = plens.id
      LEFT JOIN equip_cameras rcam ON r.camera_equip_id = rcam.id
      LEFT JOIN equip_lenses rlens ON r.lens_equip_id = rlens.id
      LEFT JOIN equip_scanners pscan ON p.scanner_equip_id = pscan.id
      WHERE p.id IN (${placeholders})
    `;
    db.all(sql, photoIds, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * 根据类型获取源文件路径
 * @param {Object} photo - 照片记录
 * @param {string} type - 下载类型
 * @returns {string|null}
 */
function getSourcePathByType(photo, type) {
  let relPath;
  
  switch (type) {
    case DOWNLOAD_TYPE.POSITIVE:
      relPath = photo.positive_rel_path || photo.full_rel_path;
      break;
    case DOWNLOAD_TYPE.NEGATIVE:
      relPath = photo.negative_rel_path || photo.original_rel_path;
      break;
    case DOWNLOAD_TYPE.ORIGINAL:
      relPath = photo.original_rel_path || photo.negative_rel_path || photo.positive_rel_path || photo.full_rel_path;
      break;
    default:
      relPath = null;
  }
  
  if (!relPath) return null;
  
  const abs = path.join(uploadsDir, relPath);
  return fs.existsSync(abs) ? abs : null;
}

// ============================================================================
// 命名规则
// ============================================================================

/**
 * 根据模式生成文件名
 * @param {Object} photo - 照片记录
 * @param {string} pattern - 命名模式
 * @param {string} originalExt - 原始扩展名
 * @returns {string}
 */
function generateFilename(photo, pattern, originalExt) {
  const base = path.basename(photo.filename || 'image', path.extname(photo.filename || '.jpg'));
  const frame = String(photo.frame_number || photo.id).padStart(2, '0');
  const date = photo.date_taken ? photo.date_taken.replace(/-/g, '') : 'unknown';
  const roll = photo.roll_title ? photo.roll_title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 30) : 'roll';
  
  let name;
  switch (pattern) {
    case NAMING_PATTERNS.FILENAME:
      name = base;
      break;
    case NAMING_PATTERNS.FRAME_FILENAME:
      name = `${frame}_${base}`;
      break;
    case NAMING_PATTERNS.DATE_FRAME:
      name = `${date}_${frame}`;
      break;
    case NAMING_PATTERNS.ROLL_FRAME:
      name = `${roll}_${frame}`;
      break;
    default:
      name = base;
  }
  
  return `${name}${originalExt}`;
}

// ============================================================================
// 核心功能
// ============================================================================

/**
 * 准备单张下载文件（可选写入 EXIF）
 * @param {Object} options
 * @param {number} options.photoId - 照片 ID
 * @param {string} [options.type='positive'] - 下载类型
 * @param {boolean} [options.writeExif=false] - 是否写入 EXIF
 * @param {Object} [options.exifOptions] - EXIF 选项
 * @returns {Promise<{filePath: string, filename: string, mimeType: string}>}
 */
async function prepareDownload(options) {
  const {
    photoId,
    type = DOWNLOAD_TYPE.POSITIVE,
    writeExif: shouldWriteExif = false,
    exifOptions = {}
  } = options;

  // 获取照片记录
  const photo = await getPhotoForExport(photoId);
  if (!photo) {
    throw new Error(`Photo not found: ${photoId}`);
  }

  // 获取源文件
  const sourcePath = getSourcePathByType(photo, type);
  if (!sourcePath) {
    throw new Error(`${type} file not found for photo: ${photoId}`);
  }

  const ext = path.extname(sourcePath);
  const mimeType = ext.toLowerCase() === '.tiff' || ext.toLowerCase() === '.tif' 
    ? 'image/tiff' 
    : 'image/jpeg';

  // 如果不需要写 EXIF，直接返回源文件
  if (!shouldWriteExif) {
    return {
      filePath: sourcePath,
      filename: path.basename(sourcePath),
      mimeType
    };
  }

  // 需要写 EXIF：复制到临时目录
  const tempDir = path.join(os.tmpdir(), 'filmgallery-download');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilename = `${photoId}_${Date.now()}${ext}`;
  const tempPath = path.join(tempDir, tempFilename);

  // 复制文件
  fs.copyFileSync(sourcePath, tempPath);

  // 构建并写入 EXIF (photo 现在包含完整的 JOIN 数据)
  const exifData = buildExifData(photo, null, exifOptions);
  
  // 获取关键词 (tags)
  const tags = await new Promise((resolve, reject) => {
    db.all('SELECT t.name FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.photo_id = ?', 
      [photoId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows ? rows.map(r => r.name) : []);
      });
  }).catch(() => []);
  
  try {
    // 只对 JPEG 文件写入完整的 EXIF/XMP
    if (['.jpg', '.jpeg'].includes(ext.toLowerCase())) {
      await writeExifWithExiftool(tempPath, exifData, {
        keywords: tags,
        rollTitle: photo.roll_title
      });
    } else {
      // 对非 JPEG 文件使用基本 EXIF 写入
      await writeExif(tempPath, exifData);
    }
  } catch (e) {
    console.error('[DownloadService] Failed to write EXIF:', e.message);
    // 即使 EXIF 写入失败，也返回文件
  }

  return {
    filePath: tempPath,
    filename: path.basename(sourcePath),
    mimeType,
    isTemp: true
  };
}

/**
 * 批量下载到指定目录
 * @param {number[]} photoIds - 照片 ID 列表
 * @param {string} type - 下载类型
 * @param {string} outputDir - 输出目录
 * @param {Object} [options] - 下载选项
 * @returns {Promise<{success: number, failed: number, skipped: number, files: string[], errors: Object[]}>}
 */
async function batchDownload(photoIds, type, outputDir, options = {}) {
  const {
    writeExif: shouldWriteExif = false,
    exifOptions = {},
    namingPattern = NAMING_PATTERNS.FILENAME,
    onProgress = null // 进度回调: (current, total, photo) => void
  } = options;

  // 确保输出目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 获取所有照片记录
  const photos = await getPhotosWithRoll(photoIds);
  const photoMap = new Map(photos.map(p => [p.id, p]));

  const result = {
    success: 0,
    failed: 0,
    skipped: 0,
    files: [],
    errors: []
  };

  let current = 0;
  const total = photoIds.length;

  for (const photoId of photoIds) {
    current++;
    const photo = photoMap.get(photoId);

    if (!photo) {
      result.failed++;
      result.errors.push({ photoId, error: 'Photo not found' });
      continue;
    }

    // 获取源文件
    const sourcePath = getSourcePathByType(photo, type);
    if (!sourcePath) {
      result.skipped++;
      result.errors.push({ photoId, error: `${type} file not available` });
      continue;
    }

    try {
      // 生成输出文件名
      const ext = path.extname(sourcePath);
      const outputFilename = generateFilename(photo, namingPattern, ext);
      const outputPath = path.join(outputDir, outputFilename);

      // 复制文件
      fs.copyFileSync(sourcePath, outputPath);

      // 写入 EXIF (photo 现在包含完整的 JOIN 数据)
      if (shouldWriteExif && (ext.toLowerCase() === '.jpg' || ext.toLowerCase() === '.jpeg')) {
        const exifData = buildExifData(photo, null, exifOptions);
        
        // 获取关键词 (tags)
        const tags = await new Promise((resolve, reject) => {
          db.all('SELECT t.name FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.photo_id = ?', 
            [photoId], (err, rows) => {
              if (err) reject(err);
              else resolve(rows ? rows.map(r => r.name) : []);
            });
        }).catch(() => []);
        
        try {
          await writeExifWithExiftool(outputPath, exifData, {
            keywords: tags,
            rollTitle: photo.roll_title
          });
        } catch (e) {
          console.error(`[DownloadService] Failed to write EXIF for photo ${photoId}:`, e.message);
          // 继续处理，不中断
        }
      }

      result.success++;
      result.files.push(outputPath);

      // 进度回调
      if (onProgress) {
        onProgress(current, total, photo);
      }
    } catch (e) {
      result.failed++;
      result.errors.push({ photoId, error: e.message });
    }
  }

  return result;
}

/**
 * 清理临时下载文件
 * @param {string} filePath - 临时文件路径
 */
function cleanupTempFile(filePath) {
  if (filePath && filePath.includes('filmgallery-download')) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      console.error('[DownloadService] Failed to cleanup temp file:', e.message);
    }
  }
}

/**
 * 获取某类型在照片中的可用数量
 * @param {number[]} photoIds - 照片 ID 列表
 * @param {string} type - 下载类型
 * @returns {Promise<{available: number, total: number}>}
 */
async function getAvailableCount(photoIds, type) {
  const photos = await getPhotosWithRoll(photoIds);
  let available = 0;
  
  for (const photo of photos) {
    const sourcePath = getSourcePathByType(photo, type);
    if (sourcePath) available++;
  }
  
  return {
    available,
    total: photoIds.length
  };
}

// ============================================================================
// 模块导出
// ============================================================================

module.exports = {
  // 常量
  DOWNLOAD_TYPE,
  NAMING_PATTERNS,
  
  // 核心功能
  prepareDownload,
  batchDownload,
  cleanupTempFile,
  getAvailableCount,
  
  // 辅助函数
  getPhotoForExport,
  getPhotosWithRoll,
  getSourcePathByType,
  generateFilename,
};
