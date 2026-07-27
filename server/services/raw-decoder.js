/**
 * RAW Decoder Service
 * 
 * 使用 @filmgallery/libraw-native (LibRaw 0.22) 解码 RAW 文件
 * 如果失败，回退到 lightdrift-libraw
 * 
 * @module services/raw-decoder
 */

const path = require('path');

// ============================================================================
// 模块加载 - 优先使用 @filmgallery/libraw-native
// ============================================================================

let LibRawNative = null;      // @filmgallery/libraw-native
let LibRawFallback = null;    // lightdrift-libraw (fallback)
let activeDecoder = null;     // 当前使用的解码器
let decoderInfo = {
  name: 'none',
  version: 'unavailable',
  librawVersion: 'unavailable',
  cameraCount: 0,
  source: 'none'
};

// 支持的 RAW 格式扩展名
const SUPPORTED_EXTENSIONS = [
  '.dng', '.cr2', '.cr3', '.nef', '.arw', 
  '.raf', '.orf', '.rw2', '.pef', '.srw',
  '.x3f', '.erf', '.mef', '.mos', '.mrw',
  '.kdc', '.3fr', '.fff', '.iiq', '.dcr', '.k25', '.qtk'
];

// 尝试加载 @filmgallery/libraw-native (优先)
try {
  LibRawNative = require('@filmgallery/libraw-native');
  if (LibRawNative.isAvailable()) {
    activeDecoder = 'native';
    const versionInfo = LibRawNative.getVersion();
    decoderInfo = {
      name: '@filmgallery/libraw-native',
      version: '1.0.0',
      librawVersion: versionInfo.version,
      cameraCount: LibRawNative.getCameraCount(),
      source: 'native'
    };
    console.log(`[RawDecoder] ✓ @filmgallery/libraw-native loaded (LibRaw ${versionInfo.version}, ${decoderInfo.cameraCount} cameras)`);
  } else {
    console.warn('[RawDecoder] @filmgallery/libraw-native loaded but not available:', LibRawNative.getLoadError()?.message);
    LibRawNative = null;
  }
} catch (e) {
  console.warn('[RawDecoder] @filmgallery/libraw-native not available:', e.message);
  LibRawNative = null;
}

// 尝试加载 lightdrift-libraw (fallback)
if (!LibRawNative) {
  try {
    LibRawFallback = require('lightdrift-libraw');
    activeDecoder = 'fallback';
    const version = LibRawFallback.getVersion ? LibRawFallback.getVersion() : 'unknown';
    decoderInfo = {
      name: 'lightdrift-libraw',
      version: '1.0.0-beta.1',
      librawVersion: version,
      cameraCount: 'unknown',
      source: 'fallback'
    };
    console.log(`[RawDecoder] ✓ lightdrift-libraw loaded as fallback (version: ${version})`);
  } catch (e) {
    console.error('[RawDecoder] ✗ No RAW decoder available:', e.message);
    console.error('[RawDecoder] RAW file decoding will be unavailable.');
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 创建处理器实例
 * @returns {Object} 处理器实例
 */
function createProcessor() {
  if (LibRawNative) {
    return new LibRawNative.LibRawProcessor();
  } else if (LibRawFallback) {
    return new LibRawFallback();
  }
  return null;
}

/**
 * 判断是否使用原生模块
 */
function isNativeDecoder() {
  return activeDecoder === 'native';
}

/**
 * Synchronous availability check (no Promise).
 * Same semantics as isAvailable() — true iff a decoder loaded at module init.
 */
function isAvailableSync() {
  return activeDecoder !== null;
}

// ============================================================================
// RawDecoder 类
// ============================================================================

class RawDecoder {
  constructor() {
    this.supportedExtensions = SUPPORTED_EXTENSIONS;
  }

  /**
   * 判断是否为支持的 RAW 文件
   */
  isRawFile(filename) {
    if (!filename) return false;
    const ext = path.extname(filename).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  /**
   * 检查解码器是否可用
   */
  async isAvailable() {
    return activeDecoder !== null;
  }

  /**
   * 获取解码器版本信息
   */
  async getVersion() {
    return {
      decoder: decoderInfo.name,
      version: decoderInfo.version,
      librawVersion: decoderInfo.librawVersion,
      cameraCount: decoderInfo.cameraCount,
      source: decoderInfo.source,
      available: activeDecoder !== null
    };
  }

  /**
   * 检查特定相机是否支持
   * @param {string} model - 相机型号
   */
  isCameraSupported(model) {
    if (LibRawNative) {
      return LibRawNative.isSupportedCamera(model);
    }
    // lightdrift-libraw 没有这个功能
    return null;
  }

  /**
   * 获取支持的格式列表
   */
  getSupportedFormats() {
    return {
      extensions: SUPPORTED_EXTENSIONS,
      formats: [
        { ext: '.dng', name: 'Adobe Digital Negative' },
        { ext: '.cr2', name: 'Canon RAW 2' },
        { ext: '.cr3', name: 'Canon RAW 3' },
        { ext: '.nef', name: 'Nikon Electronic Format' },
        { ext: '.arw', name: 'Sony Alpha RAW' },
        { ext: '.raf', name: 'Fujifilm RAW' },
        { ext: '.orf', name: 'Olympus RAW Format' },
        { ext: '.rw2', name: 'Panasonic RAW' },
        { ext: '.pef', name: 'Pentax Electronic Format' },
        { ext: '.srw', name: 'Samsung RAW' },
        { ext: '.x3f', name: 'Sigma RAW' },
        { ext: '.erf', name: 'Epson RAW Format' },
        { ext: '.mef', name: 'Mamiya Electronic Format' },
        { ext: '.mos', name: 'Leaf RAW' },
        { ext: '.mrw', name: 'Minolta RAW' },
        { ext: '.kdc', name: 'Kodak Digital Camera' },
        { ext: '.3fr', name: 'Hasselblad 3F RAW' },
        { ext: '.fff', name: 'Hasselblad/Imacon FlexFrame' },
        { ext: '.iiq', name: 'Phase One Intelligent Image Quality' },
        { ext: '.dcr', name: 'Kodak RAW' },
        { ext: '.k25', name: 'Kodak DC25' },
        { ext: '.qtk', name: 'Apple QuickTake' }
      ]
    };
  }

  /**
   * 解码 RAW 文件到 Buffer（JPEG 或 TIFF）
   * 
   * @param {string} inputPath - 输入文件路径
   * @param {Object} options - 解码选项
   * @param {string} options.outputFormat - 输出格式 ('jpeg' | 'tiff')，默认 'jpeg'
   * @param {number} options.quality - JPEG 质量 (1-100)，默认 95
   * @param {boolean} options.halfSize - 使用半尺寸解码（更快）
   * @param {boolean} options.useCameraWB - 使用相机白平衡
   * @param {Function} onProgress - 进度回调 (percent, message)
   * @returns {Promise<Buffer>} 图像 Buffer
   */
  async decode(inputPath, options = {}, onProgress = null) {
    if (!activeDecoder) {
      throw new Error('RAW decoder not available');
    }

    const processor = createProcessor();
    if (!processor) {
      throw new Error('Failed to create RAW processor');
    }

    const outputFormat = (options.outputFormat || 'jpeg').toLowerCase();
    
    try {
      if (onProgress) onProgress(10, '加载 RAW 文件...');
      
      // 加载文件
      await processor.loadFile(inputPath);
      
      if (onProgress) onProgress(30, '配置处理参数...');
      
      // 配置处理参数（仅原生模块支持）
      if (isNativeDecoder()) {
        if (options.halfSize) {
          processor.setHalfSize(true);
        }
        if (options.useCameraWB !== undefined) {
          processor.setUseCameraWB(options.useCameraWB);
        }
        if (options.useAutoWB !== undefined) {
          processor.setUseAutoWB(options.useAutoWB);
        }
        if (options.demosaicQuality !== undefined) {
          processor.setQuality(options.demosaicQuality);
        }
        // 设置输出位深度 - TIFF 默认 16 位以保持质量
        if (options.outputBps !== undefined) {
          processor.setOutputBps(options.outputBps);
        } else if (outputFormat === 'tiff') {
          // TIFF 格式默认使用 16 位以保持最高质量
          processor.setOutputBps(16);
        }
      }
      
      if (onProgress) onProgress(50, '处理图像...');
      
      // 处理图像
      const processResult = await processor.processImage();
      if (processResult) {
        console.log(`[RawDecoder] Process result - sizes: ${processResult.width}x${processResult.height}, output: ${processResult.iwidth}x${processResult.iheight}`);
      }
      
      if (onProgress) onProgress(80, `生成 ${outputFormat.toUpperCase()}...`);
      
      let buffer;
      
      if (isNativeDecoder()) {
        // @filmgallery/libraw-native - 使用 makeMemImage 获取原始图像数据
        const imageData = await processor.makeMemImage();
        
        if (!imageData || !imageData.data) {
          throw new Error('Failed to create memory image');
        }
        
        // 使用 sharp 转换为所需格式
        const sharp = require('sharp');
        const { width, height, bits, colors, type, dataSize } = imageData;
        
        // 调试信息
        console.log(`[RawDecoder] Image: ${width}x${height}, ${bits}bit, ${colors}ch, type=${type}, dataSize=${dataSize}`);
        
        // 计算期望的数据大小
        const bytesPerPixel = (bits / 8) * colors;
        const expectedSize = width * height * bytesPerPixel;
        console.log(`[RawDecoder] Expected size: ${expectedSize}, actual: ${dataSize}`);
        
        // LibRaw type: 0=bitmap, 1=ppm
        // 对于 type=1 (PPM/PNM), 数据是纯 RGB 交错格式，没有头部
        
        // 检查是否为 16 位数据
        const is16bit = bits === 16;
        
        // 创建 sharp 输入
        // 注意：sharp 根据 TypedArray 类型来推断位深度
        // Buffer -> 默认 8 位, Uint16Array -> 16 位
        let sharpInput;
        if (is16bit) {
          // 将 Buffer 转换为 Uint16Array，以便 sharp 正确识别为 16 位
          // LibRaw 在 Windows 上输出 little-endian 数据，与 Uint16Array 兼容
          const pixelData = new Uint16Array(
            imageData.data.buffer,
            imageData.data.byteOffset,
            imageData.data.byteLength / 2
          );
          console.log(`[RawDecoder] Using Uint16Array: ${pixelData.length} pixels, first 3: [${pixelData[0]}, ${pixelData[1]}, ${pixelData[2]}]`);
          
          sharpInput = sharp(pixelData, {
            raw: {
              width,
              height,
              channels: colors
            }
          });
        } else {
          // 8 位数据
          sharpInput = sharp(imageData.data, {
            raw: {
              width,
              height,
              channels: colors
            }
          });
        }
        
        if (outputFormat === 'tiff') {
          // TIFF 输出 - 保持原始位深度
          // sharp 会自动根据输入数据位深度输出相应的 TIFF
          // 注意：不要设置 bitdepth 参数，让 sharp 自动处理
          buffer = await sharpInput
            .tiff({
              compression: options.compression || 'lzw'
              // 不设置 bitdepth，让 sharp 根据输入自动选择
            })
            .toBuffer();
        } else {
          buffer = await sharpInput
            .jpeg({
              quality: options.quality || 95,
              progressive: options.progressive || false
            })
            .toBuffer();
        }
      } else {
        // lightdrift-libraw
        let result;
        if (outputFormat === 'tiff') {
          result = await processor.createTIFFBuffer({
            compression: options.compression || 'none'
          });
        } else {
          result = await processor.createJPEGBuffer({ 
            quality: options.quality || 95,
            progressive: options.progressive || false
          });
        }
        
        if (!result.success || !result.buffer) {
          throw new Error(`Failed to create ${outputFormat.toUpperCase()} buffer`);
        }
        buffer = result.buffer;
      }
      
      if (onProgress) onProgress(100, '完成');
      
      console.log(`[RawDecoder] Decoded ${path.basename(inputPath)} to ${outputFormat.toUpperCase()}: ${(buffer.length / 1024).toFixed(1)}KB`);
      
      return buffer;

    } catch (e) {
      console.error('[RawDecoder] Decode error:', e);
      throw new Error(`RAW decoding failed: ${e.message}`);
    } finally {
      try { 
        if (processor.close) await processor.close(); 
        else if (processor.recycle) processor.recycle();
      } catch (_) {}
    }
  }

  /**
   * 提取缩略图（快速预览）
   */
  async extractThumbnail(inputPath) {
    if (!activeDecoder) {
      throw new Error('RAW decoder not available');
    }
    
    const processor = createProcessor();
    if (!processor) {
      throw new Error('Failed to create RAW processor');
    }
    
    try {
      await processor.loadFile(inputPath);
      
      if (isNativeDecoder()) {
        // @filmgallery/libraw-native
        try {
          const thumbData = await processor.makeMemThumbnail();
          if (thumbData && thumbData.data && thumbData.data.length > 0) {
            return thumbData.data;
          }
        } catch (e) {
          console.log('[RawDecoder] No embedded thumbnail, generating from full image...');
        }
        
        // 如果没有嵌入缩略图，生成一个小尺寸的 JPEG
        processor.setHalfSize(true);
        await processor.processImage();
        const imageData = await processor.makeMemImage();
        
        if (imageData && imageData.data) {
          const sharp = require('sharp');
          return await sharp(imageData.data, {
            raw: {
              width: imageData.width,
              height: imageData.height,
              channels: imageData.colors
            }
          })
          .resize(400, null, { withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        }
        
        throw new Error('Failed to generate thumbnail');
      } else {
        // lightdrift-libraw
        await processor.unpackThumbnail();
        const thumbData = await processor.createMemoryThumbnail();
        
        if (thumbData && thumbData.data && thumbData.dataSize > 0) {
          return thumbData.data;
        }
        
        // 如果没有嵌入缩略图，生成一个小尺寸的 JPEG
        console.log('[RawDecoder] No embedded thumbnail, generating from full image...');
        await processor.processImage();
        const result = await processor.createJPEGBuffer({ 
          quality: 80,
          width: 400
        });
        return result.buffer;
      }
    } finally {
      try { 
        if (processor.close) await processor.close(); 
        else if (processor.recycle) processor.recycle();
      } catch (_) {}
    }
  }

  /**
   * 获取 RAW 文件元数据
   */
  async getMetadata(inputPath) {
    if (!activeDecoder) {
      return this.extractMetadataExiftool(inputPath);
    }
    
    const processor = createProcessor();
    if (!processor) {
      return this.extractMetadataExiftool(inputPath);
    }
    
    try {
      await processor.loadFile(inputPath);
      
      if (isNativeDecoder()) {
        // @filmgallery/libraw-native
        const meta = await processor.getMetadata();
        const size = await processor.getImageSize();
        
        let lens = null;
        try {
          lens = await processor.getLensInfo();
        } catch (e) {
          // 某些 RAW 文件可能没有镜头信息
        }
        
        return {
          camera: meta.model,
          make: meta.make,
          lens: lens?.lens || lens?.lensName,
          iso: meta.iso,
          shutter: meta.shutterSpeed,
          aperture: meta.aperture,
          focalLength: meta.focalLength,
          width: size?.width || meta.rawWidth,
          height: size?.height || meta.rawHeight,
          date: meta.timestamp ? new Date(meta.timestamp * 1000) : null,
          // 额外信息
          artist: meta.artist,
          software: meta.software,
          flashUsed: meta.flashUsed,
          orientation: meta.orientation
        };
      } else {
        // lightdrift-libraw
        const meta = await processor.getMetadata();
        const size = await processor.getImageSize();
        
        let lens = null;
        try {
          lens = await processor.getLensInfo();
        } catch (e) {}
        
        return {
          camera: meta.model,
          make: meta.make,
          lens: lens?.lens || lens?.lensName,
          iso: meta.iso,
          shutter: meta.shutterSpeed,
          aperture: meta.aperture,
          focalLength: meta.focalLength,
          width: size?.width || meta.rawWidth,
          height: size?.height || meta.rawHeight,
          date: meta.timestamp ? new Date(meta.timestamp * 1000) : null
        };
      }
    } catch (e) {
      console.warn('[RawDecoder] LibRaw metadata failed, fallback to exiftool:', e.message);
      return this.extractMetadataExiftool(inputPath);
    } finally {
      try { 
        if (processor.close) await processor.close(); 
        else if (processor.recycle) processor.recycle();
      } catch (_) {}
    }
  }

  /**
   * 使用 exiftool 提取元数据（后备）
   */
  async extractMetadataExiftool(inputPath) {
    try {
      const exiftool = require('exiftool-vendored').exiftool;
      const tags = await exiftool.read(inputPath);
      return {
        camera: tags.Model,
        make: tags.Make,
        lens: tags.LensID || tags.LensModel,
        iso: tags.ISO,
        shutter: tags.ShutterSpeed,
        aperture: tags.FNumber,
        focalLength: tags.FocalLength,
        width: tags.ImageWidth,
        height: tags.ImageHeight,
        date: tags.DateTimeOriginal
      };
    } catch (e) {
      console.warn('[RawDecoder] Metadata extraction failed:', e.message);
      return {};
    }
  }

  /**
   * 别名方法
   */
  async extractMetadata(inputPath) {
    return this.getMetadata(inputPath);
  }

  /**
   * 批量解码
   */
  async batchDecode(files, options, onProgress = null) {
    const results = [];
    const total = files.length;
    
    for (let i = 0; i < total; i++) {
      const file = files[i];
      try {
        const buffer = await this.decode(file.path, options);
        results.push({ id: file.id, success: true, buffer });
      } catch (e) {
        results.push({ id: file.id, success: false, error: e.message });
      }
      
      if (onProgress) {
        onProgress(Math.round(((i + 1) / total) * 100), `处理 ${i + 1}/${total}`);
      }
    }
    return results;
  }
}

// ============================================================================
// 导出
// ============================================================================

const rawDecoder = new RawDecoder();

module.exports = rawDecoder;
module.exports.SUPPORTED_EXTENSIONS = SUPPORTED_EXTENSIONS;
module.exports.isNativeDecoder = isNativeDecoder;
module.exports.isAvailableSync = isAvailableSync;
module.exports.getDecoderInfo = () => decoderInfo;
module.exports.isSupportedCamera = (model) => {
  if (LibRawNative && LibRawNative.isSupportedCamera) {
    return LibRawNative.isSupportedCamera(model);
  }
  return null; // fallback 模式无法检查
};
module.exports.getCameraList = () => {
  if (LibRawNative && LibRawNative.getCameraList) {
    return LibRawNative.getCameraList();
  }
  return [];
};
