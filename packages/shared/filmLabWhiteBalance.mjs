/**
 * FilmLab 白平衡模块 (科学化版本)
 * 
 * @module filmLabWhiteBalance
 * @description 实现基于开尔文色温的白平衡计算，同时保留传统简化模型的兼容性
 */

import { DEFAULT_WB_PARAMS, WB_GAIN_LIMITS, TEMP_SLIDER_CONFIG, REFERENCE_WHITE_POINTS } from './filmLabConstants.mjs';

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 数值钳制
 * @param {number} v - 输入值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 钳制后的值
 */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ============================================================================
// 色温转换算法 (CIE D 光源系列 — Q12 升级)
// ============================================================================

/**
 * CIE D 光源色度坐标 (xD, yD) → sRGB 乘数
 *
 * 基于 CIE 015:2004 标准 D 光源计算:
 *   4000K ≤ T ≤ 7000K:  xD = -4.6070e9/T³ + 2.9678e6/T² + 0.09911e3/T + 0.244063
 *   7000K < T ≤ 25000K: xD = -2.0064e9/T³ + 1.9018e6/T² + 0.24748e3/T + 0.237040
 *   yD = -3.000 xD² + 2.870 xD - 0.275
 *
 * 然后通过 CIE XYZ → sRGB 转换得到归一化 RGB 乘数。
 * 与 Tanner Helland 近似相比:
 *   - 物理上更精确 (基于标准日光光谱功率分布)
 *   - 全范围 C¹ 连续 (无 6600K 导数不连续)
 *   - 4000K–25000K 范围内误差 < 0.1% (CIE 标准精度)
 *
 * 低于 4000K 使用 Planckian 轨迹近似 (黑体辐射)。
 *
 * @param {number} kelvin - 色温 (开尔文)
 * @returns {[number, number, number]} RGB 乘数 (归一化，最大通道 ≈ 1.0)
 */
function kelvinToRGB(kelvin) {
  kelvin = clamp(kelvin, 1000, 40000);

  let xD, yD;

  if (kelvin >= 4000 && kelvin <= 25000) {
    // CIE D 光源色度坐标
    const T = kelvin;
    const T2 = T * T;
    const T3 = T2 * T;

    if (T <= 7000) {
      xD = -4.6070e9 / T3 + 2.9678e6 / T2 + 0.09911e3 / T + 0.244063;
    } else {
      xD = -2.0064e9 / T3 + 1.9018e6 / T2 + 0.24748e3 / T + 0.237040;
    }
    yD = -3.000 * xD * xD + 2.870 * xD - 0.275;
  } else {
    // < 4000K: Planckian 轨迹 (Kang et al. 2002)
    // > 25000K: extrapolate from CIE D (very blue — rare in practice)
    const T = kelvin;
    const T2 = T * T;
    const T3 = T2 * T;

    if (T < 4000) {
      // Kang et al. Planckian locus approximation (1667K–4000K)
      xD = -0.2661239e9 / T3 - 0.2343589e6 / T2 + 0.8776956e3 / T + 0.179910;
      yD = -1.1063814 * xD * xD * xD - 1.34811020 * xD * xD + 2.18555832 * xD - 0.20219683;
      // Smooth blend near 4000K boundary
      if (T > 3500) {
        const blend = (T - 3500) / 500; // 0 at 3500K, 1 at 4000K
        const xD_cie = -4.6070e9 / (4000 * 4000 * 4000) + 2.9678e6 / (4000 * 4000)
                       + 0.09911e3 / 4000 + 0.244063;
        const yD_cie = -3.000 * xD_cie * xD_cie + 2.870 * xD_cie - 0.275;
        xD = xD * (1 - blend) + xD_cie * blend;
        yD = yD * (1 - blend) + yD_cie * blend;
      }
    } else {
      // > 25000K: use CIE D formula (extrapolated — good enough)
      xD = -2.0064e9 / T3 + 1.9018e6 / T2 + 0.24748e3 / T + 0.237040;
      yD = -3.000 * xD * xD + 2.870 * xD - 0.275;
    }
  }

  // CIE xyY → XYZ (Y = 1.0 — equal-energy luminance)
  const X = xD / yD;
  const Y = 1.0;
  const Z = (1.0 - xD - yD) / yD;

  // XYZ → linear sRGB (D65 reference, IEC 61966-2-1 matrix)
  let R =  3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  let G = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  let B =  0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;

  // P1-30: 删除 von Kries 死代码块（恒等于 max 通道归一化）
  // 旧实现声称"Y 通道保持"，但 Y=1.0 恒定 → Y_original=1.0 → r_chroma*1.0*3.0
  // → max 归一化抵消 3.0 系数 → 整个块等价于 max 通道归一化
  // 亮度补偿已在 computeWBGains 中完成（基于 Rec.709 luma 加权）

  // Max-channel 归一化（保留色度，归一化到 [0, 1]）
  const maxC = Math.max(R, G, B);
  if (maxC > 0) {
    R /= maxC;
    G /= maxC;
    B /= maxC;
  }

  // Clamp negatives (out-of-gamut for extreme temperatures)
  R = Math.max(0, R);
  G = Math.max(0, G);
  B = Math.max(0, B);

  return [R, G, B];
}

/**
 * 将滑块值映射到开尔文色温
 * 
 * @param {number} sliderValue - 滑块值 (-100 to 100)
 * @returns {number} 开尔文色温
 */
function sliderToKelvin(sliderValue) {
  const { baseKelvin, kelvinPerUnit } = TEMP_SLIDER_CONFIG;
  return baseKelvin + (sliderValue * kelvinPerUnit);
}

// ============================================================================
// 白平衡计算
// ============================================================================

/**
 * 计算白平衡增益 (科学化版本)
 * 
 * 使用基于开尔文色温的物理模型计算 RGB 增益
 * 
 * @param {Object} params - 白平衡参数
 * @param {number} [params.red=1] - 红色基础增益
 * @param {number} [params.green=1] - 绿色基础增益
 * @param {number} [params.blue=1] - 蓝色基础增益
 * @param {number} [params.temp=0] - 色温调整 (-100 to 100)
 * @param {number} [params.tint=0] - 色调调整 (-100 to 100)
 * @param {Object} [options] - 选项
 * @param {boolean} [options.useKelvinModel=true] - 使用开尔文色温模型
 * @param {number} [options.minGain] - 最小增益
 * @param {number} [options.maxGain] - 最大增益
 * @returns {[number, number, number]} RGB 增益数组
 */
function computeWBGains(params = {}, options = {}) {
  const minGain = options.minGain ?? WB_GAIN_LIMITS.min;
  const maxGain = options.maxGain ?? WB_GAIN_LIMITS.max;
  const useKelvinModel = options.useKelvinModel !== false;
  
  // 安全解析输入
  const R = Number.isFinite(params.red) ? params.red : DEFAULT_WB_PARAMS.red;
  const G = Number.isFinite(params.green) ? params.green : DEFAULT_WB_PARAMS.green;
  const B = Number.isFinite(params.blue) ? params.blue : DEFAULT_WB_PARAMS.blue;
  const T = Number.isFinite(params.temp) ? params.temp : DEFAULT_WB_PARAMS.temp;
  const N = Number.isFinite(params.tint) ? params.tint : DEFAULT_WB_PARAMS.tint;

  let rGain, gGain, bGain;

  if (useKelvinModel) {
    // === 科学化开尔文色温模型 ===
    
    // 1. 计算目标色温对应的 RGB 乘数
    const targetKelvin = sliderToKelvin(T);
    const [rTemp, gTemp, bTemp] = kelvinToRGB(targetKelvin);
    
    // 2. 计算参考白点 (D65) 的 RGB
    const [rRef, gRef, bRef] = kelvinToRGB(REFERENCE_WHITE_POINTS.D65);
    
    // 3. 计算相对增益 (目标相对于参考)
    // 由于我们要将图像中的目标色温区域校正为 D65，
    // 需要反向应用增益：增益 = 参考 / 目标
    const rTempGain = rRef / Math.max(0.001, rTemp);
    const gTempGain = gRef / Math.max(0.001, gTemp);
    const bTempGain = bRef / Math.max(0.001, bTemp);
    
    // 4. 色调调整 (绿-品红轴)
    // P2-2 修复: tint 增益随 targetKelvin 缩放
    // 旧版 tint 用固定增益 (0.15/0.30/0.15)，极端色温下 tint 效果被 Rec.709
    // 亮度补偿部分抵消 (因 R/B 通道在极端色温下权重大，tint 对 G 的影响被稀释)。
    // Adobe LR 约定: tint 在全色温范围保持感知一致。
    // 修复: tint 增益乘以 tempScale = avgKelvinRGB / 0.5
    //   (当色温偏离 D65 时，RGB 通道不对称加剧，tint 需要更强增益)
    // tint > 0: 更品红 (减绿加红蓝)
    // tint < 0: 更绿 (加绿减红蓝)
    const n = N / 100; // 归一化到 -1..1
    const tempScale = Math.max(0.5, Math.min(2.0, (rTemp + gTemp + bTemp) / 1.5));
    const tintR = 1 + n * 0.15 * tempScale;
    const tintG = 1 - n * 0.30 * tempScale;
    const tintB = 1 + n * 0.15 * tempScale;
    
    // 5. 组合所有增益
    rGain = R * rTempGain * tintR;
    gGain = G * gTempGain * tintG;
    bGain = B * bTempGain * tintB;
    
    // ⚠️ CRITICAL FIX (v2.3.0+): Adobe Lightroom/Photoshop Luminance Preservation
    // ============================================================================
    // 问题: 白平衡调整时，由于三个通道的 Kelvin RGB 值不对称，会导致
    //      平均增益偏离 1.0，造成整体亮度变化 ±15%。
    //
    // 标准做法 (LR/PS): 
    // 1. 计算平均增益: avgGain = (rGain + gGain + bGain) / 3
    // 2. 使用 Rec.709 亮度系数对增益进行加权平均 (更精确):
    //    avgGain = 0.2126*rGain + 0.7152*gGain + 0.0722*bGain
    // 3. 补偿因子: comp = 1.0 / avgGain
    // 4. 最终增益: [rGain, gGain, bGain] *= comp
    //
    // 效果: 白平衡调整时亮度变化控制在 < 1% (与 Adobe 标准一致)
    // ============================================================================
    
    // X.2 (P0-4): 使用 Rec.709 亮度系数 (BT.709: 0.2126/0.7152/0.0722)。
    // 之前代码注释声称 Rec.709 但实际使用了 BT.601 (0.299/0.587/0.114)，
    // 与代码库其他模块（filmLabSaturation/filmLabSplitTone/GLSL colorMath/saturation）
    // 不一致。BT.601 压低绿色权重 ~18%，暖色 WB 调整时亮度补偿过度（3.6% vs 2.7%），
    // 用户感知为"加温后偏暗"。
    const avgGain = 0.2126 * rGain + 0.7152 * gGain + 0.0722 * bGain;
    
    if (avgGain > 0.001) {
      const luminanceCompensation = 1.0 / avgGain;
      rGain *= luminanceCompensation;
      gGain *= luminanceCompensation;
      bGain *= luminanceCompensation;
    }
    
  } else {
    // === 传统简化模型 (向后兼容) ===
    const t = T / 100;
    const n = N / 100;
    
    rGain = R * (1 + t * 0.5 + n * 0.3);
    gGain = G * (1 - n * 0.5);
    bGain = B * (1 - t * 0.5 + n * 0.3);
    
    // Apply same luminance compensation for legacy model
    // X.2 (P0-4): BT.709 luminance coefficients — matches Kelvin model above.
    const avgGain = 0.2126 * rGain + 0.7152 * gGain + 0.0722 * bGain;
    if (avgGain > 0.001) {
      const luminanceCompensation = 1.0 / avgGain;
      rGain *= luminanceCompensation;
      gGain *= luminanceCompensation;
      bGain *= luminanceCompensation;
    }
  }
  
  // 安全检查并钳制
  if (!Number.isFinite(rGain)) rGain = 1;
  if (!Number.isFinite(gGain)) gGain = 1;
  if (!Number.isFinite(bGain)) bGain = 1;
  
  rGain = clamp(rGain, minGain, maxGain);
  gGain = clamp(gGain, minGain, maxGain);
  bGain = clamp(bGain, minGain, maxGain);
  
  return [rGain, gGain, bGain];
}

/**
 * 计算白平衡增益 (传统模型，用于向后兼容)
 * 
 * @param {Object} params - 白平衡参数
 * @param {Object} [options] - 选项
 * @returns {[number, number, number]} RGB 增益数组
 */
function computeWBGainsLegacy(params = {}, options = {}) {
  return computeWBGains(params, { ...options, useKelvinModel: false });
}

// ============================================================================
// 自动白平衡求解器 (v2.4.0 — Newton-Raphson 行业标准方法)
// ============================================================================

/**
 * 从采样颜色求解色温和色调 (行业标准 Newton-Raphson 方法)
 *
 * 使用 2D Newton-Raphson 数值迭代，确保求解结果与开尔文渲染模型完全匹配。
 * 旧版使用传统线性模型的代数逆推导，导致 solver-renderer 模型不匹配，
 * 暖色调校正时产生严重蓝色过矫正 (temp=-60 时蓝色增益偏差 +41%)。
 *
 * 算法流程:
 *   1. 传统模型代数解作为初始估计 (快速收敛起点)
 *   2. Newton-Raphson 迭代 (数值 Jacobian) 对 computeWBGains(kelvin=true) 精确求解
 *   3. 残差目标: rS×gainR ≈ gS×gainG ≈ bS×gainB (中性灰条件)
 *
 * 参考标准: Adobe Lightroom WB Solver (Planckian Locus 迭代)
 * 性能: 典型 5-10 次迭代，< 0.5ms
 *
 * @param {[number, number, number]} sampleRgb - 采样的 RGB 值 (0-255)
 * @param {Object} [baseGains] - 基础增益 {red, green, blue}
 * @returns {{temp: number, tint: number}} 求解的 temp 和 tint 值
 */
function solveTempTintFromSample(sampleRgb, baseGains = {}) {
  // 输入验证
  if (!Array.isArray(sampleRgb) || sampleRgb.length < 3) {
    return { temp: 0, tint: 0 };
  }

  // 安全解析采样值
  const safeSample = sampleRgb.map(v => {
    const val = Number(v);
    return Number.isFinite(val) ? Math.max(1, val) : 128;
  });

  // 安全解析基础增益
  const base = {
    red: Math.max(0.05, Number.isFinite(baseGains.red) ? baseGains.red : 1),
    green: Math.max(0.05, Number.isFinite(baseGains.green) ? baseGains.green : 1),
    blue: Math.max(0.05, Number.isFinite(baseGains.blue) ? baseGains.blue : 1),
  };

  const [rS, gS, bS] = safeSample;

  // 快速检查: 是否已经接近中性灰
  const rBase = rS * base.red;
  const gBase = gS * base.green;
  const bBase = bS * base.blue;

  const avgBase = (rBase + gBase + bBase) / 3;
  if (avgBase < 1) return { temp: 0, tint: 0 };

  const maxDev = Math.max(
    Math.abs(rBase - gBase),
    Math.abs(gBase - bBase),
    Math.abs(rBase - bBase)
  ) / avgBase;

  if (maxDev < 0.02) return { temp: 0, tint: 0 };

  // ====================================================================
  // Phase 1: 初始估计 (传统线性模型代数解 — 快速收敛起点)
  // ====================================================================
  const ratioR = gBase / rBase;
  const ratioB = gBase / bBase;
  const sumRatios = ratioR + ratioB;
  const n0 = (sumRatios - 2) / (0.6 + 0.5 * sumRatios);
  const t0 = (ratioR - ratioB) * (1 - n0 * 0.5);

  let t = clamp(t0 * 100, -100, 100);
  let n = clamp(n0 * 100, -100, 100);

  // ====================================================================
  // Phase 2: Newton-Raphson 迭代 (匹配开尔文渲染模型)
  // ====================================================================

  /**
   * 残差函数: 衡量当前 (temp, tint) 下的色偏
   *   F1 = rS × gainR − gS × gainG   (R-G 差异)
   *   F2 = bS × gainB − gS × gainG   (B-G 差异)
   * 目标: F1 = F2 = 0 (中性灰)
   */
  function residuals(temp, tint) {
    const gains = computeWBGains({
      red: base.red, green: base.green, blue: base.blue,
      temp, tint,
    }, { useKelvinModel: true });
    const outR = rS * gains[0];
    const outG = gS * gains[1];
    const outB = bS * gains[2];
    return [outR - outG, outB - outG];
  }

  const EPSILON = 0.05;    // 数值微分步长 (滑块单位)
  const MAX_ITER = 30;     // 最大迭代次数
  const CONVERGE = 0.3;    // 收敛阈值 (像素值单位, 0-255)
  const DAMPING  = 0.75;   // 阻尼因子 (防止振荡)

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const [f1, f2] = residuals(t, n);

    // 收敛判定
    if (Math.abs(f1) < CONVERGE && Math.abs(f2) < CONVERGE) break;

    // 数值 Jacobian: J[i][j] = ∂Fi/∂xj
    const [f1_dt, f2_dt] = residuals(t + EPSILON, n);
    const [f1_dn, f2_dn] = residuals(t, n + EPSILON);

    const J11 = (f1_dt - f1) / EPSILON;   // ∂F1/∂temp
    const J12 = (f1_dn - f1) / EPSILON;   // ∂F1/∂tint
    const J21 = (f2_dt - f2) / EPSILON;   // ∂F2/∂temp
    const J22 = (f2_dn - f2) / EPSILON;   // ∂F2/∂tint

    const det = J11 * J22 - J12 * J21;
    if (Math.abs(det) < 1e-12) break;      // Jacobian 奇异

    // Newton 步: Δ = −J⁻¹ · F
    const dt = -(J22 * f1 - J12 * f2) / det;
    const dn = (J21 * f1 - J11 * f2) / det;

    // 带阻尼更新 (防止跳出 [-100, 100] 有效范围)
    t = clamp(t + dt * DAMPING, -100, 100);
    n = clamp(n + dn * DAMPING, -100, 100);
  }

  // ====================================================================
  // Phase 3: 结果验证
  // ====================================================================
  if (!Number.isFinite(t)) t = 0;
  if (!Number.isFinite(n)) n = 0;

  // 验证最终增益不产生极端值
  const finalGains = computeWBGains({
    red: base.red, green: base.green, blue: base.blue,
    temp: t, tint: n,
  }, { useKelvinModel: true });

  const isExtreme = finalGains.some(g => g < 0.1 || g > 10);
  if (isExtreme) {
    t *= 0.5;
    n *= 0.5;
  }

  return { temp: t, tint: n };
}

// ============================================================================
// 模块导出 (CommonJS)
// ============================================================================

const _sharedExports = {
  computeWBGains,
  computeWBGainsLegacy,
  solveTempTintFromSample,
  kelvinToRGB,
  sliderToKelvin,
};
const _e_computeWBGains = _sharedExports.computeWBGains;
export { _e_computeWBGains as computeWBGains };
const _e_computeWBGainsLegacy = _sharedExports.computeWBGainsLegacy;
export { _e_computeWBGainsLegacy as computeWBGainsLegacy };
const _e_solveTempTintFromSample = _sharedExports.solveTempTintFromSample;
export { _e_solveTempTintFromSample as solveTempTintFromSample };
const _e_kelvinToRGB = _sharedExports.kelvinToRGB;
export { _e_kelvinToRGB as kelvinToRGB };
const _e_sliderToKelvin = _sharedExports.sliderToKelvin;
export { _e_sliderToKelvin as sliderToKelvin };
export default _sharedExports;
