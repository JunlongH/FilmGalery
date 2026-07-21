# FilmLab 优化计划 v3（2026-07-21）

> **状态：✅ 已完成（2026-07-21）**

基于第三轮系统性审查，聚焦**预览渲染效率、交互响应性、资源管理**三大主题。
本轮在 v1（Phase A–L，127 测试）和 v2（Phase M–R，+283 测试）基础上，
发现了一批**性能瓶颈、主线程阻塞、资源泄漏、React 反模式**问题。

## 执行状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| S.0 | stale-render 设计文档（`docs/filmlab-stale-render-design.md`） | ✅ |
| S.1–S.7 | 渲染核心 P0/P1 修复（canvas 复用、async CPU、直方图 scratch、WebGL 对齐） | ✅ |
| T.1–T.12 | React 性能 P1 修复（8 组件 memo、useCallback、单 fetch、竞态保护） | ✅ |
| U.2–U.4 | 资源管理（AI debounce、WebGL scratch buffers、vertex dirty flag） | ✅ |
| V.2–V.6 | 工具链优化（MessageChannel、getCurveLUT memo、Save/Export async） | ✅ |
| P3 | 死代码/console.log/span 清理 | ✅ |
| 测试 | 73 个新测试（26-v3-phaseS + 27-v3-phaseTUV），939 tests / 0 failing | ✅ |
| 验证 | LUT 精度 52 点 max diff 0.000864；8 像素全管线反转正确；0 lint errors | ✅ |

## 完成提交

```
fix(filmlab): v3 performance — async CPU rendering, WebGL reuse, React.memo, histogram scratch, LUT prebuild

Phase S: stale-render (renderIdRef+AbortSignal), WebGL canvas reuse (P0-1),
  async processImage + error boundary (P0-2), 256×256 scratch histogram (P0-3),
  delete useFilmLabRenderer (P0-4), filmCurve LUT prebuild (P1-13),
  RenderCore instance reuse (P1-14), isWebGLAvailable webgl2+ caching (P1-53/P3-56)

Phase T: React.memo 8 components (P1-5), useCallback stable handlers,
  single fetch image loading (P1-10), race protection (P1-11),
  resolveFilmCurveParams SSOT (P1-12), ToneCurveEditor memo (P1-16),
  histogram array reuse (P2-18)

Phase U: AI context 300ms debounce (P1-28), WebGL scratch Float32Array (P2-19),
  vertex buffer dirty flag (P2-20), handleBarMouseDown cleanup (P2-33)

Phase V: MessageChannel yield (P2-26), getCurveLUT memo (P2-27),
  console.log cleanup (P2-29), DEBUG code gated (P2-30),
  handleSave/downloadClientJPEG async (P2-54/55),
  P3 dead code cleanup (37-42,49)

Tests: 73 new, 939 total / 0 failing
Lint: 0 errors
```

## 调查方法

- 1 个 explore agent 对 16 个核心文件做行级审查
- 覆盖：React 组件（8 个）、WebGL 渲染器、CPU 渲染服务、ComputeService、RenderCore、render-buffer、renderChunked
- 每条发现均有 `file:line` + 严重度 + 可操作建议
- 仅报告"当前仍未解决"或"v2 引入新问题"

## 与 v2 的关系

v2 修复了**算法正确性**（边缘检测、色彩算法、数据完整性、UI bug）。
v3 聚焦**性能与响应性**——这是用户感知最直接、但 v1/v2 未触及的领域。

## 分卷索引

| 卷 | 内容 |
|---|---|
| [01-issues-by-priority.md](01-issues-by-priority.md) | 全部发现按优先级排序（P0–P3） |
| [02-preview-rendering.md](02-preview-rendering.md) | 预览渲染管线详细问题 |
| [03-react-performance.md](03-react-performance.md) | React 组件重渲染、memo、状态管理 |
| [04-resource-management.md](04-resource-management.md) | WebGL/内存/监听器/AbortController |
| [05-execution-plan.md](05-execution-plan.md) | 分阶段执行计划（Phase S–V） |

## 优先级概览

### P0 — 关键性能/正确性（4 项）

1. **WebGL context 每次缓存未命中都新建 canvas+context，旧的不释放**（FilmLab.jsx:1186-1244）— 浏览器上限 ~16 个 context，滑块调 16 次后 GPU 内存累积
2. **CPU 回退路径同步阻塞主线程 200-800ms**（FilmLab.jsx:1367-1402）— 已有 `processCanvasWithRenderCoreAsync` 但未使用
3. **每次渲染都 `getImageData` 全画布回读（12MB）只为算直方图**（FilmLab.jsx:1283-1296）— 滑块拖动时每帧 12MB 分配 + GPU→CPU 回读
4. **`useFilmLabRenderer.js:208` 引用未定义变量 `frameRequest`（应为 `frameRequestRef`）**— 死代码中的 typo，证实该 hook 从未使用

### P1 — 显著性能/UX（15 项，v3 修正后）

5. **8 个面板/滑块组件无一 `React.memo`**（SliderControl/HSLPanel/SplitToningPanel/ToneCurveEditor/PhotoThumb/FilmLabControls/FilmLabCanvas/AutoCropButton）— 一次滑块拖动重渲染整个侧栏（15+ 滑块 + 24 HSL 子滑块 + 3 色轮 + 曲线编辑器）
6. **`processImage` 非 memoized，捕获 ~40 个状态变量**（FilmLab.jsx:1147）— eslint-disable 掩盖了依赖不完整
8. **50+ 个 `useState` 应收敛为 `useReducer`**（FilmLab.jsx:43-176）— `applyPreset` 触发 25-30 次连续 setState
9. **`handlePanStart` 在事件回调内 addEventListener 无 useEffect 清理**（FilmLab.jsx:1601-1633）— 组件卸载时泄漏
10. **图像加载双网络请求**（FilmLab.jsx:734-792）— `new Image()` + `fetch(arrayBuffer)` 同一 URL 两次
11. **非 server-decode 路径 `img.onload` 无竞态保护**（FilmLab.jsx:734-739）— 快速切换照片时旧图覆盖新图
12. **`webglParams` memo 内 `filmCurveProfiles.find()` 调用 8 次**（FilmLab.jsx:256-263）— 应调用 `resolveFilmCurveParams()` 一次
13. **`RenderCore.processPixelFloat` 内每像素查 `FILM_CURVE_PROFILES`**（RenderCore.js:286,518）— 3M 像素 = 3M 次哈希查找
14. **`RenderCore` 每次渲染都 `new` + `prepareLUTs()`**（FilmLab.jsx:1364, 1671, 1762, 2195 + CpuRenderService.js:170，共 5 处）— LUT 无跨实例缓存
15. **FilmLabCanvas crop-drag effect 在 `localCropRect` 变化时重订阅 window 监听器**（FilmLabCanvas.jsx:66-243）— 60fps 拖动 = 60 次 add/remove/秒
16. **ToneCurveEditor `histogramPath` memo 因 `histograms` 引用每次变化而重算**（ToneCurveEditor.jsx:24-45）— 256 次循环 + 字符串拼接每帧
17. **PhotoThumb 未 memo**（PhotoSwitcher.jsx:24，v3 修正：实际未接收 `currentParams` prop，但无 memo 时父组件重渲染会连带 36+ 子组件重渲染）
23. **全管线零 `AbortController`**（v3 修正：由 P2 升级 P1——切换照片时旧 fetch/XHR/CPU 渲染继续飞行，是正确性问题）
28. **AI 上下文 `updateOverlayContext` 每滑块触发**（v3 修正：由 P2 升级 P1——直接 UX 影响）
53. **`isWebGLAvailable()` 只查 `webgl`/`experimental-webgl`，但 `processImageWebGL()` 优先 `webgl2`**（v3 新发现）— 两者判定不一致，可能误禁用 GPU 路径

### P2 — 中等影响（20 项，v3 修正后）

- 7（v3 由 P1 降级 P2）：直方图属性名不一致（仅 error path 触发，cosmetic）
- 18（v3 由 P1 降级 P2）：`processImage` 每帧分配 4× `new Array(256)`（8KB/帧，可忽略）
- 19：FilmLabWebGL 每帧 24+ 次 `new Float32Array`（uniform 上传）
- 20：顶点缓冲每帧重传（UV 未变也传）
- 21：`packLUT3DForWebGL` 每次 LUT 变化分配 143KB
- 22：ComputeService 进度回调 Map 泄漏（无清理）
- 24：`processPixel`/`processPixelFloat` ~250 行重复
- 25：`_sampleLUT3D`/`_sampleLUT3DFloat` ~60 行重复
- 26：`setTimeout(0)` 让步 ~4ms 开销（应用 MessageChannel）
- 27：`getCurveLUT` 每帧 4 次样条构建（未 memo）
- 29：30+ 处 `console.log` 在生产路径
- 30：DEBUG 代码 `readPixels` 在 bundle 中
- 31：`rawParams` 存储但从未内部使用
- 32：rAF 轮询 canvas 尺寸
- 33：`handleBarMouseDown` 监听器泄漏
- 34：`handleSave`/`downloadClientJPEG` 几何+像素循环逻辑重复
- 35：`processCanvasWithRenderCore`（sync）阻塞主线程
- 36：内联 `require()` 在 JSX 回调
- 54（v3 新发现）：`handleSave` 同步像素循环阻塞主线程（24M 像素秒级阻塞）
- 55（v3 新发现）：`downloadClientJPEG` 同步像素循环阻塞（同 #54）

### P3 — 清理（18 项，v3 修正后）

- 37–52：原 16 项（死代码、console.log、内联箭头、minor 分配等）
- 56（v3 新发现）：`isWebGLAvailable()` 每次调用创建 canvas（原 overview 提到但未编号）
- 57（v3 新发现）：`webglParams` 引用相等性脆弱（`===` 比较，深比较更稳）
- 58（v3 新发现）：`processImage` 错误静默吞掉（无 UI 反馈，context loss 后可能反复失败）

## 测试基线（v3 修正后）

- 当前：60 suites / 866 tests（v2 后）
- 目标：~927 tests，0 failing（v3 修正：原 overview 写"950"与执行计划"921"不一致，现统一为 ~927）
- 新增性能测试套件：渲染时间断言、重渲染计数、内存泄漏检测、AbortController 取消、stale-render 检测

## 视觉验证计划（v3 修正：可测标准）

- Phase S 后：滑块拖动 rAF P50 ≤ 16ms / P99 ≤ 32ms / 长任务 = 0（Chrome DevTools Performance 录制 10s，2000×1500 图像）
- Phase T 后：React DevTools Profiler 拖动单个 HSL hue 滑块，commit 涉及组件 ≤ 3（非 80+），render duration ≤ 2ms
- Phase U 后：切换 20 张照片后 `performance.memory.usedJSHeapSize` 增量 < 5MB；WebGL context 数量 = 1（spy 计数）
- 最终：6 种 inversion mode × 3 种渲染路径 = 18 组合，直方图 χ² 相似度 > 0.99，无 crash/console error

## v3 修正摘要（2026-07-21 review 后）

- **行号修正**：P1-14 的 1647/1738/2179 → 1671/1762/2195；新增遗漏的第 5 处 `CpuRenderService.js:170`。
- **优先级调整**：
  - 升级 P2→P1：#23（AbortController，正确性）、#28（AI 上下文，UX）
  - 降级 P1→P2：#7（histogram 命名，cosmetic）、#18（4× Array(256)，可忽略）
- **新增发现**：#53（isWebGLAvailable webgl2 不一致，P1）、#54/#55（handleSave/downloadClientJPEG 同步阻塞，P2）、#56（isWebGLAvailable canvas 创建，P3）、#57（webglParams === 脆弱，P3）、#58（processImage 错误吞掉，P3）
- **执行计划修正**：
  - Phase S.2 拆为 S.0（设计文档）+ S.2a（AbortSignal 统一）+ S.2b（CPU async）+ S.2c（错误边界）
  - Phase T 可与 S 并行（T.1 React.memo 零风险）
  - Phase U 统一 abort 机制（不再用 `staleRef` + `AbortSignal` 两套）
  - Phase V 新增 Save/Export 异步化（P2-54/55）
- **测试数对齐**：overview "950" vs 详细 "921" → 统一为 ~927
- **验证标准可测化**：所有"60fps 无掉帧""无回归"等模糊表述改为可测阈值
- **新增风险缓解**：feature flags（`FG_WEBGL_CANVAS_REUSE` 等）+ rollback 策略 + beta 测试计划
