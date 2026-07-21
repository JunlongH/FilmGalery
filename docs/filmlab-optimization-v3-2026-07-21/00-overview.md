# FilmLab 优化计划 v3（2026-07-21）

基于第三轮系统性审查，聚焦**预览渲染效率、交互响应性、资源管理**三大主题。
本轮在 v1（Phase A–L，127 测试）和 v2（Phase M–R，+283 测试）基础上，
发现了一批**性能瓶颈、主线程阻塞、资源泄漏、React 反模式**问题。

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

### P1 — 显著性能/UX 影响（14 项）

5. **8 个面板/滑块组件无一 `React.memo`**（SliderControl/HSLPanel/SplitToningPanel/ToneCurveEditor/PhotoThumb/FilmLabControls/FilmLabCanvas/AutoCropButton）— 一次滑块拖动重渲染整个侧栏（15+ 滑块 + 24 HSL 子滑块 + 3 色轮 + 曲线编辑器）
6. **`processImage` 非 memoized，捕获 ~40 个状态变量**（FilmLab.jsx:1147）— eslint-disable 掩盖了依赖不完整
7. **直方图属性名不一致**（FilmLab.jsx:1358 用 `r/g/b`，正常路径用 `red/green/blue`）— 错误路径下 ToneCurveEditor 直方图为空
8. **50+ 个 `useState` 应收敛为 `useReducer`**（FilmLab.jsx:43-176）— `applyPreset` 触发 25-30 次连续 setState
9. **`handlePanStart` 在事件回调内 addEventListener 无 useEffect 清理**（FilmLab.jsx:1601-1633）— 组件卸载时泄漏
10. **图像加载双网络请求**（FilmLab.jsx:734-792）— `new Image()` + `fetch(arrayBuffer)` 同一 URL 两次
11. **非 server-decode 路径 `img.onload` 无竞态保护**（FilmLab.jsx:734-739）— 快速切换照片时旧图覆盖新图
12. **`webglParams` memo 内 `filmCurveProfiles.find()` 调用 8 次**（FilmLab.jsx:256-263）— 应调用 `resolveFilmCurveParams()` 一次
13. **`RenderCore.processPixelFloat` 内每像素查 `FILM_CURVE_PROFILES`**（RenderCore.js:286,518）— 3M 像素 = 3M 次哈希查找
14. **`RenderCore` 每次渲染都 `new` + `prepareLUTs()`**（FilmLab.jsx:1364 等 4 处）— LUT 无跨实例缓存
15. **FilmLabCanvas crop-drag effect 在 `localCropRect` 变化时重订阅 window 监听器**（FilmLabCanvas.jsx:66-243）— 60fps 拖动 = 60 次 add/remove/秒
16. **ToneCurveEditor `histogramPath` memo 因 `histograms` 引用每次变化而重算**（ToneCurveEditor.jsx:24-45）— 256 次循环 + 字符串拼接每帧
17. **PhotoThumb 未 memo，`currentParams` 变化时全部缩略图重渲染**（PhotoSwitcher.jsx:24）— 36+ 张照片重渲染
18. **`processImage` 每帧分配 4× `new Array(256)`**（FilmLab.jsx:1299-1302）— 可用 `useRef` 复用

### P2 — 中等影响（18 项）

- FilmLabWebGL 每帧 24+ 次 `new Float32Array`（uniform 上传）
- 顶点缓冲每帧重传（UV 未变也传）
- `packLUT3DForWebGL` 每次 LUT 变化分配 143KB
- ComputeService 进度回调 Map 泄漏（无清理）
- 全管线零 `AbortController`（6 处 fetch + XHR + batch）
- `processPixel`/`processPixelFloat` ~250 行重复
- `_sampleLUT3D`/`_sampleLUT3DFloat` ~60 行重复
- `setTimeout(0)` 让步 ~4ms 开销（应用 MessageChannel）
- `getCurveLUT` 每帧 4 次样条构建（未 memo）
- AI 上下文 `updateOverlayContext` 每滑块触发
- 30+ 处 `console.log` 在生产路径
- DEBUG 代码 `readPixels` 在 bundle 中
- 等等

### P3 — 清理（16 项）

- 死代码：`useFilmLabRenderer.js`（243 行）、`committedRotationRef`、注释代码、debug span
- 内联箭头函数（ defeats memo）
- `sourceLabels` 等对象每渲染重建
- `isWebGLAvailable()` 每次调用创建 canvas

## 测试基线

- 当前：60 suites / 866 tests（v2 后）
- 目标：~950 tests，0 failing
- 新增性能测试套件：渲染时间断言、重渲染计数、内存泄漏检测

## 视觉验证计划

- Phase S 后：滑块拖动 60fps 无掉帧（火焰图截图）
- Phase T 后：侧栏交互响应 < 16ms（React DevTools profiler）
- Phase U 后：GPU 内存稳定（切换 20 张照片后无 context 泄漏）
- 最终：综合 6×3 网格验证全管线无回归
