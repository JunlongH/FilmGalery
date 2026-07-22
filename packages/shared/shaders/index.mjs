/**
 * @filmgallery/shared/shaders
 * 
 * 统一的 GLSL 着色器库 — 单一事实来源 (Single Source of Truth)
 * 
 * @module packages/shared/shaders
 * @description
 * 此模块提供共享的 GLSL 着色器代码片段，供 FilmLabWebGL.js（客户端预览）
 * 和 gpu-renderer.js（GPU 导出）使用，保证色彩科学处理的一致性。
 * 
 * 架构说明：
 * - colorMath: RGB/HSL 转换、亮度计算等基础数学函数
 * - hslAdjust: HSL 通道调整（8通道，非对称饱和度/明度，权重归一化）
 * - splitTone: 分离色调（Hermite smoothstep，lerp-to-tint 混合）
 * - filmCurve: 胶片特性曲线（3段 S-curve + per-channel gamma）
 * - tonemap: 色调映射（对比度以0.46中灰为中心，tanh高光压缩）
 * - lut3d: 3D LUT 采样（打包2D纹理 / WebGL2 sampler3D）
 * - inversion: 负片反转（线性/对数模式）
 * - baseDensity: 片基校正（密度域减法）
 * - uniforms: 统一 uniform 声明
 * 
 * 处理流水线顺序（匹配 CPU RenderCore + GPU glsl-shared.js）：
 * ① Film Curve (per-channel gamma + toe/shoulder, before inversion)
 * ② Base Correction (density subtraction / gain multiplication)
 * ②.5 Density Levels (log domain auto-levels)
 * ③ Inversion (linear / log)
 * ③b 3D LUT (applied AFTER inversion, not at end)
 * ④ White Balance (RGB gains)
 * ⑤a Exposure (f-stop: pow(2, exp/50))
 * ⑤b Contrast (around mid-gray 0.46)
 * ⑤c Blacks & Whites (window remap)
 * ⑤d Shadows & Highlights (Bernstein basis)
 * ⑤e Highlight Roll-Off (tanh shoulder compression)
 * Clamp [0,1]
 * ⑥ Curves (1D LUT)
 * ⑦ HSL Adjustment * ⑦b Saturation (Luma-Preserving) * ⑧ Split Toning
 * 
 * @version 2.0.0 — 统一所有渲染路径，修复 BUG-01~16
 * @since 2026-01-29
 */

import colorMath from './colorMath.mjs';
import hslAdjust from './hslAdjust.mjs';
import splitTone from './splitTone.mjs';
import filmCurve from './filmCurve.mjs';
import tonemap from './tonemap.mjs';
import lut3d from './lut3d.mjs';
import inversion from './inversion.mjs';
import baseDensity from './baseDensity.mjs';
import saturation from './saturation.mjs';
import uniforms from './uniforms.mjs';

/**
 * 构建完整的片元着色器源码
 * 
 * @param {Object} options - 构建选项
 * @param {boolean} options.isGL2 - 是否为 WebGL2 (支持 sampler3D, texture(), #version 300 es)
 * @param {boolean} options.useCompositeCurve - 使用单一 RGBA 复合曲线纹理 (gpu-renderer 路径)
 * @param {boolean} options.useNativeLUT3D - 使用 WebGL2 原生 sampler3D（仅 isGL2=true 时有效）。
 *   默认跟随 isGL2（向后兼容 gpu-renderer 路径）。
 *   客户端预览应传 false 以使用 packed-2D 路径（避免 3D 纹理上传实现）。
 * @param {string} options.precision - 精度 ('lowp', 'mediump', 'highp')
 * @returns {string} 完整的 GLSL 片元着色器代码
 */
function buildFragmentShader(options = {}) {
  const {
    isGL2 = false,
    useCompositeCurve = false,
    precision = 'mediump',
  } = options;
  // LUT 路径解耦：客户端预览可显式禁用原生 sampler3D（即使运行在 WebGL2 上下文）
  // 避免客户端需实现 texImage3D 上传路径；服务端 gpu-renderer 保持默认启用
  const useNativeLUT3D = options.useNativeLUT3D !== undefined ? options.useNativeLUT3D : isGL2;

  if (isGL2) {
    return `#version 300 es
precision highp float;
${useNativeLUT3D ? 'precision highp sampler3D;\n' : ''}
// WebGL2 compat: modules may use texture2D()
#define texture2D texture

in vec2 v_uv;
out vec4 fragColor;

${useNativeLUT3D ? `
// WebGL2: 3D LUT as native sampler3D
uniform sampler3D u_lut3dTex;
uniform float u_hasLut3d;
uniform float u_lut3dSize;
` : ''}
${useCompositeCurve ? `
// Composite curve texture (gpu-renderer path: R,G,B channels = per-channel curves)
uniform sampler2D u_toneCurveTex;
` : ''}

${uniforms.UNIFORMS_GLSL}
${colorMath.COLOR_MATH_GLSL}
${filmCurve.FILM_CURVE_GLSL}
${baseDensity.BASE_DENSITY_GLSL}
${inversion.INVERSION_GLSL}
${tonemap.TONEMAP_GLSL}
${useNativeLUT3D ? '' : lut3d.LUT3D_GLSL}
${hslAdjust.HSL_ADJUST_GLSL}
${saturation.getSaturationGLSL()}
${splitTone.SPLIT_TONE_GLSL}
${buildMainFunction({ isGL2: true, useCompositeCurve, useNativeLUT3D })}
`;
  } else {
    return `
precision ${precision} float;
varying vec2 v_uv;

${uniforms.UNIFORMS_GLSL}
${colorMath.COLOR_MATH_GLSL}
${filmCurve.FILM_CURVE_GLSL}
${baseDensity.BASE_DENSITY_GLSL}
${inversion.INVERSION_GLSL}
${tonemap.TONEMAP_GLSL}
${lut3d.LUT3D_GLSL}
${hslAdjust.HSL_ADJUST_GLSL}
${saturation.getSaturationGLSL()}
${splitTone.SPLIT_TONE_GLSL}
${buildMainFunction({ isGL2: false })}
`;
  }
}

/**
 * 构建主函数 — 匹配 CPU RenderCore + GPU glsl-shared.js 流水线
 * 
 * @param {Object} options
 * @param {boolean} options.isGL2 - WebGL2 mode
 * @param {boolean} options.useCompositeCurve - Use single RGBA composite curve texture
 * @param {boolean} options.useNativeLUT3D - Use native sampler3D (WebGL2 only); false → packed-2D
 */
function buildMainFunction(options = {}) {
  const { isGL2 = false, useCompositeCurve = false } = options;
  // 与 buildFragmentShader 一致：未显式指定时跟随 isGL2（向后兼容 gpu-renderer 路径）
  const useNativeLUT3D = options.useNativeLUT3D !== undefined ? options.useNativeLUT3D : isGL2;
  const TEX = isGL2 ? 'texture' : 'texture2D';
  const FRAG_OUT = isGL2 ? 'fragColor' : 'gl_FragColor';

  // Curve sampling: composite RGBA texture vs separate 1D textures
  const curveSampling = useCompositeCurve ? `
    // Composite curve texture: R,G,B channels contain per-channel curve data
    c.r = ${TEX}(u_toneCurveTex, vec2(c.r, 0.5)).r;
    c.g = ${TEX}(u_toneCurveTex, vec2(c.g, 0.5)).g;
    c.b = ${TEX}(u_toneCurveTex, vec2(c.b, 0.5)).b;
  ` : `
    // Separate 1D curve textures: master RGB + per-channel
    c = applyCurvesLUT(c);
  `;

  return `
void main() {
  vec3 c = ${TEX}(u_image, v_uv).rgb;

  // ① Film Curve (before inversion) — Q13: per-channel gamma + toe/shoulder S-curve
  if (u_inverted > 0.5 && u_filmCurveEnabled > 0.5) {
    float toe = u_filmCurveToe;
    float sh  = u_filmCurveShoulder;
    c.r = applyFilmCurve(c.r, u_filmCurveGammaR, u_filmCurveDMin, u_filmCurveDMax, toe, sh);
    c.g = applyFilmCurve(c.g, u_filmCurveGammaG, u_filmCurveDMin, u_filmCurveDMax, toe, sh);
    c.b = applyFilmCurve(c.b, u_filmCurveGammaB, u_filmCurveDMin, u_filmCurveDMax, toe, sh);
  }

  // Phase I：线性域反转（与 CPU processPixelFloat 同语义）— 片基校正/密度色阶/反转在线性光下进行
  if (u_linearDomainInversion > 0.5) {
    c = srgbToLinear(c);
  }

  // ② Base Correction — neutralize film base color
  if (u_baseMode > 0.5) {
    float minT = 0.001;
    float log10 = log(10.0);
    float Tr = max(c.r, minT);
    c.r = pow(10.0, -(-log(Tr) / log10 - u_baseDensity.r));
    float Tg = max(c.g, minT);
    c.g = pow(10.0, -(-log(Tg) / log10 - u_baseDensity.g));
    float Tb = max(c.b, minT);
    c.b = pow(10.0, -(-log(Tb) / log10 - u_baseDensity.b));
    c = clamp(c, 0.0, 1.0);
  } else {
    c = clamp(c * u_baseGains, 0.0, 1.0);
  }

  // ②.5 Density Levels (Log domain auto-levels)
  if (u_densityLevelsEnabled > 0.5) {
    float minT = 0.001;
    float log10 = log(10.0);
    float rangeR = u_densityLevelsMax.r - u_densityLevelsMin.r;
    float rangeG = u_densityLevelsMax.g - u_densityLevelsMin.g;
    float rangeB = u_densityLevelsMax.b - u_densityLevelsMin.b;
    float avgRange = clamp((rangeR + rangeG + rangeB) / 3.0, 0.5, 2.5);

    if (rangeR > 0.001) {
      float Dr = -log(max(c.r, minT)) / log10;
      c.r = pow(10.0, -clamp((Dr - u_densityLevelsMin.r) / rangeR, 0.0, 1.0) * avgRange);
    }
    if (rangeG > 0.001) {
      float Dg = -log(max(c.g, minT)) / log10;
      c.g = pow(10.0, -clamp((Dg - u_densityLevelsMin.g) / rangeG, 0.0, 1.0) * avgRange);
    }
    if (rangeB > 0.001) {
      float Db = -log(max(c.b, minT)) / log10;
      c.b = pow(10.0, -clamp((Db - u_densityLevelsMin.b) / rangeB, 0.0, 1.0) * avgRange);
    }
    c = clamp(c, 0.0, 1.0);
  }

  // ③ Inversion
  if (u_inverted > 0.5) {
    if (u_inversionMode > 0.5) {
      c = vec3(1.0) - log(c * 255.0 + vec3(1.0)) / log(256.0);
    } else {
      c = vec3(1.0) - c;
    }
  }

  // Phase I：转回 sRGB 编码域（LUT/WB/Tone 仍在 sRGB 域）
  if (u_linearDomainInversion > 0.5) {
    c = linearToSrgb(c);
  }

${useNativeLUT3D ? `
  // ③b 3D LUT (WebGL2 native sampler3D — applied AFTER inversion)
  if (u_hasLut3d > 0.5) {
    float size = u_lut3dSize;
    vec3 uvw = c * (size - 1.0) / size + 0.5 / size;
    vec3 lutColor = texture(u_lut3dTex, uvw).rgb;
    c = mix(c, lutColor, u_lutIntensity);
  }
` : `
  // ③b 3D LUT (packed 2D texture — works in both WebGL1 and WebGL2)
  if (u_useLut3d > 0.5) {
    vec3 lutColor = sampleLUT3D(c);
    c = mix(c, lutColor, u_lutIntensity);
  }
`}

  // ④ White Balance
  c *= u_gains;

  // ⑤a Exposure (f-stop formula: pow(2, exposure/50))
  float expFactor = pow(2.0, u_exposure / 50.0);
  c *= expFactor;

  // ⑤b Contrast around perceptual mid-gray (0.46 = sRGB 18% reflectance)
  c = applyContrast(c, u_contrast);

  // ⑤c Blacks & Whites (window remap)
  c = applyWhitesBlacks(c);

  // ⑤d Shadows & Highlights (Bernstein basis)
  c = applyHighlightsShadows(c);

  // ⑤e Highlight Roll-Off (tanh shoulder compression)
  c = applyHighlightRollOff(c);

  c = clamp(c, 0.0, 1.0);

  // ⑥ Curves (1D LUT)
  if (u_useCurves > 0.5) {
  ${curveSampling}
  }

  // ⑦ HSL Adjustment
  if (u_useHSL > 0.5) {
    c = applyHSLAdjustment(c);
  }

  // ⑦b Saturation (Luma-Preserving, Rec.709)
  if (u_useSaturation > 0.5) {
    c = applySaturation(c);
  }

  // ⑧ Split Toning
  if (u_useSplitTone > 0.5) {
    c = applySplitTone(c);
  }

  ${FRAG_OUT} = vec4(c, 1.0);
}
`;
}

/**
 * 顶点着色器 (WebGL1)
 */
const VERTEX_SHADER = `
attribute vec2 a_pos;
attribute vec2 a_uv;
varying vec2 v_uv;

void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/**
 * 顶点着色器 (WebGL2)
 */
const VERTEX_SHADER_GL2 = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;

void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const _sharedExports = {
  // 构建函数
  buildFragmentShader,
  buildMainFunction,
  
  // 顶点着色器
  VERTEX_SHADER,
  VERTEX_SHADER_GL2,
  
  // 独立模块（用于自定义组合）
  colorMath,
  hslAdjust,
  splitTone,
  saturation,
  filmCurve,
  tonemap,
  lut3d,
  inversion,
  baseDensity,
  uniforms,
  
  // 着色器版本标识（用于缓存失效）
  SHADER_VERSION: '2026-02-08-v3',
};
const _e_buildFragmentShader = _sharedExports.buildFragmentShader;
export { _e_buildFragmentShader as buildFragmentShader };
const _e_buildMainFunction = _sharedExports.buildMainFunction;
export { _e_buildMainFunction as buildMainFunction };
const _e_VERTEX_SHADER = _sharedExports.VERTEX_SHADER;
export { _e_VERTEX_SHADER as VERTEX_SHADER };
const _e_VERTEX_SHADER_GL2 = _sharedExports.VERTEX_SHADER_GL2;
export { _e_VERTEX_SHADER_GL2 as VERTEX_SHADER_GL2 };
const _e_colorMath = _sharedExports.colorMath;
export { _e_colorMath as colorMath };
const _e_hslAdjust = _sharedExports.hslAdjust;
export { _e_hslAdjust as hslAdjust };
const _e_splitTone = _sharedExports.splitTone;
export { _e_splitTone as splitTone };
const _e_saturation = _sharedExports.saturation;
export { _e_saturation as saturation };
const _e_filmCurve = _sharedExports.filmCurve;
export { _e_filmCurve as filmCurve };
const _e_tonemap = _sharedExports.tonemap;
export { _e_tonemap as tonemap };
const _e_lut3d = _sharedExports.lut3d;
export { _e_lut3d as lut3d };
const _e_inversion = _sharedExports.inversion;
export { _e_inversion as inversion };
const _e_baseDensity = _sharedExports.baseDensity;
export { _e_baseDensity as baseDensity };
const _e_uniforms = _sharedExports.uniforms;
export { _e_uniforms as uniforms };
const _e_SHADER_VERSION = _sharedExports.SHADER_VERSION;
export { _e_SHADER_VERSION as SHADER_VERSION };
export default _sharedExports;
