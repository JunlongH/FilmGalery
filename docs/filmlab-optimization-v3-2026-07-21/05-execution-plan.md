# 05 · 执行计划（Phase S–V）

原则延续 v1/v2：**先暴露再修复**、SSOT、每阶段先复核再改、每阶段后全量测试。

## 阶段总览（v3 修正后）

| 阶段 | 内容 | 对应发现 | 预期 tests |
|---|---|---|---|
| S | 预览渲染核心 P0 修复 + stale-render 语义 | P0-1/2/3/4, P1-13/14/53 | +22 |
| T | React 性能 P1 修复（**可与 S 部分并行，零回归风险项优先**） | P1-5/6/8/9/10/11/12/15/16/17 | +15 |
| U | 资源管理 P1/P2 修复（**统一 abort 机制**） | P1-23/28, P2-22/33/19/20/21 | +12 |
| V | 代码重复清理 + P2/P3 + Save/Export 异步 | P2-7/18/24/25/26/27/29/30/34/54/55, P3 全部 | +12 |

总预期：~61 个新测试，866 → ~927（v3 修正：原计划写"950"与详细累加"921"不一致；现统一为 ~927）。

---

## Phase S — 预览渲染核心 P0/P1

### S.0 stale-render 语义设计文档（**v3 新增——S.2 前置**）
**问题**：原计划 S.2 把 `processImage` 改 async 后，rAF 回调可能并发重叠（一个 rAF 启动 async 渲染，下一个 rAF 在前一个未完成时又启动）——可能造成：
1. 两个 async 渲染交错，canvas 显示闪烁
2. 旧的 async 渲染晚于新的完成，覆盖新状态（典型 race condition）
3. `staleRef` 何时设/查未定义

**前置工作**：在动工 S.2 前，先写 `docs/filmlab-stale-render-design.md`，明确：
- `staleRef` 语义：在 `processImage` 入口设置 `const myId = ++renderIdRef.current`；在每个 `await` 后检查 `if (renderIdRef.current !== myId) return;`
- rAF 去重：rAF 回调内若已有 in-flight 渲染，跳过新帧（让当前帧继续），不排队
- AbortSignal 统一：`staleRef` 改为 `AbortController`——`abortRef.current?.abort()` 触发旧渲染的 `signal.aborted`，新渲染用新 controller
- 错误处理：`AbortError` 静默吞掉（这是预期行为），其他错误走 S.2c 错误边界

### S.1 WebGL canvas 复用（P0-1）
`FilmLab.jsx:1186-1244` — 复用 `processedCanvasRef.current`：
```js
const webglCanvas = processedCanvasRef.current || document.createElement('canvas');
// 不再每次新建
```

### S.2 CPU 回退改异步（P0-2）—— **拆为 S.2a/S.2b/S.2c**
原计划单步描述过简，实际触及 rAF 调度、stale 检测、AbortController 接线、错误边界——拆三子阶段：

#### S.2a stale-render + AbortSignal 统一
- 引入 `renderIdRef` + `abortRef`（统一 abort，不另用 `staleRef`）
- `processImage` 改 async，每个 await 后检查 `renderIdRef.current !== myId`
- rAF 回调内：若 `abortRef.current?.signal.aborted === false`（仍有 in-flight），跳过本帧
- 配套：P3-58（错误静默吞掉）改为：`AbortError` 静默；其他错误进入 error state

#### S.2b CPU 路径替换为 async
`FilmLab.jsx:1367-1402` — 替换内联循环为：
```js
const result = await processCanvasWithRenderCoreAsync(canvas, params, {
  signal: abortRef.current.signal,  // 不再用 shouldAbort 回调
  chunkRows: 64,
});
```

#### S.2c async 错误边界
- `processImage` try/catch：`AbortError` 跳过；其他错误 `setRenderError(err)` + UI 提示
- 加 retry 计数（context loss 后重试 ≤3 次）

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
`FilmLab.jsx` 4 处 + `CpuRenderService.js:170`（v3 修正：原计划漏列第 5 处） — 用 ref + params key 复用 RenderCore 实例。

### S.7 isWebGLAvailable 与 processImageWebGL 对齐（P1-53 + P3-56，v3 新增）
`FilmLabWebGL.js:74-81` — `isWebGLAvailable()` 改为优先 `getContext('webgl2')`；模块级缓存结果避免每次创建 canvas。

### S.8 测试
- S.1: 切换 20 次后 `getContext` 调用次数 = 1
- S.2a: 快速切换 10 次照片，只保留最后一次渲染结果（`renderIdRef` 单调递增，旧渲染被 abort）
- S.2a: rAF 内若 in-flight 未完成，新帧被跳过（mock rAF 计数）
- S.2b: CPU 路径不阻塞（mock `processCanvasWithRenderCoreAsync` 被调用 + 收到 signal）
- S.2c: 渲染抛非 AbortError 时 UI 显示错误提示；context loss 后重试 ≤3 次
- S.3: 拖动中 `getImageData` 不被调用
- S.5: `processPixelFloat` 不调 `FILM_CURVE_PROFILES` 查找
- S.6: 相同 params 复用 RenderCore（`new RenderCore` 调用次数 < 渲染次数）
- S.7: `isWebGLAvailable()` 在 webgl2-only 环境返回 true（mock getContext）

**预期**：+22 测试。

---

## Phase T — React 性能 P1（v3 修正：可与 S 部分并行，零风险项先行）

> **顺序调整理由**：T.1（React.memo 包装 8 个组件）~5 行/组件，零回归风险，立竿见影。无需等待 S.2a stale-render 设计。建议与 S.1/S.3/S.4/S.5/S.6/S.7 并行启动；T.3/T.5/T.7 等触及 `processImage` 的项等 S.2 完成。

### T.1 React.memo 包装组件（P1-5）— **可立即开工，与 S 并行**
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

### T.3 processImage useCallback（P1-6）— **依赖 S.2 完成**
`FilmLab.jsx:1147` — `useCallback` + 显式依赖。

### T.4 直方图属性名统一（P2-7，v3 修正：由 P1-7 降级 P2，仍在本阶段修复）
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
`FilmLab.jsx:734-739` — 加 `active` flag + cleanup（或复用 S.2a 的 AbortSignal）。

### T.9 webglParams memo 用 resolveFilmCurveParams（P1-12/P2-12）
`FilmLab.jsx:256-263` — 调用一次 `resolveFilmCurveParams()`，展开。

### T.10 ToneCurveEditor histogram 优化（P1-16）
传 `histogram={histograms[activeChannel]}` 而非整个对象。

### T.11 PhotoThumb 不接收 currentParams（P1-17，v3 修正：原诊断已纠正）
`PhotoSwitcher.jsx` — `PhotoThumb` 实际未接收 `currentParams`（prop 列表已是 `{photo, isActive, onClick, hasPositive, isSelected, showCheckbox}`）。修复重点是 `React.memo` + 父组件 `useCallback` 稳定 `onClick`，避免父重渲染连带子重渲染。

### T.12 直方图数组复用（P2-18，v3 修正：由 P1-18 降级 P2，仍在本阶段修复）
`FilmLab.jsx:1299-1302` — `useRef(new Array(256).fill(0))` × 4。

### T.13 测试
- T.1: `React.memo` 包装后拖动一个滑块只重渲染该滑块（mock render 计数）
- T.4: 错误路径直方图属性名正确
- T.5: `applyPreset` 触发 1 次 dispatch（非 25 次 setState）
- T.7: 图像加载只 1 次 fetch

**预期**：+15 测试。

---

## Phase U — 资源管理 P1/P2（v3 修正：统一 abort 机制）

### U.1 AbortController 全管线（P1-23）— **依赖 S.2a 的 AbortSignal 设计**
- ComputeService: 所有 fetch 接受 `signal`
- FilmLab.jsx: `abortRef` 切换照片时 abort（复用 S.2a 引入的 controller）
- AutoCropButton: 检测请求可取消
- **不再用 `shouldAbort` 回调**——统一用 `signal.aborted`（v3 修正：避免两套 abort 机制）

### U.2 AI 上下文 debounce（P1-28，v3 修正：由 P2 升级 P1）
`FilmLab.jsx:224-230` — `setTimeout(…, 300)` + cleanup。也可考虑用 `signal` 取消未完成的 AI 上下文更新。

### U.3 进度回调 disposer（P2-22）
`ComputeService.js:48-49` — 返回 disposer。

### U.4 FilmLabWebGL 预分配（P2-19）
`cache._scratch3 = new Float32Array(3)` 等。

### U.5 顶点缓冲 dirty flag（P2-20）
`cache.lastUVKey`。

### U.6 LUT packed buffer 缓存（P2-21）
按内容哈希缓存。

### U.7 监听器清理（P2-33/50）
- handleBarMouseDown → useEffect
- webglcontextlost → disposeWebGL 中 removeEventListener

### U.8 rAF 轮询改 ResizeObserver（P2-32）
`FilmLabCanvas.jsx:36-61`。

### U.9 测试
- U.1: abort 后 fetch 抛 AbortError
- U.1: 切换 5 次照片后无 in-flight 请求（mock fetch 计数 + abort 调用计数）
- U.2: 拖动滑块时 AI 上下文 effect 不触发，mouseup 300ms 后触发
- U.3: 卸载后 progressCallbacks Map 为空
- U.4: `new Float32Array` 调用次数 < 24/帧

**预期**：+12 测试。

---

## Phase V — 代码重复 + P2/P3 清理 + Save/Export 异步

### V.1 RenderCore 管线统一（P2-24/25）
- `processPixel` 调 `processPixelFloat` + scale
- `_sampleLUT3D` 接受 scale 参数

### V.2 setTimeout → MessageChannel（P2-26）
`CpuRenderService.js:182`。

### V.3 getCurveLUT memo（P2-27）
`FilmLab.jsx:1232-1235` — `useMemo([curves])`。

### V.4 console.log 清理（P2-29）
30+ 处 → `if (process.env.NODE_ENV !== 'production')`。

### V.5 DEBUG 代码条件编译（P2-30）
`FilmLabWebGL.js:750-771`。

### V.6 handleSave/downloadClientJPEG 抽公共 async 函数（P2-34 + P2-54 + P2-55，v3 新增）
`FilmLab.jsx:1765-1777` + `2198-2210` — 抽 `renderAtSize(image, params, {maxWidth, outputFormat, signal})`：
- 复用 `processCanvasWithRenderCoreAsync`（不再同步阻塞）
- 接受 `signal` 支持取消（导出中切走可 abort）
- 解决 P2-34（重复）+ P2-54（handleSave 阻塞）+ P2-55（downloadClientJPEG 阻塞）

### V.7 P3 清理
- 删除 `committedRotationRef`（P3-37）
- 删除注释代码（P3-38/42）
- 删除 crop-debug span（P3-40）
- 修复死/buggy 行（P3-41）
- hoist 常量函数/对象（P3-45/46/49）
- 内联箭头改 useCallback（P3-47/48）
- PhotoSwitcher smooth scroll（P3-44）
- webglParams 深比较（P3-57，v3 新增）：用 `stableSerializeParams` 替代 `===`
- processImage 错误 state（P3-58，v3 新增）：已在 S.2c 部分实现，此处补 UI 提示

### V.8 测试
- V.1: `processPixel` 与 `processPixelFloat` 数值一致
- V.2: `MessageChannel` 让步 < 1ms
- V.5: 生产模式无 console.log 调用
- V.6: handleSave 不阻塞主线程（mock `processCanvasWithRenderCoreAsync` 被调用）
- V.6: 导出中 abort 后 `toBlob` 不被调用
- V.7: webglParams 值相同但引用不同时不触发 canvas 重建

**预期**：+12 测试。

---

## 执行顺序与依赖（v3 修正）

```
S.0 stale-render 设计文档（前置）
  ↓
Phase S（渲染核心 P0，最高优先级）
  ├─ S.1/S.3/S.4/S.5/S.6/S.7（独立子项，可并行）
  └─ S.2a → S.2b → S.2c（强依赖链）
                  ↓
Phase T（React 性能）
  ├─ T.1/T.2/T.10/T.11（独立，可与 S 并行，零回归风险）
  └─ T.3/T.5/T.7/T.8（依赖 S.2a 的 AbortSignal）
                  ↓
Phase U（资源管理，依赖 S.2a 的 AbortSignal + S.6 的 RenderCore ref）
  ↓
Phase V（清理 + Save/Export 异步，独立）
  ↓
最终全量测试 + lint + 视觉验证
```

**关键依赖**：
- **S.0 必须最先**：stale-render 语义未定前，S.2 不可动工（async rAF 重叠风险）
- **T.1 可与 S 并行**：React.memo 包装零风险，立即可做
- **U.1 依赖 S.2a**：AbortSignal 机制统一，不能用两套 abort
- **V 独立**：清理类工作可最后做

## 测试基线（v3 修正后）

- 当前：60 suites / 866 tests
- Phase S 后：~888（+22）
- Phase T 后：~903（+15）
- Phase U 后：~915（+12）
- Phase V 后：~927（+12）
- 最终目标：~927 tests，0 failing（v3 修正：原计划 overview "950" 与详细 "921" 不一致，现统一）

## 视觉验证计划（v3 修正：可测标准）

| 阶段 | 验证项 | 可测标准 |
|---|---|---|
| Phase S 后 | 滑块拖动流畅度 | Chrome DevTools Performance 录制 10s 拖动 exposure 滑块（2000×1500 图像）：rAF 回调 P50 ≤ 16ms，P99 ≤ 32ms，长任务（>50ms）计数 = 0 |
| Phase T 后 | 侧栏重渲染 | React DevTools Profiler 录制拖动单个 HSL hue 滑块：commit 涉及组件数 ≤ 3（非 80+），render duration ≤ 2ms |
| Phase U 后 | GPU 内存稳定 | 切换 20 张照片（不同尺寸）：`performance.memory.usedJSHeapSize` 增量 < 5MB（Chrome-only；Firefox/Safari 用 `console.timeStamp` + 手动比对 heap snapshot）；WebGL context 数量 = 1（`getContext` spy 计数） |
| 最终 | 全管线无回归 | 综合矩阵：6 种 inversion mode（positive/negative/slide/b&w/infrared/custom）× 3 种渲染路径（WebGL2 / WebGL1 / CPU 回退）= 18 组合；每组 1 张测试图；判定标准：直方图 χ² 相似度 > 0.99，无 crash，无 console error |

## 风险缓解（v3 新增）

### Feature flags
建议为高风险变更加 feature flag（`localStorage` 或 app settings）：
- `FG_WEBGL_CANVAS_REUSE`（P0-1）：失败时回退到原行为（每次新建）
- `FG_ASYNC_RENDER`（P0-2）：失败时回退到同步渲染（已知会阻塞，但不会闪烁）
- `FG_HISTOGRAM_SKIP_DRAG`（P0-3）：失败时回退到每帧算直方图

### Rollback 策略
- 每个 Phase 单独 commit（已有 v1/v2 习惯）
- Phase S 失败 → revert S commit，T/U/V 不受影响
- S.2 失败 → revert S.2a/b/c 三个 commit，S.1/S.3/S.4/S.5/S.6/S.7 保留

### Beta 测试
- Phase S 完成后：在 dev 分支跑 1 周日常使用，收集 Performance 录制
- Phase U 完成后：测试切换 100 张照片（含 RAW + JPEG 混合），监控内存
- 最终前：邀请 2-3 个用户做 dogfooding，关注"是否感受到响应提升"

## Top 5 修复（最高影响、最低风险，v3 修正）

1. **WebGL canvas 复用**（P0-1, ~10 行）— 消除 context 泄漏 + GPU 内存耗尽
2. **React.memo 包装 SliderControl/PhotoThumb/ChannelSliders/ToneControl**（P1-5, ~5 行/组件）— 侧栏重渲染成本降 ~5×（**可立即开工，与 S 并行**）
3. **CPU 路径改 async + AbortSignal 统一**（P0-2, ~30 行 + S.0 设计文档）— 解除主线程阻塞
4. **直方图读回优化**（P0-3, ~15 行）— 消除 12MB/帧分配
5. **RenderCore filmCurve LUT 预构建**（P1-13, ~10 行）— 移除 3M 次哈希查找/渲染

> **v3 修正说明（2026-07-21 review 后）**：
> - **Phase S.2 拆为 S.0/S.2a/S.2b/S.2c**：原计划低估 async `processImage` 的集成复杂度。S.0 是 stale-render 语义设计文档（前置）；S.2a 统一 AbortSignal；S.2b 替换 CPU 路径；S.2c 错误边界。
> - **Phase T 可与 S 并行**：T.1（React.memo）零风险，立即可做。原计划把 T 放在 S 之后串行执行浪费时间。
> - **Phase U 统一 abort 机制**：原计划 S.2 用 `staleRef`、U.1 用 `AbortSignal` 是两套机制。现统一为 `AbortSignal`。
> - **Phase V 新增 Save/Export 异步化**（P2-54/P2-55）：原计划 P2-34 只抽公共函数，未解决同步阻塞。
> - **测试数对齐**：overview "950" vs 详细 "921" 不一致，现统一为 ~927（含新增 D-1/D-3/D-4 等发现的测试）。
> - **验证标准可测化**：所有"60fps 无掉帧""无回归"等模糊表述改为可测阈值。
> - **新增风险缓解**：feature flags + rollback 策略 + beta 测试计划。
