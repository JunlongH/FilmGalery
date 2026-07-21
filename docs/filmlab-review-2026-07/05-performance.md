# 05 · 性能优化问题

## 高严重度

### P1 · 直方图高频 setState 致全面板重渲染
`FilmLab.jsx:1291-1301`：每次 processImage 都 `setHistograms(新对象)` → FilmLab 整体重渲染 → 1174 行的 FilmLabControls（256 点 SVG ToneCurveEditor、24 滑块 HSLPanel）每帧重建。拖曝光滑块 = 全控制面板 60fps 重渲染。
**修复**：直方图状态下放独立组件 + React.memo，或启用 useHistogram（需先修复）并加 debounce/rAF 节流。

## 中严重度

### P2 · WebGL 每帧全量重传纹理
`FilmLabWebGL.js:327`（整图）、:489-497（4 条曲线）、:524-580（33³ LUT ~143KB）无内容缓存/脏标记，滑块拖动时全量重传。
**修复**：按引用/版本号缓存（cache.lut3Ref !== params.lut3 时才重传）。

### P3 · 每帧重新获取全部 uniform location
`FilmLabWebGL.js:329-391` ~45 次 getUniformLocation/帧；:331 注释与事实不符（cache 持久存在）。
**修复**：仅 program 重建时填充 cache.locs。

### P4 · 预览永远 mediump WebGL1 着色器
见 03-R8。移动端精度崩塌、banding。

### P5 · GL 资源无 dispose
`FilmLabWebGL.js:140-150,302-327,480,564`：imageTex/lut3Tex/4 曲线纹理/buffer/program 从不 gl.delete*，canvas 频繁重建（缩略图列表）累积至上下文丢失。
**修复**：提供 disposeWebGL(canvas)。

### P6 · 导出大图主线程阻塞
`CpuRenderService.js:292+` maxWidth:0 全分辨率 getImageData + 主线程逐像素 float，4000 万像素阻塞数秒、OOM 风险；无 Worker/分块。
**修复**：Worker（transferable ImageData）或分块 + await 让出主线程。

### P7 · 浅拷贝共享模块级 DEFAULT_* 常量
`useFilmLabState.js:187-190,330-333`、`filmLabExport.js:78-127`：嵌套对象/数组与模块常量共享引用，原地编辑污染全局、跨照片串味、resetAllState 无法真正复位。
**修复**：createDefaultParams() 深拷贝工厂 + 常量递归冻结。

### P8 · tiff16 双倍计算
`render-buffer.js:77-102`：jpeg8 与 tiff16 两个循环各自独立调 processPixelFloat，16-bit 输出 CPU 成本 ×2。

### P9 · LUT/曲线精度
- `shaders/lut3d.js` 手动三线性 + LINEAR 过滤双重插值（应 NEAREST）；8-bit LUT 量化暗部 banding。
- `RenderCore.js:669-674` GPU 曲线纹理 8-bit vs CPU float 1024 级 LUT，暗部差 1-2 灰阶。
- 无 dithering：8-bit 输出 + 大量 log/曲线运算，暗部渐变 banding 不可避免。建议 shader 末尾加 gl_FragCoord 三角噪声 dither（±0.5/255）。

## 低严重度

- `useHistogram.js:138` GPU 全分辨率 readPixels 每帧数百 MB/s PCIe 流量（且该 hook 是死代码）。
- `edgeDetection/index.js:154` edges.filter 计数复制全尺寸 Uint8Array。
- `edgeDetection/utils.js:47-89` toGrayscaleEnhanced 3 份全尺寸 Float32Array + 3 次全图扫描。
- `edgeDetection/cannyEdge.js:27-53` Sobel 内层 9 次乘法索引，可用行指针预计算。
- `ToneCurveEditor.jsx` 每渲染重复 512 点字符串拼接 + 261 次 spline 求值（应 useMemo）。
- `FilmLab.jsx:2558+` 大量内联箭头/对象字面量阻碍子组件 memo 化。
- `FilmLabWebGL.js` preserveDrawingBuffer:true 非必要可关。
