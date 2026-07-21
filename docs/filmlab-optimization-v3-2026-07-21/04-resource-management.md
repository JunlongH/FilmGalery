# 04 · 资源管理详细问题

## P1 — 无 AbortController

### P1-23 全管线零 AbortController
全管线（FilmLab.jsx + ComputeService.js + CpuRenderService.js）**无一处** `AbortController`/`AbortSignal`。

| 位置 | 操作 | 影响 |
|---|---|---|
| ComputeService.js:158-166 | GPU preview fetch | 切换照片时旧请求飞行 |
| ComputeService.js:261-265 | local render fetch | 同上 |
| ComputeService.js:364-368 | local export fetch | 导出中切走继续跑 |
| ComputeService.js:485-533 | XHR upload | 2 分钟超时但无 abort |
| ComputeService.js:703-779 | batchProcess | 100 张批量无取消 |
| FilmLab.jsx:1367-1402 | CPU 回退渲染 | 切照片时旧渲染继续阻塞 |
| AutoCropButton.jsx:49-109 | detectEdges | 快速双击旧请求覆盖新状态 |

**建议**：
```js
// 公共 API 接受 signal
async function smartFilmlabPreviewLatest(photoId, params, { signal } = {}) {
  const response = await fetch(url, { signal });
  // ...
}

// 调用方
const abortRef = useRef(null);
const handleChange = (photoId) => {
  abortRef.current?.abort();
  abortRef.current = new AbortController();
  smartFilmlabPreviewLatest(photoId, params, { signal: abortRef.current.signal });
};
```

CPU 渲染用 `shouldAbort` 回调（分块间检查）：
```js
await processCanvasWithRenderCoreAsync(canvas, params, {
  shouldAbort: () => abortRef.current.signal.aborted
});
```

---

## P2 — 资源泄漏

### P2-22 进度回调 Map 泄漏
`ComputeService.js:48-49` — 模块级 `Map` 持有回调函数。组件注册后卸载但未调 `unregisterProgressCallback` → 回调 + 捕获的组件 state 永久泄漏。

**建议**：
```js
function registerProgressCallback(id, callback) {
  progressCallbacks.set(id, callback);
  return () => progressCallbacks.delete(id); // 返回 disposer
}

// 组件内
useEffect(() => {
  const unregister = registerProgressCallback(photoId, onProgress);
  return unregister; // useEffect cleanup 自动调
}, [photoId]);
```

或用 `WeakRef`（Node 14.6+ / 浏览器较新版本）。

### P2-50 webglcontextlost 监听器用 DOM 属性标记
`FilmLabWebGL.js:117-134` — `canvas._contextLostHandlerRegistered = true` 标记 + `addEventListener`。监听器从未移除（canvas GC 时隐式清理，但 DOM 属性是反模式）。

**建议**：在 `disposeWebGL` 中 `removeEventListener`。

---

## P2 — 内存分配

### P2-19 FilmLabWebGL 每帧 24+ 次 Float32Array
（详见 02-preview-rendering.md P2-19）

### P2-21 packLUT3DForWebGL 143KB
（详见 02-preview-rendering.md P2-21）

### P2-32 FilmLabCanvas rAF 轮询
`FilmLabCanvas.jsx:36-61` — `requestAnimationFrame` 循环轮询 `canvas.width === expectedWidth`。若 canvas 因 bug 永不匹配，轮询不停。

**建议**：`ResizeObserver` 或 `processImage` 完成后回调通知。

### P2-33 handleBarMouseDown 监听器泄漏
`FilmLabCanvas.jsx:285-295` — 同 P1-9 handlePanStart 模式。

---

## P3 — 清理

### P3-42 AutoCropButton 死代码
`AutoCropButton.jsx:111-119` — 注释掉的 `applyLastResult`。删除。

### P3-43 AutoCropButton console.log
`AutoCropButton.jsx:62,67,76,96,100,104` — 6 处 debug log。`if (DEBUG)`。

### P3-49 sourceLabels 重建
`FilmLabControls.jsx:623-628` — 模块级 hoist。

### P3-51/52 RenderCore/render-buffer minor
- `RenderCore.js:650-729` — `getGLSLUniforms` 返回新数组（minor）
- `render-buffer.js:55-68` — `writePixel` 闭包（minor）

---

## 测试策略

### 资源管理测试
```js
// WebGL context 泄漏检测
test('切换 20 张照片后 WebGL context 数量不增长', () => {
  const getContextSpy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext');
  for (let i = 0; i < 20; i++) {
    processImage(mockCanvas, mockImage, params);
  }
  // 复用后应只创建 1 个 context
  expect(getContextSpy).toHaveBeenCalledTimes(1);
});

// AbortController 取消
test('切换照片时旧 preview 请求被 abort', async () => {
  const controller = new AbortController();
  const promise = smartFilmlabPreviewLatest(1, params, { signal: controller.signal });
  controller.abort();
  await expect(promise).rejects.toThrow('AbortError');
});

// 监听器泄漏
test('组件卸载后无 window 监听器残留', () => {
  const addSpy = jest.spyOn(window, 'addEventListener');
  const removeSpy = jest.spyOn(window, 'removeEventListener');
  const { unmount } = render(<FilmLab {...props} />);
  unmount();
  // 每个 add 应有对应 remove
  expect(addSpy.mock.calls.length).toBe(removeSpy.mock.calls.length);
});
```
