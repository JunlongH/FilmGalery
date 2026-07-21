/**
 * Phase Q — UI P0/P1 fixes
 *
 * 覆盖：
 *   - Q.1: 取色器边缘越界保护
 *   - Q.2: savePreset 完整参数（serializeAllParams SSOT）
 *   - Q.3: applyGeometry 补 rotationOffset
 *   - Q.4: 'x' 快捷键过滤输入框
 *   - Q.5: renderOriginal 依赖补 rotationOffset
 *   - Q.6: resolveFilmCurveParams 含 gammaR/G/B/toe/shoulder
 *   - Q.7: buildRenderCoreParams SSOT
 *   - Q.8: CpuRenderService 常量从 shared 导入
 *   - Q.9: ToneCurveEditor useMemo
 *   - Q.10: SliderControl 单全局监听器
 *   - Q.11: 死 hooks 删除
 */

const fs = require('fs');
const path = require('path');

function readClientSrc(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', 'client', 'src', relPath), 'utf-8');
}

describe('Phase Q.1 — 取色器边缘越界保护', () => {
  test('WB picker getImageData 同时保护上下界', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    // 应有 Math.min(canvas.width - 3, ...) 保护上界
    expect(src).toMatch(/Math\.min\(canvas\.width\s*-\s*3,/);
    expect(src).toMatch(/Math\.min\(canvas\.height\s*-\s*3,/);
  });
});

describe('Phase Q.2 — savePreset 完整参数（serializeAllParams SSOT）', () => {
  test('FilmLab.jsx 定义 serializeAllParams SSOT', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).toMatch(/serializeAllParams/);
    // captureSnapshot 应委托给 serializeAllParams
    expect(src).toMatch(/captureSnapshot\s*=\s*serializeAllParams/);
  });

  test('savePreset 调用 serializeAllParams（含完整字段）', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    // savePreset 函数内应调用 serializeAllParams
    expect(src).toMatch(/savePreset[\s\S]*?serializeAllParams\(\)/);
  });

  test('serializeAllParams 包含 baseMode/baseDensity/densityLevels/rotation/cropRect', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    // 提取 serializeAllParams 到下一个 const 之间的代码
    const startIdx = src.indexOf('serializeAllParams = React.useCallback');
    const endIdx = src.indexOf('const captureSnapshot', startIdx);
    const body = src.substring(startIdx, endIdx);
    expect(body).toContain('baseMode');
    expect(body).toContain('baseDensityR');
    expect(body).toContain('densityLevels');
    expect(body).toContain('rotation');
    expect(body).toContain('cropRect');
  });
});

describe('Phase Q.3 — applyGeometry 补 rotationOffset', () => {
  test('CpuRenderService.applyGeometry 含 rotationOffset', () => {
    const src = readClientSrc('services/CpuRenderService.js');
    expect(src).toMatch(/params\.rotationOffset/);
  });
});

describe('Phase Q.4 — x 快捷键过滤输入框', () => {
  test('FilmLab.jsx x 快捷键检查 target.tagName', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    // 应有 INPUT/TEXTAREA/isContentEditable 检查
    expect(src).toMatch(/target\.tagName\s*===\s*['"]INPUT['"]/);
    expect(src).toMatch(/target\.tagName\s*===\s*['"]TEXTAREA['"]/);
    expect(src).toMatch(/isContentEditable/);
  });
});

describe('Phase Q.5 — renderOriginal 依赖补 rotationOffset', () => {
  test('renderOriginal effect 依赖数组含 rotationOffset', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    // 提取 renderOriginal effect 的依赖数组
    const match = src.match(/renderOriginal\(\);[\s\S]*?\},\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const deps = match[1];
    expect(deps).toContain('rotationOffset');
  });
});

describe('Phase Q.6 — resolveFilmCurveParams SSOT', () => {
  test('FilmLab.jsx 定义 resolveFilmCurveParams memo', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).toMatch(/resolveFilmCurveParams\s*=\s*React\.useCallback/);
  });

  test('resolveFilmCurveParams 含全部 9 个字段', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    const startIdx = src.indexOf('resolveFilmCurveParams = React.useCallback');
    const endIdx = src.indexOf('buildRenderCoreParams', startIdx);
    const body = src.substring(startIdx, endIdx);
    expect(body).toContain('filmCurveEnabled');
    expect(body).toContain('filmCurveGamma:');
    expect(body).toContain('filmCurveGammaR:');
    expect(body).toContain('filmCurveGammaG:');
    expect(body).toContain('filmCurveGammaB:');
    expect(body).toContain('filmCurveDMin:');
    expect(body).toContain('filmCurveDMax:');
    expect(body).toContain('filmCurveToe:');
    expect(body).toContain('filmCurveShoulder:');
  });

  test('downloadClientJPEG GPU 路径使用 resolveFilmCurveParams', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    // 应有 const filmCurveParams = resolveFilmCurveParams();
    expect(src).toMatch(/const\s+filmCurveParams\s*=\s*resolveFilmCurveParams\(\)/);
  });
});

describe('Phase Q.7 — buildRenderCoreParams SSOT', () => {
  test('FilmLab.jsx 定义 buildRenderCoreParams callback', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).toMatch(/buildRenderCoreParams\s*=\s*React\.useCallback/);
  });

  test('P1-14: 4 处原 new RenderCore 已替换为 getRenderCore() 实例复用', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    // v3 P1-14: 不再有裸 new RenderCore(buildRenderCoreParams()) 调用
    expect(src).not.toMatch(/new RenderCore\(buildRenderCoreParams\(\)\)/);
    // 应有 getRenderCore callback（ref + params key 缓存）
    expect(src).toMatch(/getRenderCore\s*=\s*React\.useCallback/);
    expect(src).toMatch(/renderCoreRef/);
    expect(src).toMatch(/stableSerializeParams/);
  });
});

describe('Phase Q.8 — CpuRenderService 常量从 shared 导入', () => {
  test('CpuRenderService 不含本地 EXPORT_MAX_WIDTH 定义', () => {
    const src = readClientSrc('services/CpuRenderService.js');
    // 不应有 const EXPORT_MAX_WIDTH = <number> 本地定义
    expect(src).not.toMatch(/const\s+EXPORT_MAX_WIDTH\s*=\s*\d/);
    expect(src).not.toMatch(/const\s+PREVIEW_MAX_WIDTH\s*=\s*\d/);
  });

  test('CpuRenderService 从 @filmgallery/shared 导入常量', () => {
    const src = readClientSrc('services/CpuRenderService.js');
    expect(src).toMatch(/import.*PREVIEW_MAX_WIDTH_CLIENT.*EXPORT_MAX_WIDTH.*from.*@filmgallery\/shared/);
  });
});

describe('Phase Q.9 — ToneCurveEditor useMemo', () => {
  test('ToneCurveEditor 使用 useMemo 缓存 histogramPath 和 curvePath', () => {
    const src = readClientSrc('components/FilmLab/ToneCurveEditor.jsx');
    expect(src).toMatch(/import.*useMemo/);
    expect(src).toMatch(/useMemo\(/);
    // 应有 histogramPath 和 curvePath 变量（而非函数调用）
    expect(src).toMatch(/const\s+histogramPath\s*=\s*useMemo/);
    expect(src).toMatch(/const\s+curvePath\s*=\s*useMemo/);
  });

  test('ToneCurveEditor 不再每帧调用 getHistogramPath()/getCurvePath()', () => {
    const src = readClientSrc('components/FilmLab/ToneCurveEditor.jsx');
    // 旧函数调用模式不应存在
    expect(src).not.toMatch(/getHistogramPath\(\)/);
    expect(src).not.toMatch(/getCurvePath\(\)/);
  });
});

describe('Phase Q.10 — SliderControl 单全局监听器', () => {
  test('SliderControl 使用模块级 dragState 共享状态', () => {
    const src = readClientSrc('components/FilmLab/SliderControl.jsx');
    expect(src).toMatch(/const\s+dragState/);
    expect(src).toMatch(/dragState\.active/);
  });

  test('SliderControl 不在 useEffect 内 addEventListener', () => {
    const src = readClientSrc('components/FilmLab/SliderControl.jsx');
    // 旧模式：useEffect 内 window.addEventListener('mouseup', ...)
    expect(src).not.toMatch(/useEffect\([\s\S]*?window\.addEventListener\(['"]mouseup['"]/);
  });

  test('SliderControl 模块级注册单一 mouseup/touchend', () => {
    const src = readClientSrc('components/FilmLab/SliderControl.jsx');
    // 应在模块顶层（非 useEffect 内）注册
    expect(src).toMatch(/if\s*\(\s*typeof\s+window\s*!==\s*['"]undefined['"]\s*\)[\s\S]*?window\.addEventListener\(['"]mouseup['"]/);
  });
});

describe('Phase Q.11 — 死 hooks 删除', () => {
  test('useFilmLabState.js 已删除', () => {
    const p = path.join(__dirname, '..', 'client', 'src', 'components', 'FilmLab', 'hooks', 'useFilmLabState.js');
    expect(fs.existsSync(p)).toBe(false);
  });

  test('useFilmLabPipeline.js 已删除', () => {
    const p = path.join(__dirname, '..', 'client', 'src', 'components', 'FilmLab', 'hooks', 'useFilmLabPipeline.js');
    expect(fs.existsSync(p)).toBe(false);
  });

  test('hooks/index.js 不再导出 useFilmLabState/useFilmLabPipeline', () => {
    const src = readClientSrc('components/FilmLab/hooks/index.js');
    expect(src).not.toMatch(/export.*useFilmLabState/);
    expect(src).not.toMatch(/export.*useFilmLabPipeline/);
  });

  test('hooks/index.js 不再导出 useFilmLabRenderer（v3 P0-4 已删除死代码）', () => {
    const src = readClientSrc('components/FilmLab/hooks/index.js');
    expect(src).not.toMatch(/export.*useFilmLabRenderer/);
  });
});
