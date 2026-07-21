# 03 · React 性能与状态管理详细问题

## P1 — 重渲染开销

### P1-5 八个组件无一 React.memo

| 组件 | 文件:行号 | 实例数 | 重渲染触发 |
|---|---|---|---|
| `SliderControl` | SliderControl.jsx:22 | 15+ | 每次 FilmLab 状态变化 |
| `ChannelSliders` (HSL) | HSLPanel.jsx:38 | 8 | 每次 hslParams 变化 |
| `HSLSlider` | HSLPanel.jsx:108 | 24 (8×3) | 每次 hslParams 变化 |
| `ToneControl` (SplitTone) | SplitToningPanel.jsx:85 | 3 | 每次 splitToning 变化 |
| `HueWheel` | SplitToningPanel.jsx:17 | 3 | 每次 splitToning 变化 |
| `ToneCurveEditor` | ToneCurveEditor.jsx:4 | 1 | 每次渲染 |
| `PhotoThumb` | PhotoSwitcher.jsx:24 | 36+ | 每次 currentParams 变化 |
| `FilmLabControls` | FilmLabControls.jsx:506 | 1 | 每次渲染 |
| `FilmLabCanvas` | FilmLabCanvas.jsx:4 | 1 | 每次渲染 |
| `AutoCropButton` | AutoCropButton.jsx | 1 | 每次渲染 |

**影响**：拖动一个滑块 → FilmLab 重渲染 → 整个侧栏重渲染（15 滑块 + 24 HSL + 3 色轮 + 曲线 + 36 缩略图）≈ **80+ 组件重渲染**，实际只有 1 个需要。

**建议**：
```jsx
// SliderControl.jsx
const SliderControl = React.memo(({ label, value, onChange, ... }) => {
  // ...
});

// HSLPanel.jsx — 传 primitive 而非对象
const ChannelSliders = React.memo(function ChannelSliders({
  channelKey, hue, saturation, luminance, onChannelChange
}) {
  // ...
});
```

**注意**：`React.memo` 需配合稳定 handler（`useCallback`）和 primitive props，否则被内联箭头/对象引用变化击败。

### P1-8 50+ useState 应收敛为 useReducer
`FilmLab.jsx:43-176` — 组件有 ~50 个 `useState`：
- 色调：exposure, contrast, highlights, shadows, whites, blacks
- WB：temp, tint, red, green, blue
- 片基：baseMode, baseRed, baseGreen, baseBlue, baseDensityR/G/B
- 密度色阶：densityLevelsEnabled, densityLevels
- 反转：inverted, inversionMode
- 胶片曲线：filmCurveEnabled, filmCurveProfile
- HSL：hslParams
- 分离色调：splitToning
- 饱和度：saturation
- 曲线：curves
- 几何：rotation, cropRect
- LUT：lut1, lut2
- UI：isCropping, compareMode, ratioMode, ratioSwap, isPicking*, presets, presetName...
- 等

`applyPreset`（line 485-531）调 25-30 次连续 `setState`，每次进入单独 re-render 批次。`pushToHistory` 在 setState 前捕获快照，可能 stale。

**建议**：
```jsx
const [params, dispatch] = useReducer(paramsReducer, initialParams);
// applyPreset → 单次 dispatch
dispatch({ type: 'applyPreset', params: preset.params });
// reducer 一次性替换所有字段 → 单次 re-render
```

UI 状态（isCropping, compareMode, picker）可保留 useState 或拆为独立 useReducer。

### P1-15 FilmLabCanvas crop-drag effect 重订阅监听器
`FilmLabCanvas.jsx:66-243` — effect 依赖 `[dragState, localCropRect, canvasRef, image, rotation, orientation, rotationOffset, ratioMode, ratioSwap, setCropRect, setRotation, pushToHistory, onRotateEnd]`。拖动时 `setLocalCropRect` 每 mousemove 更新 → effect 重跑 → 移除+重加 window 监听器。60fps = **60 次 add/remove/秒**。

**建议**：ref 化可变部分：
```jsx
const stateRef = useRef({});
stateRef.current = { dragState, localCropRect, image, rotation, ... };

useEffect(() => {
  if (!dragState) return;
  const handleMove = (e) => {
    const { dragState, localCropRect, ... } = stateRef.current;
    // 用 ref 内的值计算
  };
  window.addEventListener('mousemove', handleMove);
  return () => window.removeEventListener('mousemove', handleMove);
}, [dragState]); // 只依赖 dragState（拖动开始/结束）
```

### P1-16 ToneCurveEditor histogramPath memo 失效
`ToneCurveEditor.jsx:24-45` — `useMemo(() => { ... }, [histograms, activeChannel, ...])`。`histograms` 每次 `processImage` 都是新对象（`setHistograms({ rgb, red, green, blue })`），即使值相同。→ memo 每帧重算（256 次循环 + 字符串拼接）。

**建议**：
1. 只传 activeChannel 的数组：`<ToneCurveEditor histogram={histograms[activeChannel]} />`
2. 或按值比较：`useMemo` 内先比较 JSON.stringify(histograms[activeChannel])

### P1-17 PhotoThumb 重渲染
`PhotoSwitcher.jsx:24` — `PhotoThumb` 接收 `currentParams`（每次滑块变化都变），导致 36+ 缩略图全重渲染。

**建议**：
```jsx
const PhotoThumb = React.memo(function PhotoThumb({ photo, isSelected, onClick }) {
  // 不接收 currentParams
});
// onClick 用 useCallback 稳定
```

---

## P1 — 竞态与监听器泄漏

### P1-9 handlePanStart 监听器泄漏
`FilmLab.jsx:1601-1633` — `onMouseDown` 内 `window.addEventListener('mousemove', handleMove)` + `window.addEventListener('mouseup', handleUp)`。`handleUp` 移除两者，但：
1. 组件卸载时泄漏（Escape/路由切换）
2. mouseup 跨 iframe 可能不触发

同 `FilmLabCanvas.jsx:285-295` `handleBarMouseDown`。

**建议**：移入 `useEffect` keyed on `isDragging`：
```jsx
const [isDragging, setIsDragging] = useState(false);
useEffect(() => {
  if (!isDragging) return;
  const handleMove = (e) => { ... };
  const handleUp = () => setIsDragging(false);
  window.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleUp);
  return () => {
    window.removeEventListener('mousemove', handleMove);
    window.removeEventListener('mouseup', handleUp);
  };
}, [isDragging]);
```

### P1-10 图像加载双网络请求
`FilmLab.jsx:734-792` — 非 RAW 图像：
1. `new Image(); img.src = imageUrl` 加载显示
2. `fetch(imageUrl).then(res => res.arrayBuffer())` 解析 EXIF

同一 URL 两次网络请求。大图双倍流量+延迟。

**建议**：
```js
const response = await fetch(imageUrl);
const blob = await response.blob();
const [bitmap, orientation] = await Promise.all([
  createImageBitmap(blob),
  getExifOrientation(await blob.arrayBuffer())
]);
setImage(bitmap);
```

### P1-11 非 server-decode 竞态
`FilmLab.jsx:734-739` — `needsServerDecode` 路径有 `active` flag + cleanup，非 server-decode 路径没有。快速切换照片时旧 `img.onload` 仍会 `setImage`。

**建议**：
```js
let active = true;
// ... img.onload = () => { if (active) setImage(img); }
return () => { active = false; };
```

---

## P2 — 中等影响

### P2-28 AI 上下文每滑块触发
`FilmLab.jsx:224-230` — `updateOverlayContext` effect 依赖 11 个参数值。每次滑块变化都触发 AI 面板上下文更新+重渲染。

**建议**：`setTimeout(…, 300)` + cleanup debounce。

### P2-12 webglParams memo 8 次 find
`FilmLab.jsx:256-263` — `filmCurveProfiles?.find(p => p.key === filmCurveProfile)` 调 8 次（每字段一次）。

**建议**：已有 `resolveFilmCurveParams()` callback（v2 Phase Q），用它：
```js
const filmCurveParams = resolveFilmCurveParams();
// webglParams memo 内：...filmCurveParams
```

---

## P3 — 清理

### P3-37 committedRotationRef 死代码
`FilmLab.jsx:114` — 声明 + 写入（line 2649, 2712）但从未读取。删除。

### P3-38 注释代码
`FilmLab.jsx:1700-1705` — `handleExportLUT` 注释。删除。

### P3-40 crop-debug span
`FilmLabCanvas.jsx:419` — `<span id="crop-debug" />` 渲染但从未填充。删除。

### P3-41 死/buggy 行
`FilmLabCanvas.jsx:208-209` — `let next = startRect.rotation + delta` 立即被覆盖。删除。

### P3-45/46/47/48 内联箭头函数
- `ToneCurveEditor.jsx:47-72` — `getCurveColor` 等应 hoist 到模块级
- `ToneCurveEditor.jsx:291` — `key={i}` → `key={`${p.x}-${p.y}`}`
- `HSLPanel.jsx:80,89,98` — `onChange={(v) => handleChange('hue', v)}` → `useCallback`
- `SplitToningPanel.jsx:373,374,391,392,409,410` — 同上
- `FilmLabControls.jsx:623-628` — `sourceLabels` 应 hoist

### P3-44 PhotoSwitcher smooth scroll 堆积
`PhotoSwitcher.jsx:160-167` — 快速导航时 `scrollTo({behavior:'smooth'})` 队列堆积。

**建议**：快速连续时用 `behavior: 'auto'`。
