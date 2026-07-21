# 02 · 预览渲染管线详细问题

## P0 — 关键性能

### P0-1 WebGL context 每次缓存未命中都新建
`FilmLab.jsx:1186-1244` — `processImage` 在缓存未命中时 `document.createElement('canvas')` 创建新 canvas，传给 `processImageWebGL`（新建 GL context + program + 6 纹理 + buffer），赋给 `processedCanvasRef.current`，**旧 canvas 引用丢弃但未调 `disposeWebGL`**。

浏览器上限 ~16 个 WebGL context。~16 次滑块调整后：
- 旧 context 静默丢失（GL 资源泄漏）
- GPU 内存累积（每个 context = 1 program + 6 纹理 + 1 buffer）
- 最终可能触发 "too many WebGL contexts" 错误

**建议**：
```js
// 复用单个 offscreen canvas
const webglCanvas = processedCanvasRef.current || document.createElement('canvas');
// processImageWebGL._cache 是 WeakMap，按 canvas 键复用 program/纹理
```

### P0-2 CPU 回退路径同步阻塞主线程
`FilmLab.jsx:1367-1402` — CPU 路径在 `processImage` 内同步运行：
```js
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const [rF, gF, bF] = core.processPixelFloat(r, g, b);
    // ...
  }
}
```
对 2000×1500 预览 = 3M 像素 × 超越函数（log/pow）= **200-800ms 阻塞**。滑块拖动时 UI 完全冻结。

`processCanvasWithRenderCoreAsync`（CpuRenderService.js:165）已实现分块 + `setTimeout(0)` 让步，但未被使用。

**建议**：
```js
const result = await processCanvasWithRenderCoreAsync(canvas, params, {
  chunkRows: 64,
  shouldAbort: () => staleRef.current
});
```
`processImage` 改 async，用 `staleRef` 标志取消被取代的渲染。

### P0-3 全画布 getImageData 回读
`FilmLab.jsx:1283-1296` — 即使 WebGL 成功路径（图像已绘制），仍 `ctx.getImageData(0, 0, canvas.width, canvas.height)` 读回整个画布。对 2000×1500 = **12MB Uint8ClampedArray 分配** + GPU→CPU 回读，每帧一次。数据仅用于直方图计算。

**建议**（按优先级）：
1. **GPU 端算直方图**：downscale pass 到 256×1，readPixels 1KB
2. **降采样读回**：`drawImage` 到 256×256 scratch canvas，`getImageData` 256KB
3. **拖动时跳过**：`isRotating` / `isDraggingSlider` 时跳过，`mouseup` debounce 200ms 后算

### P0-4 useFilmLabRenderer.js typo bug（死代码）
`useFilmLabRenderer.js:208` — `cancelAnimationFrame(frameRequest.current)` 引用 `frameRequest`（无 Ref 后缀），但 ref 声明为 `frameRequestRef`（line 54）。**ReferenceError**。

证实该 hook 从未使用（FilmLab.jsx 直接调 `processImageWebGL`）。

**建议**：删除整个文件（243 行死代码）。已在 v2 Phase Q 删除 `useFilmLabState`/`useFilmLabPipeline`，`useFilmLabRenderer` 应一并删除。

---

## P1 — 显著性能

### P1-13 RenderCore 每像素查 FILM_CURVE_PROFILES
`RenderCore.js:286,518` — `processPixelFloat`/`processPixel` 内部：
```js
const profile = FILM_CURVE_PROFILES[p.filmCurveProfile];
const gamma = profile?.gamma ?? 0.6;
// ...
```
每像素执行一次。3M 像素 = 3M 次哈希查找 + 3M 次可选链。profile 不随像素变化。

**建议**：提升到 `prepareLUTs()`：
```js
prepareLUTs() {
  const profile = FILM_CURVE_PROFILES[this.params.filmCurveProfile];
  this._resolvedFilmCurve = {
    gamma: profile?.gamma ?? 0.6,
    gammaR: profile?.gammaR ?? profile?.gamma ?? 0.6,
    // ...
  };
  // 构建 filmCurve LUT (1024-entry Float32Array)
  this.luts.filmCurveFloat = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    this.luts.filmCurveFloat[i] = applyFilmCurveFloat(i / 1023, this._resolvedFilmCurve);
  }
}
```
`processPixelFloat` 改为 `this.luts.filmCurveFloat[idx]`（LUT 查找，O(1)）。

### P1-14 RenderCore 每次渲染都 new + prepareLUTs
`FilmLab.jsx:1364, 1647, 1738, 2179` — 4 处 `new RenderCore(buildRenderCoreParams())` + `core.prepareLUTs()`。即使参数未变，也重建所有 LUT（tone LUT + 4 curve LUT × 2 精度 + WB gains + split-tone context）。

**建议**：
```js
// 方案 A: 复用实例
const coreRef = useRef(null);
const paramsKey = stableSerializeParams(buildRenderCoreParams());
if (!coreRef.current || coreRef.current._paramsKey !== paramsKey) {
  coreRef.current = new RenderCore(buildRenderCoreParams());
  coreRef.current._paramsKey = paramsKey;
  coreRef.current.prepareLUTs();
}

// 方案 B: 模块级 LUT 缓存
const LUT_CACHE = new Map(); // key: serialized params
```

### P1-6 processImage 非 memoized
`FilmLab.jsx:1147` — `const processImage = () => { ... }` 是普通函数，每次渲染重新创建。它被 render effect（line 802）在 `requestAnimationFrame` 内引用。由于 effect 依赖 `webglParams` 且 eslint-disable exhaustive-deps，始终闭包最新 `processImage`——**功能正确**，但：
1. 函数身份每次变化，无法作为稳定 prop 传递
2. eslint-disable 掩盖了 ~40 个状态变量依赖，漏一个就 stale

**建议**：`useCallback` + 显式依赖列表；或提取到 `useFilmLabRenderer` hook（修复 typo 后真正使用）。

---

## P2 — 中等影响

### P2-19 FilmLabWebGL 每帧 24+ 次 new Float32Array
`FilmLabWebGL.js:298,447,482-498,668-707` — 每帧分配：
- `new Float32Array(16)` 顶点缓冲
- `new Float32Array(gains)` WB 增益
- `new Float32Array(baseGains)` 片基增益
- `new Float32Array(baseDensity)` 片基密度
- 2× `new Float32Array(3)` densityLevelsMin/Max
- 8× `new Float32Array(3)` HSL uniforms（24 个分配仅 HSL）

小但频繁，连续拖动时产生 GC 压力。

**建议**：`cache._scratch3 = new Float32Array(3)` 预分配，`scratch.set([r,g,b])` 复用。

### P2-20 顶点缓冲每帧重传
`FilmLabWebGL.js:306-310` — `gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW)` 每帧无条件调用。UV 仅在 rotation/crop 变化时改变。

**建议**：`cache.lastUVKey = JSON.stringify({rotation, cropRect})`，未变跳过。

### P2-21 packLUT3DForWebGL 每次 143KB 分配
`FilmLabWebGL.js:572` — LUT 变化时 `packLUT3DForWebGL(dataF, size)` 分配 `Uint8Array(size³×4)`。33³ = 143KB，65³ = 1.1MB。

**建议**：缓存 packed buffer by LUT 内容哈希。

### P2-26 setTimeout(0) 让步开销
`CpuRenderService.js:182` — 每块 `await new Promise(resolve => setTimeout(resolve, 0))`。浏览器最小 setTimeout ~4ms。4000px 高 × chunkRows=64 = 62 块 × 4ms = **250ms 额外开销**。

**建议**：`MessageChannel`（~0.5ms 让步）：
```js
const channel = new MessageChannel();
const yieldToMain = () => new Promise(resolve => {
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(null);
});
```

### P2-27 getCurveLUT 每帧 4 次样条构建
`FilmLab.jsx:1232-1235` — `getCurveLUT(curves.rgb)` 等每帧调用，每次构建 `Uint8Array(256)` + 样条插值 + 256 次循环。

**建议**：`useMemo(() => buildAllCurveLUTs(curves), [curves])`。

### P2-24/25 RenderCore 管线代码重复
- `processPixel` vs `processPixelFloat`：~250 行近相同管线
- `_sampleLUT3D` vs `_sampleLUT3DFloat`：~60 行近相同三线性插值

**建议**：统一。`processPixel` 调 `processPixelFloat(val/255, ...) * 255`；`_sampleLUT3D` 接受 scale 参数。

---

## P3 — 清理

### P3-39 console.log 在热路径
`FilmLab.jsx:714,1069,1085,1095,1563,1576,1831` — WB picker、Auto WB 等点击时打印。应 `if (DEBUG)`。

### P3-30 DEBUG 代码 readPixels 在 bundle
`FilmLabWebGL.js:750-771` — `if (DEBUG_WEBGL)` 块调 `gl.readPixels` 3 次/帧。`DEBUG_WEBGL=false` 但仍 shipped。

**建议**：`if (process.env.NODE_ENV !== 'production' && DEBUG_WEBGL)` 或分离 dev 模块。

### P3-31 rawParams 存储但未用
`RenderCore.js:76` — `this.rawParams = params` 从未内部读取。删除或文档化。

### P3-34 handleSave/downloadClientJPEG 逻辑重复
`FilmLab.jsx:1710-1784 vs 2031-2220` — 几何变换 + 像素循环 + toBlob 几乎相同。

**建议**：抽 `renderAtSize(image, params, {maxWidth, outputFormat})`。
