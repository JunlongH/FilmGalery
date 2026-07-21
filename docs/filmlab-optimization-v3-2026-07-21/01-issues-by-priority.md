# 01 · 全部发现按优先级排序

## P0 — 关键性能/正确性（立即修复）

| # | 文件:行号 | 问题 | 建议 |
|---|---|---|---|
| 1 | FilmLab.jsx:1186-1244 | **WebGL context 每次缓存未命中都新建 canvas+context，旧的不释放**。浏览器上限 ~16 个 context，滑块调 16 次后 GPU 内存累积，旧 context 静默丢失 | 复用单个 offscreen canvas（`processedCanvasRef.current || document.createElement('canvas')`），或重赋值前调 `disposeWebGL` |
| 2 | FilmLab.jsx:1367-1402 | **CPU 回退路径同步阻塞主线程 200-800ms**。已有 `processCanvasWithRenderCoreAsync` 但 `processImage` 用内联同步循环 | 替换为 `await processCanvasWithRenderCoreAsync(canvas, params, { chunkRows: 64, shouldAbort })`，`processImage` 改 async + abort flag |
| 3 | FilmLab.jsx:1283-1296 | **每次渲染 `getImageData` 全画布回读（12MB）只为算直方图**。滑块拖动时每帧 12MB 分配 + GPU→CPU 回读 | GPU 端算直方图（downscale pass）；或降采样到 256×256 再读；或拖动时跳过、debounce 到 mouseup |
| 4 | useFilmLabRenderer.js:208 | **`cancelAnimationFrame(frameRequest.current)` 引用未定义变量**（应为 `frameRequestRef`）。死代码中的 typo，证实该 hook 从未使用 | 删除整个文件（243 行死代码） |

## P0 — 测试覆盖（新增）

| # | 文件 | 问题 | 建议 |
|---|---|---|---|
| 4b | tests/ | 渲染性能测试缺失（无帧时间断言、无重渲染计数） | 新建 26-render-perf.test.js：mock canvas + 计数 getUniformLocation/texImage2D 调用次数 |

## P1 — 显著性能/UX（14 项）

| # | 文件:行号 | 问题 | 建议 |
|---|---|---|---|
| 5 | SliderControl.jsx:22, HSLPanel.jsx:38, SplitToningPanel.jsx:17,85, ToneCurveEditor.jsx:4, PhotoSwitcher.jsx:24, FilmLabControls.jsx:506, FilmLabCanvas.jsx:4, AutoCropButton.jsx | **8 个面板/滑块组件无一 `React.memo`**。一次滑块拖动重渲染整个侧栏（15+ 滑块 + 24 HSL 子滑块 + 3 色轮 + 曲线编辑器 + 36+ 缩略图） | `export default React.memo(Component)`；稳定 handler 用 `useCallback`；传 primitive 而非对象 |
| 6 | FilmLab.jsx:1147 | **`processImage` 非 memoized**，捕获 ~40 个状态变量。eslint-disable 掩盖依赖不完整 | `useCallback` + 显式依赖；或提取到 ref 模式 |
| 7 | FilmLab.jsx:1358 vs 1416 vs 150 | **直方图属性名不一致**：错误路径用 `r/g/b`，正常路径用 `red/green/blue`。错误路径下 ToneCurveEditor 直方图为空 | 统一为 `{ rgb, red, green, blue }`，删除 `maxCount` |
| 8 | FilmLab.jsx:43-176 | **50+ 个 `useState` 应收敛为 `useReducer`**。`applyPreset` 触发 25-30 次连续 setState，每次触发单独 re-render 批次 | 合并为 `useReducer(paramsReducer)`，`applyPreset` → 单次 dispatch |
| 9 | FilmLab.jsx:1601-1633 | **`handlePanStart` 在事件回调内 addEventListener 无 useEffect 清理**。组件卸载时监听器泄漏 | 移入 `useEffect` keyed on `isDragging` state |
| 10 | FilmLab.jsx:734-792 | **图像加载双网络请求**：`new Image()` + `fetch(arrayBuffer)` 同一 URL 两次 | 单次 `fetch(blob)` → `createImageBitmap(blob)` + `getExifOrientation(blob)` |
| 11 | FilmLab.jsx:734-739 | **非 server-decode 路径 `img.onload` 无竞态保护**。快速切换照片时旧图覆盖新图 | 加 `active` flag + cleanup（同 server-decode 路径） |
| 12 | FilmLab.jsx:256-263 | **`webglParams` memo 内 `filmCurveProfiles.find()` 调用 8 次**（每字段一次） | 调用 `resolveFilmCurveParams()` 一次，展开结果 |
| 13 | RenderCore.js:286,518 | **`processPixelFloat`/`processPixel` 内每像素查 `FILM_CURVE_PROFILES`**。3M 像素 = 3M 次哈希查找 | 提升到 `prepareLUTs()`，存 `this.luts.filmCurve` |
| 14 | FilmLab.jsx:1364 等 4 处 | **`RenderCore` 每次渲染都 `new` + `prepareLUTs()`**。LUT 无跨实例缓存 | 复用实例（ref + params 变化时重建）；或模块级 LUT 缓存 |
| 15 | FilmLabCanvas.jsx:66-243 | **crop-drag effect 在 `localCropRect` 变化时重订阅 window 监听器**。60fps 拖动 = 60 次 add/remove/秒 | ref 化可变部分，effect 依赖只保留 `[dragState]` |
| 16 | ToneCurveEditor.jsx:24-45 | **`histogramPath` memo 因 `histograms` 引用每次变化而重算**。256 次循环 + 字符串拼接每帧 | 按值比较或只传 activeChannel 数组 |
| 17 | PhotoSwitcher.jsx:24 | **PhotoThumb 未 memo，`currentParams` 变化时全部缩略图重渲染**（36+ 张） | `React.memo` + 稳定 `onClick` |
| 18 | FilmLab.jsx:1299-1302 | **`processImage` 每帧分配 4× `new Array(256)`**（直方图） | `useRef(new Array(256).fill(0))` 复用 |

## P2 — 中等影响（18 项）

| # | 文件:行号 | 问题 | 建议 |
|---|---|---|---|
| 19 | FilmLabWebGL.js:298,447,482-498,668-707 | **每帧 24+ 次 `new Float32Array`**（uniform 上传） | 预分配 `cache._scratch3` 复用 |
| 20 | FilmLabWebGL.js:306-310 | **顶点缓冲每帧重传**（UV 未变也传） | dirty-flag `cache.lastUVKey` |
| 21 | FilmLabWebGL.js:572 | **`packLUT3DForWebGL` 每次 LUT 变化分配 143KB**（33³） | 缓存 packed buffer by content hash |
| 22 | ComputeService.js:48-49 | **进度回调 Map 泄漏**（无清理） | 返回 disposer 或用 `WeakRef` |
| 23 | ComputeService.js:158-166,261,364,485 | **全管线零 `AbortController`**（6 处 fetch + XHR） | 接受 `AbortSignal`，调用方 abort |
| 24 | RenderCore.js:279-498 vs 512-628 | **`processPixel`/`processPixelFloat` ~250 行重复** | 统一：`processPixel` 调 `processPixelFloat` + scale |
| 25 | RenderCore.js:796-856 vs 967-1030 | **`_sampleLUT3D`/`_sampleLUT3DFloat` ~60 行重复** | 统一 with scale 参数 |
| 26 | CpuRenderService.js:182 | **`setTimeout(0)` 让步 ~4ms 开销**（62 chunks × 4ms = 250ms） | 改 `MessageChannel`（~0.5ms） |
| 27 | FilmLab.jsx:1232-1235 | **`getCurveLUT` 每帧 4 次样条构建**（未 memo） | `useMemo([curves])` |
| 28 | FilmLab.jsx:224-230 | **AI 上下文 `updateOverlayContext` 每滑块触发** | debounce 300ms |
| 29 | 全管线 | **30+ 处 `console.log` 在生产路径** | `if (process.env.NODE_ENV !== 'production')` |
| 30 | FilmLabWebGL.js:750-771 | **DEBUG 代码 `readPixels` 在 bundle 中**（gated but shipped） | 条件编译或分离 dev 模块 |
| 31 | RenderCore.js:76 | **`rawParams` 存储但从未内部使用** | 删除或文档化 |
| 32 | FilmLabCanvas.jsx:36-61 | **rAF 轮询 canvas 尺寸**（不优雅） | `ResizeObserver` 或回调 |
| 33 | FilmLabCanvas.jsx:285-295 | **`handleBarMouseDown` 监听器泄漏**（同 handlePanStart） | 移入 useEffect |
| 34 | FilmLab.jsx:1710-1784 vs 2031-2220 | **`handleSave`/`downloadClientJPEG` 几何+像素循环逻辑重复** | 抽 `renderAtSize(image, params, {maxWidth})` |
| 35 | CpuRenderService.js:148-152 | **`processCanvasWithRenderCore`（sync）阻塞主线程** | 弃用或重命名 `_Blocking`，默认 async |
| 36 | FilmLabControls.jsx:949 | **内联 `require()` 在 JSX 回调** | 顶部静态 import |

## P3 — 清理（16 项）

| # | 文件:行号 | 问题 |
|---|---|---|
| 37 | FilmLab.jsx:114 | `committedRotationRef` 声明但从未读取（死代码） |
| 38 | FilmLab.jsx:1700-1705 | 注释掉的 `handleExportLUT`（死代码） |
| 39 | FilmLab.jsx:714,1069,1085,1095,1563,1576,1831 | 7 处 `console.log` 在热路径 |
| 40 | FilmLabCanvas.jsx:419 | `<span id="crop-debug" />` 渲染但从未填充 |
| 41 | FilmLabCanvas.jsx:208-209 | `let next = startRect.rotation + delta` 立即被覆盖（死/buggy 行） |
| 42 | AutoCropButton.jsx:111-119 | 注释掉的 `applyLastResult` |
| 43 | AutoCropButton.jsx:62,67,76,96,100,104 | 6 处 `console.log` |
| 44 | PhotoSwitcher.jsx:160-167 | 快速导航时 `scrollTo({behavior:'smooth'})` 队列堆积 |
| 45 | ToneCurveEditor.jsx:47-72 | `getCurveColor`/`getHistogramFill`/`getHistogramStroke` 每渲染重建（应 hoist） |
| 46 | ToneCurveEditor.jsx:291 | 控制点 `key={i}`（索引）应改稳定 key |
| 47 | HSLPanel.jsx:80,89,98 | 3 处内联 `onChange` 箭头（defeats memo） |
| 48 | SplitToningPanel.jsx:373,374,391,392,409,410 | 6 处内联 `onHueChange` 箭头 |
| 49 | FilmLabControls.jsx:623-628 | `sourceLabels` 对象每渲染重建（应 hoist） |
| 50 | FilmLabWebGL.js:117-134 | `webglcontextlost` 监听器用 DOM 属性标记（反模式） |
| 51 | RenderCore.js:650-729 | `getGLSLUniforms` 每次返回新数组（minor） |
| 52 | render-buffer.js:55-68 | `writePixel` 闭包每次创建（minor） |

## 严重度统计

| 严重度 | 数量 | 影响域 |
|---|---|---|
| P0 | 4+1 | 渲染管线核心（context 泄漏、主线程阻塞、12MB/帧分配） |
| P1 | 14 | React 重渲染、状态管理、竞态、每像素开销 |
| P2 | 18 | 内存分配、无取消、代码重复、调试代码 |
| P3 | 16 | 死代码、console.log、内联箭头、minor 分配 |
