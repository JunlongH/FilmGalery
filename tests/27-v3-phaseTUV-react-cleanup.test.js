/**
 * v3 Phase T/U/V — React 性能 / 资源管理 / 清理 测试
 *
 * 覆盖：
 *   T.1: React.memo 包装 8 个组件 (P1-5)
 *   T.2: 稳定 handler useCallback (P3-47/48)
 *   T.4: 直方图属性名统一 (P2-7)
 *   T.7: 图像加载单 fetch (P1-10)
 *   T.8: 竞态保护 active flag (P1-11)
 *   T.9: webglParams resolveFilmCurveParams (P1-12)
 *   T.10: ToneCurveEditor histogramPath memo (P1-16)
 *   T.12: 直方图数组复用 (P2-18)
 *   U.2: AI 上下文 debounce (P1-28)
 *   U.3: WebGL scratch buffers (P2-19)
 *   U.4: 顶点缓冲 dirty flag (P2-20)
 *   V.2: MessageChannel yield (P2-26)
 *   V.3: getCurveLUT memo (P2-27)
 *   V.4: console.log 清理 (P2-29)
 *   V.5: DEBUG 代码条件编译 (P2-30)
 *   V.6: handleSave/downloadClientJPEG async (P2-54/55)
 *   P3: 死代码/console.log/span/内联箭头清理
 */

const fs = require('fs');
const path = require('path');

function readClientSrc(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', 'client', 'src', relPath), 'utf-8');
}

function countOccurrences(str, pattern) {
  const matches = str.match(pattern);
  return matches ? matches.length : 0;
}

// ============================================================================
// T.1: React.memo 包装 (P1-5)
// ============================================================================
describe('T.1 — React.memo 包装 8 个组件', () => {
  test('SliderControl 被 React.memo 包装', () => {
    const src = readClientSrc('components/FilmLab/SliderControl.jsx');
    expect(src).toMatch(/React\.memo/);
  });

  test('PhotoThumb 被 React.memo 包装', () => {
    const src = readClientSrc('components/FilmLab/PhotoSwitcher.jsx');
    expect(src).toMatch(/PhotoThumb\s*=\s*React\.memo/);
  });

  test('ChannelSliders 和 HSLSlider 被 React.memo 包装', () => {
    const src = readClientSrc('components/FilmLab/HSLPanel.jsx');
    expect(src).toMatch(/ChannelSliders\s*=\s*React\.memo/);
    expect(src).toMatch(/HSLSlider\s*=\s*React\.memo/);
  });

  test('HueWheel 和 ToneControl 被 React.memo 包装', () => {
    const src = readClientSrc('components/FilmLab/SplitToningPanel.jsx');
    expect(src).toMatch(/HueWheel\s*=\s*React\.memo/);
    expect(src).toMatch(/ToneControl\s*=\s*React\.memo/);
  });

  test('ToneCurveEditor 被 React.memo 包装', () => {
    const src = readClientSrc('components/FilmLab/ToneCurveEditor.jsx');
    expect(src).toMatch(/React\.memo/);
  });

  test('AutoCropButton 被 React.memo 包装', () => {
    const src = readClientSrc('components/FilmLab/AutoCropButton.jsx');
    expect(src).toMatch(/React\.memo/);
  });
});

// ============================================================================
// T.2: 稳定 handler useCallback (P3-47/48)
// ============================================================================
describe('T.2 — 稳定 handler useCallback', () => {
  test('HSLPanel 有 useCallback 稳定的 onChange handler', () => {
    const src = readClientSrc('components/FilmLab/HSLPanel.jsx');
    expect(src).toMatch(/useCallback/);
    expect(src).toMatch(/handleHueChange|handleSaturationChange|handleLuminanceChange/);
  });

  test('SplitToningPanel 有 useCallback 稳定的 onHueChange handler', () => {
    const src = readClientSrc('components/FilmLab/SplitToningPanel.jsx');
    expect(src).toMatch(/useCallback/);
    expect(src).toMatch(/handleHighlights|handleMidtones|handleShadows/);
  });
});

// ============================================================================
// T.4: 直方图属性名统一 (P2-7)
// ============================================================================
describe('T.4 — 直方图属性名统一 (P2-7)', () => {
  test('不再有 r/g/b 错误属性名（应统一为 red/green/blue）', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).not.toMatch(/r:\s*histR,\s*g:\s*histG,\s*b:\s*histB/);
  });

  test('setHistograms 使用 red/green/blue 属性名', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).toMatch(/red:\s*histR,\s*green:\s*histG,\s*blue:\s*histB/);
  });
});

// ============================================================================
// T.7: 图像加载单 fetch (P1-10)
// ============================================================================
describe('T.7 — 图像加载单网络请求 (P1-10)', () => {
  test('非 server-decode 路径使用单次 fetch(blob) 而非 new Image() + fetch()', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    // 应有 fetch(imageUrl) → blob → createObjectURL
    expect(src).toMatch(/fetch\(imageUrl\)/);
    expect(src).toMatch(/response\.blob/);
    expect(src).toMatch(/URL\.createObjectURL\(blob\)/);
  });

  test('EXIF 从同一 blob 解析（不再第二次 fetch）', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    // 应有 blob.arrayBuffer() 而非 fetch(imageUrl).then(res => res.arrayBuffer())
    expect(src).toMatch(/blob\.arrayBuffer/);
    // 不应有独立的 EXIF fetch（旧代码模式）
    expect(src).not.toMatch(/\/\/ Fetch and parse EXIF/);
  });
});

// ============================================================================
// T.8: 竞态保护 active flag (P1-11)
// ============================================================================
describe('T.8 — 非 server-decode 竞态保护 (P1-11)', () => {
  test('有 active flag + cleanup', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    // 非_server-decode 路径（fetch blob 路径）应有 active flag
    expect(src).toMatch(/let active = true/);
    expect(src).toMatch(/if\s*\(!active\)\s*return/);
    expect(src).toMatch(/return\s*\(\)\s*=>\s*\{\s*active\s*=\s*false/);
  });
});

// ============================================================================
// T.9: webglParams resolveFilmCurveParams (P1-12)
// ============================================================================
describe('T.9 — webglParams 使用 resolveFilmCurveParams (P1-12)', () => {
  test('webglParams memo 内不再有 8 次 find()', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    const memoStart = src.indexOf('const webglParams = React.useMemo');
    const memoEnd = src.indexOf('}, [inverted, inversionMode');
    const memoContent = src.substring(memoStart, memoEnd);
    const findCount = countOccurrences(memoContent, /filmCurveProfiles\?\.find/);
    expect(findCount).toBe(0);
  });

  test('webglParams memo 使用 resolveFilmCurveParams()', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).toMatch(/\.\.\.resolveFilmCurveParams\(\)/);
  });
});

// ============================================================================
// T.10: ToneCurveEditor histogramPath memo (P1-16)
// ============================================================================
describe('T.10 — ToneCurveEditor histogramPath memo (P1-16)', () => {
  test('histogramPath 依赖 activeHistogram 而非整个 histograms 对象', () => {
    const src = readClientSrc('components/FilmLab/ToneCurveEditor.jsx');
    expect(src).toMatch(/activeHistogram/);
  });

  test('useMemo 依赖数组不含 histograms', () => {
    const src = readClientSrc('components/FilmLab/ToneCurveEditor.jsx');
    const memoMatch = src.match(/useMemo\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[([^\]]+)\]\)/);
    expect(memoMatch).toBeTruthy();
    const deps = memoMatch[1];
    expect(deps).not.toMatch(/\bhistograms\b/);
    expect(deps).toMatch(/activeHistogram/);
  });
});

// ============================================================================
// T.12: 直方图数组复用 (P2-18)
// ============================================================================
describe('T.12 — 直方图数组复用 (P2-18)', () => {
  test('有 histBuffersRef 复用数组', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).toMatch(/histBuffersRef/);
    expect(src).toMatch(/useRef\(\{/);
  });

  test('每帧 fill(0) 重置而非 new Array(256)', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).toMatch(/\.fill\(0\)/);
  });
});

// ============================================================================
// U.2: AI 上下文 debounce (P1-28)
// ============================================================================
describe('U.2 — AI 上下文 debounce (P1-28)', () => {
  test('updateOverlayContext 有 300ms debounce', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).toMatch(/aiContextTimerRef/);
    expect(src).toMatch(/setTimeout/);
    expect(src).toMatch(/300/);
  });

  test('debounce 有 cleanup（clearTimeout）', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).toMatch(/clearTimeout\(aiContextTimerRef\.current\)/);
  });
});

// ============================================================================
// U.3: WebGL scratch buffers (P2-19)
// ============================================================================
describe('U.3 — FilmLabWebGL scratch Float32Array 复用 (P2-19)', () => {
  test('cache 有预分配的 scratch buffers', () => {
    const src = readClientSrc('components/FilmLab/FilmLabWebGL.js');
    expect(src).toMatch(/_scratch3/);
    expect(src).toMatch(/_scratch4/);
  });
});

// ============================================================================
// U.4: 顶点缓冲 dirty flag (P2-20)
// ============================================================================
describe('U.4 — 顶点缓冲 dirty flag (P2-20)', () => {
  test('有 lastUVKey dirty flag 跳过未变化的 bufferData', () => {
    const src = readClientSrc('components/FilmLab/FilmLabWebGL.js');
    expect(src).toMatch(/lastUVKey/);
  });
});

// ============================================================================
// V.2: MessageChannel yield (P2-26)
// ============================================================================
describe('V.2 — MessageChannel 替代 setTimeout(0) (P2-26)', () => {
  test('CpuRenderService 有 _yieldToMain 函数', () => {
    const src = readClientSrc('services/CpuRenderService.js');
    expect(src).toMatch(/_yieldToMain/);
    expect(src).toMatch(/MessageChannel/);
  });

  test('processCanvasWithRenderCoreAsync 使用 _yieldToMain 而非 setTimeout', () => {
    const src = readClientSrc('services/CpuRenderService.js');
    expect(src).toMatch(/await _yieldToMain/);
  });
});

// ============================================================================
// V.3: getCurveLUT memo (P2-27)
// ============================================================================
describe('V.3 — getCurveLUT memo (P2-27)', () => {
  test('FilmLab.jsx 有 curveLUTs useMemo', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).toMatch(/curveLUTs/);
    expect(src).toMatch(/React\.useMemo/);
  });
});

// ============================================================================
// V.4: console.log 清理 (P2-29)
// ============================================================================
describe('V.4 — console.log 清理 (P2-29)', () => {
  test('CpuRenderService console.log 数量减少', () => {
    const src = readClientSrc('services/CpuRenderService.js');
    const count = countOccurrences(src, /console\.log/g);
    // 旧实现有 8+ 处；清理后应 ≤ 3（保留 timing log，gated by NODE_ENV）
    expect(count).toBeLessThanOrEqual(3);
  });

  test('FilmLab.jsx console.log 数量减少', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    const count = countOccurrences(src, /console\.log/g);
    // 旧实现有 44+ 处；清理后应显著减少
    expect(count).toBeLessThan(20);
  });

  test('AutoCropButton console.log 已删除', () => {
    const src = readClientSrc('components/FilmLab/AutoCropButton.jsx');
    const count = countOccurrences(src, /console\.log/g);
    expect(count).toBe(0);
  });
});

// ============================================================================
// V.5: DEBUG 代码条件编译 (P2-30)
// ============================================================================
describe('V.5 — DEBUG 代码条件编译 (P2-30)', () => {
  test('FilmLabWebGL DEBUG_WEBGL 块 gated by NODE_ENV', () => {
    const src = readClientSrc('components/FilmLab/FilmLabWebGL.js');
    expect(src).toMatch(/process\.env\.NODE_ENV\s*!==\s*'production'/);
  });
});

// ============================================================================
// V.6: handleSave/downloadClientJPEG async (P2-54/55)
// ============================================================================
describe('V.6 — handleSave/downloadClientJPEG async (P2-54/55)', () => {
  test('handleSave 改为 async', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).toMatch(/const handleSave\s*=\s*async/);
  });

  test('handleSave 使用 processCanvasWithRenderCoreAsync', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    // handleSave 内应有 await processCanvasWithRenderCoreAsync
    const saveSection = src.substring(src.indexOf('const handleSave'), src.indexOf('handleHighQualityExport'));
    expect(saveSection).toMatch(/await processCanvasWithRenderCoreAsync/);
  });

  test('downloadClientJPEG 改为 async', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).toMatch(/const downloadClientJPEG\s*=\s*async/);
  });

  test('downloadClientJPEG 使用 processCanvasWithRenderCoreAsync', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    // downloadClientJPEG 在 handleGpuExport 之后定义
    const dlStart = src.indexOf('const downloadClientJPEG');
    const dlSection = src.substring(dlStart);
    expect(dlSection).toMatch(/await processCanvasWithRenderCoreAsync/);
  });
});

// ============================================================================
// P3: 死代码清理
// ============================================================================
describe('P3 — 死代码清理', () => {
  test('P3-37: committedRotationRef 已删除', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).not.toMatch(/committedRotationRef/);
  });

  test('P3-38: 注释 handleExportLUT 已删除', () => {
    const src = readClientSrc('components/FilmLab/FilmLab.jsx');
    expect(src).not.toMatch(/handleExportLUT/);
  });

  test('P3-40: crop-debug span 已删除', () => {
    const src = readClientSrc('components/FilmLab/FilmLabCanvas.jsx');
    expect(src).not.toMatch(/crop-debug/);
  });

  test('P3-41: 死/buggy 行已删除', () => {
    const src = readClientSrc('components/FilmLab/FilmLabCanvas.jsx');
    expect(src).not.toMatch(/let next = startRect\.rotation \+ delta/);
  });

  test('P3-42: AutoCropButton applyLastResult 注释已删除', () => {
    const src = readClientSrc('components/FilmLab/AutoCropButton.jsx');
    expect(src).not.toMatch(/applyLastResult/);
  });

  test('P3-49: sourceLabels hoisted 到模块级', () => {
    const src = readClientSrc('components/FilmLab/FilmLabControls.jsx');
    // 应在组件函数外定义
    const componentStart = src.indexOf('function FilmLabControls') !== -1
      ? src.indexOf('function FilmLabControls')
      : src.indexOf('const FilmLabControls');
    const beforeComponent = src.substring(0, componentStart);
    expect(beforeComponent).toMatch(/sourceLabels/);
  });

  test('P2-36: 不再有内联 require() 在 JSX 回调', () => {
    const src = readClientSrc('components/FilmLab/FilmLabControls.jsx');
    expect(src).not.toMatch(/require\(/);
  });
});
