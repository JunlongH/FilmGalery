# 05 · 执行计划（Phase S–V）

原则延续 v1/v2：**先暴露再修复**、SSOT、每阶段先复核再改、每阶段后全量测试。

## 阶段总览

| 阶段 | 内容 | 对应发现 | 预期 tests |
|---|---|---|---|
| S | 预览渲染核心 P0 修复 | P0-1/2/3/4, P1-13/14 | +20 |
| T | React 性能 P1 修复 | P1-5/6/8/9/10/11/15/16/17/18 | +15 |
| U | 资源管理 P1/P2 修复 | P1-23, P2-22/33, P2-19/20/21 | +10 |
| V | 代码重复清理 + P2/P3 | P2-24/25/26/27/28/29/34, P3 全部 | +10 |

总预期：~55 个新测试，866 → ~920。

---

## Phase S — 预览渲染核心 P0/P1

### S.1 WebGL canvas 复用（P0-1）
`FilmLab.jsx:1186-1244` — 复用 `processedCanvasRef.current`：
```js
const webglCanvas = processedCanvasRef.current || document.createElement('canvas');
// 不再每次新建
```

### S.2 CPU 回退改异步（P0-2）
`FilmLab.jsx:1367-1402` — 替换内联循环为：
```js
const result = await processCanvasWithRenderCoreAsync(canvas, params, {
  chunkRows: 64,
  shouldAbort: () => staleRef.current
});
```
`processImage` 改 async，加 `staleRef` 取消标志。

### S.3 直方图读回优化（P0-3）
`FilmLab.jsx:1283-1296` — 拖动时跳过，debounce 到 mouseup：
```js
// 拖动中：跳过直方图
if (isInteractingRef.current) {
  setHistograms(null); // ToneCurveEditor 显示空直方图
  return;
}
// mouseup 后 200ms 算
```
或降采样到 256×256 scratch canvas。

### S.4 删除 useFilmLabRenderer.js（P0-4）
删除文件 + hooks/index.js 导出。修复 typo bug（如未来需要可重新实现正确版本）。

### S.5 RenderCore filmCurve LUT 预构建（P1-13）
`RenderCore.js:prepareLUTs()` — 预构建 filmCurveFloat LUT（1024-entry），`processPixelFloat` 改 LUT 查找。

### S.6 RenderCore 实例复用（P1-14）
`FilmLab.jsx` — 用 ref + params key 复用 RenderCore 实例。

### S.7 测试
- S.1: 切换 20 次后 `getContext` 调用次数 = 1
- S.2: CPU 路径不阻塞（mock `processCanvasWithRenderCoreAsync` 被调用）
- S.3: 拖动中 `getImageData` 不被调用
- S.5: `processPixelFloat` 不调 `FILM_CURVE_PROFILES` 查找
- S.6: 相同 params 复用 RenderCore（`new RenderCore` 调用次数 < 渲染次数）

**预期**：+20 测试。

---

## Phase T — React 性能 P1

### T.1 React.memo 包装组件（P1-5）
```jsx
// SliderControl.jsx
export default React.memo(SliderControl);
// HSLPanel.jsx
const ChannelSliders = React.memo(function ChannelSliders(...) {...});
const HSLSlider = React.memo(function HSLSlider(...) {...});
// SplitToningPanel.jsx
const ToneControl = React.memo(...);
const HueWheel = React.memo(...);
// PhotoSwitcher.jsx
const PhotoThumb = React.memo(...);
```

### T.2 稳定 handler（配合 memo）
- `HSLPanel.jsx:80,89,98` — `useCallback`
- `SplitToningPanel.jsx:373,374,391,392,409,410` — `useCallback`
- `PhotoSwitcher.jsx:402-408` — `useCallback`

### T.3 processImage useCallback（P1-6）
`FilmLab.jsx:1147` — `useCallback` + 显式依赖。

### T.4 直方图属性名统一（P1-7）
`FilmLab.jsx:1358` — `{ rgb: histRGB, red: histR, green: histG, blue: histB }`，删除 `maxCount`。

### T.5 useState → useReducer（P1-8）
`FilmLab.jsx:43-176` — 合并参数状态为 `useReducer(paramsReducer)`。`applyPreset`/`applySnapshot`/`handleReset` 改单次 dispatch。

### T.6 监听器移入 useEffect（P1-9/15）
- `FilmLab.jsx:1601-1633` handlePanStart → useEffect keyed on isDragging
- `FilmLabCanvas.jsx:66-243` crop-drag → ref 化，effect 依赖 `[dragState]`
- `FilmLabCanvas.jsx:285-295` handleBarMouseDown → 同上

### T.7 图像加载单网络请求（P1-10）
`FilmLab.jsx:734-792` — `fetch(blob)` → `createImageBitmap` + `getExifOrientation`。

### T.8 竞态保护（P1-11）
`FilmLab.jsx:734-739` — 加 `active` flag + cleanup。

### T.9 webglParams memo 用 resolveFilmCurveParams（P1-12/P2-12）
`FilmLab.jsx:256-263` — 调用一次 `resolveFilmCurveParams()`，展开。

### T.10 ToneCurveEditor histogram 优化（P1-16）
传 `histogram={histograms[activeChannel]}` 而非整个对象。

### T.11 PhotoThumb 不接收 currentParams（P1-17）
`PhotoSwitcher.jsx` — 移除 `currentParams` prop。

### T.12 直方图数组复用（P1-18）
`FilmLab.jsx:1299-1302` — `useRef(new Array(256).fill(0))` × 4。

### T.13 测试
- T.1: `React.memo` 包装后拖动一个滑块只重渲染该滑块（mock render 计数）
- T.4: 错误路径直方图属性名正确
- T.5: `applyPreset` 触发 1 次 dispatch（非 25 次 setState）
- T.7: 图像加载只 1 次 fetch

**预期**：+15 测试。

---

## Phase U — 资源管理 P1/P2

### U.1 AbortController 全管线（P1-23）
- ComputeService: 所有 fetch 接受 `signal`
- FilmLab.jsx: `abortRef` 切换照片时 abort
- AutoCropButton: 检测请求可取消

### U.2 进度回调 disposer（P2-22）
`ComputeService.js:48-49` — 返回 disposer。

### U.3 FilmLabWebGL 预分配（P2-19）
`cache._scratch3 = new Float32Array(3)` 等。

### U.4 顶点缓冲 dirty flag（P2-20）
`cache.lastUVKey`。

### U.5 LUT packed buffer 缓存（P2-21）
按内容哈希缓存。

### U.6 监听器清理（P2-33/50）
- handleBarMouseDown → useEffect
- webglcontextlost → disposeWebGL 中 removeEventListener

### U.7 rAF 轮询改 ResizeObserver（P2-32）
`FilmLabCanvas.jsx:36-61`。

### U.8 测试
- U.1: abort 后 fetch 抛 AbortError
- U.2: 卸载后 progressCallbacks Map 为空
- U.3: `new Float32Array` 调用次数 < 24/帧

**预期**：+10 测试。

---

## Phase V — 代码重复 + P2/P3 清理

### V.1 RenderCore 管线统一（P2-24/25）
- `processPixel` 调 `processPixelFloat` + scale
- `_sampleLUT3D` 接受 scale 参数

### V.2 setTimeout → MessageChannel（P2-26）
`CpuRenderService.js:182`。

### V.3 getCurveLUT memo（P2-27）
`FilmLab.jsx:1232-1235` — `useMemo([curves])`。

### V.4 AI 上下文 debounce（P2-28）
`FilmLab.jsx:224-230` — `setTimeout(…, 300)`。

### V.5 console.log 清理（P2-29）
30+ 处 → `if (process.env.NODE_ENV !== 'production')`。

### V.6 DEBUG 代码条件编译（P2-30）
`FilmLabWebGL.js:750-771`。

### V.7 handleSave/downloadClientJPEG 抽公共函数（P2-34）
`renderAtSize(image, params, {maxWidth, outputFormat})`。

### V.8 P3 清理
- 删除 `committedRotationRef`（P3-37）
- 删除注释代码（P3-38/42）
- 删除 crop-debug span（P3-40）
- 修复死/buggy 行（P3-41）
- hoist 常量函数/对象（P3-45/46/49）
- 内联箭头改 useCallback（P3-47/48）
- PhotoSwitcher smooth scroll（P3-44）

### V.9 测试
- V.1: `processPixel` 与 `processPixelFloat` 数值一致
- V.2: `MessageChannel` 让步 < 1ms
- V.5: 生产模式无 console.log 调用

**预期**：+10 测试。

---

## 执行顺序与依赖

```
Phase S（渲染核心 P0，最高优先级）
  ↓
Phase T（React 性能，可与 S 部分并行）
  ↓
Phase U（资源管理，依赖 S 的 async 基础）
  ↓
Phase V（清理，独立）
  ↓
最终全量测试 + lint + 视觉验证
```

Phase S 必须最先（P0 阻塞主线程是最大痛点）。
Phase T 可与 S 部分并行（不同文件域）。
Phase U 依赖 S 的 async 基础（AbortController 配合 async render）。
Phase V 独立清理。

## 测试基线

- 当前：60 suites / 866 tests
- Phase S 后：~886（+20）
- Phase T 后：~901（+15）
- Phase U 后：~911（+10）
- Phase V 后：~921（+10）
- 最终目标：~920 tests，0 failing

## 视觉验证计划

- Phase S 后：滑块拖动 60fps 无掉帧（Chrome DevTools Performance 录制）
- Phase T 后：React DevTools profiler 显示拖动时仅 1-3 组件重渲染（非 80+）
- Phase U 后：切换 20 张照片后 GPU 内存稳定（`performance.memory` 不增长）
- 最终：综合 6×3 网格验证全管线无回归

## Top 5 修复（最高影响、最低风险）

1. **WebGL canvas 复用**（P0-1, ~10 行）— 消除 context 泄漏 + GPU 内存耗尽
2. **React.memo 包装 SliderControl/PhotoThumb/ChannelSliders/ToneControl**（P1-5, ~5 行/组件）— 侧栏重渲染成本降 ~5×
3. **CPU 路径改 async + abort**（P0-2, ~20 行）— 解除主线程阻塞
4. **直方图读回优化**（P0-3, ~15 行）— 消除 12MB/帧分配
5. **RenderCore filmCurve LUT 预构建**（P1-13, ~10 行）— 移除 3M 次哈希查找/渲染
