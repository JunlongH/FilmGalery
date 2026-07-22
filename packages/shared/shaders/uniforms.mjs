/**
 * GLSL Uniforms 声明
 * 
 * 统一的 uniform 变量声明，确保客户端和服务端使用相同的变量名和类型
 * 
 * 设计规范：
 * - 所有布尔类标志位使用 float (非 int)，判断用 > 0.5
 * - Split Tone uniforms 使用 u_split* 前缀以区分 tone mapping highlights
 * - Film Curve 支持 per-channel gamma + toe/shoulder (Q13)
 * 
 * @version 2.0.0 — float types, per-channel film curve, u_split* naming
 */

const UNIFORMS_GLSL = `
// Image texture
uniform sampler2D u_image;

// Inversion (float for WebGL1/2 compat — test with > 0.5)
uniform float u_inverted;      // 0.0 = no inversion, 1.0 = invert
uniform float u_inversionMode; // 0.0 = linear, 1.0 = log

// Phase I: 线性域反转（0.0 = gamma 域，1.0 = 线性光下做片基校正+反转）
uniform float u_linearDomainInversion;

// White Balance
uniform vec3 u_gains;          // r,g,b gains

// Tone adjustments (raw values from UI, see shader for scaling)
uniform float u_exposure;      // -100..100
uniform float u_contrast;      // -100..100
uniform float u_highlights;    // -100..100
uniform float u_shadows;       // -100..100
uniform float u_whites;        // -100..100
uniform float u_blacks;        // -100..100

// Film Curve parameters (Q13: per-channel gamma + toe/shoulder)
uniform float u_filmCurveEnabled;
uniform float u_filmCurveGamma;
uniform float u_filmCurveGammaR;
uniform float u_filmCurveGammaG;
uniform float u_filmCurveGammaB;
uniform float u_filmCurveDMin;
uniform float u_filmCurveDMax;
uniform float u_filmCurveToe;
uniform float u_filmCurveShoulder;

// Film Base Correction (Pre-Inversion)
uniform float u_baseMode;      // 0.0 = linear (gains), 1.0 = log (density subtraction)
uniform vec3 u_baseGains;      // Linear mode: r,g,b gains
uniform vec3 u_baseDensity;    // Log mode: r,g,b density values to subtract

// Density Levels (Log domain auto-levels)
uniform float u_densityLevelsEnabled;
uniform vec3 u_densityLevelsMin;
uniform vec3 u_densityLevelsMax;

// Curve LUTs (1D textures)
uniform sampler2D u_curveRGB;
uniform sampler2D u_curveR;
uniform sampler2D u_curveG;
uniform sampler2D u_curveB;
uniform float u_useCurves;

// 3D LUT (packed 2D texture for WebGL1; native 3D texture for WebGL2)
uniform sampler2D u_lut3d;
uniform float u_useLut3d;
uniform float u_lutSize;
uniform float u_lutIntensity;

// HSL adjustments (8 channels x 3 values: hue, saturation, luminance)
uniform float u_useHSL;
uniform vec3 u_hslRed;
uniform vec3 u_hslOrange;
uniform vec3 u_hslYellow;
uniform vec3 u_hslGreen;
uniform vec3 u_hslCyan;
uniform vec3 u_hslBlue;
uniform vec3 u_hslPurple;
uniform vec3 u_hslMagenta;

// Global Saturation (Luma-Preserving, Rec.709)
uniform float u_useSaturation;
uniform float u_saturation;    // -100..100, 0 = identity

// Split Toning (u_split* prefix to distinguish from tone mapping highlights)
uniform float u_useSplitTone;
uniform float u_splitHighlightHue;
uniform float u_splitHighlightSat;
uniform float u_splitMidtoneHue;
uniform float u_splitMidtoneSat;
uniform float u_splitShadowHue;
uniform float u_splitShadowSat;
uniform float u_splitBalance;
`;

export {
  UNIFORMS_GLSL,
}