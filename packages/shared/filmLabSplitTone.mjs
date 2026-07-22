/**
 * FilmLab 分离色调模块
 * 
 * @module filmLabSplitTone
 * @description 实现高光/阴影分区着色
 * 
 * 功能特性：
 * - 高光着色 (hue/saturation)
 * - 阴影着色 (hue/saturation)
 * - 平衡滑块控制过渡
 * - 3 区分割: 阴影 / 中间调 / 高光
 */

// ============================================================================
// 常量定义
// ============================================================================

/** 默认分离色调参数 */
const DEFAULT_SPLIT_TONE_PARAMS = {
  highlights: {
    hue: 30,          // 高光色相 (0-360)
    saturation: 0,    // 高光饱和度 (0-100)
  },
  midtones: {
    hue: 0,           // 中间调色相 (0-360)
    saturation: 0,    // 中间调饱和度 (0-100)
  },
  shadows: {
    hue: 220,         // 阴影色相 (0-360)
    saturation: 0,    // 阴影饱和度 (0-100)
  },
  balance: 0,         // 平衡 (-100 到 100，正值偏向高光)
};

/** 亮度阈值配置 */
const LUMINANCE_CONFIG = {
  shadowEnd: 0.25,      // 阴影区结束
  highlightStart: 0.75, // 高光区开始
  // 过渡区: 0.25 - 0.75 (中间调)
};

// ============================================================================
// 核心算法
// ============================================================================

/**
 * 计算像素亮度 (Rec. 709)
 * 
 * @param {number} r - 红色 (0-255)
 * @param {number} g - 绿色 (0-255)
 * @param {number} b - 蓝色 (0-255)
 * @returns {number} 亮度 (0-1)
 */
function calculateLuminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * HSL 转 RGB (内联版本)
 * 
 * @param {number} h - 色相 (0-360)
 * @param {number} s - 饱和度 (0-1)
 * @param {number} l - 亮度 (0-1)
 * @returns {[number, number, number]} [R, G, B] (0-255)
 */
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  h /= 360;
  
  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }
  
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ];
}

/**
 * 计算分区权重 (带平衡调整)
 *
 * 单位分解 (partition of unity)：shadow + midtone + highlight ≡ 1，
 * 全域连续（smoothstep 互补过渡），避免过渡带权重不守恒/跳变导致的色带。
 * 参照 darktable split-toning 的互补权重原则。
 *
 * @param {number} luminance - 亮度 (0-1)
 * @param {number} balance - 平衡值 (-100 到 100)
 * @returns {{ shadow: number, midtone: number, highlight: number }} 权重
 */
function calculateZoneWeights(luminance, balance = 0) {
  // 根据 balance 调整过渡点；钳制在固定边界内，保证过渡区宽度 > 0
  const balanceOffset = balance / 200; // -0.5 到 0.5
  const midpoint = Math.min(
    Math.max(0.5 + balanceOffset, LUMINANCE_CONFIG.shadowEnd + 0.05),
    LUMINANCE_CONFIG.highlightStart - 0.05
  );

  let shadowWeight = 0;
  let highlightWeight = 0;

  // 阴影区权重：[shadowEnd, midpoint] 内从 1 平滑降到 0
  if (luminance <= LUMINANCE_CONFIG.shadowEnd) {
    shadowWeight = 1;
  } else if (luminance < midpoint) {
    const t = (luminance - LUMINANCE_CONFIG.shadowEnd) / (midpoint - LUMINANCE_CONFIG.shadowEnd);
    shadowWeight = 1 - smoothstep(t);
  }

  // 高光区权重：[midpoint, highlightStart] 内从 0 平滑升到 1
  if (luminance >= LUMINANCE_CONFIG.highlightStart) {
    highlightWeight = 1;
  } else if (luminance > midpoint) {
    const t = (luminance - midpoint) / (LUMINANCE_CONFIG.highlightStart - midpoint);
    highlightWeight = smoothstep(t);
  }

  // 中间调取余量，保证三者之和恒为 1
  const midtoneWeight = 1 - shadowWeight - highlightWeight;

  return { shadow: shadowWeight, midtone: midtoneWeight, highlight: highlightWeight };
}

/**
 * 平滑插值函数 (Hermite)
 * 
 * @param {number} t - 输入 (0-1)
 * @returns {number} 平滑输出 (0-1)
 */
function smoothstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

/**
 * 检查分离色调参数是否为默认值
 * 
 * @param {Object} params - 分离色调参数
 * @returns {boolean} 是否为默认
 */
function isDefaultSplitTone(params) {
  if (!params) return true;
  
  const { highlights, midtones, shadows } = params;
  
  // 只检查饱和度，因为色相在饱和度为0时无意义
  if (highlights?.saturation && highlights.saturation !== 0) return false;
  if (midtones?.saturation && midtones.saturation !== 0) return false;
  if (shadows?.saturation && shadows.saturation !== 0) return false;
  
  return true;
}

/**
 * 应用分离色调到单个像素
 * 
 * @param {number} r - 红色 (0-255)
 * @param {number} g - 绿色 (0-255)
 * @param {number} b - 蓝色 (0-255)
 * @param {Object} params - 分离色调参数
 * @returns {[number, number, number]} 调整后的 [R, G, B] (0-255)
 */
function applySplitTone(r, g, b, params = {}) {
  // 快速检查：如果参数为默认值，直接返回
  if (isDefaultSplitTone(params)) {
    return [r, g, b];
  }
  
  const { highlights = {}, midtones = {}, shadows = {}, balance = 0 } = params;
  const highlightHue = highlights.hue ?? 30;
  const highlightSat = (highlights.saturation ?? 0) / 100;
  const midtoneHue = midtones.hue ?? 0;
  const midtoneSat = (midtones.saturation ?? 0) / 100;
  const shadowHue = shadows.hue ?? 220;
  const shadowSat = (shadows.saturation ?? 0) / 100;
  
  // 计算亮度
  const luminance = calculateLuminance(r, g, b);
  
  // 计算分区权重
  const weights = calculateZoneWeights(luminance, balance);
  
  // 生成着色颜色
  const highlightColor = hslToRgb(highlightHue, 1, 0.5);
  const midtoneColor = hslToRgb(midtoneHue, 1, 0.5);
  const shadowColor = hslToRgb(shadowHue, 1, 0.5);
  
  // 混合（顺序 shadow → midtone → highlight，与 GPU shader 保持一致；
  // 权重为单位分解，顺序差异已最小化）
  let outR = r;
  let outG = g;
  let outB = b;

  // 阴影着色
  if (shadowSat > 0 && weights.shadow > 0) {
    const strength = shadowSat * weights.shadow;
    outR = outR + (shadowColor[0] - outR) * strength * 0.3;
    outG = outG + (shadowColor[1] - outG) * strength * 0.3;
    outB = outB + (shadowColor[2] - outB) * strength * 0.3;
  }

  // 中间调着色
  if (midtoneSat > 0 && weights.midtone > 0) {
    const strength = midtoneSat * weights.midtone;
    outR = outR + (midtoneColor[0] - outR) * strength * 0.3;
    outG = outG + (midtoneColor[1] - outG) * strength * 0.3;
    outB = outB + (midtoneColor[2] - outB) * strength * 0.3;
  }

  // 高光着色
  if (highlightSat > 0 && weights.highlight > 0) {
    const strength = highlightSat * weights.highlight;
    outR = outR + (highlightColor[0] - outR) * strength * 0.3;
    outG = outG + (highlightColor[1] - outG) * strength * 0.3;
    outB = outB + (highlightColor[2] - outB) * strength * 0.3;
  }
  
  // 钳制输出
  return [
    Math.max(0, Math.min(255, Math.round(outR))),
    Math.max(0, Math.min(255, Math.round(outG))),
    Math.max(0, Math.min(255, Math.round(outB))),
  ];
}

/**
 * 批量应用分离色调到像素数组
 * 
 * @param {Uint8Array|Uint8ClampedArray} data - 像素数据 (RGB 或 RGBA)
 * @param {Object} params - 分离色调参数
 * @param {Object} [options] - 选项
 * @param {number} [options.channels=4] - 每像素通道数
 * @returns {Uint8Array} 处理后的数据
 */
function applySplitToneToArray(data, params, options = {}) {
  const channels = options.channels || 4;
  
  if (isDefaultSplitTone(params)) {
    return data;
  }

  // 保留输入类型（Uint8Array 或 Uint8ClampedArray）
  const output = new data.constructor(data.length);
  // Q18: Precompute tint colors once (instead of per-pixel)
  const ctx = prepareSplitTone(params);
  
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    const [rOut, gOut, bOut] = applySplitToneFast(r, g, b, ctx);
    
    output[i] = rOut;
    output[i + 1] = gOut;
    output[i + 2] = bOut;
    
    if (channels === 4) {
      output[i + 3] = data[i + 3]; // 保留 alpha
    }
  }
  
  return output;
}

// ============================================================================
// Q18: Precomputed Split Tone (避免每像素重复 hslToRgb)
// ============================================================================

/**
 * 预计算分离色调参数（tint RGB 颜色等），一帧只需调用一次。
 * 返回的上下文对象传给 applySplitToneFast() 进行逐像素处理。
 *
 * @param {Object} params - 分离色调参数
 * @returns {Object|null} 预计算上下文，如果参数为默认值则返回 null
 */
function prepareSplitTone(params) {
  if (!params || isDefaultSplitTone(params)) return null;

  const { highlights = {}, midtones = {}, shadows = {}, balance = 0 } = params;
  return {
    highlightSat: (highlights.saturation ?? 0) / 100,
    midtoneSat:   (midtones.saturation ?? 0) / 100,
    shadowSat:    (shadows.saturation ?? 0) / 100,
    highlightColor: hslToRgb(highlights.hue ?? 30, 1, 0.5),
    midtoneColor:   hslToRgb(midtones.hue ?? 0, 1, 0.5),
    shadowColor:    hslToRgb(shadows.hue ?? 220, 1, 0.5),
    balance,
  };
}

/**
 * 快速逐像素分离色调（使用预计算的 tint 颜色）。
 * 每像素只做亮度计算 + 区权重 + RGB lerp，避免 hslToRgb 开销。
 *
 * @param {number} r - 红色 (0-255)
 * @param {number} g - 绿色 (0-255)
 * @param {number} b - 蓝色 (0-255)
 * @param {Object} ctx - prepareSplitTone() 返回的上下文
 * @returns {[number, number, number]} 调整后的 [R, G, B] (0-255)
 */
function applySplitToneFast(r, g, b, ctx) {
  if (!ctx) return [r, g, b];

  const luminance = calculateLuminance(r, g, b);
  const weights = calculateZoneWeights(luminance, ctx.balance);

  let outR = r, outG = g, outB = b;

  // 顺序 shadow → midtone → highlight，与 GPU shader 一致
  if (ctx.shadowSat > 0 && weights.shadow > 0) {
    const s = ctx.shadowSat * weights.shadow * 0.3;
    outR += (ctx.shadowColor[0] - outR) * s;
    outG += (ctx.shadowColor[1] - outG) * s;
    outB += (ctx.shadowColor[2] - outB) * s;
  }
  if (ctx.midtoneSat > 0 && weights.midtone > 0) {
    const s = ctx.midtoneSat * weights.midtone * 0.3;
    outR += (ctx.midtoneColor[0] - outR) * s;
    outG += (ctx.midtoneColor[1] - outG) * s;
    outB += (ctx.midtoneColor[2] - outB) * s;
  }
  if (ctx.highlightSat > 0 && weights.highlight > 0) {
    const s = ctx.highlightSat * weights.highlight * 0.3;
    outR += (ctx.highlightColor[0] - outR) * s;
    outG += (ctx.highlightColor[1] - outG) * s;
    outB += (ctx.highlightColor[2] - outB) * s;
  }

  return [
    Math.max(0, Math.min(255, Math.round(outR))),
    Math.max(0, Math.min(255, Math.round(outG))),
    Math.max(0, Math.min(255, Math.round(outB))),
  ];
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 合并分离色调参数
 * 
 * @param {Object} base - 基础参数
 * @param {Object} overlay - 覆盖参数
 * @returns {Object} 合并后的参数
 */
function mergeSplitToneParams(base, overlay) {
  return {
    highlights: {
      hue: overlay?.highlights?.hue ?? base?.highlights?.hue ?? DEFAULT_SPLIT_TONE_PARAMS.highlights.hue,
      saturation: overlay?.highlights?.saturation ?? base?.highlights?.saturation ?? DEFAULT_SPLIT_TONE_PARAMS.highlights.saturation,
    },
    midtones: {
      hue: overlay?.midtones?.hue ?? base?.midtones?.hue ?? DEFAULT_SPLIT_TONE_PARAMS.midtones?.hue ?? 0,
      saturation: overlay?.midtones?.saturation ?? base?.midtones?.saturation ?? DEFAULT_SPLIT_TONE_PARAMS.midtones?.saturation ?? 0,
    },
    shadows: {
      hue: overlay?.shadows?.hue ?? base?.shadows?.hue ?? DEFAULT_SPLIT_TONE_PARAMS.shadows.hue,
      saturation: overlay?.shadows?.saturation ?? base?.shadows?.saturation ?? DEFAULT_SPLIT_TONE_PARAMS.shadows.saturation,
    },
    balance: overlay?.balance ?? base?.balance ?? DEFAULT_SPLIT_TONE_PARAMS.balance,
  };
}

/**
 * 验证分离色调参数
 * 
 * @param {Object} params - 分离色调参数
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSplitToneParams(params) {
  const errors = [];
  
  if (!params || typeof params !== 'object') {
    return { valid: true, errors: [] };
  }
  
  // 验证高光
  if (params.highlights) {
    if (params.highlights.hue !== undefined) {
      if (typeof params.highlights.hue !== 'number' || params.highlights.hue < 0 || params.highlights.hue > 360) {
        errors.push('highlights.hue must be between 0 and 360');
      }
    }
    if (params.highlights.saturation !== undefined) {
      if (typeof params.highlights.saturation !== 'number' || params.highlights.saturation < 0 || params.highlights.saturation > 100) {
        errors.push('highlights.saturation must be between 0 and 100');
      }
    }
  }
  
  // 验证阴影
  if (params.shadows) {
    if (params.shadows.hue !== undefined) {
      if (typeof params.shadows.hue !== 'number' || params.shadows.hue < 0 || params.shadows.hue > 360) {
        errors.push('shadows.hue must be between 0 and 360');
      }
    }
    if (params.shadows.saturation !== undefined) {
      if (typeof params.shadows.saturation !== 'number' || params.shadows.saturation < 0 || params.shadows.saturation > 100) {
        errors.push('shadows.saturation must be between 0 and 100');
      }
    }
  }

  // 验证中间调
  if (params.midtones) {
    if (params.midtones.hue !== undefined) {
      if (typeof params.midtones.hue !== 'number' || params.midtones.hue < 0 || params.midtones.hue > 360) {
        errors.push('midtones.hue must be between 0 and 360');
      }
    }
    if (params.midtones.saturation !== undefined) {
      if (typeof params.midtones.saturation !== 'number' || params.midtones.saturation < 0 || params.midtones.saturation > 100) {
        errors.push('midtones.saturation must be between 0 and 100');
      }
    }
  }
  
  // 验证平衡
  if (params.balance !== undefined) {
    if (typeof params.balance !== 'number' || params.balance < -100 || params.balance > 100) {
      errors.push('balance must be between -100 and 100');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// 预设
// ============================================================================

/** 分离色调预设 */
const SPLIT_TONE_PRESETS = {
  // 经典胶片风格
  warmCoolFilm: {
    name: '暖高光冷阴影',
    highlights: { hue: 40, saturation: 20 },
    shadows: { hue: 230, saturation: 25 },
    balance: 0,
  },
  
  // 青橙电影
  tealOrange: {
    name: '青橙电影',
    highlights: { hue: 30, saturation: 30 },
    shadows: { hue: 190, saturation: 35 },
    balance: -10,
  },
  
  // 复古褪色
  vintageFade: {
    name: '复古褪色',
    highlights: { hue: 50, saturation: 15 },
    shadows: { hue: 200, saturation: 20 },
    balance: 20,
  },
  
  // 冷调
  coolMood: {
    name: '冷调',
    highlights: { hue: 200, saturation: 10 },
    shadows: { hue: 240, saturation: 25 },
    balance: 0,
  },
  
  // 暖调
  warmMood: {
    name: '暖调',
    highlights: { hue: 35, saturation: 20 },
    shadows: { hue: 25, saturation: 15 },
    balance: 0,
  },
};

// ============================================================================
// 模块导出
// ============================================================================

export {
  // 常量
  DEFAULT_SPLIT_TONE_PARAMS,
  LUMINANCE_CONFIG,
  SPLIT_TONE_PRESETS,
  
  // 核心函数
  applySplitTone,
  applySplitToneToArray,
  isDefaultSplitTone,
  
  // Q18: Precomputed per-frame factory (avoids per-pixel hslToRgb)
  prepareSplitTone,
  applySplitToneFast,
  
  // 工具函数
  calculateLuminance,
  calculateZoneWeights,
  smoothstep,
  mergeSplitToneParams,
  validateSplitToneParams,
}