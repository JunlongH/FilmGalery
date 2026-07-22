/**
 * FilmLab HSL 调整模块
 * 
 * @module filmLabHSL
 * @description 实现按色相分区的 HSL (色相/饱和度/明度) 调整
 * 
 * 功能特性：
 * - 8 色相分区 (红/橙/黄/绿/青/蓝/紫/品红)
 * - 每分区独立调整色相偏移、饱和度、明度
 * - 平滑过渡算法，避免色带
 */

// ============================================================================
// 常量定义
// ============================================================================

/**
 * HSL 通道定义
 *
 * hueCenter: 色相中心 (0-360)
 * hueRange: 影响范围 (度数，单侧)
 *
 * P2-1 修复: 相邻通道 range 之和 ≥ 中心距，保证权重构成 (近) 单位分解。
 * 旧定义在 h=90/150/210/300 等中点处总权重仅 0.25 (弱响应区)，
 * 用户调整强度比中心弱 4 倍。Adobe LR HSL 面板保证相邻覆盖无弱区。
 *
 * 精确单位分解要求两侧 range 均等于中心距；由于 range 对称，
 * 取 max(左距, 右距) — 短侧会过覆盖 (total > 1)，由归一化处理。
 */
const HSL_CHANNELS = {
  red:     { hueCenter: 0,   hueRange: 30, name: '红色' },   // 邻: magenta(330,d30) orange(30,d30) → max=30
  orange:  { hueCenter: 30,  hueRange: 30, name: '橙色' },   // 邻: red(0,d30) yellow(60,d30) → max=30
  yellow:  { hueCenter: 60,  hueRange: 60, name: '黄色' },   // 邻: orange(30,d30) green(120,d60) → max=60 (was 30)
  green:   { hueCenter: 120, hueRange: 60, name: '绿色' },   // 邻: yellow(60,d60) cyan(180,d60) → max=60 (was 45)
  cyan:    { hueCenter: 180, hueRange: 60, name: '青色' },   // 邻: green(120,d60) blue(240,d60) → max=60 (was 30)
  blue:    { hueCenter: 240, hueRange: 60, name: '蓝色' },   // 邻: cyan(180,d60) purple(280,d40) → max=60 (was 45)
  purple:  { hueCenter: 280, hueRange: 50, name: '紫色' },   // 邻: blue(240,d40) magenta(330,d50) → max=50 (was 30)
  magenta: { hueCenter: 330, hueRange: 50, name: '品红' },   // 邻: purple(280,d50) red(360,d30) → max=50 (was 30)
};

/** HSL 通道顺序 (用于 UI) */
const HSL_CHANNEL_ORDER = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];

/** 预缓存 HSL_CHANNELS entries (避免每像素 Object.entries 分配) */
const HSL_CHANNELS_ENTRIES = Object.entries(HSL_CHANNELS);

/** 默认 HSL 参数 */
const DEFAULT_HSL_PARAMS = {
  red:     { hue: 0, saturation: 0, luminance: 0 },
  orange:  { hue: 0, saturation: 0, luminance: 0 },
  yellow:  { hue: 0, saturation: 0, luminance: 0 },
  green:   { hue: 0, saturation: 0, luminance: 0 },
  cyan:    { hue: 0, saturation: 0, luminance: 0 },
  blue:    { hue: 0, saturation: 0, luminance: 0 },
  purple:  { hue: 0, saturation: 0, luminance: 0 },
  magenta: { hue: 0, saturation: 0, luminance: 0 },
};

// ============================================================================
// 颜色空间转换
// ============================================================================

/**
 * RGB 转 HSL
 * 
 * @param {number} r - 红色 (0-255)
 * @param {number} g - 绿色 (0-255)
 * @param {number} b - 蓝色 (0-255)
 * @returns {[number, number, number]} [H (0-360), S (0-1), L (0-1)]
 */
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  
  if (max === min) {
    return [0, 0, l]; // 灰色
  }
  
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  
  let h;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    case b:
      h = ((r - g) / d + 4) / 6;
      break;
  }
  
  return [h * 360, s, l];
}

/**
 * HSL 转 RGB
 * 
 * @param {number} h - 色相 (0-360)
 * @param {number} s - 饱和度 (0-1)
 * @param {number} l - 明度 (0-1)
 * @returns {[number, number, number]} [R, G, B] (0-255)
 */
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; // 确保 h 在 0-360
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
  
  const r = hue2rgb(p, q, h + 1/3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1/3);
  
  return [
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
  ];
}

// ============================================================================
// HSL 调整算法
// ============================================================================

/**
 * 计算色相距离 (考虑环形)
 * 
 * @param {number} h1 - 色相 1 (0-360)
 * @param {number} h2 - 色相 2 (0-360)
 * @returns {number} 距离 (0-180)
 */
function hueDistance(h1, h2) {
  const diff = Math.abs(h1 - h2);
  return diff > 180 ? 360 - diff : diff;
}

/**
 * 计算通道影响权重
 * 
 * 使用余弦平滑过渡，避免硬边界
 * 
 * @param {number} hue - 像素色相 (0-360)
 * @param {Object} channel - 通道定义 {hueCenter, hueRange}
 * @returns {number} 权重 (0-1)
 */
function calculateChannelWeight(hue, channel) {
  const distance = hueDistance(hue, channel.hueCenter);
  
  if (distance >= channel.hueRange) {
    return 0;
  }
  
  // 余弦平滑过渡
  const t = distance / channel.hueRange;
  return 0.5 * (1 + Math.cos(t * Math.PI));
}

/**
 * 应用 HSL 调整到单个像素
 * 
 * @param {number} r - 红色 (0-255)
 * @param {number} g - 绿色 (0-255)
 * @param {number} b - 蓝色 (0-255)
 * @param {Object} hslParams - HSL 参数 (各通道的 hue/saturation/luminance)
 * @returns {[number, number, number]} 调整后的 [R, G, B] (0-255)
 */
function applyHSL(r, g, b, hslParams = {}) {
  // 快速检查：如果所有参数都是默认值，直接返回
  if (isDefaultHSL(hslParams)) {
    return [r, g, b];
  }
  
  // 转换到 HSL
  let [h, s, l] = rgbToHsl(r, g, b);

  // 计算各通道的调整
  let hueAdjust = 0;
  let satAdjust = 0;
  let lumAdjust = 0;
  let totalWeight = 0;

  for (const [channelKey, channel] of HSL_CHANNELS_ENTRIES) {
    const params = hslParams[channelKey];
    if (!params) continue;

    const weight = calculateChannelWeight(h, channel);
    if (weight <= 0) continue;

    totalWeight += weight;

    // 色相偏移 (-180 to 180)
    if (params.hue !== 0) {
      hueAdjust += params.hue * weight;
    }

    // 饱和度 (-100 to 100)
    if (params.saturation !== 0) {
      satAdjust += (params.saturation / 100) * weight;
    }

    // 明度 (-100 to 100)
    if (params.luminance !== 0) {
      lumAdjust += (params.luminance / 100) * weight;
    }
  }

  if (totalWeight <= 0) {
    return [r, g, b];
  }

  // P2-1: 归一化权重 — 除以 max(1, totalWeight)
  // 旧版仅在 totalWeight > 1 时除，弱响应区 (total < 1) 不补偿 → 调整强度被低估
  // 现在统一除以 max(1, total)：重叠区缩放，弱区不放大（安全）
  const norm = Math.max(1, totalWeight);
  hueAdjust /= norm;
  satAdjust /= norm;
  lumAdjust /= norm;

  // 连续饱和度斜坡：近灰像素 (s→0) 逐渐衰减色相/饱和度调整，
  // 替代旧版 s<0.05 硬切换（会在近中性区域产生阶跃）。与 GPU hslAdjust.js 一致。
  const rampT = Math.min(Math.max(s / 0.1, 0), 1);
  const satRamp = rampT * rampT * (3 - 2 * rampT);
  hueAdjust *= satRamp;
  satAdjust *= satRamp;

  // 应用调整
  if (hueAdjust !== 0) {
    h = (h + hueAdjust + 360) % 360;
  }

  if (satAdjust !== 0) {
    // 饱和度调整使用乘法混合
    if (satAdjust > 0) {
      s = s + (1 - s) * satAdjust;
    } else {
      s = s * (1 + satAdjust);
    }
    s = Math.max(0, Math.min(1, s));
  }

  if (lumAdjust !== 0) {
    // 明度调整：低饱和像素用线性增量（旧灰像素行为），
    // 高饱和像素用非对称增量，两者之间按 satRamp 连续混合
    const linearDelta = lumAdjust * 0.5;
    const asymDelta = lumAdjust > 0 ? (1 - l) * lumAdjust * 0.5 : l * lumAdjust * 0.5;
    l = Math.max(0, Math.min(1, l + linearDelta + (asymDelta - linearDelta) * satRamp));
  }

  // 转回 RGB
  return hslToRgb(h, s, l);
}

/**
 * 检查 HSL 参数是否为默认值
 * 
 * @param {Object} hslParams - HSL 参数
 * @returns {boolean} 是否为默认
 */
function isDefaultHSL(hslParams) {
  if (!hslParams) return true;
  
  for (const channelKey of HSL_CHANNEL_ORDER) {
    const params = hslParams[channelKey];
    if (params) {
      if (params.hue !== 0 || params.saturation !== 0 || params.luminance !== 0) {
        return false;
      }
    }
  }
  
  return true;
}

/**
 * 批量应用 HSL 到像素数组
 * 
 * @param {Uint8Array|Uint8ClampedArray} data - 像素数据 (RGB 或 RGBA)
 * @param {Object} hslParams - HSL 参数
 * @param {Object} [options] - 选项
 * @param {number} [options.channels=4] - 每像素通道数
 * @returns {Uint8Array} 处理后的数据
 */
function applyHSLToArray(data, hslParams, options = {}) {
  const channels = options.channels || 4;
  
  if (isDefaultHSL(hslParams)) {
    return data;
  }

  // 保留输入类型（Uint8Array 或 Uint8ClampedArray），避免调用方处理两种返回类型
  const output = new data.constructor(data.length);
  
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    const [rOut, gOut, bOut] = applyHSL(r, g, b, hslParams);
    
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
// 预设和工具函数
// ============================================================================

/**
 * 创建单通道 HSL 参数
 * 
 * @param {string} channel - 通道名
 * @param {number} hue - 色相偏移
 * @param {number} saturation - 饱和度
 * @param {number} luminance - 明度
 * @returns {Object} HSL 参数对象
 */
function createSingleChannelHSL(channel, hue = 0, saturation = 0, luminance = 0) {
  const params = { ...DEFAULT_HSL_PARAMS };
  params[channel] = { hue, saturation, luminance };
  return params;
}

/**
 * 合并 HSL 参数
 * 
 * @param {Object} base - 基础参数
 * @param {Object} overlay - 覆盖参数
 * @returns {Object} 合并后的参数
 */
function mergeHSLParams(base, overlay) {
  const result = {};
  
  for (const channel of HSL_CHANNEL_ORDER) {
    const baseChannel = base?.[channel] || { hue: 0, saturation: 0, luminance: 0 };
    const overlayChannel = overlay?.[channel] || {};
    
    result[channel] = {
      hue: overlayChannel.hue ?? baseChannel.hue,
      saturation: overlayChannel.saturation ?? baseChannel.saturation,
      luminance: overlayChannel.luminance ?? baseChannel.luminance,
    };
  }
  
  return result;
}

/**
 * 验证 HSL 参数
 * 
 * @param {Object} hslParams - HSL 参数
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateHSLParams(hslParams) {
  const errors = [];
  
  if (!hslParams || typeof hslParams !== 'object') {
    return { valid: true, errors: [] }; // 空参数视为有效
  }
  
  for (const channel of HSL_CHANNEL_ORDER) {
    const params = hslParams[channel];
    if (!params) continue;
    
    if (params.hue !== undefined) {
      if (typeof params.hue !== 'number' || params.hue < -180 || params.hue > 180) {
        errors.push(`${channel}.hue must be between -180 and 180`);
      }
    }
    
    if (params.saturation !== undefined) {
      if (typeof params.saturation !== 'number' || params.saturation < -100 || params.saturation > 100) {
        errors.push(`${channel}.saturation must be between -100 and 100`);
      }
    }
    
    if (params.luminance !== undefined) {
      if (typeof params.luminance !== 'number' || params.luminance < -100 || params.luminance > 100) {
        errors.push(`${channel}.luminance must be between -100 and 100`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// 模块导出
// ============================================================================

export {
  // 常量
  HSL_CHANNELS,
  HSL_CHANNEL_ORDER,
  DEFAULT_HSL_PARAMS,
  
  // 颜色转换
  rgbToHsl,
  hslToRgb,
  
  // HSL 调整
  applyHSL,
  applyHSLToArray,
  isDefaultHSL,
  
  // 工具函数
  createSingleChannelHSL,
  mergeHSLParams,
  validateHSLParams,
  calculateChannelWeight,
  hueDistance,
}