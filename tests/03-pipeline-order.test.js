/**
 * 渲染流水线顺序测试
 * 
 * 验证 shared shader 的 main() 函数中处理步骤的正确顺序。
 * 确保 CPU (RenderCore) 和 GPU (shared shader) 流水线保持一致。
 * 
 * 正确顺序：
 * ① Film Curve → ② Base Correction → ②.5 Density Levels → ③ Inversion
 * → ③b 3D LUT → ④ White Balance → ⑤a Exposure → ⑤b Contrast
 * → ⑤c Whites/Blacks → ⑤d Shadows/Highlights → ⑤e Highlight Roll-Off
 * → clamp → ⑥ Curves → ⑦ HSL → ⑧ Split Tone
 */
'use strict';

const shaders = require('../packages/shared/shaders');

// ============================================================================
// 流水线步骤顺序
// ============================================================================

describe('Pipeline step order — shared shader main()', () => {
  let mainGLSL;

  beforeAll(() => {
    mainGLSL = shaders.buildMainFunction({ isGL2: false });
  });

  test('main() 包含所有 14 个处理步骤标记', () => {
    const stepMarkers = [
      '①', '②', '②.5', '③', '③b',
      '④', '⑤a', '⑤b', '⑤c', '⑤d', '⑤e',
      '⑥', '⑦', '⑧',
    ];
    for (const marker of stepMarkers) {
      expect(mainGLSL).toContain(marker);
    }
  });

  test('步骤顺序正确 (每个步骤在前一步骤之后)', () => {
    const orderedSteps = [
      { marker: '① Film Curve', label: 'Film Curve' },
      { marker: '② Base Correction', label: 'Base Correction' },
      { marker: '②.5 Density Levels', label: 'Density Levels' },
      { marker: '③ Inversion', label: 'Inversion' },
      { marker: '③b 3D LUT', label: '3D LUT' },
      { marker: '④ White Balance', label: 'White Balance' },
      { marker: '⑤a Exposure', label: 'Exposure' },
      { marker: '⑤b Contrast', label: 'Contrast' },
      { marker: '⑤c Blacks', label: 'Blacks & Whites' },
      { marker: '⑤d Shadows', label: 'Shadows & Highlights' },
      { marker: '⑤e Highlight Roll-Off', label: 'Highlight Roll-Off' },
      { marker: '⑥ Curves', label: 'Curves' },
      { marker: '⑦ HSL', label: 'HSL' },
      { marker: '⑧ Split Toning', label: 'Split Toning' },
    ];

    let prevIndex = -1;
    for (const step of orderedSteps) {
      const idx = mainGLSL.indexOf(step.marker);
      expect(idx).toBeGreaterThan(prevIndex);
      prevIndex = idx;
    }
  });

  test('3D LUT 在 Inversion 之后、White Balance 之前', () => {
    const inversionIdx = mainGLSL.indexOf('③ Inversion');
    const lutIdx = mainGLSL.indexOf('③b 3D LUT');
    const wbIdx = mainGLSL.indexOf('④ White Balance');

    expect(lutIdx).toBeGreaterThan(inversionIdx);
    expect(lutIdx).toBeLessThan(wbIdx);
  });

  test('Highlight Roll-Off 在 Shadows/Highlights 之后、Clamp 之前', () => {
    const shIdx = mainGLSL.indexOf('⑤d Shadows');
    const rollIdx = mainGLSL.indexOf('⑤e Highlight Roll-Off');
    const clampIdx = mainGLSL.indexOf('c = clamp(c, 0.0, 1.0)');

    expect(rollIdx).toBeGreaterThan(shIdx);
    // clamp 应在 roll-off 之后
    // 找 ⑤e 之后的第一个 clamp
    const clampAfterRoll = mainGLSL.indexOf('c = clamp(c, 0.0, 1.0)', rollIdx);
    expect(clampAfterRoll).toBeGreaterThan(rollIdx);
  });

  test('HSL 在 Curves 之后', () => {
    const curvesIdx = mainGLSL.indexOf('⑥ Curves');
    const hslIdx = mainGLSL.indexOf('⑦ HSL');
    expect(hslIdx).toBeGreaterThan(curvesIdx);
  });

  test('Split Toning 是最后一步 (在 HSL 之后)', () => {
    const hslIdx = mainGLSL.indexOf('⑦ HSL');
    const splitIdx = mainGLSL.indexOf('⑧ Split Toning');
    expect(splitIdx).toBeGreaterThan(hslIdx);
  });
});

// ============================================================================
// WebGL1 vs WebGL2 — main() 结构一致性
// ============================================================================

describe('Pipeline structure — GL1 vs GL2', () => {
  let mainGL1, mainGL2;

  beforeAll(() => {
    mainGL1 = shaders.buildMainFunction({ isGL2: false });
    mainGL2 = shaders.buildMainFunction({ isGL2: true });
  });

  test('两个版本包含相同的步骤标记', () => {
    const stepMarkers = ['①', '②', '③', '④', '⑤a', '⑤b', '⑤c', '⑤d', '⑤e', '⑥', '⑦', '⑧'];
    for (const marker of stepMarkers) {
      expect(mainGL1).toContain(marker);
      expect(mainGL2).toContain(marker);
    }
  });

  test('GL1 使用 texture2D, GL2 使用 texture', () => {
    // GL1: texture2D(u_image, ...)
    expect(mainGL1).toContain('texture2D(u_image');
    // GL2: texture(u_image, ...) 
    expect(mainGL2).toContain('texture(u_image');
  });

  test('GL1 输出 gl_FragColor, GL2 输出 fragColor', () => {
    expect(mainGL1).toContain('gl_FragColor');
    expect(mainGL2).toContain('fragColor');
  });

  test('GL1 使用 u_useLut3d, GL2(useNativeLUT3D) 使用 u_hasLut3d', () => {
    expect(mainGL1).toContain('u_useLut3d');
    expect(mainGL2).toContain('u_hasLut3d');
  });

  test('GL1 调用 sampleLUT3D(), GL2(useNativeLUT3D) 使用 texture(u_lut3dTex)', () => {
    expect(mainGL1).toContain('sampleLUT3D');
    expect(mainGL2).toContain('u_lut3dTex');
  });

  test('GL2(useNativeLUT3D=false) 回退到 packed-2D 路径（客户端使用）', () => {
    const mainGL2Packed = shaders.buildFragmentShader({ isGL2: true, useNativeLUT3D: false });
    expect(mainGL2Packed).toContain('u_useLut3d');
    expect(mainGL2Packed).toContain('sampleLUT3D');
    expect(mainGL2Packed).not.toContain('u_hasLut3d');
    expect(mainGL2Packed).not.toContain('u_lut3dTex');
  });
});

// ============================================================================
// Film Curve 在 Inversion 之前（仅在 inverted 且 enabled 时）
// ============================================================================

describe('Film Curve guard conditions', () => {
  let mainGLSL;

  beforeAll(() => {
    mainGLSL = shaders.buildMainFunction({ isGL2: false });
  });

  test('Film Curve 需要 u_inverted > 0.5 && u_filmCurveEnabled > 0.5', () => {
    // 找到 Film Curve 部分
    const filmCurveSection = mainGLSL.substring(
      mainGLSL.indexOf('① Film Curve'),
      mainGLSL.indexOf('② Base Correction')
    );
    expect(filmCurveSection).toContain('u_inverted > 0.5');
    expect(filmCurveSection).toContain('u_filmCurveEnabled > 0.5');
  });

  test('Film Curve 使用 per-channel gamma (u_filmCurveGammaR/G/B)', () => {
    const filmCurveSection = mainGLSL.substring(
      mainGLSL.indexOf('① Film Curve'),
      mainGLSL.indexOf('② Base Correction')
    );
    expect(filmCurveSection).toContain('u_filmCurveGammaR');
    expect(filmCurveSection).toContain('u_filmCurveGammaG');
    expect(filmCurveSection).toContain('u_filmCurveGammaB');
  });
});

// ============================================================================
// Exposure / Contrast 使用原始 UI 值 (着色器内部缩放)
// ============================================================================

describe('Exposure/Contrast internal scaling', () => {
  let mainGLSL;

  beforeAll(() => {
    mainGLSL = shaders.buildMainFunction({ isGL2: false });
  });

  test('Exposure: pow(2.0, u_exposure / 50.0)', () => {
    expect(mainGLSL).toContain('pow(2.0, u_exposure / 50.0)');
  });

  test('Contrast: applyContrast(c, u_contrast) 调用', () => {
    expect(mainGLSL).toContain('applyContrast(c, u_contrast)');
  });

  test('Contrast 函数内部: contrast * 2.55 缩放', () => {
    const tonemapGLSL = shaders.tonemap.TONEMAP_GLSL;
    expect(tonemapGLSL).toContain('contrast * 2.55');
  });

  test('Contrast 函数内部: mid-gray 0.46', () => {
    const tonemapGLSL = shaders.tonemap.TONEMAP_GLSL;
    expect(tonemapGLSL).toContain('0.46');
    expect(tonemapGLSL).toMatch(/midGray\s*=\s*0\.46/);
  });
});
