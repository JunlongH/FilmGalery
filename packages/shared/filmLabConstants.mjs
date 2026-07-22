/**
 * FilmLab 共享常量
 * 客户端、服务端、Electron 共用
 * 
 * @module filmLabConstants
 * @description 统一定义所有 FilmLab 相关的常量，确保各路径一致性
 */

// ============================================================================
// 图像尺寸常量
// ============================================================================

/** 服务端预览最大宽度 */
const PREVIEW_MAX_WIDTH_SERVER = 1400;

/** 客户端实时预览最大宽度 (WebGL/CPU) */
const PREVIEW_MAX_WIDTH_CLIENT = 1200;

/** 导出操作最大宽度 (Save/HQ Export/Download) */
const EXPORT_MAX_WIDTH = 8000;

// ============================================================================
// 默认参数值
// ============================================================================

/** 默认色调参数 */
const DEFAULT_TONE_PARAMS = {
  exposure: 0,      // -100 to 100
  contrast: 0,      // -100 to 100
  highlights: 0,    // -100 to 100
  shadows: 0,       // -100 to 100
  whites: 0,        // -100 to 100
  blacks: 0,        // -100 to 100
};

/**
 * 感知中灰点 (Perceptual Mid-Gray)
 *
 * 18% 反射率 (线性 0.18) 在 sRGB gamma 域的值:
 *   sRGB = ((0.18 / 12.92)              if linear ≤ 0.0031308)
 *        = (1.055 * 0.18^(1/2.4) - 0.055)  ≈ 0.4586
 *
 * 对比度公式应围绕此值操作，而非 sRGB 0.5 (对应线性 ~0.214)。
 * 这使得对比度调整在感知上对称，与 Lightroom/Photoshop 行为一致。
 *
 * Q11: Replaces hardcoded 0.5 in contrast formula across CPU/GPU paths.
 */
const CONTRAST_MID_GRAY = 0.46;

/** 默认白平衡参数 */
const DEFAULT_WB_PARAMS = {
  red: 1.0,
  green: 1.0,
  blue: 1.0,
  temp: 0,          // -100 to 100 (Blue <-> Yellow)
  tint: 0,          // -100 to 100 (Green <-> Magenta)
};

// P1-32: 删除 DEFAULT_BASE_GAINS / DEFAULT_BASE_CORRECTION 死导出
// 全仓库无任何消费者（filmLabExport.js 自行内联定义，且字段名/结构不同步）
// 如需恢复，应从 filmLabExport.js 的 DEFAULT_PROCESSING_PARAMS.baseGains/baseDensity 获取

/**
 * 反转模式显示名称映射
 * 用于 UI 显示，保持代码中使用 'linear'/'log' 值不变
 */
const INVERSION_MODE_LABELS = {
  linear: 'Linear',       // 标准线性反转
  log: 'Soft',           // 对数压缩反转 (原 Log)，保留更多阴影细节
};

/** 默认白平衡增益限制 */
const WB_GAIN_LIMITS = {
  min: 0.05,
  max: 50.0,
};

/** 默认反转参数 */
const DEFAULT_INVERSION_PARAMS = {
  inverted: false,
  inversionMode: 'linear',  // 'linear' | 'log' | 'film'
};

/** 默认曲线控制点 */
const DEFAULT_CURVES = {
  rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
};

/** 默认裁剪区域 (全图) */
const DEFAULT_CROP_RECT = { x: 0, y: 0, w: 1, h: 1 };

// ============================================================================
// 导出质量设置
// ============================================================================

/** JPEG 质量设置 */
const JPEG_QUALITY = {
  preview: 85,
  export: 95,
  maximum: 100,
};

// ============================================================================
// WebGL 配置
// ============================================================================

/** WebGL 防抖时间 (毫秒) */
const WEBGL_DEBOUNCE_MS = 100;

/** 调试模式开关 */
const DEBUG = false;

// ============================================================================
// 胶片类型配置 (用于科学化 Log 反转)
// ============================================================================

/**
 * 胶片特性参数 (Q13 增强)
 *
 * gamma:    主 gamma 值 (直线段斜率，影响对比度)
 * gammaR:   红色通道 gamma (默认 = gamma; C-41 彩色负片各层不同)
 * gammaG:   绿色通道 gamma
 * gammaB:   蓝色通道 gamma
 * dMin:     最小密度 (片基+灰雾)
 * dMax:     最大密度 (可达到的最大暗度)
 * toe:      趾部强度 (0–1; 0 = 无趾部, 1 = 完全 toe 压缩)
 * shoulder: 肩部强度 (0–1; 0 = 无肩部, 1 = 完全 shoulder 饱和)
 */
const FILM_PROFILES = {
  // 彩色负片 — per-channel gamma 模拟不同乳剂层感光特性
  portra160: { gamma: 0.58, gammaR: 0.56, gammaG: 0.58, gammaB: 0.54, dMin: 0.10, dMax: 2.8, toe: 0.3, shoulder: 0.2, name: 'Kodak Portra 160' },
  portra400: { gamma: 0.60, gammaR: 0.58, gammaG: 0.60, gammaB: 0.55, dMin: 0.12, dMax: 3.0, toe: 0.3, shoulder: 0.2, name: 'Kodak Portra 400' },
  portra800: { gamma: 0.62, gammaR: 0.60, gammaG: 0.62, gammaB: 0.57, dMin: 0.15, dMax: 3.2, toe: 0.35, shoulder: 0.25, name: 'Kodak Portra 800' },
  ektar100:  { gamma: 0.55, gammaR: 0.53, gammaG: 0.55, gammaB: 0.51, dMin: 0.08, dMax: 3.0, toe: 0.25, shoulder: 0.3, name: 'Kodak Ektar 100' },
  gold200:   { gamma: 0.58, gammaR: 0.56, gammaG: 0.58, gammaB: 0.54, dMin: 0.12, dMax: 2.9, toe: 0.3, shoulder: 0.2, name: 'Kodak Gold 200' },
  colorplus200: { gamma: 0.57, gammaR: 0.55, gammaG: 0.57, gammaB: 0.53, dMin: 0.11, dMax: 2.8, toe: 0.3, shoulder: 0.2, name: 'Kodak ColorPlus 200' },
  pro400h:   { gamma: 0.60, gammaR: 0.58, gammaG: 0.60, gammaB: 0.56, dMin: 0.12, dMax: 3.0, toe: 0.25, shoulder: 0.2, name: 'Fuji Pro 400H' },
  superia400:{ gamma: 0.58, gammaR: 0.56, gammaG: 0.58, gammaB: 0.54, dMin: 0.13, dMax: 2.9, toe: 0.3, shoulder: 0.2, name: 'Fuji Superia 400' },
  c200:      { gamma: 0.56, gammaR: 0.54, gammaG: 0.56, gammaB: 0.52, dMin: 0.10, dMax: 2.8, toe: 0.3, shoulder: 0.2, name: 'Fuji C200' },
  
  // 黑白负片 — 单一 gamma (各层感光特性相同)
  trix400:   { gamma: 0.65, dMin: 0.15, dMax: 2.8, toe: 0.35, shoulder: 0.25, name: 'Kodak Tri-X 400' },
  tmax100:   { gamma: 0.62, dMin: 0.10, dMax: 2.6, toe: 0.2, shoulder: 0.15, name: 'Kodak T-Max 100' },
  tmax400:   { gamma: 0.64, dMin: 0.12, dMax: 2.8, toe: 0.25, shoulder: 0.2, name: 'Kodak T-Max 400' },
  hp5:       { gamma: 0.63, dMin: 0.14, dMax: 2.7, toe: 0.3, shoulder: 0.2, name: 'Ilford HP5+' },
  delta100:  { gamma: 0.60, dMin: 0.08, dMax: 2.5, toe: 0.2, shoulder: 0.15, name: 'Ilford Delta 100' },
  delta400:  { gamma: 0.62, dMin: 0.10, dMax: 2.7, toe: 0.25, shoulder: 0.2, name: 'Ilford Delta 400' },
  acros100:  { gamma: 0.60, dMin: 0.09, dMax: 2.6, toe: 0.2, shoulder: 0.15, name: 'Fuji Acros 100' },
  
  // 默认 (通用 — 无 toe/shoulder，向后兼容)
  default: { gamma: 0.60, dMin: 0.10, dMax: 3.0, toe: 0, shoulder: 0, name: 'Generic Film' },
};

// ============================================================================
// 色温配置 (用于科学化白平衡)
// ============================================================================

/** 参考白点色温 (开尔文) */
const REFERENCE_WHITE_POINTS = {
  D50: 5000,    // 印刷标准
  D55: 5500,    // 中间色温
  D65: 6500,    // 日光 (sRGB 标准)
  D75: 7500,    // 北方天光
  A: 2856,      // 钨丝灯
  F2: 4230,     // 冷白色荧光灯
  F11: 4000,    // 窄带荧光灯
};

/** 色温滑块范围映射 */
const TEMP_SLIDER_CONFIG = {
  min: -100,
  max: 100,
  // 滑块值映射到开尔文: baseKelvin + (sliderValue * kelvinPerUnit)
  baseKelvin: 6500,   // D65 作为中性点
  kelvinPerUnit: 40,  // 每单位 40K，范围 2500K - 10500K
};

// ============================================================================
// 模块导出 (CommonJS)
// ============================================================================

const _sharedExports = {
  PREVIEW_MAX_WIDTH_SERVER,
  PREVIEW_MAX_WIDTH_CLIENT,
  EXPORT_MAX_WIDTH,
  DEFAULT_TONE_PARAMS,
  CONTRAST_MID_GRAY,
  DEFAULT_WB_PARAMS,
  INVERSION_MODE_LABELS,
  DEFAULT_INVERSION_PARAMS,
  DEFAULT_CURVES,
  DEFAULT_CROP_RECT,
  WB_GAIN_LIMITS,
  JPEG_QUALITY,
  WEBGL_DEBOUNCE_MS,
  DEBUG,
  FILM_PROFILES,
  REFERENCE_WHITE_POINTS,
  TEMP_SLIDER_CONFIG,
};
export const { PREVIEW_MAX_WIDTH_SERVER, PREVIEW_MAX_WIDTH_CLIENT, EXPORT_MAX_WIDTH, DEFAULT_TONE_PARAMS, CONTRAST_MID_GRAY, DEFAULT_WB_PARAMS, INVERSION_MODE_LABELS, DEFAULT_INVERSION_PARAMS, DEFAULT_CURVES, DEFAULT_CROP_RECT, WB_GAIN_LIMITS, JPEG_QUALITY, WEBGL_DEBOUNCE_MS, DEBUG, FILM_PROFILES, REFERENCE_WHITE_POINTS, TEMP_SLIDER_CONFIG } = _sharedExports;
export default _sharedExports;
