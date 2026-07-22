/**
 * RAW 文件工具函数
 * 
 * @module rawUtils
 * @description 共享的 RAW 文件检测和处理工具
 */

'use strict';

/**
 * 支持的 RAW 格式扩展名
 * 与 server/services/raw-decoder.js 保持同步
 */
const RAW_EXTENSIONS = [
  '.dng', '.cr2', '.cr3', '.nef', '.arw', 
  '.raf', '.orf', '.rw2', '.pef', '.srw',
  '.x3f', '.erf', '.mef', '.mos', '.mrw',
  '.kdc', '.3fr', '.fff', '.iiq', '.dcr', '.k25', '.qtk'
];

/**
 * 判断是否为支持的 RAW 文件
 * 
 * @param {string} filename - 文件名或路径
 * @returns {boolean} 是否为 RAW 文件
 */
function isRawFile(filename) {
  if (!filename || typeof filename !== 'string') return false;
  
  // 提取扩展名（支持路径和纯文件名）
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return false;
  
  const ext = filename.slice(lastDot).toLowerCase();
  return RAW_EXTENSIONS.includes(ext);
}

/**
 * 获取 RAW 文件的格式信息
 * 
 * @param {string} filename - 文件名或路径
 * @returns {Object|null} 格式信息 { ext, name, manufacturer }
 */
function getRawFormatInfo(filename) {
  if (!isRawFile(filename)) return null;
  
  const lastDot = filename.lastIndexOf('.');
  const ext = filename.slice(lastDot).toLowerCase();
  
  const formatMap = {
    '.dng': { ext: '.dng', name: 'Adobe Digital Negative', manufacturer: 'Adobe' },
    '.cr2': { ext: '.cr2', name: 'Canon RAW 2', manufacturer: 'Canon' },
    '.cr3': { ext: '.cr3', name: 'Canon RAW 3', manufacturer: 'Canon' },
    '.nef': { ext: '.nef', name: 'Nikon Electronic Format', manufacturer: 'Nikon' },
    '.arw': { ext: '.arw', name: 'Sony Alpha RAW', manufacturer: 'Sony' },
    '.raf': { ext: '.raf', name: 'Fujifilm RAW', manufacturer: 'Fujifilm' },
    '.orf': { ext: '.orf', name: 'Olympus RAW Format', manufacturer: 'Olympus' },
    '.rw2': { ext: '.rw2', name: 'Panasonic RAW', manufacturer: 'Panasonic' },
    '.pef': { ext: '.pef', name: 'Pentax Electronic Format', manufacturer: 'Pentax' },
    '.srw': { ext: '.srw', name: 'Samsung RAW', manufacturer: 'Samsung' },
    '.x3f': { ext: '.x3f', name: 'Sigma RAW', manufacturer: 'Sigma' },
    '.erf': { ext: '.erf', name: 'Epson RAW Format', manufacturer: 'Epson' },
    '.mef': { ext: '.mef', name: 'Mamiya Electronic Format', manufacturer: 'Mamiya' },
    '.mos': { ext: '.mos', name: 'Leaf RAW', manufacturer: 'Leaf' },
    '.mrw': { ext: '.mrw', name: 'Minolta RAW', manufacturer: 'Minolta' },
    '.kdc': { ext: '.kdc', name: 'Kodak Digital Camera', manufacturer: 'Kodak' },
    '.3fr': { ext: '.3fr', name: 'Hasselblad 3F RAW', manufacturer: 'Hasselblad' },
    '.fff': { ext: '.fff', name: 'Hasselblad/Imacon FlexFrame', manufacturer: 'Hasselblad' },
    '.iiq': { ext: '.iiq', name: 'Phase One IIQ', manufacturer: 'Phase One' },
    '.dcr': { ext: '.dcr', name: 'Kodak RAW', manufacturer: 'Kodak' },
    '.k25': { ext: '.k25', name: 'Kodak DC25', manufacturer: 'Kodak' },
    '.qtk': { ext: '.qtk', name: 'Apple QuickTake', manufacturer: 'Apple' }
  };
  
  return formatMap[ext] || null;
}

/**
 * 检测文件类型
 * 
 * @param {string} filename - 文件名或路径
 * @returns {'raw'|'tiff'|'bmp'|'jpeg'|'png'|'unknown'} 文件类型
 */
function detectFileType(filename) {
  if (!filename || typeof filename !== 'string') return 'unknown';
  
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return 'unknown';
  
  const ext = filename.slice(lastDot).toLowerCase();
  
  if (RAW_EXTENSIONS.includes(ext)) return 'raw';
  if (['.tif', '.tiff'].includes(ext)) return 'tiff';
  if (['.bmp', '.dib'].includes(ext)) return 'bmp';
  if (['.jpg', '.jpeg'].includes(ext)) return 'jpeg';
  if (ext === '.png') return 'png';
  
  return 'unknown';
}

/**
 * 检查浏览器是否可以直接加载此文件
 * 
 * @param {string} filename - 文件名或路径
 * @returns {boolean} 浏览器是否可以直接加载
 */
function isBrowserLoadable(filename) {
  const type = detectFileType(filename);
  // 浏览器通常可以加载 JPEG、PNG 和 BMP，部分浏览器支持 TIFF
  // RAW 文件需要服务器解码
  return type === 'jpeg' || type === 'png' || type === 'bmp';
}

/**
 * 检查文件是否需要服务器端解码
 * 
 * @param {string} filename - 文件名或路径
 * @returns {boolean} 是否需要服务器解码
 */
function requiresServerDecode(filename) {
  const type = detectFileType(filename);
  return type === 'raw' || type === 'tiff';
}

const _sharedExports = {
  RAW_EXTENSIONS,
  isRawFile,
  getRawFormatInfo,
  detectFileType,
  isBrowserLoadable,
  requiresServerDecode
};
export const { RAW_EXTENSIONS, isRawFile, getRawFormatInfo, detectFileType, isBrowserLoadable, requiresServerDecode } = _sharedExports;
export default _sharedExports;
