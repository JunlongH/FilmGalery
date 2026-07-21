/**
 * 测试辅助工具
 * 
 * 提供 GLSL 解析、数值比较等公共工具函数
 */
'use strict';

// ============================================================================
// GLSL String Parsing Utilities
// ============================================================================

/**
 * 从 GLSL 源码中提取所有 uniform 声明
 * @param {string} glsl - GLSL 源码
 * @returns {Array<{type: string, name: string, line: string}>}
 */
function extractUniforms(glsl) {
  const results = [];
  const regex = /uniform\s+(sampler2D|sampler3D|float|int|vec2|vec3|vec4|mat3|mat4)\s+(\w+)\s*;/g;
  let match;
  while ((match = regex.exec(glsl)) !== null) {
    results.push({
      type: match[1],
      name: match[2],
      line: match[0].trim(),
    });
  }
  return results;
}

/**
 * 从 GLSL 源码中提取所有函数定义
 * @param {string} glsl - GLSL 源码
 * @returns {Array<string>} 函数名列表
 */
function extractFunctionNames(glsl) {
  const regex = /(?:void|float|vec[234]|mat[234]|int|bool)\s+(\w+)\s*\(/g;
  const names = new Set();
  let match;
  while ((match = regex.exec(glsl)) !== null) {
    // 排除 main() — 它是入口，不是可重用函数
    if (match[1] !== 'main') {
      names.add(match[1]);
    }
  }
  return [...names];
}

/**
 * 从 GLSL main() 中按注释标记提取流水线步骤
 * @param {string} glsl - GLSL main() 源码
 * @returns {Array<string>} 步骤编号列表 (如 ['①', '②', '②.5', '③', ...])
 */
function extractPipelineSteps(glsl) {
  // 匹配 // ①, // ②, // ②.5, // ③b 等格式
  const regex = /\/\/\s*([①②③④⑤⑥⑦⑧][\.½b]?\d*[a-e]?)/g;
  const steps = [];
  let match;
  while ((match = regex.exec(glsl)) !== null) {
    steps.push(match[1]);
  }
  return steps;
}

/**
 * 检查 GLSL 中是否使用了 int 类型的 uniform（应该全部是 float）
 * @param {string} glsl - GLSL 源码
 * @returns {Array<string>} 使用了 int 类型的 uniform 名
 */
function findIntUniforms(glsl) {
  const uniforms = extractUniforms(glsl);
  return uniforms
    .filter(u => u.type === 'int')
    .map(u => u.name);
}

/**
 * 检查 GLSL 代码中的 > 0.5 float 布尔判断模式
 * @param {string} glsl - GLSL 源码
 * @param {string} uniformName - uniform 名称
 * @returns {boolean} 是否使用 > 0.5 模式
 */
function usesFloatBoolPattern(glsl, uniformName) {
  // 匹配 uniformName > 0.5 或 uniformName < 0.5
  const regex = new RegExp(`${uniformName}\\s*[><]=?\\s*0\\.5`, 'g');
  return regex.test(glsl);
}

// ============================================================================
// Numerical Comparison Utilities
// ============================================================================

/**
 * 近似相等比较
 * @param {number} a 
 * @param {number} b 
 * @param {number} epsilon 
 * @returns {boolean}
 */
function approxEqual(a, b, epsilon = 1e-6) {
  return Math.abs(a - b) < epsilon;
}

/**
 * 批量近似比较（RGB 向量）
 * @param {number[]} a 
 * @param {number[]} b 
 * @param {number} epsilon 
 * @returns {boolean}
 */
function approxEqualVec(a, b, epsilon = 1e-4) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]) < epsilon);
}

// ============================================================================
// CPU Reference Implementations (from GLSL algorithms, for numerical testing)
// ============================================================================

/**
 * 对比度公式 CPU 参考实现 (匹配 GLSL applyContrast)
 * @param {number} value - 输入值 (0-1)
 * @param {number} contrast - UI contrast (-100..100)
 * @returns {number} 输出值
 */
function cpuContrast(value, contrast) {
  const C = contrast * 2.55; // ×2.55 scaling
  const factor = (259 * (C + 255)) / (255 * (259 - C));
  const midGray = 0.46; // CONTRAST_MID_GRAY
  return (value - midGray) * factor + midGray;
}

/**
 * Hermite smoothstep (匹配 GLSL splitToneSmoothstep)
 * @param {number} t 
 * @returns {number}
 */
function cpuSmoothstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

/**
 * 高光压缩 tanh (匹配 GLSL applyHighlightRollOff)
 * @param {number[]} rgb - [r, g, b]
 * @returns {number[]}
 */
function cpuHighlightRollOff(rgb) {
  const [r, g, b] = rgb;
  const maxVal = Math.max(r, g, b);
  const threshold = 0.8;
  if (maxVal > threshold) {
    const headroom = 1.0 - threshold;
    const tRO = Math.min((maxVal - threshold) / headroom, 10.0);
    const e2t = Math.exp(2.0 * tRO);
    const tanhT = (e2t - 1.0) / (e2t + 1.0);
    const compressed = threshold + headroom * tanhT;
    const scale = compressed / maxVal;
    return [r * scale, g * scale, b * scale];
  }
  return [r, g, b];
}

/**
 * HSL 通道权重 (匹配 GLSL hslChannelWeight)
 * @param {number} hue 
 * @param {number} centerHue 
 * @param {number} hueRange 
 * @returns {number}
 */
function cpuHslChannelWeight(hue, centerHue, hueRange) {
  const dist = Math.min(Math.abs(hue - centerHue), 360 - Math.abs(hue - centerHue));
  if (dist >= hueRange) return 0;
  const t = dist / hueRange;
  return 0.5 * (1 + Math.cos(t * Math.PI));
}

/**
 * Bernstein basis shadows/highlights (匹配 GLSL applyHighlightsShadows)
 * @param {number[]} rgb 
 * @param {number} shadows 
 * @param {number} highlights 
 * @returns {number[]}
 */
function cpuHighlightsShadows(rgb, shadows, highlights) {
  const sFactor = shadows * 0.005;
  const hFactor = highlights * 0.005;
  return rgb.map(c => {
    let v = c;
    if (sFactor !== 0) {
      v += sFactor * Math.pow(1 - v, 2) * v * 4;
    }
    if (hFactor !== 0) {
      v += hFactor * Math.pow(v, 2) * (1 - v) * 4;
    }
    return v;
  });
}

/**
 * Whites & Blacks (匹配 GLSL applyWhitesBlacks)
 * @param {number[]} rgb 
 * @param {number} blacks 
 * @param {number} whites 
 * @returns {number[]}
 */
function cpuWhitesBlacks(rgb, blacks, whites) {
  const blackPoint = -(blacks) * 0.002;
  const whitePoint = 1.0 - (whites) * 0.002;
  if (whitePoint === blackPoint) return rgb;
  return rgb.map(c => (c - blackPoint) / (whitePoint - blackPoint));
}

/**
 * Exposure (匹配 GLSL pow(2, u_exposure / 50))
 * @param {number[]} rgb 
 * @param {number} exposure 
 * @returns {number[]}
 */
function cpuExposure(rgb, exposure) {
  const factor = Math.pow(2, exposure / 50);
  return rgb.map(c => c * factor);
}

/**
 * Split Tone zone weights (匹配 GLSL applySplitTone / CPU calculateZoneWeights)
 * 单位分解：shadow + midtone + highlight ≡ 1，连续 smoothstep 过渡
 * @param {number} lum - luminance (0-1)
 * @param {number} balance - balance value (-1..1, pre-divided by 100)
 * @returns {{shadow: number, midtone: number, highlight: number}}
 */
function cpuSplitToneZoneWeights(lum, balance) {
  const balanceOffset = balance / 2.0;
  const shadowEnd = 0.25;
  const highlightStart = 0.75;
  const midpoint = Math.min(Math.max(0.5 + balanceOffset, shadowEnd + 0.05), highlightStart - 0.05);

  let shadowWeight = 0;
  let highlightWeight = 0;

  // Shadow zone: 1 below shadowEnd, smooth ramp to 0 at midpoint
  if (lum <= shadowEnd) {
    shadowWeight = 1;
  } else if (lum < midpoint) {
    shadowWeight = 1 - cpuSmoothstep((lum - shadowEnd) / (midpoint - shadowEnd));
  }

  // Highlight zone: 1 above highlightStart, smooth ramp from 0 at midpoint
  if (lum >= highlightStart) {
    highlightWeight = 1;
  } else if (lum > midpoint) {
    highlightWeight = cpuSmoothstep((lum - midpoint) / (highlightStart - midpoint));
  }

  // Midtone takes the remainder — weights always sum to 1
  const midtoneWeight = 1 - shadowWeight - highlightWeight;

  return { shadow: shadowWeight, midtone: midtoneWeight, highlight: highlightWeight };
}

module.exports = {
  // GLSL parsing
  extractUniforms,
  extractFunctionNames,
  extractPipelineSteps,
  findIntUniforms,
  usesFloatBoolPattern,
  // Numerical
  approxEqual,
  approxEqualVec,
  // CPU reference implementations
  cpuContrast,
  cpuSmoothstep,
  cpuHighlightRollOff,
  cpuHslChannelWeight,
  cpuHighlightsShadows,
  cpuWhitesBlacks,
  cpuExposure,
  cpuSplitToneZoneWeights,
};
