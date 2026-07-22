/**
 * 源路径解析器 - 统一管理图片文件路径选择
 * 
 * @module sourcePathResolver
 * @description 
 * 核心原则:
 * 1. sourceType 必须与实际加载文件匹配
 * 2. 不允许隐式回退到不同类型的文件
 * 3. 如无匹配文件，返回 null 而非错误类型文件
 * 
 * 这是五条渲染管线的统一入口，确保一致性:
 * - Client CPU Preview
 * - Client WebGL Preview
 * - Server Preview
 * - Server Export
 * - GPU Export
 */

// ============================================================================
// 常量定义
// ============================================================================

/**
 * 源类型枚举
 * @readonly
 * @enum {string}
 */
const SOURCE_TYPE = {
  /** 原始文件（底片扫描原始数据） */
  ORIGINAL: 'original',
  /** 负片（可能经过初步处理） */
  NEGATIVE: 'negative',
  /** 正片（已反转/调色的成品） */
  POSITIVE: 'positive'
};

/**
 * 源路径字段映射
 * @readonly
 */
const SOURCE_PATH_FIELDS = {
  [SOURCE_TYPE.ORIGINAL]: 'original_rel_path',
  [SOURCE_TYPE.NEGATIVE]: 'negative_rel_path',
  [SOURCE_TYPE.POSITIVE]: 'positive_rel_path'
};

// ============================================================================
// 核心函数
// ============================================================================

/**
 * 获取严格匹配的源文件路径
 * 
 * @param {Object} photo - 照片记录对象
 * @param {string} photo.original_rel_path - 原始文件相对路径
 * @param {string} photo.negative_rel_path - 负片文件相对路径
 * @param {string} photo.positive_rel_path - 正片文件相对路径
 * @param {string} photo.full_rel_path - 完整尺寸文件相对路径（兼容旧数据）
 * @param {string} sourceType - 期望的源类型 (SOURCE_TYPE 枚举值)
 * @param {Object} [options] - 选项
 * @param {boolean} [options.allowFallbackWithinType=true] - 是否允许同类型内回退
 * @param {boolean} [options.allowCrossTypeFallback=false] - 是否允许跨类型回退（危险）
 * @returns {{ path: string|null, actualType: string|null, matched: boolean, warning: string|null }}
 */
function getStrictSourcePath(photo, sourceType, options = {}) {
  const { 
    allowFallbackWithinType = true,
    allowCrossTypeFallback = false 
  } = options;
  
  if (!photo) {
    return { 
      path: null, 
      actualType: null, 
      matched: false, 
      warning: 'Photo object is null or undefined' 
    };
  }
  
  // 标准化 sourceType
  const normalizedType = (sourceType || '').toLowerCase();
  
  switch (normalizedType) {
    case SOURCE_TYPE.POSITIVE:
      // 正片模式：必须严格使用正片文件
      if (photo.positive_rel_path) {
        return { 
          path: photo.positive_rel_path, 
          actualType: SOURCE_TYPE.POSITIVE, 
          matched: true,
          warning: null
        };
      }
      
      // 正片模式下不允许回退到负片（这是 bug 的根源）
      if (allowCrossTypeFallback) {
        // 仅在显式允许时才回退（应该极少使用）
        const fallback = photo.full_rel_path || photo.negative_rel_path || photo.original_rel_path;
        if (fallback) {
          const fallbackType = photo.full_rel_path ? 'full' : 
                               photo.negative_rel_path ? SOURCE_TYPE.NEGATIVE : 
                               SOURCE_TYPE.ORIGINAL;
          return {
            path: fallback,
            actualType: fallbackType,
            matched: false,
            warning: `Positive file not found, falling back to ${fallbackType} (DANGEROUS)`
          };
        }
      }
      
      // 无正片文件，返回 null
      return { 
        path: null, 
        actualType: null, 
        matched: false,
        warning: 'No positive file available for positive mode'
      };
      
    case SOURCE_TYPE.NEGATIVE:
      // 负片模式：优先 negative_rel_path，可回退到 original_rel_path
      if (photo.negative_rel_path) {
        return { 
          path: photo.negative_rel_path, 
          actualType: SOURCE_TYPE.NEGATIVE, 
          matched: true,
          warning: null
        };
      }
      
      if (allowFallbackWithinType && photo.original_rel_path) {
        return { 
          path: photo.original_rel_path, 
          actualType: SOURCE_TYPE.ORIGINAL, 
          matched: true, // original 可视为 negative 的同类
          warning: 'Using original file as negative source'
        };
      }
      
      // 兼容旧数据
      if (allowFallbackWithinType && photo.full_rel_path) {
        return {
          path: photo.full_rel_path,
          actualType: 'full',
          matched: true,
          warning: 'Using full_rel_path as negative source (legacy)'
        };
      }
      
      return { 
        path: null, 
        actualType: null, 
        matched: false,
        warning: 'No negative/original file available'
      };
      
    case SOURCE_TYPE.ORIGINAL:
    default:
      // 原始模式：优先 original，可回退到 negative
      if (photo.original_rel_path) {
        return { 
          path: photo.original_rel_path, 
          actualType: SOURCE_TYPE.ORIGINAL, 
          matched: true,
          warning: null
        };
      }
      
      if (allowFallbackWithinType && photo.negative_rel_path) {
        return { 
          path: photo.negative_rel_path, 
          actualType: SOURCE_TYPE.NEGATIVE, 
          matched: true,
          warning: 'Using negative file as original source'
        };
      }
      
      // 兼容旧数据
      if (allowFallbackWithinType && photo.full_rel_path) {
        return {
          path: photo.full_rel_path,
          actualType: 'full',
          matched: true,
          warning: 'Using full_rel_path as source (legacy)'
        };
      }
      
      return { 
        path: null, 
        actualType: null, 
        matched: false,
        warning: 'No source file available'
      };
  }
}

/**
 * 根据源类型和用户设置计算有效反转状态
 * 
 * 核心逻辑:
 * - positive 模式：永远不反转（文件已经是正片）
 * - negative/original 模式：遵循用户 inverted 设置
 * 
 * @param {string} sourceType - 源类型
 * @param {boolean} userInverted - 用户的反转设置
 * @returns {boolean} 是否需要反转
 */
function getEffectiveInverted(sourceType, userInverted) {
  // 正片模式永远不反转
  if (sourceType === SOURCE_TYPE.POSITIVE) {
    return false;
  }
  // 其他模式遵循用户设置
  return Boolean(userInverted);
}

/**
 * 验证 sourceType 和加载的文件是否匹配
 * 
 * @param {string} sourceType - 期望的源类型
 * @param {string} actualPath - 实际加载的路径
 * @param {Object} photo - 照片记录
 * @returns {{ valid: boolean, message: string }}
 */
function validateSourceMatch(sourceType, actualPath, photo) {
  if (!actualPath) {
    return { valid: false, message: 'No file loaded' };
  }
  
  const normalizedType = (sourceType || '').toLowerCase();
  
  if (normalizedType === SOURCE_TYPE.POSITIVE) {
    // 正片模式必须加载正片文件
    if (actualPath === photo.positive_rel_path) {
      return { valid: true, message: 'Positive file correctly loaded' };
    }
    return { 
      valid: false, 
      message: `MISMATCH: sourceType=positive but loaded file is not positive_rel_path` 
    };
  }
  
  if (normalizedType === SOURCE_TYPE.NEGATIVE) {
    if (actualPath === photo.negative_rel_path || actualPath === photo.original_rel_path) {
      return { valid: true, message: 'Negative/Original file correctly loaded' };
    }
    // full_rel_path 可接受作为负片
    if (actualPath === photo.full_rel_path) {
      return { valid: true, message: 'Legacy full_rel_path used as negative' };
    }
    return { valid: false, message: 'Unexpected file for negative mode' };
  }
  
  // original 模式较宽松
  return { valid: true, message: 'Original mode - any source acceptable' };
}

/**
 * 检查照片是否可以使用指定的源类型
 * 
 * @param {Object} photo - 照片记录
 * @param {string} sourceType - 源类型
 * @returns {boolean}
 */
function canUseSourceType(photo, sourceType) {
  if (!photo) return false;
  
  const normalizedType = (sourceType || '').toLowerCase();
  
  switch (normalizedType) {
    case SOURCE_TYPE.POSITIVE:
      return Boolean(photo.positive_rel_path);
    case SOURCE_TYPE.NEGATIVE:
      return Boolean(photo.negative_rel_path || photo.original_rel_path || photo.full_rel_path);
    case SOURCE_TYPE.ORIGINAL:
    default:
      return Boolean(photo.original_rel_path || photo.negative_rel_path || photo.full_rel_path);
  }
}

/**
 * 获取照片可用的所有源类型
 * 
 * @param {Object} photo - 照片记录
 * @returns {string[]} 可用的源类型列表
 */
function getAvailableSourceTypes(photo) {
  const available = [];
  
  if (!photo) return available;
  
  if (photo.positive_rel_path) {
    available.push(SOURCE_TYPE.POSITIVE);
  }
  if (photo.negative_rel_path || photo.original_rel_path || photo.full_rel_path) {
    available.push(SOURCE_TYPE.NEGATIVE);
    available.push(SOURCE_TYPE.ORIGINAL);
  }
  
  return available;
}

// ============================================================================
// 模块导出
// ============================================================================

const _sharedExports = {
  // 常量
  SOURCE_TYPE,
  SOURCE_PATH_FIELDS,
  
  // 核心函数
  getStrictSourcePath,
  getEffectiveInverted,
  validateSourceMatch,
  canUseSourceType,
  getAvailableSourceTypes
};
export const { SOURCE_TYPE, SOURCE_PATH_FIELDS, getStrictSourcePath, getEffectiveInverted, validateSourceMatch, canUseSourceType, getAvailableSourceTypes } = _sharedExports;
export default _sharedExports;
