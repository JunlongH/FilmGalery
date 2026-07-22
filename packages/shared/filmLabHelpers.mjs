/**
 * FilmLab 共享辅助函数
 * 
 * @module filmLabHelpers
 * @description 统一的辅助函数，确保 WebGL/CPU/Server 各路径行为一致
 * 
 * 设计目标：
 * - 集中处理 sourceType 与 inverted 的关系
 * - 提供 WebGL 与 CPU 共用的 LUT 打包/采样逻辑
 * - 统一参数验证和规范化
 */

'use strict';

// Debug flag - set to true for detailed logging
const DEBUG_LUT = false;

// ============================================================================
// 反转状态计算
// ============================================================================

/**
 * 计算有效的反转状态
 * 
 * 规则：
 * - sourceType === 'positive' → 永远不反转（正片不需要反转）
 * - 其他情况 → 使用用户设置的 inverted 值
 * 
 * @param {string} sourceType - 源类型: 'original' | 'negative' | 'positive'
 * @param {boolean} inverted - 用户设置的反转状态
 * @returns {boolean} 实际应该使用的反转状态
 */
function getEffectiveInverted(sourceType, inverted) {
  if (sourceType === 'positive') {
    return false;
  }
  return !!inverted;
}

/**
 * 检查是否为正片模式
 * 
 * @param {string} sourceType - 源类型
 * @returns {boolean}
 */
function isPositiveMode(sourceType) {
  return sourceType === 'positive';
}

/**
 * 检查是否需要反转 UI 控件
 * 
 * @param {string} sourceType - 源类型
 * @returns {boolean} 是否应该显示反转相关控件
 */
function shouldShowInversionControls(sourceType) {
  return sourceType !== 'positive';
}

// ============================================================================
// 3D LUT 辅助函数
// ============================================================================

/**
 * 计算 3D LUT 索引
 * 
 * 标准 .cube 文件顺序: for B { for G { for R { ... } } }
 * 索引公式: index = r + g*size + b*size*size
 * 
 * @param {number} r - 红色索引 (0 to size-1)
 * @param {number} g - 绿色索引 (0 to size-1)
 * @param {number} b - 蓝色索引 (0 to size-1)
 * @param {number} size - LUT 尺寸 (如 33)
 * @returns {number} 在扁平数组中的索引 (乘以3得到RGB数据起始位置)
 */
function getLUT3DIndex(r, g, b, size) {
  return r + g * size + b * size * size;
}

/**
 * 将 3D LUT Float32Array 打包为 WebGL 纹理格式
 * 
 * 输入: size^3 * 3 的 Float32Array (RGB值 0-1)
 * 输出: 可上传到 WebGL 的 Uint8Array (width=size, height=size*size)
 * 
 * 纹理布局:
 * - X 轴: R 通道 (0 to size-1)
 * - Y 轴: G + B*size (0 to size*size-1)
 * 
 * @param {Float32Array} data - 原始 LUT 数据
 * @param {number} size - LUT 尺寸
 * @returns {Uint8Array} 打包后的 RGBA 纹理数据
 */
function packLUT3DForWebGL(data, size) {
  const w = size;
  const h = size * size;
  const buf = new Uint8Array(w * h * 4);
  
  let ptr = 0;
  // 按照纹理坐标顺序填充：Y轴 = g + b*size, X轴 = r
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        // 从原始数据中读取
        const srcIdx = getLUT3DIndex(r, g, b, size) * 3;
        const vr = Math.max(0, Math.min(1, data[srcIdx]));
        const vg = Math.max(0, Math.min(1, data[srcIdx + 1]));
        const vb = Math.max(0, Math.min(1, data[srcIdx + 2]));
        
        buf[ptr++] = Math.round(vr * 255);
        buf[ptr++] = Math.round(vg * 255);
        buf[ptr++] = Math.round(vb * 255);
        buf[ptr++] = 255;
      }
    }
  }
  
  return buf;
}

/**
 * 合并两个 3D LUT，考虑各自的强度
 * 
 * @param {Object|null} lut1 - 第一个 LUT { size, data, intensity }
 * @param {Object|null} lut2 - 第二个 LUT { size, data, intensity }
 * @returns {Object|null} 合并后的 LUT { size, data }
 */
function buildCombinedLUT(lut1, lut2) {
  const a = lut1;
  const b = lut2;
  const base = a || b;
  if (!base || !base.data) return null;
  
  const size = base.size;
  const total = size * size * size;
  const out = new Float32Array(total * 3);
  
  const aData = a ? a.data : null;
  const aInt = a ? (a.intensity ?? 1.0) : 0;
  const bData = b ? b.data : null;
  const bInt = b ? (b.intensity ?? 1.0) : 0;
  
  // 调试日志 - 验证输入 LUT 数据
  if (DEBUG_LUT) {
    console.log('[buildCombinedLUT] Input:', {
      hasLut1: !!a, lut1Size: a?.size, lut1Intensity: a?.intensity,
      hasLut2: !!b, lut2Size: b?.size, lut2Intensity: b?.intensity,
      aInt, bInt, total
    });
    
    // 关键调试：打印 aData 中 red 位置的值（验证 LUT 数据本身是否正确）
    if (aData && size >= 17) {
      const redIdx = (size - 1) * 3;  // r=size-1, g=0, b=0
      console.log('[buildCombinedLUT] aData verification:', {
        'aData[0..8]': [aData[0], aData[1], aData[2], aData[3], aData[4], aData[5], aData[6], aData[7], aData[8]],
        'aData at red (r=max,g=0,b=0)': [aData[redIdx], aData[redIdx+1], aData[redIdx+2]],
        'aData length': aData.length
      });
    }
  }
  
  for (let i = 0, j = 0; i < total; i++, j += 3) {
    // 重建原始归一化 RGB 从索引
    const rIdx = i % size;
    const gIdx = Math.floor(i / size) % size;
    const bIdx = Math.floor(i / (size * size));
    const r0 = rIdx / (size - 1);
    const g0 = gIdx / (size - 1);
    const b0 = bIdx / (size - 1);
    
    let r = r0, g = g0, bb = b0;
    
    // 应用第一个 LUT
    if (aData && aInt > 0) {
      const ar = aData[j];
      const ag = aData[j + 1];
      const ab = aData[j + 2];
      r = r * (1 - aInt) + ar * aInt;
      g = g * (1 - aInt) + ag * aInt;
      bb = bb * (1 - aInt) + ab * aInt;
    }
    
    // 应用第二个 LUT
    if (bData && bInt > 0) {
      const br = bData[j];
      const bg = bData[j + 1];
      const bbb = bData[j + 2];
      r = r * (1 - bInt) + br * bInt;
      g = g * (1 - bInt) + bg * bInt;
      bb = bb * (1 - bInt) + bbb * bInt;
    }
    
    out[j] = r;
    out[j + 1] = g;
    out[j + 2] = bb;
  }
  
  // 调试：验证输出数据的几个关键点
  if (DEBUG_LUT) {
    console.log('[buildCombinedLUT] Output sample:',
      'black:', out[0].toFixed(3), out[1].toFixed(3), out[2].toFixed(3),
      'white:', out[(total-1)*3].toFixed(3), out[(total-1)*3+1].toFixed(3), out[(total-1)*3+2].toFixed(3),
      'mid:', out[Math.floor(total/2)*3].toFixed(3), out[Math.floor(total/2)*3+1].toFixed(3), out[Math.floor(total/2)*3+2].toFixed(3)
    );
  }
  
  // intensity 设为 1.0，因为强度已经在合并过程中被应用（烘焙）
  return { size, data: out, intensity: 1.0 };
}

/**
 * 对 3D LUT 进行三线性插值采样
 * 
 * @param {number} r - 红色 (0-255)
 * @param {number} g - 绿色 (0-255)
 * @param {number} b - 蓝色 (0-255)
 * @param {Object} lut - LUT 对象 { size, data }
 * @param {number} intensity - 强度 (0-1)
 * @returns {[number, number, number]} 采样后的 RGB (0-255)
 */
function sampleLUT3D(r, g, b, lut, intensity = 1) {
  if (!lut || !lut.data || !lut.size) {
    return [r, g, b];
  }

  const { size, data } = lut;
  const maxIndex = size - 1;

  // 归一化到 0-1
  const rNorm = Math.max(0, Math.min(255, r)) / 255;
  const gNorm = Math.max(0, Math.min(255, g)) / 255;
  const bNorm = Math.max(0, Math.min(255, b)) / 255;

  // 映射到 LUT 坐标
  const rPos = rNorm * maxIndex;
  const gPos = gNorm * maxIndex;
  const bPos = bNorm * maxIndex;

  const r0 = Math.floor(rPos);
  const r1 = Math.min(maxIndex, r0 + 1);
  const g0 = Math.floor(gPos);
  const g1 = Math.min(maxIndex, g0 + 1);
  const b0 = Math.floor(bPos);
  const b1 = Math.min(maxIndex, b0 + 1);

  const fr = rPos - r0;
  const fg = gPos - g0;
  const fb = bPos - b0;

  const getIdx = (ri, gi, bi) => getLUT3DIndex(ri, gi, bi, size) * 3;

  // 三线性插值
  const interp = (offset) => {
    const v000 = data[getIdx(r0, g0, b0) + offset];
    const v100 = data[getIdx(r1, g0, b0) + offset];
    const v010 = data[getIdx(r0, g1, b0) + offset];
    const v110 = data[getIdx(r1, g1, b0) + offset];
    const v001 = data[getIdx(r0, g0, b1) + offset];
    const v101 = data[getIdx(r1, g0, b1) + offset];
    const v011 = data[getIdx(r0, g1, b1) + offset];
    const v111 = data[getIdx(r1, g1, b1) + offset];

    const c00 = v000 * (1 - fr) + v100 * fr;
    const c10 = v010 * (1 - fr) + v110 * fr;
    const c01 = v001 * (1 - fr) + v101 * fr;
    const c11 = v011 * (1 - fr) + v111 * fr;

    const c0 = c00 * (1 - fg) + c10 * fg;
    const c1 = c01 * (1 - fg) + c11 * fg;

    return c0 * (1 - fb) + c1 * fb;
  };

  // P2-10: clamp 输出到 [0, 255]（HDR .cube LUT 数据可能 >1.0，*255 后越界）
  const rOut = Math.max(0, Math.min(255, interp(0) * 255));
  const gOut = Math.max(0, Math.min(255, interp(1) * 255));
  const bOut = Math.max(0, Math.min(255, interp(2) * 255));

  // 应用强度
  if (intensity >= 1) {
    return [rOut, gOut, bOut];
  }

  return [
    r + (rOut - r) * intensity,
    g + (gOut - g) * intensity,
    b + (bOut - b) * intensity,
  ];
}

// ============================================================================
// 参数验证
// ============================================================================

/**
 * 验证 sourceType 参数
 * 
 * @param {string} sourceType - 源类型
 * @returns {string} 规范化后的 sourceType
 */
function normalizeSourceType(sourceType) {
  const valid = ['original', 'negative', 'positive'];
  if (valid.includes(sourceType)) {
    return sourceType;
  }
  return 'original'; // 默认值
}

/**
 * 验证并规范化 inversionMode
 * 
 * @param {string} mode - 反转模式
 * @returns {string} 规范化后的模式
 */
function normalizeInversionMode(mode) {
  const valid = ['linear', 'log'];
  if (valid.includes(mode)) {
    return mode;
  }
  return 'linear';
}

// ============================================================================
// GLSL 代码片段生成
// ============================================================================

/**
 * 获取 3D LUT 采样的 GLSL 代码
 * 
 * 与 JavaScript 版本的 sampleLUT3D 保持一致
 * 
 * @returns {string} GLSL 代码片段
 */
function getLUT3DSamplingGLSL() {
  return `
// 3D LUT 采样 (与 CPU 版本一致)
// 纹理布局: X = R, Y = G + B*size
vec3 sampleLUT3D(vec3 c) {
  int size = u_lutSize;
  float sz = float(size);
  
  // 映射到 [0..size-1]
  float rf = c.r * (sz - 1.0);
  float gf = c.g * (sz - 1.0);
  float bf = c.b * (sz - 1.0);

  float r0 = floor(rf);
  float g0 = floor(gf);
  float b0 = floor(bf);
  float r1 = min(sz - 1.0, r0 + 1.0);
  float g1 = min(sz - 1.0, g0 + 1.0);
  float b1 = min(sz - 1.0, b0 + 1.0);

  // 采样 8 个角点
  vec3 c000, c100, c010, c110, c001, c101, c011, c111;
  vec2 uv;

  // UV 计算: x = (r + 0.5) / size, y = (g + b*size + 0.5) / (size*size)
  uv.x = (r0 + 0.5) / sz;
  uv.y = (g0 + b0 * sz + 0.5) / (sz * sz);
  c000 = texture2D(u_lut3d, uv).rgb;

  uv.x = (r1 + 0.5) / sz;
  uv.y = (g0 + b0 * sz + 0.5) / (sz * sz);
  c100 = texture2D(u_lut3d, uv).rgb;

  uv.x = (r0 + 0.5) / sz;
  uv.y = (g1 + b0 * sz + 0.5) / (sz * sz);
  c010 = texture2D(u_lut3d, uv).rgb;

  uv.x = (r1 + 0.5) / sz;
  uv.y = (g1 + b0 * sz + 0.5) / (sz * sz);
  c110 = texture2D(u_lut3d, uv).rgb;

  uv.x = (r0 + 0.5) / sz;
  uv.y = (g0 + b1 * sz + 0.5) / (sz * sz);
  c001 = texture2D(u_lut3d, uv).rgb;

  uv.x = (r1 + 0.5) / sz;
  uv.y = (g0 + b1 * sz + 0.5) / (sz * sz);
  c101 = texture2D(u_lut3d, uv).rgb;

  uv.x = (r0 + 0.5) / sz;
  uv.y = (g1 + b1 * sz + 0.5) / (sz * sz);
  c011 = texture2D(u_lut3d, uv).rgb;

  uv.x = (r1 + 0.5) / sz;
  uv.y = (g1 + b1 * sz + 0.5) / (sz * sz);
  c111 = texture2D(u_lut3d, uv).rgb;

  // 三线性插值
  float fr = rf - r0;
  float fg = gf - g0;
  float fb = bf - b0;

  vec3 c00 = mix(c000, c100, fr);
  vec3 c10 = mix(c010, c110, fr);
  vec3 c01 = mix(c001, c101, fr);
  vec3 c11 = mix(c011, c111, fr);

  vec3 c0 = mix(c00, c10, fg);
  vec3 c1 = mix(c01, c11, fg);

  return mix(c0, c1, fb);
}

// 带强度的 LUT 采样
vec3 sampleLUT3DWithIntensity(vec3 c, float intensity) {
  if (intensity <= 0.0) return c;
  vec3 lutColor = sampleLUT3D(c);
  return mix(c, lutColor, intensity);
}
`;
}

// ============================================================================
// 模块导出
// ============================================================================

export {
  // 反转状态
  getEffectiveInverted,
  isPositiveMode,
  shouldShowInversionControls,
  
  // 3D LUT
  getLUT3DIndex,
  packLUT3DForWebGL,
  buildCombinedLUT,
  sampleLUT3D,
  
  // 参数验证
  normalizeSourceType,
  normalizeInversionMode,
  
  // GLSL 代码生成
  getLUT3DSamplingGLSL,
}