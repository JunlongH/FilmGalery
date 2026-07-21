/**
 * Phase O — Rendering Pipeline P0/P1 fixes
 *
 * 覆盖：
 *   - O.1: WebGL2 LUT 路径解耦（useNativeLUT3D 选项）
 *   - O.2: disposeWebGL 调用契约
 *   - O.3: uniform location 缓存复用
 *   - O.5: u_linearDomainInversion 客户端绑定
 *   - O.7: RenderCore 死代码删除
 *   - O.8: shader 字符串不含已删函数
 */

const shaders = require('../packages/shared/shaders');
const { buildFragmentShader, buildMainFunction } = shaders;

describe('Phase O.1 — WebGL2 LUT 路径解耦', () => {
  test('默认 isGL2=true 启用原生 sampler3D（gpu-renderer 路径）', () => {
    const fs = buildFragmentShader({ isGL2: true });
    expect(fs).toContain('u_hasLut3d');
    expect(fs).toContain('u_lut3dTex');
    expect(fs).toContain('u_lut3dSize');
    expect(fs).toContain('precision highp sampler3D');
  });

  test('useNativeLUT3D=false 强制 packed-2D 路径（客户端预览使用）', () => {
    const fs = buildFragmentShader({ isGL2: true, useNativeLUT3D: false });
    expect(fs).toContain('u_useLut3d');
    expect(fs).toContain('sampleLUT3D');
    expect(fs).not.toContain('u_hasLut3d');
    expect(fs).not.toContain('u_lut3dTex');
    expect(fs).not.toContain('u_lut3dSize');
    expect(fs).not.toContain('precision highp sampler3D');
  });

  test('useNativeLUT3D=false 时 LUT3D_GLSL 模块仍被包含', () => {
    const fs = buildFragmentShader({ isGL2: true, useNativeLUT3D: false });
    // sampleLUT3D 函数定义必须存在（被 main 调用）
    expect(fs).toMatch(/vec3 sampleLUT3D\s*\(/);
  });

  test('useNativeLUT3D=true 时不重复包含 LUT3D_GLSL（避免双重定义）', () => {
    const fs = buildFragmentShader({ isGL2: true, useNativeLUT3D: true });
    // sampleLUT3D 函数不应在原生路径中定义（main 使用 texture(u_lut3dTex)）
    expect(fs).not.toMatch(/vec3 sampleLUT3D\s*\(/);
  });

  test('WebGL1 路径始终使用 packed-2D（useNativeLUT3D 无效）', () => {
    const fs1 = buildFragmentShader({ isGL2: false });
    const fs2 = buildFragmentShader({ isGL2: false, useNativeLUT3D: true });
    expect(fs1).toContain('sampleLUT3D');
    expect(fs2).toContain('sampleLUT3D');
    // WebGL1 不支持 sampler3D
    expect(fs1).not.toContain('sampler3D');
    expect(fs2).not.toContain('sampler3D');
  });

  test('buildMainFunction 默认跟随 isGL2（向后兼容）', () => {
    const mainGL2 = buildMainFunction({ isGL2: true });
    expect(mainGL2).toContain('u_hasLut3d');
    expect(mainGL2).toContain('u_lut3dTex');

    const mainGL1 = buildMainFunction({ isGL2: false });
    expect(mainGL1).toContain('u_useLut3d');
    expect(mainGL1).not.toContain('u_hasLut3d');
  });

  test('buildMainFunction useNativeLUT3D=false 在 GL2 下走 packed-2D', () => {
    const main = buildMainFunction({ isGL2: true, useNativeLUT3D: false });
    expect(main).toContain('u_useLut3d');
    expect(main).toContain('sampleLUT3D');
    expect(main).not.toContain('u_hasLut3d');
  });
});

describe('Phase O.5 — u_linearDomainInversion uniform 绑定', () => {
  test('shader 声明 u_linearDomainInversion uniform', () => {
    const fsGL1 = buildFragmentShader({ isGL2: false });
    const fsGL2 = buildFragmentShader({ isGL2: true });
    expect(fsGL1).toContain('uniform float u_linearDomainInversion');
    expect(fsGL2).toContain('uniform float u_linearDomainInversion');
  });

  test('shader main 消费 u_linearDomainInversion（srgbToLinear/linearToSrgb 切换）', () => {
    const main = buildMainFunction({ isGL2: false });
    expect(main).toContain('u_linearDomainInversion');
    expect(main).toContain('srgbToLinear');
    expect(main).toContain('linearToSrgb');
  });

  test('客户端 FilmLabWebGL 源码绑定 u_linearDomainInversion', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'client', 'src', 'components', 'FilmLab', 'FilmLabWebGL.js'),
      'utf-8'
    );
    expect(src).toContain("locs.u_linearDomainInversion = gl.getUniformLocation(program, 'u_linearDomainInversion')");
    expect(src).toMatch(/gl\.uniform1f\(locs\.u_linearDomainInversion/);
  });
});

describe('Phase O.3 — Uniform location 缓存', () => {
  test('客户端 FilmLabWebGL 复用 cache.locs（不在每帧重建）', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'client', 'src', 'components', 'FilmLab', 'FilmLabWebGL.js'),
      'utf-8'
    );
    // 应有 cache.locs 复用逻辑（仅在 cache.locs 为 null 时重建）
    expect(src).toMatch(/if\s*\(!cache\.locs\)\s*\{/);
    expect(src).toMatch(/cache\.locs\s*=\s*locs/);
    // 旧注释 "每次强制重新获取" 不应存在
    expect(src).not.toContain('每次强制重新获取');
  });
});

describe('Phase O.6 — 图像纹理脏标记', () => {
  test('客户端 FilmLabWebGL 跳过未变图像的 texImage2D', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'client', 'src', 'components', 'FilmLab', 'FilmLabWebGL.js'),
      'utf-8'
    );
    expect(src).toMatch(/cache\.imageRef\s*===?\s*image/);
    expect(src).toMatch(/cache\.imageRef\s*=\s*image/);
  });
});

describe('Phase O.4 — 曲线纹理脏标记', () => {
  test('客户端 FilmLabWebGL 复用曲线纹理（脏标记 + 预分配缓冲）', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'client', 'src', 'components', 'FilmLab', 'FilmLabWebGL.js'),
      'utf-8'
    );
    // 脏标记：检查引用未变则跳过
    expect(src).toMatch(/cache\[key\s*\+\s*'_ref'\]\s*!==?\s*arr/);
    // 预分配缓冲
    expect(src).toMatch(/_curveBuf/);
    expect(src).toMatch(/new Uint8Array\(256\s*\*\s*4\)/);
  });
});

describe('Phase O.7 — RenderCore 死代码删除', () => {
  test('RenderCore 不再包含 _applyFilmCurveFloat', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'packages', 'shared', 'render', 'RenderCore.js'),
      'utf-8'
    );
    expect(src).not.toMatch(/_applyFilmCurveFloat\s*\(/);
  });

  test('RenderCore 不再包含 _sampleCurveLUTFloat（保留 HQ 版本）', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'packages', 'shared', 'render', 'RenderCore.js'),
      'utf-8'
    );
    // _sampleCurveLUTFloat 后面不能紧跟 HQ
    expect(src).not.toMatch(/_sampleCurveLUTFloat\s*\(/);
    // 但 _sampleCurveLUTFloatHQ 必须保留
    expect(src).toContain('_sampleCurveLUTFloatHQ');
  });

  test('RenderCore 不再包含 getHSLGLSL / getSplitToneGLSL（@deprecated 副本）', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'packages', 'shared', 'render', 'RenderCore.js'),
      'utf-8'
    );
    expect(src).not.toContain('getHSLGLSL');
    expect(src).not.toContain('getSplitToneGLSL');
  });

  test('RenderCore 仍可正常加载并实例化', () => {
    const { RenderCore } = require('../packages/shared/render/RenderCore');
    expect(typeof RenderCore).toBe('function');
    const core = new RenderCore({});
    expect(core).toBeDefined();
  });
});

describe('Phase O.2 — disposeWebGL 接入', () => {
  test('FilmLab.jsx 组件卸载时调用 disposeWebGL（主渲染路径）', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'client', 'src', 'components', 'FilmLab', 'FilmLab.jsx'),
      'utf-8'
    );
    expect(src).toMatch(/import.*disposeWebGL/);
    expect(src).toMatch(/disposeWebGL\(processedCanvasRef\.current\)/);
  });

  test('useFilmLabRenderer.js 已删除（v3 P0-4 死代码清理）', () => {
    const fs = require('fs');
    const path = require('path');
    const hookPath = path.join(__dirname, '..', 'client', 'src', 'components', 'FilmLab', 'hooks', 'useFilmLabRenderer.js');
    expect(fs.existsSync(hookPath)).toBe(false);
  });

  test('FilmLabWebGL.disposeWebGL 删除所有 GL 资源', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'client', 'src', 'components', 'FilmLab', 'FilmLabWebGL.js'),
      'utf-8'
    );
    // 删除纹理
    expect(src).toMatch(/delTex\(cache\.imageTex\)/);
    expect(src).toMatch(/delTex\(cache\.lut3Tex\)/);
    // 删除 buffer 和 program
    expect(src).toMatch(/gl\.deleteBuffer\(cache\.buffer\)/);
    expect(src).toMatch(/gl\.deleteProgram\(cache\.program\)/);
    // 清空 cache 引用
    expect(src).toMatch(/cache\.locs\s*=\s*null/);
    expect(src).toMatch(/processImageWebGL\._cache\.delete\(canvas\)/);
  });
});
