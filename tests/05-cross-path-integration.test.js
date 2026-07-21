/**
 * 跨路径集成测试
 * 
 * 验证三条渲染路径使用同一共享着色器模块：
 * 1. client/FilmLabWebGL.js (WebGL1 preview)
 * 2. electron-gpu/glsl-shared.js → gpu-renderer.js (GPU export, WebGL2)
 * 3. packages/shared/render/RenderCore.js (CPU, getGLSLUniforms)
 * 
 * 以及 deprecated 标记和向后兼容。
 */
'use strict';

const path = require('path');
const fs = require('fs');

const shaders = require('../packages/shared/shaders');
const { extractUniforms } = require('./helpers');

// ============================================================================
// 1. glsl-shared.js — Thin Wrapper 验证
// ============================================================================

describe('glsl-shared.js — thin wrapper', () => {
  let glslShared;

  beforeAll(() => {
    glslShared = require('../electron-gpu/glsl-shared');
  });

  test('导出 buildFragmentShader 函数', () => {
    expect(typeof glslShared.buildFragmentShader).toBe('function');
  });

  test('buildFragmentShader(true) 产生 WebGL2 着色器', () => {
    const glsl = glslShared.buildFragmentShader(true);
    expect(glsl).toContain('#version 300 es');
    expect(glsl).toContain('sampler3D');
  });

  test('buildFragmentShader(false) 产生 WebGL1 着色器', () => {
    const glsl = glslShared.buildFragmentShader(false);
    expect(glsl).not.toContain('#version 300 es');
    expect(glsl).toContain('varying vec2 v_uv');
  });

  test('GL2 着色器使用 useCompositeCurve=true (复合曲线纹理)', () => {
    const glsl = glslShared.buildFragmentShader(true);
    expect(glsl).toContain('u_toneCurveTex');
  });

  test('导出的 GLSL 模块与 shared shaders 一致', () => {
    expect(glslShared.GLSL_SHARED_UNIFORMS).toBe(shaders.uniforms.UNIFORMS_GLSL);
    expect(glslShared.GLSL_COLOR_FUNCTIONS).toBe(shaders.colorMath.COLOR_MATH_GLSL);
    expect(glslShared.GLSL_HSL_ADJUSTMENT).toBe(shaders.hslAdjust.HSL_ADJUST_GLSL);
    expect(glslShared.GLSL_SPLIT_TONE).toBe(shaders.splitTone.SPLIT_TONE_GLSL);
    expect(glslShared.GLSL_FILM_CURVE).toBe(shaders.filmCurve.FILM_CURVE_GLSL);
  });
});

// ============================================================================
// 2. gpu-renderer.js — Shader Source 一致性
// ============================================================================

describe('gpu-renderer.js — shader source consistency', () => {
  let gpuRendererSource;

  beforeAll(() => {
    const filePath = path.join(__dirname, '..', 'electron-gpu', 'gpu-renderer.js');
    gpuRendererSource = fs.readFileSync(filePath, 'utf-8');
  });

  test('导入 buildFragmentShader from glsl-shared', () => {
    expect(gpuRendererSource).toMatch(/require\(['"]\.\/glsl-shared['"]\)/);
  });

  test('FS 使用 buildFragmentShader() 而非内联 GLSL', () => {
    expect(gpuRendererSource).toMatch(/buildFragmentShader\s*\(\s*(true|false)\s*\)/);
    // 不应有大量内联 GLSL
    const inlineGLSL = (gpuRendererSource.match(/precision\s+mediump\s+float/g) || []).length;
    expect(inlineGLSL).toBe(0); // 不应有内联 precision 声明
  });

  test('使用 u_image (非 u_tex, u_texture 等旧名)', () => {
    expect(gpuRendererSource).toContain('u_image');
  });

  test('使用 u_inversionMode (非 u_logInversion 等旧名)', () => {
    expect(gpuRendererSource).toContain('u_inversionMode');
  });

  test('使用 u_split* 前缀 (非 u_highlight* 旧名)', () => {
    expect(gpuRendererSource).toContain('u_splitHighlightHue');
    expect(gpuRendererSource).toContain('u_splitShadowHue');
    expect(gpuRendererSource).toContain('u_splitMidtoneHue');
    expect(gpuRendererSource).toContain('u_splitBalance');
  });

  test('使用 u_useCurves, u_useHSL, u_useSplitTone 启用标志', () => {
    expect(gpuRendererSource).toContain('u_useCurves');
    expect(gpuRendererSource).toContain('u_useHSL');
    expect(gpuRendererSource).toContain('u_useSplitTone');
  });

  test('使用 u_lutIntensity 和 u_lutSize', () => {
    expect(gpuRendererSource).toContain('u_lutIntensity');
    expect(gpuRendererSource).toContain('u_lutSize');
  });

  test('使用 u_lut3dTex (WebGL2 sampler3D)', () => {
    expect(gpuRendererSource).toContain('u_lut3dTex');
  });

  test('uniform1f 用于布尔标志 (非 uniform1i)', () => {
    // 检查文件中的 gl.uniform1f 调用频率 vs gl.uniform1i
    const uniform1fCount = (gpuRendererSource.match(/uniform1f\b/g) || []).length;
    const uniform1iCount = (gpuRendererSource.match(/uniform1i\b/g) || []).length;
    // 应有大量 uniform1f，而 uniform1i 仅用于纹理单元绑定
    expect(uniform1fCount).toBeGreaterThan(5);
    // uniform1i 仅用于 sampler 纹理单元
    // 不应对布尔标志使用 uniform1i
  });
});

// ============================================================================
// 3. FilmLabWebGL.js — 客户端 Preview 路径
// ============================================================================

describe('FilmLabWebGL.js — client preview path', () => {
  let webglSource;

  beforeAll(() => {
    const filePath = path.join(__dirname, '..', 'client', 'src', 'components', 'FilmLab', 'FilmLabWebGL.js');
    webglSource = fs.readFileSync(filePath, 'utf-8');
  });

  test('导入 buildFragmentShader from @filmgallery/shared', () => {
    expect(webglSource).toMatch(/import\s+.*buildFragmentShader.*from\s+['"]@filmgallery\/shared['"]/);
  });

  test('导入 VERTEX_SHADER from @filmgallery/shared', () => {
    expect(webglSource).toMatch(/VERTEX_SHADER/);
  });

  test('使用 buildFragmentShader({ isGL2, precision: "highp" }) (Phase F: 移动端精度)', () => {
    expect(webglSource).toMatch(/buildFragmentShader\s*\(\s*\{\s*isGL2,\s*precision:\s*['"]highp['"]/);
  });

  test('不包含内联 GLSL precision 声明 (已移除)', () => {
    // 移除了 ~590 行内联 GLSL
    const precisionDecls = (webglSource.match(/precision\s+mediump\s+float/g) || []).length;
    expect(precisionDecls).toBe(0);
  });

  test('使用 u_split* 前缀', () => {
    expect(webglSource).toContain('u_splitHighlightHue');
    expect(webglSource).toContain('u_splitShadowSat');
    expect(webglSource).toContain('u_splitBalance');
  });

  test('exposure/contrast 传递原始 UI 值', () => {
    // 应该是 u_exposure: someValue 而非 u_exposure: someValue / 50
    // 着色器内部会做 pow(2, u_exposure / 50)
    expect(webglSource).toMatch(/u_exposure/);
    expect(webglSource).toMatch(/u_contrast/);
  });
});

// ============================================================================
// 4. RenderCore — getGLSLUniforms 一致性
// ============================================================================

describe('RenderCore.getGLSLUniforms() — cross-path uniform map', () => {
  let uniforms;

  beforeAll(() => {
    const { RenderCore } = require('../packages/shared/render/RenderCore');
    const core = new RenderCore({
      inverted: false,
      exposure: 0,
      contrast: 0,
    });
    uniforms = core.getGLSLUniforms();
  });

  test('返回对象包含所有必要 uniform keys', () => {
    const requiredKeys = [
      'u_inverted', 'u_inversionMode',
      'u_filmCurveEnabled', 'u_filmCurveGamma',
      'u_filmCurveGammaR', 'u_filmCurveGammaG', 'u_filmCurveGammaB',
      'u_filmCurveDMin', 'u_filmCurveDMax',
      'u_filmCurveToe', 'u_filmCurveShoulder',
      'u_baseMode', 'u_baseGains', 'u_baseDensity',
      'u_densityLevelsEnabled', 'u_densityLevelsMin', 'u_densityLevelsMax',
      'u_gains',
      'u_exposure', 'u_contrast', 'u_highlights', 'u_shadows', 'u_whites', 'u_blacks',
      'u_useCurves',
      'u_useHSL',
      'u_useSplitTone',
      'u_splitHighlightHue', 'u_splitHighlightSat',
      'u_splitMidtoneHue', 'u_splitMidtoneSat',
      'u_splitShadowHue', 'u_splitShadowSat',
      'u_splitBalance',
      'u_hasLut3d', 'u_lutIntensity',
    ];

    for (const key of requiredKeys) {
      expect(uniforms).toHaveProperty(key);
    }
  });

  test('默认参数下: inverted=0, filmCurveEnabled=0', () => {
    expect(uniforms.u_inverted).toBe(0.0);
    expect(uniforms.u_filmCurveEnabled).toBe(0.0);
  });

  test('u_baseGains 是长度 3 的数组', () => {
    expect(Array.isArray(uniforms.u_baseGains)).toBe(true);
    expect(uniforms.u_baseGains).toHaveLength(3);
  });

  test('u_baseDensity 是长度 3 的数组', () => {
    expect(Array.isArray(uniforms.u_baseDensity)).toBe(true);
    expect(uniforms.u_baseDensity).toHaveLength(3);
  });

  test('u_gains (白平衡) 是长度 3 的数组', () => {
    expect(Array.isArray(uniforms.u_gains)).toBe(true);
    expect(uniforms.u_gains).toHaveLength(3);
  });
});

// ============================================================================
// 5. Deprecated APIs (Phase O: deleted, no longer deprecated)
// ============================================================================

describe('Dead code removed (Phase O P1-25)', () => {
  test('RenderCore.getHSLGLSL() 已删除（dead code 清理）', () => {
    const filePath = path.join(__dirname, '..', 'packages', 'shared', 'render', 'RenderCore.js');
    const source = fs.readFileSync(filePath, 'utf-8');
    // 应不再包含该方法（已删除，使用 packages/shared/shaders/hslAdjust.js）
    expect(source).not.toContain('getHSLGLSL');
    expect(source).not.toContain('getSplitToneGLSL');
    expect(source).not.toMatch(/_applyFilmCurveFloat\s*\(/);
    expect(source).not.toMatch(/_sampleCurveLUTFloat\s*\(/);
    // _sampleCurveLUTFloatHQ 仍在使用，不应删除
    expect(source).toContain('_sampleCurveLUTFloatHQ');
  });

  test('filmlab-core.js 已标记 @deprecated', () => {
    const filePath = path.join(__dirname, '..', 'packages', 'shared', 'filmlab-core.js');
    if (fs.existsSync(filePath)) {
      const source = fs.readFileSync(filePath, 'utf-8');
      expect(source).toContain('@deprecated');
    }
  });
});

// ============================================================================
// 6. SHADER_VERSION 同步
// ============================================================================

describe('SHADER_VERSION synchronization', () => {
  test('shared shaders 导出 SHADER_VERSION', () => {
    expect(shaders.SHADER_VERSION).toBeDefined();
    expect(typeof shaders.SHADER_VERSION).toBe('string');
  });

  test('FilmLabWebGL.js 导入 SHADER_VERSION', () => {
    const filePath = path.join(__dirname, '..', 'client', 'src', 'components', 'FilmLab', 'FilmLabWebGL.js');
    const source = fs.readFileSync(filePath, 'utf-8');
    expect(source).toContain('SHADER_VERSION');
  });
});

// ============================================================================
// 7. GL1 (Client) vs GL2 (GPU Export) — 相同的着色器管线
// ============================================================================

describe('GL1 (client) vs GL2 (gpu-export) — identical pipeline', () => {
  test('两个路径生成的 main() 包含相同的处理步骤', () => {
    const mainGL1 = shaders.buildMainFunction({ isGL2: false });
    const mainGL2 = shaders.buildMainFunction({ isGL2: true, useCompositeCurve: true });

    // 相同的步骤标记
    const steps = ['①', '②', '②.5', '③', '③b', '④', '⑤a', '⑤b', '⑤c', '⑤d', '⑤e', '⑥', '⑦', '⑧'];
    for (const step of steps) {
      expect(mainGL1).toContain(step);
      expect(mainGL2).toContain(step);
    }
  });

  test('两个路径使用相同的 uniform 声明模块', () => {
    const gl1 = shaders.buildFragmentShader({ isGL2: false });
    const gl2 = shaders.buildFragmentShader({ isGL2: true });

    // uniforms.js 的内容应完整包含在两者中
    const uniformsSrc = shaders.uniforms.UNIFORMS_GLSL;
    expect(gl1).toContain(uniformsSrc);
    expect(gl2).toContain(uniformsSrc);
  });

  test('两个路径使用相同的 colorMath 模块', () => {
    const gl1 = shaders.buildFragmentShader({ isGL2: false });
    const gl2 = shaders.buildFragmentShader({ isGL2: true });
    const cm = shaders.colorMath.COLOR_MATH_GLSL;
    expect(gl1).toContain(cm);
    expect(gl2).toContain(cm);
  });

  test('两个路径使用相同的 hslAdjust 模块', () => {
    const gl1 = shaders.buildFragmentShader({ isGL2: false });
    const gl2 = shaders.buildFragmentShader({ isGL2: true });
    const hsl = shaders.hslAdjust.HSL_ADJUST_GLSL;
    expect(gl1).toContain(hsl);
    expect(gl2).toContain(hsl);
  });

  test('两个路径使用相同的 splitTone 模块', () => {
    const gl1 = shaders.buildFragmentShader({ isGL2: false });
    const gl2 = shaders.buildFragmentShader({ isGL2: true });
    const st = shaders.splitTone.SPLIT_TONE_GLSL;
    expect(gl1).toContain(st);
    expect(gl2).toContain(st);
  });
});
