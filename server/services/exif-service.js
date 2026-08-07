/**
 * EXIF 服务 - EXIF 元数据读写
 * 
 * @module exif-service
 * @description 供下载功能使用的 EXIF 读写服务
 */

const fs = require('fs');
const path = require('path');

// 使用 piexifjs 处理 JPEG EXIF (轻量级，纯 JavaScript)
// 如果需要更完整的支持，可以考虑 exif-parser 或 sharp 的 metadata
let piexif;
try {
  piexif = require('piexifjs');
} catch (e) {
  console.warn('[ExifService] piexifjs not installed, EXIF writing will be limited');
  piexif = null;
}

// 使用 exiftool-vendored 处理完整的 EXIF/XMP 写入
let exiftool;
try {
  exiftool = require('exiftool-vendored').exiftool;
} catch (e) {
  console.warn('[ExifService] exiftool-vendored not installed, XMP writing will be limited');
  exiftool = null;
}

// ============================================================================
// 常量定义
// ============================================================================

/**
 * 支持的 EXIF 标签映射
 * 数据库字段 -> EXIF 标签
 */
const EXIF_TAG_MAPPING = {
  // 相机信息
  camera_make: 'Make',
  camera_model: 'Model',
  lens: 'LensModel',
  
  // 拍摄参数
  aperture: 'FNumber',
  shutter_speed: 'ExposureTime',
  iso: 'ISOSpeedRatings',
  focal_length: 'FocalLength',
  
  // 时间
  date_taken: 'DateTimeOriginal',
  
  // GPS
  latitude: 'GPSLatitude',
  longitude: 'GPSLongitude',
  altitude: 'GPSAltitude',
  
  // 描述
  caption: 'ImageDescription',
  notes: 'UserComment',
  photographer: 'Artist',
};

/**
 * EXIF 写入选项默认值
 */
const DEFAULT_EXIF_OPTIONS = {
  camera: true,       // 相机/镜头信息
  shooting: true,     // 光圈/快门/ISO/焦距
  datetime: true,     // 日期时间
  gps: true,          // GPS 位置
  description: true,  // 描述/备注
  scanner: true,      // 扫描仪/数字化信息
};

/**
 * 胶片格式对应的画幅宽度 (mm)
 * 用于计算 35mm 等效焦距
 */
const FORMAT_WIDTH_MM = {
  '135': 36,              // 标准 35mm
  '35mm': 36,
  'Half Frame': 24,       // 半格
  'APS': 30.2,            // APS
  '110': 17,              // 110 格式
  '127': 40,              // 127 格式
  '120': 60,              // 中画幅 (按 6x6 计算)
  '220': 60,              // 中画幅 (同 120)
  'Large Format 4x5': 127, // 大画幅 4x5
  '4x5': 127,
  'Large Format 8x10': 254, // 大画幅 8x10
  '8x10': 254,
  'Instant': 79,          // 拍立得
};

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 解析相机品牌和型号
 * @param {string} cameraString - 相机字符串 (如 "Nikon FM2")
 * @returns {{ make: string, model: string }}
 */
function parseCameraString(cameraString) {
  if (!cameraString) return { make: '', model: '' };
  
  // 常见相机品牌
  const brands = [
    'Nikon', 'Canon', 'Sony', 'Fujifilm', 'Fuji', 'Olympus', 'Pentax',
    'Leica', 'Hasselblad', 'Mamiya', 'Contax', 'Minolta', 'Rollei',
    'Yashica', 'Bronica', 'Phase One', 'Ricoh', 'Sigma', 'Panasonic'
  ];
  
  const str = cameraString.trim();
  
  for (const brand of brands) {
    if (str.toLowerCase().startsWith(brand.toLowerCase())) {
      return {
        make: brand,
        model: str.substring(brand.length).trim() || str
      };
    }
  }
  
  // 无法识别品牌，整体作为型号
  return { make: '', model: str };
}

/**
 * 解析光圈值为 EXIF 格式
 * @param {string|number} aperture - 光圈值 (如 "f/2.8" 或 2.8)
 * @returns {number|null}
 */
function parseAperture(aperture) {
  if (!aperture) return null;
  
  if (typeof aperture === 'number') return aperture;
  
  const str = String(aperture);
  const match = str.match(/f?\/?(\d+\.?\d*)/i);
  if (match) {
    return parseFloat(match[1]);
  }
  
  return null;
}

/**
 * 解析快门速度为 EXIF 格式 (分数)
 * @param {string|number} shutter - 快门速度 (如 "1/125" 或 0.008)
 * @returns {{ numerator: number, denominator: number }|null}
 */
function parseShutterSpeed(shutter) {
  if (!shutter) return null;
  
  if (typeof shutter === 'number') {
    // 秒数转分数
    if (shutter >= 1) {
      return { numerator: Math.round(shutter), denominator: 1 };
    } else {
      const denom = Math.round(1 / shutter);
      return { numerator: 1, denominator: denom };
    }
  }
  
  const str = String(shutter);
  const match = str.match(/(\d+)\/(\d+)/);
  if (match) {
    return { numerator: parseInt(match[1]), denominator: parseInt(match[2]) };
  }
  
  // 尝试解析为秒数
  const seconds = parseFloat(str);
  if (!isNaN(seconds)) {
    if (seconds >= 1) {
      return { numerator: Math.round(seconds), denominator: 1 };
    } else {
      const denom = Math.round(1 / seconds);
      return { numerator: 1, denominator: denom };
    }
  }
  
  return null;
}

/**
 * 解析焦距
 * @param {string|number} focalLength - 焦距 (如 "50mm" 或 50)
 * @returns {number|null}
 */
function parseFocalLength(focalLength) {
  if (!focalLength) return null;
  
  if (typeof focalLength === 'number') return focalLength;
  
  const str = String(focalLength);
  const match = str.match(/(\d+\.?\d*)/);
  if (match) {
    return parseFloat(match[1]);
  }
  
  return null;
}

/**
 * 格式化日期时间为 EXIF 格式
 * @param {string} dateTaken - 日期 (如 "2026-01-15")
 * @param {string} timeTaken - 时间 (如 "14:30:00")
 * @returns {string|null} EXIF 格式 "YYYY:MM:DD HH:MM:SS"
 */
function formatExifDateTime(dateTaken, timeTaken) {
  if (!dateTaken) return null;
  
  const str = String(dateTaken);
  
  if (/Z$/i.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }
  }
  
  // 标准化日期
  const dateMatch = str.match(/(\d{4})-?(\d{2})-?(\d{2})/);
  if (!dateMatch) return null;
  
  const year = dateMatch[1];
  const month = dateMatch[2];
  const day = dateMatch[3];
  
  // 标准化时间: 优先使用 dateTaken 内嵌时间, 回退到 timeTaken
  let hour = '00', minute = '00', second = '00';
  const embedded = str.match(/[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (embedded) {
    hour = embedded[1];
    minute = embedded[2];
    second = embedded[3] || '00';
  } else if (timeTaken) {
    const timeMatch = String(timeTaken).match(/(\d{2}):?(\d{2}):?(\d{2})?/);
    if (timeMatch) {
      hour = timeMatch[1];
      minute = timeMatch[2];
      second = timeMatch[3] || '00';
    }
  }
  
  return `${year}:${month}:${day} ${hour}:${minute}:${second}`;
}

/**
 * 将十进制度数转换为 EXIF GPS 格式 (度/分/秒)
 * @param {number} decimal - 十进制度数
 * @returns {[[number, number], [number, number], [number, number]]}
 */
function decimalToDMS(decimal) {
  const abs = Math.abs(decimal);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.round((minutesFloat - minutes) * 60 * 100) / 100;
  
  return [
    [degrees, 1],
    [minutes, 1],
    [Math.round(seconds * 100), 100]
  ];
}

// ============================================================================
// 核心功能
// ============================================================================

/**
 * 从数据库记录构建 EXIF 数据
 * @param {Object} photo - 照片记录 (包含完整的 JOIN 数据)
 * @param {Object} roll - 卷记录 (可选，当 photo 已包含 roll 数据时可为 null)
 * @param {Object} [options] - 选项
 * @returns {Object} EXIF 数据对象
 */
function buildExifData(photo, roll, options = {}) {
  const opts = { ...DEFAULT_EXIF_OPTIONS, ...options };
  const exif = {};
  
  // 相机/镜头信息 - 优先使用设备表数据
  if (opts.camera) {
    // 从设备表获取相机信息，回退到文本字段
    const cameraName = photo.photo_camera_name || photo.roll_camera_name || photo.camera || photo.roll_camera || roll?.camera;
    const cameraBrand = photo.photo_camera_brand || photo.roll_camera_brand;
    const cameraModel = photo.photo_camera_model || photo.roll_camera_model;
    
    if (cameraBrand || cameraModel) {
      // 使用设备表的结构化数据
      if (cameraBrand) exif.Make = cameraBrand;
      if (cameraModel) exif.Model = cameraModel;
    } else if (cameraName) {
      // 回退到解析相机字符串
      const { make, model } = parseCameraString(cameraName);
      if (make) exif.Make = make;
      if (model) exif.Model = model;
    }
    
    // 镜头信息 - 优先使用设备表数据
    const lensName = photo.photo_lens_name || photo.roll_lens_name || photo.lens || photo.roll_lens;
    const lensBrand = photo.photo_lens_brand || photo.roll_lens_brand;
    const lensModel = photo.photo_lens_model || photo.roll_lens_model;
    
    // 对于 PS 机固定镜头，从相机获取镜头信息
    let fixedLensFocal = null;
    if (photo.has_fixed_lens || photo.roll_has_fixed_lens) {
      fixedLensFocal = photo.fixed_lens_focal_length || photo.roll_fixed_lens_focal;
    }
    
    // 镜头品牌 - 直接使用 lensBrand
    if (lensBrand) {
      exif.LensMake = lensBrand;
    }
    
    // 镜头型号
    if (lensBrand && lensModel) {
      exif.LensModel = `${lensBrand} ${lensModel}`;
    } else if (lensModel) {
      exif.LensModel = lensModel;
    } else if (lensName) {
      exif.LensModel = lensName;
    }
    
    // 如果是固定镜头相机且没有单独镜头信息
    if (fixedLensFocal && !exif.LensModel && cameraName) {
      exif.LensModel = `${cameraName} ${fixedLensFocal}mm`;
    }
  }
  
  // 拍摄参数
  if (opts.shooting) {
    // 光圈
    const aperture = parseAperture(photo.aperture);
    if (aperture) {
      exif.FNumber = aperture;
    }
    
    // 快门速度
    const shutter = parseShutterSpeed(photo.shutter_speed);
    if (shutter) {
      exif.ExposureTime = shutter;
    }
    
    // ISO - 优先使用照片 ISO，回退到胶片 ISO
    const isoValue = photo.iso || photo.film_iso;
    if (isoValue) {
      exif.ISOSpeedRatings = parseInt(isoValue);
    }
    
    // 焦距
    const focal = parseFocalLength(photo.focal_length);
    if (focal) {
      exif.FocalLength = focal;
      
      // 计算 35mm 等效焦距
      // 使用胶片格式或相机格式确定画幅宽度
      const filmFormat = photo.film_format || photo.roll_format || roll?.format;
      if (filmFormat) {
        const formatWidth = FORMAT_WIDTH_MM[filmFormat] || FORMAT_WIDTH_MM[filmFormat.split(' ')[0]] || 36;
        // 35mm 等效焦距 = 实际焦距 × (36 / 画幅宽度)
        const cropFactor = 36 / formatWidth;
        exif.FocalLengthIn35mmFormat = Math.round(focal * cropFactor);
      }
    }
  }
  
  // 日期时间
  if (opts.datetime) {
    const datetime = formatExifDateTime(photo.date_taken, photo.time_taken || '12:00:00');
    if (datetime) {
      exif.DateTimeOriginal = datetime;
      exif.DateTimeDigitized = datetime;
    }
  }
  
  // GPS
  if (opts.gps) {
    if (photo.latitude && photo.longitude) {
      exif.GPSLatitude = decimalToDMS(photo.latitude);
      exif.GPSLatitudeRef = photo.latitude >= 0 ? 'N' : 'S';
      exif.GPSLongitude = decimalToDMS(photo.longitude);
      exif.GPSLongitudeRef = photo.longitude >= 0 ? 'E' : 'W';
    }
    
    if (photo.altitude) {
      exif.GPSAltitude = [Math.abs(Math.round(photo.altitude * 100)), 100];
      exif.GPSAltitudeRef = photo.altitude >= 0 ? 0 : 1;
    }
  }
  
  // 描述
  if (opts.description) {
    if (photo.caption) {
      exif.ImageDescription = photo.caption;
    }
    
    if (photo.notes) {
      exif.UserComment = photo.notes;
    }
    
    const photographer = photo.photographer || photo.roll_photographer || roll?.photographer;
    if (photographer) {
      exif.Artist = photographer;
      exif.Copyright = `© ${new Date().getFullYear()} ${photographer}`;
    }
  }
  
  // 软件标识
  exif.Software = 'FilmGallery v1.9.2';
  
  // 胶片信息 (用于 XMP)
  if (photo.film_name || photo.film_type) {
    exif.FilmName = photo.film_name || photo.film_type;
  }
  if (photo.film_brand) {
    exif.FilmBrand = photo.film_brand;
  }
  if (photo.film_iso) {
    exif.FilmISO = photo.film_iso;
  }
  if (photo.film_format) {
    exif.FilmFormat = photo.film_format;
  }
  if (photo.film_process) {
    exif.FilmProcess = photo.film_process;
  }
  
  // 冲洗信息 (用于 XMP)
  if (photo.develop_lab) {
    exif.DevelopLab = photo.develop_lab;
  }
  if (photo.develop_process) {
    exif.DevelopProcess = photo.develop_process;
  }
  if (photo.develop_date) {
    exif.DevelopDate = photo.develop_date;
  }
  
  // 扫描仪/数字化信息
  // 注意: piexifjs 不支持 XMP，这些字段会存储在 EXIF 对象中供 XMP 写入使用
  if (opts.scanner) {
    // 原始源设备信息 (扫描仪制造商/型号) - 来自 EXIF 提取
    if (photo.source_make) {
      exif.ScannerMake = photo.source_make;
    }
    if (photo.source_model) {
      exif.ScannerModel = photo.source_model;
    }
    if (photo.source_software) {
      exif.ScannerSoftware = photo.source_software;
    }
    
    // 扫描参数
    if (photo.scan_resolution) {
      exif.ScanResolution = photo.scan_resolution;
    }
    if (photo.scan_bit_depth) {
      exif.ScanBitDepth = photo.scan_bit_depth;
    }
    if (photo.scan_date) {
      exif.ScanDate = photo.scan_date;
    }
    
    // 扫描仪设备信息 (从 JOIN 查询获取)
    if (photo.scanner_name) {
      exif.ScannerEquipment = photo.scanner_name;
    }
    if (photo.scanner_brand) {
      exif.ScannerEquipBrand = photo.scanner_brand;
    }
    if (photo.scanner_model) {
      exif.ScannerEquipModel = photo.scanner_model;
    }
    if (photo.scanner_type) {
      exif.ScannerType = photo.scanner_type;
    }
  }
  
  return exif;
}

/**
 * 写入 EXIF 到 JPEG 图片文件
 * @param {string} filePath - 图片文件路径
 * @param {Object} exifData - EXIF 数据
 * @returns {Promise<void>}
 */
async function writeExif(filePath, exifData) {
  if (!piexif) {
    console.warn('[ExifService] piexifjs not available, skipping EXIF write');
    return;
  }
  
  // 读取原始图片
  const imageData = fs.readFileSync(filePath);
  const base64 = imageData.toString('binary');
  
  // 构建 piexif 格式的 EXIF 对象
  const zeroth = {};
  const exifIfd = {};
  const gpsIfd = {};
  
  // 0th IFD (基本信息)
  if (exifData.Make) zeroth[piexif.ImageIFD.Make] = exifData.Make;
  if (exifData.Model) zeroth[piexif.ImageIFD.Model] = exifData.Model;
  if (exifData.Software) zeroth[piexif.ImageIFD.Software] = exifData.Software;
  if (exifData.Artist) zeroth[piexif.ImageIFD.Artist] = exifData.Artist;
  if (exifData.Copyright) zeroth[piexif.ImageIFD.Copyright] = exifData.Copyright;
  if (exifData.ImageDescription) zeroth[piexif.ImageIFD.ImageDescription] = exifData.ImageDescription;
  
  // Exif IFD (拍摄信息)
  if (exifData.FNumber) {
    exifIfd[piexif.ExifIFD.FNumber] = [Math.round(exifData.FNumber * 10), 10];
  }
  if (exifData.ExposureTime) {
    exifIfd[piexif.ExifIFD.ExposureTime] = [exifData.ExposureTime.numerator, exifData.ExposureTime.denominator];
  }
  if (exifData.ISOSpeedRatings) {
    exifIfd[piexif.ExifIFD.ISOSpeedRatings] = exifData.ISOSpeedRatings;
  }
  if (exifData.FocalLength) {
    exifIfd[piexif.ExifIFD.FocalLength] = [Math.round(exifData.FocalLength * 10), 10];
  }
  if (exifData.DateTimeOriginal) {
    exifIfd[piexif.ExifIFD.DateTimeOriginal] = exifData.DateTimeOriginal;
  }
  if (exifData.DateTimeDigitized) {
    exifIfd[piexif.ExifIFD.DateTimeDigitized] = exifData.DateTimeDigitized;
  }
  if (exifData.LensModel) {
    exifIfd[piexif.ExifIFD.LensModel] = exifData.LensModel;
  }
  if (exifData.UserComment) {
    // UserComment 需要特殊编码
    exifIfd[piexif.ExifIFD.UserComment] = 'ASCII\0\0\0' + exifData.UserComment;
  }
  
  // GPS IFD
  if (exifData.GPSLatitude) {
    gpsIfd[piexif.GPSIFD.GPSLatitude] = exifData.GPSLatitude;
    gpsIfd[piexif.GPSIFD.GPSLatitudeRef] = exifData.GPSLatitudeRef;
  }
  if (exifData.GPSLongitude) {
    gpsIfd[piexif.GPSIFD.GPSLongitude] = exifData.GPSLongitude;
    gpsIfd[piexif.GPSIFD.GPSLongitudeRef] = exifData.GPSLongitudeRef;
  }
  if (exifData.GPSAltitude) {
    gpsIfd[piexif.GPSIFD.GPSAltitude] = exifData.GPSAltitude;
    gpsIfd[piexif.GPSIFD.GPSAltitudeRef] = exifData.GPSAltitudeRef;
  }
  
  // 组合 EXIF 对象
  const exifObj = {
    '0th': zeroth,
    'Exif': exifIfd,
    'GPS': gpsIfd,
    '1st': {},
    'Interop': {},
    'thumbnail': null
  };
  
  // 生成 EXIF 字节
  const exifBytes = piexif.dump(exifObj);
  
  // 插入 EXIF 到图片
  const newImageData = piexif.insert(exifBytes, base64);
  
  // 写入文件
  fs.writeFileSync(filePath, Buffer.from(newImageData, 'binary'));
}

/**
 * 读取图片 EXIF
 * @param {string} filePath - 图片文件路径
 * @returns {Promise<Object>} EXIF 数据
 */
async function readExif(filePath) {
  if (!piexif) {
    console.warn('[ExifService] piexifjs not available, returning empty EXIF');
    return {};
  }
  
  try {
    const imageData = fs.readFileSync(filePath);
    const base64 = imageData.toString('binary');
    const exifObj = piexif.load(base64);
    
    // 转换为简单对象
    const result = {};
    
    // 0th IFD
    for (const [tag, value] of Object.entries(exifObj['0th'] || {})) {
      const tagName = piexif.TAGS['0th'][tag]?.name;
      if (tagName) result[tagName] = value;
    }
    
    // Exif IFD
    for (const [tag, value] of Object.entries(exifObj['Exif'] || {})) {
      const tagName = piexif.TAGS['Exif'][tag]?.name;
      if (tagName) result[tagName] = value;
    }
    
    // GPS IFD
    for (const [tag, value] of Object.entries(exifObj['GPS'] || {})) {
      const tagName = piexif.TAGS['GPS'][tag]?.name;
      if (tagName) result[tagName] = value;
    }
    
    return result;
  } catch (e) {
    console.error('[ExifService] Failed to read EXIF:', e.message);
    return {};
  }
}

/**
 * 使用 exiftool-vendored 写入完整的 EXIF/XMP 数据
 * 支持标准 EXIF、IPTC 和 XMP 自定义命名空间 (FilmGallery)
 * 
 * @param {string} filePath - 图片文件路径
 * @param {Object} exifData - EXIF 数据对象 (由 buildExifData 返回)
 * @param {Object} [options] - 额外选项
 * @param {string[]} [options.keywords] - 关键词/标签
 * @param {string} [options.rollTitle] - 卷标题
 * @returns {Promise<boolean>} 写入是否成功
 */
async function writeExifWithExiftool(filePath, exifData, options = {}) {
  if (!exiftool) {
    console.warn('[ExifService] exiftool-vendored not available, falling back to piexif');
    // 回退到 piexif (不支持 XMP)
    await writeExif(filePath, exifData);
    return true;
  }
  
  try {
    // 构建 exiftool 格式的写入数据
    const writeData = {};
    
    // ========== 标准 EXIF 标签 ==========
    // 相机信息
    if (exifData.Make) writeData.Make = exifData.Make;
    if (exifData.Model) writeData.Model = exifData.Model;
    if (exifData.LensModel) writeData.LensModel = exifData.LensModel;
    if (exifData.LensMake) writeData.LensMake = exifData.LensMake;
    
    // 拍摄参数
    if (exifData.FNumber) writeData.FNumber = exifData.FNumber;
    if (exifData.ExposureTime) {
      // 转换分数为字符串
      if (typeof exifData.ExposureTime === 'object') {
        writeData.ExposureTime = `${exifData.ExposureTime.numerator}/${exifData.ExposureTime.denominator}`;
      } else {
        writeData.ExposureTime = exifData.ExposureTime;
      }
    }
    if (exifData.ISOSpeedRatings) writeData.ISO = exifData.ISOSpeedRatings;
    if (exifData.FocalLength) writeData.FocalLength = exifData.FocalLength;
    
    // 日期时间
    if (exifData.DateTimeOriginal) {
      writeData.DateTimeOriginal = exifData.DateTimeOriginal;
      writeData.CreateDate = exifData.DateTimeOriginal;
    }
    
    // GPS
    if (exifData.GPSLatitude) {
      // exiftool 接受十进制度数
      const latDMS = exifData.GPSLatitude;
      const lat = latDMS[0][0] + latDMS[1][0] / 60 + latDMS[2][0] / latDMS[2][1] / 3600;
      const latSign = exifData.GPSLatitudeRef === 'S' ? -1 : 1;
      writeData.GPSLatitude = lat * latSign;
    }
    if (exifData.GPSLongitude) {
      const lonDMS = exifData.GPSLongitude;
      const lon = lonDMS[0][0] + lonDMS[1][0] / 60 + lonDMS[2][0] / lonDMS[2][1] / 3600;
      const lonSign = exifData.GPSLongitudeRef === 'W' ? -1 : 1;
      writeData.GPSLongitude = lon * lonSign;
    }
    
    // 描述信息
    if (exifData.ImageDescription) writeData.ImageDescription = exifData.ImageDescription;
    if (exifData.UserComment) writeData.UserComment = exifData.UserComment;
    if (exifData.Artist) writeData.Artist = exifData.Artist;
    if (exifData.Copyright) writeData.Copyright = exifData.Copyright;
    if (exifData.Software) writeData.Software = exifData.Software;
    
    // ========== IPTC/XMP 关键词 ==========
    const keywords = options.keywords || [];
    if (exifData.FilmName) keywords.push(exifData.FilmName);
    if (exifData.DevelopLab) keywords.push(exifData.DevelopLab);
    if (keywords.length > 0) {
      writeData.Subject = keywords;
      writeData.Keywords = keywords;
    }
    
    // ========== 构建综合描述 ==========
    const descParts = [];
    if (exifData.ImageDescription) descParts.push(exifData.ImageDescription);
    if (options.rollTitle) descParts.push(`Roll: ${options.rollTitle}`);
    
    // 胶片信息
    const filmParts = [];
    if (exifData.FilmBrand) filmParts.push(exifData.FilmBrand);
    if (exifData.FilmName) filmParts.push(exifData.FilmName);
    if (exifData.FilmISO) filmParts.push(`ISO ${exifData.FilmISO}`);
    if (exifData.FilmFormat) filmParts.push(exifData.FilmFormat);
    if (filmParts.length > 0) {
      descParts.push(`Film: ${filmParts.join(' ')}`);
    }
    
    // 冲洗信息
    const developParts = [];
    if (exifData.DevelopLab) developParts.push(`Lab: ${exifData.DevelopLab}`);
    if (exifData.DevelopProcess) developParts.push(`Process: ${exifData.DevelopProcess}`);
    if (exifData.DevelopDate) developParts.push(`Date: ${exifData.DevelopDate}`);
    if (developParts.length > 0) {
      descParts.push(`Develop: ${developParts.join(', ')}`);
    }
    
    if (descParts.length > 1) {
      writeData.ImageDescription = descParts.join(' | ');
    }
    
    // UserComment 包含更详细信息
    const userCommentParts = [];
    if (filmParts.length > 0) userCommentParts.push(`Film: ${filmParts.join(' ')}`);
    if (exifData.LensModel) userCommentParts.push(`Lens: ${exifData.LensModel}`);
    if (developParts.length > 0) userCommentParts.push(developParts.join(', '));
    if (userCommentParts.length > 0) {
      writeData.UserComment = userCommentParts.join(' | ');
    }
    
    // ========== XMP-FilmGallery 自定义命名空间 ==========
    // 扫描仪/数字化信息
    if (exifData.ScannerMake) {
      writeData['XMP-FilmGallery:ScannerMake'] = exifData.ScannerMake;
    }
    if (exifData.ScannerModel) {
      writeData['XMP-FilmGallery:ScannerModel'] = exifData.ScannerModel;
    }
    if (exifData.ScannerSoftware) {
      writeData['XMP-FilmGallery:ScanSoftware'] = exifData.ScannerSoftware;
    }
    if (exifData.ScanResolution) {
      writeData['XMP-FilmGallery:ScanResolution'] = exifData.ScanResolution;
    }
    if (exifData.ScanBitDepth) {
      writeData['XMP-FilmGallery:ScanBitDepth'] = exifData.ScanBitDepth;
    }
    if (exifData.ScanDate) {
      writeData['XMP-FilmGallery:ScanDate'] = exifData.ScanDate;
    }
    
    // 扫描仪设备信息 (来自设备库)
    if (exifData.ScannerEquipment) {
      writeData['XMP-FilmGallery:ScannerEquipment'] = exifData.ScannerEquipment;
    }
    if (exifData.ScannerEquipBrand) {
      writeData['XMP-FilmGallery:ScannerEquipBrand'] = exifData.ScannerEquipBrand;
    }
    if (exifData.ScannerEquipModel) {
      writeData['XMP-FilmGallery:ScannerEquipModel'] = exifData.ScannerEquipModel;
    }
    if (exifData.ScannerType) {
      writeData['XMP-FilmGallery:ScannerType'] = exifData.ScannerType;
    }
    
    // 胶片信息 (XMP)
    if (exifData.FilmName) {
      writeData['XMP-FilmGallery:FilmName'] = exifData.FilmName;
    }
    if (exifData.FilmBrand) {
      writeData['XMP-FilmGallery:FilmBrand'] = exifData.FilmBrand;
    }
    if (exifData.FilmISO) {
      writeData['XMP-FilmGallery:FilmISO'] = exifData.FilmISO;
    }
    if (exifData.FilmFormat) {
      writeData['XMP-FilmGallery:FilmFormat'] = exifData.FilmFormat;
    }
    if (exifData.FilmProcess) {
      writeData['XMP-FilmGallery:FilmProcess'] = exifData.FilmProcess;
    }
    
    // 冲洗信息 (XMP)
    if (exifData.DevelopLab) {
      writeData['XMP-FilmGallery:DevelopLab'] = exifData.DevelopLab;
    }
    if (exifData.DevelopProcess) {
      writeData['XMP-FilmGallery:DevelopProcess'] = exifData.DevelopProcess;
    }
    if (exifData.DevelopDate) {
      writeData['XMP-FilmGallery:DevelopDate'] = exifData.DevelopDate;
    }
    
    console.log('[ExifService] Writing EXIF with exiftool:', Object.keys(writeData).length, 'tags');
    
    // 写入 EXIF
    await exiftool.write(filePath, writeData, ['-overwrite_original']);
    
    console.log('[ExifService] ✅ EXIF write successful');
    return true;
    
  } catch (err) {
    console.error('[ExifService] exiftool write failed:', err);
    return false;
  }
}

// ============================================================================
// 模块导出
// ============================================================================

module.exports = {
  // 常量
  EXIF_TAG_MAPPING,
  DEFAULT_EXIF_OPTIONS,
  
  // 核心功能
  buildExifData,
  writeExif,
  writeExifWithExiftool,
  readExif,
  
  // 辅助函数
  parseCameraString,
  parseAperture,
  parseShutterSpeed,
  parseFocalLength,
  formatExifDateTime,
  decimalToDMS,
};
