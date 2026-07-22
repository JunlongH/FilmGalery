/**
 * FilmLab 胶片反转模块
 * 
 * @module filmLabInversion
 * @description 实现线性反转和对数反转
 * 
 * 注意：胶片曲线处理已分离到 filmLabCurve.js 模块
 * 反转（负→正）与曲线（色调风格）现在是独立的处理步骤
 */

import { DEFAULT_INVERSION_PARAMS } from './filmLabConstants.mjs';

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 数值钳制
 */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ============================================================================
// 反转算法实现
// ============================================================================

/**
 * 线性反转
 * 
 * 简单的数值反转: out = 255 - in
 * 
 * @param {number} value - 输入值 (0-255)
 * @returns {number} 反转后的值
 */
function invertLinear(value) {
  return 255 - value;
}

/**
 * 对数反转 (传统艺术化算法)
 * 
 * 公式: out = 255 * (1 - log(in + 1) / log(256))
 * 
 * 此算法提供了一种对数压缩的反转效果，保留更多阴影细节
 * 
 * @param {number} value - 输入值 (0-255)
 * @returns {number} 反转后的值
 */
function invertLog(value) {
  // +1 避免 log(0)
  return clamp(Math.round(255 * (1 - Math.log(value + 1) / Math.log(256))), 0, 255);
}

// ============================================================================
// 统一反转接口
// ============================================================================

/**
 * 反转单个像素值
 * 
 * @param {number} value - 输入值 (0-255)
 * @param {Object} params - 反转参数
 * @param {boolean} [params.inverted=false] - 是否启用反转
 * @param {string} [params.inversionMode='linear'] - 反转模式: 'linear' | 'log'
 * @returns {number} 处理后的值
 */
function applyInversion(value, params = {}) {
  const {
    inverted = DEFAULT_INVERSION_PARAMS.inverted,
    inversionMode = DEFAULT_INVERSION_PARAMS.inversionMode,
  } = params;
  
  if (!inverted) {
    return value;
  }
  
  switch (inversionMode) {
    case 'linear':
      return invertLinear(value);
    
    case 'log':
      return invertLog(value);
    
    default:
      return invertLinear(value);
  }
}

/**
 * 反转 RGB 三通道
 * 
 * @param {number} r - 红色值 (0-255)
 * @param {number} g - 绿色值 (0-255)
 * @param {number} b - 蓝色值 (0-255)
 * @param {Object} params - 反转参数
 * @returns {[number, number, number]} 反转后的 RGB 值
 */
function applyInversionRGB(r, g, b, params = {}) {
  return [
    applyInversion(r, params),
    applyInversion(g, params),
    applyInversion(b, params),
  ];
}

/**
 * 构建反转 LUT
 * 
 * 预计算 256 级反转查找表，用于批量处理
 * 
 * @param {Object} params - 反转参数
 * @returns {Uint8Array} 256 级反转查找表
 */
function buildInversionLUT(params = {}) {
  const lut = new Uint8Array(256);
  
  for (let i = 0; i < 256; i++) {
    lut[i] = applyInversion(i, params);
  }
  
  return lut;
}

// ============================================================================
// 对数域片基校正
// ============================================================================

/**
 * 计算片基密度值 (从采样的 RGB 值)
 * 
 * 用于 Auto Base / Pick Base 时计算对数域校正参数
 * 
 * @param {number} r - 红色值 (0-255)
 * @param {number} g - 绿色值 (0-255)
 * @param {number} b - 蓝色值 (0-255)
 * @returns {{densityR: number, densityG: number, densityB: number}} 各通道密度值
 */
function calculateBaseDensity(r, g, b) {
  // 避免 log(0)，使用最小透射率 0.001 (约等于密度 3.0)
  const minT = 0.001;
  
  const Tr = Math.max(r / 255, minT);
  const Tg = Math.max(g / 255, minT);
  const Tb = Math.max(b / 255, minT);
  
  // D = -log10(T)
  return {
    densityR: -Math.log10(Tr),
    densityG: -Math.log10(Tg),
    densityB: -Math.log10(Tb),
  };
}

/**
 * 应用对数域片基校正 (单通道)
 * 
 * 在密度域进行减法校正：D_image = D_scan - D_base
 * 
 * @param {number} value - 输入值 (0-255)
 * @param {number} baseDensity - 该通道的片基密度
 * @returns {number} 校正后的值 (0-255)
 */
function applyLogBaseCorrection(value, baseDensity) {
  if (baseDensity === 0) return value;
  
  const minT = 0.001;
  const T = Math.max(value / 255, minT);
  
  // 转换到密度域
  const D = -Math.log10(T);
  
  // 减去片基密度
  const Dcorrected = D - baseDensity;
  
  // 转回透射率域
  // 注意：Dcorrected 可能为负（比片基更亮），这时 T > 1
  const Tcorrected = Math.pow(10, -Dcorrected);
  
  // 钳制到 0-255
  return Math.max(0, Math.min(255, Math.round(Tcorrected * 255)));
}

/**
 * 应用对数域片基校正 (RGB 三通道)
 * 
 * @param {number} r - 红色值 (0-255)
 * @param {number} g - 绿色值 (0-255)
 * @param {number} b - 蓝色值 (0-255)
 * @param {number} densityR - 红色片基密度
 * @param {number} densityG - 绿色片基密度
 * @param {number} densityB - 蓝色片基密度
 * @returns {[number, number, number]} 校正后的 RGB 值
 */
function applyLogBaseCorrectionRGB(r, g, b, densityR, densityG, densityB) {
  return [
    applyLogBaseCorrection(r, densityR),
    applyLogBaseCorrection(g, densityG),
    applyLogBaseCorrection(b, densityB),
  ];
}

/**
 * 应用线性域片基校正 (乘法增益)
 * 
 * @param {number} value - 输入值 (0-255)
 * @param {number} gain - 增益系数 (1.0 = 无变化)
 * @returns {number} 校正后的值 (0-255)
 */
function applyLinearBaseCorrection(value, gain) {
  if (gain === 1.0) return value;
  return Math.max(0, Math.min(255, Math.round(value * gain)));
}

/**
 * 应用线性域片基校正 (RGB 三通道)
 * 
 * @param {number} r - 红色值 (0-255)
 * @param {number} g - 绿色值 (0-255)
 * @param {number} b - 蓝色值 (0-255)
 * @param {number} gainR - 红色增益
 * @param {number} gainG - 绿色增益
 * @param {number} gainB - 蓝色增益
 * @returns {[number, number, number]} 校正后的 RGB 值
 */
function applyLinearBaseCorrectionRGB(r, g, b, gainR, gainG, gainB) {
  return [
    applyLinearBaseCorrection(r, gainR),
    applyLinearBaseCorrection(g, gainG),
    applyLinearBaseCorrection(b, gainB),
  ];
}

// ============================================================================
// 模块导出 (CommonJS)
// ============================================================================

export { invertLinear, invertLog, applyInversion, applyInversionRGB, buildInversionLUT, calculateBaseDensity, applyLogBaseCorrection, applyLogBaseCorrectionRGB, applyLinearBaseCorrection, applyLinearBaseCorrectionRGB };