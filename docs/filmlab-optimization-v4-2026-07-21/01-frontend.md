# 01 · 前端问题（25 项）

v3 后的前端审查，聚焦 v1-v3 未覆盖的领域：错误边界、上下文架构、触摸支持、无障碍、i18n。

---

## P0 — 关键（4 项）

### P0-1 handleAutoColor 全画布 getImageData 阻塞 UI

- **FilmLab.jsx:1553-1556**
- `handleAutoColor()` 调用 `ctx.getImageData(0, 0, canvas.width, canvas.height)` — 全画布 12MB GPU→CPU 读回。v3 P0-3 已为直方图优化了此问题（256×256 scratch canvas），但 `handleAutoColor` 未被覆盖。
- **影响**：点击 AUTO WB 时 UI 冻结 50-200ms。
- **修复**：复用已有的 `histogramScratchRef` 做降采样读回。

### P0-2 handleDensityAutoLevels 全画布 getImageData

- **FilmLab.jsx:2360**
- 同上模式，创建 canvas + 全画布 getImageData 用于密度自动分析。
- **修复**：复用 scratch canvas 降采样到 256×256。

### P0-3 SliderControl 全局事件监听器未清理

- **SliderControl.jsx:18-19**
- 模块级 `window.addEventListener('mouseup'/'touchend')` 永久注册，App 生命周期内不清理。即使 FilmLab 未挂载，每次 mouseup 都执行 null-check。
- **影响**：微量性能损耗，架构上违反 scoped 副作用原则。
- **修复**：移入 useEffect，组件挂载时注册 / 卸载时清理。

### P0-4 handleCanvasClick 每次创建临时 canvas

- **FilmLab.jsx:972, 1017**
- WB picker 每次点击都 `document.createElement('canvas')`，色块读取只需 3×3 像素但 canvas 创建开销没必要。
- **修复**：复用一个 tempCanvas ref（类似 `histogramScratchRef`）。

---

## P1 — 高（6 项）

### P1-fe WebGL 失败静默——用户可能在走 CPU 路径（详见 [07-preview-performance.md](07-preview-performance.md) P1-21）

- **FilmLab.jsx:1311-1315**
- WebGL 异常被 `console.error` 静默吞掉，无 UI 指示器。`isWebGLAvailable()` 缓存在 GPU 崩溃后永不清除。
- **影响**：如果 WebGL 因 transient failure（context loss, driver reset）被 catch，用户一直走在 86ms+ 的 CPU 路径上而不知原因。
- **修复**：catch 块记录失败原因到 state；UI 显示"WebGL 不可用，使用 CPU 模式"；context loss 后 retry ≤3 + 清缓存。

### P1-1 useEffect 依赖重复触发

- **FilmLab.jsx:832-847**
- render useEffect 依赖 `webglParams`（已含 rotation/orientation/isCropping/isRotating），但又单独列出这些 geometry deps。一个参数变化触发 2 次 effect（1 次 from webglParams + 1 次 from 独立 dep），导致额外 cancelAnimationFrame + rAF 开销。
- **修复**：从 deps 数组移除冗余的 geometry deps，仅保留 `[webglParams]`。

### P1-2 AIPanelContext 导致 FilmLab 级联重渲染

- **AIPanelContext.jsx:38-49**
- `overlayContext` 变化时 `value` 对象重算，所有 `useAIPanel()` 消费者重渲染——包括 FilmLab.jsx（读取 `isAIPanelOpen` / `panelWidth`）。AI 上下文已有 300ms debounce（v3 P1-28），但 debounced 更新仍会导致 FilmLab 每 300ms 重渲染一次。
- **修复**：拆分 context 为两个——panel lifecycle（isOpen/panelWidth，低频）+ overlay context（高频），Consumer 只订阅需要的切片。

### P1-3 FilmLab 无子树 ErrorBoundary

- **index.jsx:26-28 / ErrorBoundary.jsx:11**
- 只有根级 ErrorBoundary。FilmLab 渲染异常→整个 App 崩溃到"unexpected error"屏幕。OOM（getImageData 大图）、WebGL context loss、crop drag 无限循环都能触发。
- **修复**：在 FilmLab overlay div 外包裹 `<ErrorBoundary>`，崩溃时显示可恢复的 overlay 内提示，而非整个 App 崩溃。

### P1-4 PhotoSwitcher smooth scroll 与点击冲突

- **PhotoSwitcher.jsx:160-167**
- `useEffect([currentIndex])` 对每次 currentIndex 变化都调用 `scrollTo({behavior:'smooth'})`——包括用户点击缩略图。快速点击时多个滚动动画堆积。
- **修复**：用 ref flag 区分用户点击 vs 键盘导航，仅后者触发 auto-scroll。

### P1-5 AIPanel 拖拽手柄无触摸支持

- **AIPanel.jsx:51-71**
- `handleDragStart` 只绑定 `mousemove`/`mouseup`，无 `touchstart`/`touchmove`/`touchend`。iPad/触摸设备无法调整面板大小。
- **修复**：添加 touch 事件或改用 pointer events。

### P1-6 sourceType useEffect 竞态

- **FilmLab.jsx:194-203**
- sourceType 变化时先清 WebGL 缓存再 setInverted(false)，但两者在不同 effect 中，中间帧可能显示闪烁。
- **修复**：向上提升 inverted 重置到父组件，与 sourceType 原子化到达。

---

## P2 — 中等（8 项）

### P2-1 handlePanStart 闭包内联创建

- **FilmLab.jsx:1642-1657**
- 每次 mousedown 在线创建 handleMouseMove / handleMouseUp 闭包，捕获 drag 起始坐标。
- **修复**：用 ref 存储 drag 状态 + 稳定事件 handler 引用（同 FilmLabCanvas splitDragCleanupRef 模式）。

### P2-2 preset 名验证弱

- **FilmLabControls.jsx:593-596**
- 只检查 `!presetName.trim()`，无长度/特殊字符/unicode 空格限制。
- **修复**：`.trim()` 一致化、max 50 chars、拒绝控制字符。

### P2-3 LUT 上传无文件大小验证

- **LutSelectorModal.jsx:257-278**
- 只检查扩展名（.cube/.3dl/.csp/.lut），500MB 误选文件会卡住上传。
- **修复**：前端加 50MB 限制 + 进度回调。

### P2-4 filmCurveEnabled effect 依赖过多

- **FilmLab.jsx:452-456**
- 依赖数组包含 `filmCurveEnabled`（同时是 effect 的 setter 目标），引发不必要的触发。
- **修复**：移除 `filmCurveEnabled` 从 deps，只保留 `[inverted]`。

### P2-5 renderOriginal 硬编码 maxWidth

- **FilmLab.jsx:1475**
- 使用硬编码 `1200` 而非 `PREVIEW_MAX_WIDTH_CLIENT`，且重复计算 geometry。
- **修复**：改用常量 + 复用 `geometry` memo。

### P2-6 移动端 AsyncStorage 无限挂起风险

- **mobile/App.tsx:241-265**
- `Promise.all([AsyncStorage.getItem(...)])` 无超时，存储损坏时永久显示空白屏幕。
- **修复**：`Promise.race` + 5s 超时，超时后显示最小错误 UI。

### P2-7 WebGL context lost 监听器未移除

- **FilmLabWebGL.js:132-149**
- `addEventListener` 用 `_contextLostHandlerRegistered` flag 防重复，但从未 `removeEventListener`。
- **修复**：在 `disposeWebGL()` 中移除。

### P2-8 FilmLabCanvas.jsx rAF 轮询无超时

- **FilmLabCanvas.jsx:37-62**
- `isReady` 轮询无限循环 rAF，canvas 永远达不到预期宽度时静默消耗 CPU。
- **修复**：加最大迭代次数或 2s 超时 fallback。

---

## P3 — 低（7 项）

### P3-1 无障碍零 ARIA

- 全 FilmLab 组件无 `aria-label`/`aria-valuemin`/`role`/`tabIndex`。屏幕阅读器无法交互。
- **修复**：至少给按钮加 `aria-label`，滑杆加 `role="slider"` + `aria-valuemin/max/now`。

### P3-2 i18n 全硬编码

- 21+ `alert()` 中英混合字符串硬编码。移动端已有 `src/i18n/` 框架（zh/en + `useT()` hook），桌面端零。
- **修复**：提取用户可见字符串到共享 i18n 模块。

### P3-3 CpuRenderService.getPhotoImageUrl 在移动端重复

- 桌面 `CpuRenderService.js:420-444` 与移动 `PhotoViewScreen.tsx:52-53` 重复 photo URL 解析逻辑。
- **修复**：移到 `@filmgallery/shared`。

### P3-4 AIPanelContext push 初始 capture 默认参数

- **FilmLab.jsx:217-227**
- `useEffect([], [])` 捕获首次渲染的默认参数值，AI 面板在前 300ms 内看到默认值而非实际加载状态。
- **修复**：从初始 push 移除 `filmlabParams`，仅由 debounced update 提供。

### P3-5 webglParams === 比较过于敏感

- **FilmLab.jsx:1234**
- `lastWebglParamsRef.current === webglParams`——`curves`/`hslParams` 值相同但引用不同时（React setState 新建对象）缓存未命中。
- **修复**：用 `stableSerializeParams()`（已导入）做深比较缓存键。

### P3-6 thumbClickHandlers useMemo 全量重建

- **PhotoSwitcher.jsx:210-218**
- batchMode 变化时 36 个 handler 全部重建，每次都破 `React.memo`。
- **修复**：改用事件委托——容器 div 上单 handler，用 `data-photo-id` 识别目标。

### P3-7 buildRenderCoreParams 仍在 handleSave 被重复调用

- v3 S.6 引入了 `getRenderCore()` 缓存，但 V.6 给 handleSave 改 async 时用了 `buildRenderCoreParams()` 传给 `processCanvasWithRenderCoreAsync`，此函数内部又调一次 `getCachedRenderCore`。
- **修复**：传 `getRenderCore()` 直接给 processCanvasWithRenderCoreAsync 的 core 选项（通过 renderChunked 的 opts.core）。
