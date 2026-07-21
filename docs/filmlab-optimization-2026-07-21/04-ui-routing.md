# 04 · UI 组件、状态管理、路由服务详细问题

## P0 — 功能性 Bug

### P0-3 WB/普通取色器边缘越界 IndexSizeError
`FilmLab.jsx:961-965,1024-1028` `getImageData(Math.max(0, floor(clickX-1)), Math.max(0, floor(clickY-1)), 3, 3)` 只保护下界。点击 canvas 右/下边缘（clickX >= canvas.width-1）时 x+3 > canvas.width → IndexSizeError。handleCanvasClick 外层无 try-catch。

**建议**：`const sx = Math.max(0, Math.min(canvas.width-3, floor(clickX-1)))`。

### P0-4 savePreset 漏存半数参数
`FilmLab.jsx:375-389` savePreset 缺 baseMode/baseDensityR/G/B/densityLevelsEnabled/densityLevels/rotation/orientation/cropRect/saturation。加载预设后这些参数丢失。

**建议**：抽 serializeAllParams SSOT，captureSnapshot/currentParams/savePreset 全部调用。

### P0-5 CpuRenderService.applyGeometry 漏算 rotationOffset
`CpuRenderService.js:86` `const rotation = (params.rotation||0) + (params.orientation||0)` 漏 rotationOffset。FilmLab.jsx 所有几何用 rotation+orientation+rotationOffset。CPU fallback 旋转角度错误。

**建议**：`+ (params.rotationOffset||0)`。

### P0-6 'x' 快捷键未过滤输入框
`FilmLab.jsx:2479-2488` `if (e.key==='x'\|\|'X') setRatioSwap(...)` 未检查 e.target.tagName。预设名/搜索框输入 x 时若 isCropping=true 误触发。

**建议**：`if (e.target.tagName==='INPUT'\|\|'TEXTAREA'\|\|e.target.isContentEditable) return`。

### P0-7 renderOriginal effect 缺 rotationOffset 依赖
`FilmLab.jsx:740-745` renderOriginal 内部用 rotationOffset（:1377），但 effect 依赖 `[image,rotation,orientation,isCropping,compareMode]` 缺 rotationOffset。EXIF 解析后 setRotationOffset 时 renderOriginal 不重跑 → compare 模式原图旋转错误。

**建议**：依赖数组加 rotationOffset。

### P0-8 downloadClientJPEG GPU 路径 filmCurve 漏取 gammaR/G/B/toe/shoulder
`FilmLab.jsx:2035-2038` 只取 gamma/dMin/dMax，缺 gammaR/G/B/toe/shoulder。GPU Save As 与其他路径胶片曲线行为不一致。

**建议**：抽 resolveFilmCurveParams memo（含全部 Q13 字段），4 处统一调用。

## P1 — 性能/架构

### P1-17 每帧 setHistograms 致全面板重渲染
`FilmLab.jsx:1347` setHistograms(...) 在 processImage 内每帧调用，触发 FilmLab 整组件重渲染（30+ useState、4 useMemo、多个 useEffect、FilmLabControls 60+ props、ToneCurveEditor、HSLPanel、SplitToningPanel）。

**建议**：提取 HistogramContext + HistogramProvider（或 useSyncExternalStore），processImage 直接写 store，ToneCurveEditor 自行订阅。调色时只重渲染 ToneCurveEditor。

### P1-18 4 处 new RenderCore({...}) 参数组装重复
`FilmLab.jsx:1281-1295`（processImage CPU）、`1601-1615`（generateOutputLUT）、`1705-1718`（handleSave）、`2156-2169`（downloadClientJPEG CPU fallback）。4 处参数列表 95% 相同，handleSave/downloadClientJPEG 还漏 lut1Intensity 等。新增参数需同步改 4 处。

**建议**：抽 `const buildRenderCoreParams = (sourceTypeOverride) => ({...})`。

### P1-19 3 处 filmCurve profile 解析重复 + GPU 路径漏字段
`FilmLab.jsx:1123-1130/1756-1765/1850-1859/2035-2038` 链式查找重复 4 次，downloadClientJPEG GPU 路径漏 gammaR/G/B/toe/shoulder。

**建议**：抽 `resolveFilmCurveParams(filmCurveProfiles, filmCurveProfile)` memo。

### P1-22 CpuRenderService 本地常量与 shared 漂移
`CpuRenderService.js:18-19` EXPORT_MAX_WIDTH=4000（shared 8000）、PREVIEW_MAX_WIDTH=1400（shared 1200、useFilmLabRenderer 2000）。三处不同，预览/导出分辨率不一致。

**建议**：从 shared 导入。

### P1-23 ToneCurveEditor getHistogramPath/getCurvePath 每帧重算未 memo
`ToneCurveEditor.jsx:23-44`（256 次循环）、`74-94`（createSpline + 260 次循环）在 render 内直接调用，每帧重算。

**建议**：`useMemo(() => getHistogramPath(), [histograms, activeChannel])`。

### P1-24 SliderControl 每实例注册全局 mouseup 监听器
`SliderControl.jsx:26-41` 每个 SliderControl 实例 useEffect 内 window.addEventListener('mouseup')。FilmLabControls 渲染约 15 个 SliderControl → 15 个全局监听器。

**建议**：单全局 mousedown/mouseup 监听器 + context，或 useRef 共享。

## P1 — 死代码/SSOT

### P1-29 hooks/*.js 全部 1062 行未使用 + schema 不兼容
useFilmLabState/useFilmLabRenderer/useFilmLabPipeline 全项目无 import（除 hooks/ 内部）。且与 FilmLab.jsx 实现严重不一致：
- useFilmLabState DEFAULT_DENSITY_LEVELS 扁平 `{minR,maxR,...}` vs FilmLab.jsx 嵌套 `{red:{min,max}}`
- useFilmLabState DEFAULT_CURVES 0-1 范围 vs FilmLab.jsx 0-255
- useFilmLabState hasModifications 漏检 curves/hslParams/splitToning/saturation/baseMode/baseDensity 等
- useFilmLabPipeline eventDependencies 只定义 4 个事件级联
- useFilmLabRenderer doRender 每帧 setIsRendering（退化）

**建议**：删除三个 hook，或修复 schema 不一致后真正重构 FilmLab.jsx 使用它们。

### P1-31 ComputeService 三个 local* 函数 90% 重复
`ComputeService.js:200-240`（localGpuPreview）、`298-339`（localRenderPositive）、`403-453`（localExportPositive）结构完全相同（获取 imageUrl → GPU → CPU 回退），差异仅 previewMode/outputFormat/uploadFn。

**建议**：抽 `async function localRender({ photoId, params, sourceType, previewMode, outputFormat, uploadFn })`。

## P2 — 健壮性/UX

### P2-1 ComputeService 全部 fetch 无 AbortController
`:158-166/261-265/364-368/87/395/488` 6 处 fetch 不可取消。切换照片时旧 preview 请求仍飞行；快速连点 EXPORT 时 race。smartFilmlabPreviewLatest 序号守卫只防"结果采用"不防"请求飞行"。

**建议**：所有 fetch 接受 signal 参数，调用方切换/卸载时 controller.abort()。

### P2-2 PhotoSwitcher getPhotos 无竞态防护
`PhotoSwitcher.jsx:144-152` 切换 roll 时旧请求未取消，A 响应可能晚于 B 覆盖 photos 列表。

**建议**：useEffect 内 AbortController + 序号守卫。

### P2-3 三个 picker 状态非互斥
`FilmLab.jsx:58-60` 3 个独立 useState，toggling 时不清其他。用户可同时激活 Base+WB picker，handleCanvasClick 按 isPickingBase→isPickingWB→isPicking 顺序处理，Base 永远赢。

**建议**：收敛为 `const [pickerMode, setPickerMode] = useState('off')`，值 'off'|'color'|'base'|'wb'。

### P2-4 图像加载双网络请求
`FilmLab.jsx:656-714` 先 `new Image(); img.src=imageUrl` 加载一次，再 `fetch(imageUrl).then(res=>res.arrayBuffer())` 解析 EXIF 又加载一次。大图双倍流量+延迟。

**建议**：fetch 一次性拿 blob → createImageBitmap(blob) 显示 + getExifOrientation(blob.arrayBuffer())。

### P2-5 FilmLabCanvas 缺少 DPR 处理
canvas width/height 设为 CSS 像素值，未乘 devicePixelRatio。HiDPI 屏（DPR=2）canvas 内容被拉伸 2x → 模糊。

**建议**：canvas.width = rotatedW*dpr; canvas.style.width = rotatedW+'px'; ctx.scale(dpr,dpr)。

### P2-6 PhotoSwitcher Ctrl+↑/↓ 与系统快捷键冲突
`:184-197` Ctrl+↑/↓ 在多数浏览器已被占用（标签页切换）。

**建议**：改用 Alt+↑/↓ 或 PageUp/PageDown。

### P2-7 FilmLabCanvas drag effect 依赖过长
`:243` 依赖 `[dragState,localCropRect,canvasRef,image,rotation,orientation,rotationOffset,ratioMode,ratioSwap,setCropRect,setRotation,pushToHistory,onRotateEnd]`。localCropRect 每次变化 → effect 重跑 → 重订阅 window 监听器。

**建议**：用 useRef 存可变部分，effect 依赖只保留 [dragState]。

### P2-8 FilmLabCanvas isReady 轮询不优雅
`:36-61` rAF 轮询 canvas.width 与 expectedWidth 匹配。若 canvas 尺寸因 bug 永不匹配，轮询不停。

**建议**：ResizeObserver 或父组件回调通知。

### P2-9 AutoCropButton detectEdges 无 AbortController
`:49-109` 快速双击或切换照片后旧请求返回覆盖新状态。

**建议**：AbortController + 序号守卫。

### P2-10 useFilmLabState hasModifications 漏检多数参数
`:344-359` 只检查 17 个字段，漏 curves/hslParams/splitToning/saturation/baseMode/baseDensity 等。

**建议**：补全或改用序列化比较（与 captureSnapshot SSOT 一致）。

## P2 — 其他

- FilmLab.jsx:656-714 图像加载 effect 缺 active 标志（已修一半，仍缺完整竞态防护）
- FilmLab.jsx:227-228 hslKey/splitToneKey 死字段（缓存比较用引用，从不读取 key）
- FilmLab.jsx:51 filmType 死状态
- FilmLab.jsx:174-183 useEffect 强制 setInverted(false) 重复逻辑（getEffectiveInverted 已处理）
- FilmLab.jsx:257-295/502-514/375-389 三处参数序列化 SSOT
- FilmLab.jsx:516-549 等 3 处 25+ 连续 setState（useReducer 收敛）
- FilmLabControls.jsx:506-579 60+ props 透传（收敛 useReducer + 区段拆分）
- FilmLabControls.jsx:539 onAutoEdgeDetection 死 prop
- FilmLabControls.jsx:949 require 在事件回调内（改顶部 import）
- FilmLabControls.jsx:347-471 DensityLevelsPanel 内联样式重复（抽组件）
- FilmLabCanvas.jsx:285-295 handleBarMouseDown 内联 move/up 未清理
- FilmLabCanvas.jsx:276-283 handleSplitDrag 每次拖动 getBoundingClientRect
- PhotoSwitcher.jsx:160-167 scrollTo 依赖缺 photos
- PhotoSwitcher.jsx:59-69 PhotoThumb 缩略图无 onError
- ToneCurveEditor.jsx:126-180 拖动 rAF 闭包捕获旧 draggingPointIndex
- ToneCurveEditor.jsx:98 handleAddPoint 判断脆弱
- HSLPanel.jsx:153 handleChannelChange 未 useCallback
- SplitToningPanel.jsx:211 5 个 update 函数未 useCallback
- LutSelectorModal.jsx:239 loadLuts 未 useCallback + useEffect 依赖警告
- LutSelectorModal.jsx:313 filteredLuts 未 memo
- LutSelectorModal.jsx:232 fileInputRef 未使用
- LutSelectorModal.jsx:261 handleUpload 仅校验扩展名
- ComputeService.js:79-116 能力探测无 inflight promise 缓存
- ComputeService.js:544-611 processAndUpload 与 localExportPositive 职责重叠
- ComputeService.js:703-779 batchProcess 并发控制简单（非真正 pool）
- ComputeService.js:531 uploadProcessedResult xhr.timeout 不可配置
- CpuRenderService.js:221-236 canvasToBlob TIFF16 fallback 谎报 contentType
- CpuRenderService.js:39-41 loadImageToCanvas 30s 超时不可配置
- CpuRenderService.js:179 setTimeout(0) 让出策略（改 MessageChannel）
