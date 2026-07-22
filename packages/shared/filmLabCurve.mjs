/**
 * FilmLab 胶片曲线模块
 * 
 * @module filmLabCurve
 * @description 独立的胶片特性曲线处理，基于 H&D 密度模型
 * 
 * 与反转模块分离，可以：
 * 1. 单独应用胶片曲线（用于已反转的正片）
 * 2. 配合反转使用（负片处理流程）
 * 3. 支持自定义 gamma/dMin/dMax 参数
 */

import { FILM_PROFILES } from './filmLabConstants.mjs';

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
// 胶片曲线算法 (Q13 增强: 三段式 S 曲线 + 逐通道 gamma)
// ============================================================================

/**
 * 三段式 H&D 曲线的 Hermite 混合因子
 *
 * smoothstep(t) = t² × (3 - 2t), 在 0 和 1 处 C¹ 连续。
 * 用于 toe 和 shoulder 区域与直线段的平滑过渡。
 *
 * @param {number} t - 归一化位置 [0, 1]
 * @returns {number} Hermite 混合权重 [0, 1]
 */
function hermite(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * 应用三段式胶片特性曲线 (Q13)
 *
 * 真实 H&D (Hurter & Driffield) 密度曲线由三段组成:
 *   1. 趾部 (toe): 低曝光区域，密度响应压缩 (γ < γ_main)
 *   2. 直线段 (straight-line): 线性响应区域 (γ = γ_main)
 *   3. 肩部 (shoulder): 高曝光区域，密度响应饱和 (γ > γ_main → 压缩)
 *
 * 各段通过 Hermite smoothstep 平滑过渡，保证 C¹ 连续。
 *
 * ⚠️ 密度域 gamma 语义 (与 RGB 域 gamma 相反):
 *   - gamma < 1: pow(densityNorm, gamma) 让中间密度值增大 → D_adj 增大 → T 减小 → 输出变暗
 *   - gamma > 1: pow(densityNorm, gamma) 让中间密度值减小 → D_adj 减小 → T 增大 → 输出变亮
 *   这与 sRGB gamma (gamma<1 提亮) 相反，因为操作在密度域 (D = -log10(T))。
 *   典型负片 gamma ≈ 0.6 在密度域意味着"压缩高密度区域" (让暗部细节更可见)。
 *
 * @param {number} value - 输入值 (0-255，代表透射率)
 * @param {Object} profile - 胶片曲线参数
 * @param {number} [profile.gamma=0.6]    - 主曲线 gamma 值 (密度域语义)
 * @param {number} [profile.dMin=0.1]     - 最小密度
 * @param {number} [profile.dMax=3.0]     - 最大密度
 * @param {number} [profile.toe=0]        - 趾部强度 (0–1)
 * @param {number} [profile.shoulder=0]   - 肩部强度 (0–1)
 * @returns {number} 处理后的透射率值 (0-255)
 */
function applyFilmCurve(value, profile = {}) {
  const {
    gamma = 0.6,
    dMin = 0.1,
    dMax = 3.0,
    toe = 0,
    shoulder = 0,
  } = profile;

  // P2-8: gamma 校验非零（gamma=0 时 pow(x,0)=1 输出恒定；<0.1 视为非法）
  const safeGamma = Number.isFinite(gamma) && gamma >= 0.1 ? gamma : 0.6;

  // 1. 输入归一化 (避免 log(0))
  const normalized = clamp(value / 255, 0.001, 1);

  // 2. 计算密度 D = -log10(T)
  const density = -Math.log10(normalized);

  // 3. 密度归一化到 dMin-dMax 范围（防 dMax === dMin 除零）
  const dRange = Math.max(dMax - dMin, 1e-6);
  const densityNorm = clamp((density - dMin) / dRange, 0, 1);

  // 4. 三段式 gamma 应用
  let gammaApplied;
  if (toe <= 0 && shoulder <= 0) {
    // 无 toe/shoulder: 简单幂函数 (向后兼容)
    gammaApplied = Math.pow(densityNorm, safeGamma);
  } else {
    gammaApplied = _applyThreeSegmentGamma(densityNorm, safeGamma, toe, shoulder);
  }

  // 5. 将调整后的归一化密度转回密度值
  const adjustedDensity = dMin + gammaApplied * dRange;

  // 6. 将密度转回透射率: T = 10^(-D)
  const outputT = Math.pow(10, -adjustedDensity);

  return clamp(Math.round(outputT * 255), 0, 255);
}

/**
 * 应用三段式胶片特性曲线 (浮点精度版本)
 *
 * 与 applyFilmCurve 相同的算法，但输入/输出为 0.0–1.0 浮点。
 * 用于 processPixelFloat() 和 GPU shader 的一致性。
 *
 * @param {number} value - 输入值 (0.0–1.0，代表透射率)
 * @param {Object} profile - 胶片曲线参数 (同上)
 * @returns {number} 处理后的透射率值 (0.0–1.0)
 */
function applyFilmCurveFloat(value, profile = {}) {
  const {
    gamma = 0.6,
    dMin = 0.1,
    dMax = 3.0,
    toe = 0,
    shoulder = 0,
  } = profile;

  // P2-8: gamma 校验非零（与 8-bit 版本一致）
  const safeGamma = Number.isFinite(gamma) && gamma >= 0.1 ? gamma : 0.6;

  const normalized = clamp(value, 0.001, 1);
  const density = -Math.log10(normalized);
  const dRange = Math.max(dMax - dMin, 1e-6);
  const densityNorm = clamp((density - dMin) / dRange, 0, 1);

  let gammaApplied;
  if (toe <= 0 && shoulder <= 0) {
    gammaApplied = Math.pow(densityNorm, safeGamma);
  } else {
    gammaApplied = _applyThreeSegmentGamma(densityNorm, safeGamma, toe, shoulder);
  }

  const adjustedDensity = dMin + gammaApplied * dRange;
  const outputT = Math.pow(10, -adjustedDensity);
  return clamp(outputT, 0, 1);
}

/**
 * 三段式 gamma 映射 (内部函数)
 *
 * densityNorm ∈ [0, 1]:
 *   - [0, toeBound):     toe 区域  (γ_toe = γ × 1.5 → 压缩低密度)
 *   - [toeBound, shBound]: 直线段    (γ_main)
 *   - (shBound, 1]:       shoulder  (γ_sh  = γ × 0.6 → 压缩高密度)
 *
 * 过渡区域使用 Hermite smoothstep 混合。
 *
 * P2-shoulder 修复: 旧版 shBound = 1 - 0.25*shoulder，shoulder=0.5 时 shBound=0.875，
 * 仅在 densityNorm > 0.875 (T < 0.6/255) 时生效，8-bit 下接近无效。
 * 现改为 shBound = 1 - 0.5*shoulder，shoulder=0.5 时 shBound=0.75，
 * densityNorm > 0.75 (T < 5/255) 时生效，覆盖更多有意义的高密度区域。
 *
 * @param {number} d - 归一化密度 [0, 1]
 * @param {number} gamma - 主 gamma
 * @param {number} toe - 趾部强度 (0–1)
 * @param {number} shoulder - 肩部强度 (0–1)
 * @returns {number} gamma 映射后的值 [0, 1]
 */
function _applyThreeSegmentGamma(d, gamma, toe, shoulder) {
  // Segment boundaries (density-normalized)
  const toeBound = 0.25 * toe;            // toe 占低密度区的比例
  const shBound  = 1.0 - 0.5 * shoulder;  // P2-shoulder: 从 0.25 改为 0.5，扩大 shoulder 作用范围

  // Gamma variants for toe and shoulder
  const gammaToe = gamma * 1.5;      // toe: 更陡 → 压缩低密度响应
  const gammaSh  = gamma * 0.6;      // shoulder: 更平 → 饱和高密度响应

  // Transition width for smooth blending
  const tw = 0.08; // 过渡带宽度

  if (d < toeBound) {
    // Pure toe region
    return Math.pow(d, gammaToe);
  } else if (d < toeBound + tw && toeBound > 0) {
    // Toe → straight transition (Hermite blend)
    const t = (d - toeBound) / tw;
    const blend = hermite(t);
    const vToe    = Math.pow(d, gammaToe);
    const vStraight = Math.pow(d, gamma);
    return vToe * (1 - blend) + vStraight * blend;
  } else if (d > shBound) {
    // Pure shoulder region
    return Math.pow(d, gammaSh);
  } else if (d > shBound - tw && shoulder > 0) {
    // Straight → shoulder transition (Hermite blend)
    const t = (d - (shBound - tw)) / tw;
    const blend = hermite(t);
    const vStraight = Math.pow(d, gamma);
    const vShoulder = Math.pow(d, gammaSh);
    return vStraight * (1 - blend) + vShoulder * blend;
  } else {
    // Pure straight-line region
    return Math.pow(d, gamma);
  }
}

/**
 * 应用胶片曲线到 RGB 三通道
 * 
 * @param {number} r - 红色值 (0-255)
 * @param {number} g - 绿色值 (0-255)
 * @param {number} b - 蓝色值 (0-255)
 * @param {Object} profile - 胶片曲线参数
 * @returns {[number, number, number]} 处理后的 RGB 值
 */
function applyFilmCurveRGB(r, g, b, profile = {}) {
  // 逐通道 gamma（彩负不同乳剂层感光特性），与 RenderCore 浮点路径同一语义：
  // 显式 gammaR/G/B → 回退主 gamma
  const {
    gamma = 0.6,
    gammaR,
    gammaG,
    gammaB,
  } = profile;
  const base = { ...profile, gamma };
  return [
    applyFilmCurve(r, { ...base, gamma: gammaR ?? gamma }),
    applyFilmCurve(g, { ...base, gamma: gammaG ?? gamma }),
    applyFilmCurve(b, { ...base, gamma: gammaB ?? gamma }),
  ];
}

/**
 * 构建胶片曲线 LUT
 * 
 * 预计算 256 级查找表，用于批量处理
 * 
 * @param {Object} profile - 胶片曲线参数
 * @returns {Uint8Array} 256 级查找表
 */
function buildFilmCurveLUT(profile = {}) {
  const lut = new Uint8Array(256);
  
  for (let i = 0; i < 256; i++) {
    lut[i] = applyFilmCurve(i, profile);
  }
  
  return lut;
}

/**
 * 获取内置胶片曲线配置
 * 
 * @param {string} profileKey - 配置键名 (如 'portra400')
 * @returns {Object} 胶片曲线参数
 */
function getBuiltinFilmProfile(profileKey) {
  return FILM_PROFILES[profileKey] || FILM_PROFILES.default;
}

/**
 * 合并内置配置和自定义配置
 * 
 * @param {Array} customProfiles - 从数据库加载的自定义配置
 * @returns {Object} 合并后的配置对象 { key: { gamma, dMin, dMax, name, isBuiltin } }
 */
function mergeFilmProfiles(customProfiles = []) {
  // 内置配置
  const merged = {};
  for (const [key, profile] of Object.entries(FILM_PROFILES)) {
    merged[key] = {
      ...profile,
      isBuiltin: true,
    };
  }
  
  // 自定义配置覆盖或添加
  for (const custom of customProfiles) {
    merged[custom.key] = {
      gamma: custom.gamma,
      dMin: custom.dMin,
      dMax: custom.dMax,
      name: custom.name,
      category: custom.category || 'custom',
      isBuiltin: false,
      id: custom.id,
    };
  }
  
  return merged;
}

/**
 * 按类别分组胶片配置
 * 
 * @param {Object} profiles - 合并后的配置对象
 * @returns {Object} 分组后的配置 { color: [...], bw: [...], custom: [...] }
 */
function groupFilmProfilesByCategory(profiles) {
  const groups = {
    color: [],
    bw: [],
    custom: [],
  };
  
  const categoryMap = {
    portra160: 'color', portra400: 'color', portra800: 'color',
    ektar100: 'color', gold200: 'color', colorplus200: 'color',
    pro400h: 'color', superia400: 'color', c200: 'color',
    trix400: 'bw', tmax100: 'bw', tmax400: 'bw',
    hp5: 'bw', delta100: 'bw', delta400: 'bw', acros100: 'bw',
    default: 'color',
  };
  
  for (const [key, profile] of Object.entries(profiles)) {
    if (!profile.isBuiltin) {
      groups.custom.push({ key, ...profile });
    } else {
      const cat = categoryMap[key] || 'color';
      groups[cat].push({ key, ...profile });
    }
  }
  
  return groups;
}

// ============================================================================
// 模块导出 (CommonJS)
// ============================================================================

const _sharedExports = {
  applyFilmCurve,
  applyFilmCurveFloat,
  applyFilmCurveRGB,
  buildFilmCurveLUT,
  getBuiltinFilmProfile,
  mergeFilmProfiles,
  groupFilmProfilesByCategory,
  FILM_CURVE_PROFILES: FILM_PROFILES,
};
export const { applyFilmCurve, applyFilmCurveFloat, applyFilmCurveRGB, buildFilmCurveLUT, getBuiltinFilmProfile, mergeFilmProfiles, groupFilmProfilesByCategory, FILM_CURVE_PROFILES } = _sharedExports;
export default _sharedExports;
