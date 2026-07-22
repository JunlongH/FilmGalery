/**
 * FilmLab 导出参数模块
 * 
 * @module filmLabExport
 * @description 导出参数构建、验证和标准化
 * 
 * 功能特性：
 * - 从预设构建导出参数
 * - 参数验证和默认值填充
 * - 参数版本迁移
 */

import { DEFAULT_TONE_PARAMS, DEFAULT_WB_PARAMS, DEFAULT_INVERSION_PARAMS, DEFAULT_CURVES, DEFAULT_CROP_RECT, JPEG_QUALITY, EXPORT_MAX_WIDTH } from './filmLabConstants.mjs';
import { DEFAULT_HSL_PARAMS as HSL_CANONICAL_DEFAULTS } from './filmLabHSL.mjs';
import { DEFAULT_SPLIT_TONE_PARAMS as SPLIT_TONE_CANONICAL_DEFAULTS, validateSplitToneParams } from './filmLabSplitTone.mjs';
import { stableSerializeParams } from './paramSerializer.mjs';

// ============================================================================
// 常量定义
// ============================================================================

/** 当前参数版本 */
const PARAMS_VERSION = 3;

// P1-27: 删除本地 DEFAULT_HSL_PARAMS / DEFAULT_SPLIT_TONING 重复定义
// 直接使用从 canonical 模块导入的 HSL_CANONICAL_DEFAULTS / SPLIT_TONE_CANONICAL_DEFAULTS
// 旧别名保留以兼容模块外部可能存在的引用
const DEFAULT_HSL_PARAMS = HSL_CANONICAL_DEFAULTS;
const DEFAULT_SPLIT_TONING = SPLIT_TONE_CANONICAL_DEFAULTS;

/** 完整默认参数模板（冻结，禁止原地修改；用 createDefaultParams() 取深拷贝实例） */
const DEFAULT_PROCESSING_PARAMS = {
  version: PARAMS_VERSION,

  // 反转
  inverted: DEFAULT_INVERSION_PARAMS.inverted,
  inversionMode: DEFAULT_INVERSION_PARAMS.inversionMode,
  filmCurveEnabled: false,
  filmCurveProfile: 'default',

  // 白平衡
  red: DEFAULT_WB_PARAMS.red,
  green: DEFAULT_WB_PARAMS.green,
  blue: DEFAULT_WB_PARAMS.blue,
  temp: DEFAULT_WB_PARAMS.temp,
  tint: DEFAULT_WB_PARAMS.tint,

  // 色调
  exposure: DEFAULT_TONE_PARAMS.exposure,
  contrast: DEFAULT_TONE_PARAMS.contrast,
  highlights: DEFAULT_TONE_PARAMS.highlights,
  shadows: DEFAULT_TONE_PARAMS.shadows,
  whites: DEFAULT_TONE_PARAMS.whites,
  blacks: DEFAULT_TONE_PARAMS.blacks,

  // 曲线
  curves: { ...DEFAULT_CURVES },

  // HSL (统一使用 hslParams 字段名)
  hslParams: { ...DEFAULT_HSL_PARAMS },

  // 全局饱和度 (Luma-preserving)
  saturation: 0,

  // 分离色调
  splitToning: { ...DEFAULT_SPLIT_TONING },

  // 片基校正
  baseMode: 'linear',
  baseRed: 1.0,
  baseGreen: 1.0,
  baseBlue: 1.0,
  baseDensityR: 0.0,
  baseDensityG: 0.0,
  baseDensityB: 0.0,

  // 密度域色阶
  densityLevelsEnabled: false,

  // 裁剪/旋转
  cropRect: { ...DEFAULT_CROP_RECT },
  rotation: 0,

  // 3D LUT
  lut1: null,
  lut1Intensity: 1.0,
  lut2: null,
  lut2Intensity: 1.0,
};

// 冻结默认值防止原地修改污染全局（嵌套对象递归冻结）
function deepFreeze(obj) {
  if (obj && typeof obj === 'object') {
    Object.keys(obj).forEach(k => deepFreeze(obj[k]));
    Object.freeze(obj);
  }
  return obj;
}
deepFreeze(DEFAULT_PROCESSING_PARAMS);
deepFreeze(DEFAULT_HSL_PARAMS);
deepFreeze(DEFAULT_SPLIT_TONING);

/**
 * 创建一份默认参数的深拷贝实例（消费方可安全修改）。
 * 结构化克隆语义：嵌套对象/数组均为独立副本。
 *
 * @returns {Object} 全新的默认参数对象
 */
function createDefaultParams() {
  return structuredClone(DEFAULT_PROCESSING_PARAMS);
}

// ============================================================================
// 参数构建
// ============================================================================

/**
 * 构建导出参数
 * 
 * 从预设和覆盖值构建完整的处理参数
 * 
 * @param {Object|null} preset - 预设对象 (可选)
 * @param {Object} overrides - 覆盖值
 * @returns {Object} 完整的处理参数
 */
function buildExportParams(preset, overrides = {}) {
  // 从默认值开始（深拷贝，避免消费方原地修改污染全局默认）
  const params = createDefaultParams();

  // 应用预设（深合并嵌套对象，避免整体替换丢兄弟字段）
  if (preset) {
    let presetParams;
    if (typeof preset === 'string') {
      try {
        presetParams = JSON.parse(preset);
      } catch (e) {
        console.warn('[filmLabExport] preset JSON 解析失败，已忽略 preset:', e.message);
        presetParams = null;
      }
    } else {
      presetParams = preset;
    }
    if (presetParams) mergeDeep(params, presetParams);
  }

  // 应用覆盖值（同样深合并）
  mergeDeep(params, overrides);

  // 先迁移（保留原始 version 字段供 migrateParams 判定分支），再盖章最新版本号
  const migrated = migrateParams(params);
  migrated.version = PARAMS_VERSION;
  return migrated;
}

/**
 * 深合并：将 src 的字段合并到 dst，嵌套对象递归合并（而非整体替换）。
 * 数组按索引合并（src 提供则覆盖元素），null/undefined 跳过。
 *
 * P0-11: 数组元素深拷贝，避免 dst[key]=sv 共享 src 数组引用导致调用方修改返回值污染输入。
 * 同时当 dv 不是对象时（dst 缺该字段），对 sv 做深拷贝而非引用赋值，避免嵌套数组/对象共享。
 */
function mergeDeep(dst, src) {
  if (!src || typeof src !== 'object') return dst;
  for (const key of Object.keys(src)) {
    const sv = src[key];
    const dv = dst[key];
    if (Array.isArray(sv)) {
      // P0-11: 数组深拷贝（元素为对象时递归拷贝，避免共享引用）
      dst[key] = sv.map(item => (item && typeof item === 'object' ? mergeDeep({}, item) : item));
    } else if (sv && typeof sv === 'object') {
      if (dv && typeof dv === 'object' && !Array.isArray(dv)) {
        // 双方都是普通对象：递归合并
        mergeDeep(dv, sv);
      } else {
        // dv 不存在或不是对象：深拷贝 sv（避免共享嵌套数组/对象引用）
        dst[key] = mergeDeep({}, sv);
      }
    } else {
      dst[key] = sv;
    }
  }
  return dst;
}

/**
 * 从照片记录提取处理参数
 * 
 * @param {Object} photo - 照片数据库记录
 * @returns {Object} 处理参数
 */
function getPhotoProcessingParams(photo) {
  if (!photo) {
    return { ...DEFAULT_PROCESSING_PARAMS };
  }
  
  let params;
  
  if (photo.processing_params) {
    params = typeof photo.processing_params === 'string'
      ? JSON.parse(photo.processing_params)
      : photo.processing_params;
  } else {
    params = {};
  }
  
  // 合并默认值
  return buildExportParams(null, params);
}

// ============================================================================
// 参数验证
// ============================================================================

/**
 * 验证导出参数
 * 
 * @param {Object} params - 处理参数
 * @returns {{ valid: boolean, errors: string[] }} 验证结果
 */
function validateExportParams(params) {
  const errors = [];
  
  // 数值范围验证
  const rangeChecks = [
    { key: 'exposure', min: -100, max: 100 },
    { key: 'contrast', min: -100, max: 100 },
    { key: 'highlights', min: -100, max: 100 },
    { key: 'shadows', min: -100, max: 100 },
    { key: 'whites', min: -100, max: 100 },
    { key: 'blacks', min: -100, max: 100 },
    { key: 'temp', min: -100, max: 100 },
    { key: 'tint', min: -100, max: 100 },
    { key: 'red', min: 0.05, max: 50 },
    { key: 'green', min: 0.05, max: 50 },
    { key: 'blue', min: 0.05, max: 50 },
    { key: 'lut1Intensity', min: 0, max: 1 },
    { key: 'lut2Intensity', min: 0, max: 1 },
    { key: 'rotation', min: -360, max: 360 },
  ];
  
  for (const { key, min, max } of rangeChecks) {
    const value = params[key];
    if (value !== undefined && value !== null) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`${key} must be a finite number`);
      } else if (value < min || value > max) {
        errors.push(`${key} must be between ${min} and ${max}`);
      }
    }
  }
  
  // 枚举值验证
  if (params.inversionMode && !['linear', 'log'].includes(params.inversionMode)) {
    errors.push('inversionMode must be "linear" or "log"');
  }
  
  // 裁剪区域验证
  if (params.cropRect) {
    const { x, y, w, h } = params.cropRect;
    if (x < 0 || x > 1 || y < 0 || y > 1 || w <= 0 || w > 1 || h <= 0 || h > 1) {
      errors.push('cropRect values must be normalized (0-1)');
    }
    if (x + w > 1.01 || y + h > 1.01) { // 允许微小浮点误差
      errors.push('cropRect extends beyond image bounds');
    }
  }
  
  // 曲线验证
  if (params.curves) {
    for (const channel of ['rgb', 'red', 'green', 'blue']) {
      const curve = params.curves[channel];
      if (curve && Array.isArray(curve)) {
        for (const point of curve) {
          if (typeof point.x !== 'number' || typeof point.y !== 'number') {
            errors.push(`curves.${channel} contains invalid point`);
            break;
          }
          if (point.x < 0 || point.x > 255 || point.y < 0 || point.y > 255) {
            errors.push(`curves.${channel} point out of range (0-255)`);
            break;
          }
        }
      }
    }
  }
  
  // 全局饱和度验证
  if (params.saturation !== undefined && params.saturation !== null) {
    if (typeof params.saturation !== 'number' || !Number.isFinite(params.saturation)) {
      errors.push('saturation must be a finite number');
    } else if (params.saturation < -100 || params.saturation > 100) {
      errors.push('saturation must be between -100 and 100');
    }
  }
  
  // HSL 验证 (兼容 hslParams 和旧 hsl 字段名)
  // P0-9: 前置 typeof / Number.isFinite 检查，防止 NaN 通过（NaN < -180 为 false）
  const hslData = params.hslParams || params.hsl;
  if (hslData) {
    const hslChannels = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];
    for (const channel of hslChannels) {
      const hsl = hslData[channel];
      if (hsl) {
        // hue: -180..180
        if (hsl.hue !== undefined && hsl.hue !== null) {
          if (typeof hsl.hue !== 'number' || !Number.isFinite(hsl.hue)) {
            errors.push(`hslParams.${channel}.hue must be a finite number`);
          } else if (hsl.hue < -180 || hsl.hue > 180) {
            errors.push(`hslParams.${channel}.hue must be between -180 and 180`);
          }
        }
        // saturation: -100..100
        if (hsl.saturation !== undefined && hsl.saturation !== null) {
          if (typeof hsl.saturation !== 'number' || !Number.isFinite(hsl.saturation)) {
            errors.push(`hslParams.${channel}.saturation must be a finite number`);
          } else if (hsl.saturation < -100 || hsl.saturation > 100) {
            errors.push(`hslParams.${channel}.saturation must be between -100 and 100`);
          }
        }
        // luminance: -100..100
        if (hsl.luminance !== undefined && hsl.luminance !== null) {
          if (typeof hsl.luminance !== 'number' || !Number.isFinite(hsl.luminance)) {
            errors.push(`hslParams.${channel}.luminance must be a finite number`);
          } else if (hsl.luminance < -100 || hsl.luminance > 100) {
            errors.push(`hslParams.${channel}.luminance must be between -100 and 100`);
          }
        }
      }
    }
  }

  // P0-9: splitToning 验证（之前完全跳过，依赖 filmLabSplitTone.validateSplitToneParams）
  if (params.splitToning) {
    const stResult = validateSplitToneParams(params.splitToning);
    for (const e of stResult.errors) {
      errors.push(`splitToning.${e}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// 参数迁移
// ============================================================================

/**
 * 迁移旧版本参数到当前版本
 * 
 * @param {Object} params - 原始参数
 * @returns {Object} 迁移后的参数
 */
function migrateParams(params) {
  // 注意：调用方（buildExportParams）现在在 migrate 之后才盖章 version，
  // 这里读取的是数据自身的原始版本号，迁移分支可正常执行
  const version = params.version || 1;
  const migrated = { ...params };

  // v1 -> v2: 添加 HSL 和 splitToning
  if (version < 2) {
    if (!migrated.hslParams && !migrated.hsl) {
      migrated.hslParams = structuredClone(DEFAULT_HSL_PARAMS);
    }
    if (!migrated.splitToning) {
      migrated.splitToning = structuredClone(DEFAULT_SPLIT_TONING);
    }
    migrated.version = 2;
  }

  // v2 -> v3: 统一字段命名 + 添加 saturation
  if (version < 3) {
    migrated.saturation = migrated.saturation ?? 0;
    migrated.version = 3;
  }

  // === 兼容性映射：hsl → hslParams ===
  if (migrated.hsl && !migrated.hslParams) {
    migrated.hslParams = migrated.hsl;
    delete migrated.hsl;
  } else if (migrated.hsl) {
    delete migrated.hsl; // 优先 hslParams
  }

  // === 旧 HSL 结构迁移 (按属性分组 → 按通道分组) ===
  if (migrated.hslParams && migrated.hslParams.hue && typeof migrated.hslParams.hue === 'object'
      && !migrated.hslParams.red) {
    migrated.hslParams = migrateOldHSLFormat(migrated.hslParams);
  }

  // === 旧 splitToning 结构迁移 (flat → nested) ===
  if (migrated.splitToning && ('highlightHue' in migrated.splitToning || 'shadowHue' in migrated.splitToning)) {
    migrated.splitToning = migrateOldSplitToningFormat(migrated.splitToning);
  }

  // 确保所有必需字段存在（深拷贝，避免返回的嵌套对象与模块常量共享引用）
  migrated.hslParams = migrated.hslParams || structuredClone(DEFAULT_HSL_PARAMS);
  migrated.splitToning = migrated.splitToning || structuredClone(DEFAULT_SPLIT_TONING);
  migrated.curves = migrated.curves || structuredClone(DEFAULT_CURVES);
  migrated.cropRect = migrated.cropRect || structuredClone(DEFAULT_CROP_RECT);

  return migrated;
}

/**
 * 迁移旧版 HSL 格式：按属性分组 → 按通道分组
 * 旧: { hue: {red:0,...}, saturation: {red:0,...}, luminance: {red:0,...} }
 * 新: { red: {hue:0, saturation:0, luminance:0}, ... }
 * 同时处理 aqua→cyan 通道名映射
 */
function migrateOldHSLFormat(oldHSL) {
  const CHANNEL_MAP = { aqua: 'cyan' }; // 旧名→新名
  // 仅遍历数据中实际存在的通道，避免 aqua 与 cyan 双重迭代导致 aqua 值被 cyan 覆盖清零
  const sourceChannels = new Set([
    ...Object.keys(oldHSL.hue || {}),
    ...Object.keys(oldHSL.saturation || {}),
    ...Object.keys(oldHSL.luminance || {}),
  ]);
  const result = structuredClone(DEFAULT_HSL_PARAMS);

  for (const ch of sourceChannels) {
    const canonicalCh = CHANNEL_MAP[ch] || ch;
    if (!DEFAULT_HSL_PARAMS[canonicalCh]) continue;

    result[canonicalCh] = {
      hue: (oldHSL.hue && oldHSL.hue[ch]) || 0,
      saturation: (oldHSL.saturation && oldHSL.saturation[ch]) || 0,
      luminance: (oldHSL.luminance && oldHSL.luminance[ch]) || 0,
    };
  }
  return result;
}

/**
 * 迁移旧版 splitToning 格式：flat → nested 3-zone
 * 旧: { highlightHue, highlightSaturation, shadowHue, shadowSaturation, balance }
 * 新: { highlights: {hue, saturation}, midtones: {hue, saturation}, shadows: {hue, saturation}, balance }
 */
function migrateOldSplitToningFormat(old) {
  return {
    highlights: { hue: old.highlightHue || 0, saturation: old.highlightSaturation || 0 },
    midtones: { hue: 0, saturation: 0 },
    shadows: { hue: old.shadowHue || 0, saturation: old.shadowSaturation || 0 },
    balance: old.balance ?? 0,
  };
}

// ============================================================================
// 参数比较
// ============================================================================

/**
 * 比较两组参数是否有实质性差异
 * 
 * @param {Object} params1 - 参数组 1
 * @param {Object} params2 - 参数组 2
 * @returns {boolean} 是否有差异
 */
function hasParamsDifference(params1, params2) {
  const p1 = buildExportParams(null, params1);
  const p2 = buildExportParams(null, params2);
  
  // 简单字段比较
  const simpleFields = [
    'inverted', 'inversionMode', 'filmCurveEnabled', 'filmCurveProfile',
    'red', 'green', 'blue', 'temp', 'tint',
    'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
    'saturation',
    'rotation', 'lut1', 'lut1Intensity', 'lut2', 'lut2Intensity',
    'baseMode', 'baseRed', 'baseGreen', 'baseBlue',
    'baseDensityR', 'baseDensityG', 'baseDensityB',
    'densityLevelsEnabled',
  ];
  
  for (const field of simpleFields) {
    if (p1[field] !== p2[field]) {
      return true;
    }
  }
  
  // 裁剪区域比较 (允许微小误差)
  const cropFields = ['x', 'y', 'w', 'h'];
  for (const f of cropFields) {
    if (Math.abs((p1.cropRect?.[f] || 0) - (p2.cropRect?.[f] || 0)) > 0.001) {
      return true;
    }
  }
  
  // 曲线比较 (P0-10: 用 stableSerializeParams 替代 JSON.stringify，键序无关)
  if (stableSerializeParams(p1.curves) !== stableSerializeParams(p2.curves)) {
    return true;
  }

  // HSL 比较 (统一使用 hslParams)
  if (stableSerializeParams(p1.hslParams) !== stableSerializeParams(p2.hslParams)) {
    return true;
  }

  // 分离色调比较
  if (stableSerializeParams(p1.splitToning) !== stableSerializeParams(p2.splitToning)) {
    return true;
  }

  return false;
}

/**
 * 序列化参数为 JSON 字符串 (用于数据库存储)
 * 
 * @param {Object} params - 处理参数
 * @returns {string} JSON 字符串
 */
function serializeParams(params) {
  const validated = buildExportParams(null, params);
  return JSON.stringify(validated);
}

/**
 * 反序列化参数
 * 
 * @param {string|Object} data - JSON 字符串或对象
 * @returns {Object} 处理参数
 */
function deserializeParams(data) {
  if (!data) {
    return createDefaultParams();
  }

  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  return buildExportParams(null, parsed);
}

// ============================================================================
// 模块导出
// ============================================================================

const _sharedExports = {
  // 参数版本
  PARAMS_VERSION,
  
  // 默认值
  DEFAULT_PROCESSING_PARAMS,
  DEFAULT_HSL_PARAMS,
  DEFAULT_SPLIT_TONING,
  createDefaultParams,

  // 构建和验证
  buildExportParams,
  validateExportParams,
  getPhotoProcessingParams,

  // 迁移
  migrateParams,
  mergeDeep,

  // 比较和序列化
  hasParamsDifference,
  serializeParams,
  deserializeParams,
};
export const { PARAMS_VERSION, DEFAULT_PROCESSING_PARAMS, DEFAULT_HSL_PARAMS, DEFAULT_SPLIT_TONING, createDefaultParams, buildExportParams, validateExportParams, getPhotoProcessingParams, migrateParams, mergeDeep, hasParamsDifference, serializeParams, deserializeParams } = _sharedExports;
export default _sharedExports;
