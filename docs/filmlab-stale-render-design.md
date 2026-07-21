# FilmLab Stale-Render 设计文档（v3 Phase S.0）

> **目的**：Phase S.2 把 `processImage` 改为 async 后，必须明确 stale-render 语义，否则会出现 rAF 重叠、旧渲染覆盖新状态、错误吞掉等问题。本文是 S.2a/b/c 的实现依据。

## 1. 问题陈述

当前 `processImage` 是同步函数，由 rAF 回调触发（FilmLab.jsx:802）：

```js
processRafRef.current = requestAnimationFrame(() => { processImage(); });
```

改为 async 后会引入三个问题：

| 问题 | 触发场景 | 后果 |
|---|---|---|
| **rAF 重叠** | 一个 rAF 启动 async 渲染（耗时 >16ms），下一个 rAF 在前一个未完成时又启动 | 两个 async 渲染交错，canvas 闪烁 |
| **旧覆盖新**（race） | 用户快速切照片：图 A 渲染未完成，图 B 已开始；A 晚于 B 完成 | canvas 显示旧图 A |
| **stale 时机不明** | `staleRef` 何时设/查未定义 | 漏检查点 → stale 数据写入 canvas |

## 2. 设计：renderIdRef + AbortSignal 双轨

### 2.1 核心数据结构

```js
// 渲染 ID —— 单调递增，每次 processImage 入口自增
const renderIdRef = useRef(0);

// AbortController —— 切照片/切参数时 abort 旧渲染
const abortRef = useRef(null);

// 渲染错误 state（P3-58：错误不再静默吞掉）
const [renderError, setRenderError] = useState(null);
```

### 2.2 processImage 入口约定

```js
const processImage = useCallback(async () => {
  // (1) 自增 renderId —— 本次渲染的唯一标识
  const myId = ++renderIdRef.current;

  // (2) abort 上一次 in-flight 渲染（如果有）
  if (abortRef.current) abortRef.current.abort();

  // (3) 创建本次渲染的 AbortController
  const myAbort = new AbortController();
  abortRef.current = myAbort;
  const signal = myAbort.signal;

  // (4) 清除 renderError（新渲染开始，旧错误不再相关）
  setRenderError(null);

  try {
    // ... 渲染主体 ...
    // 每个 await 后必须检查 stale
    await someAsyncOp();
    if (renderIdRef.current !== myId || signal.aborted) return;

    // ... 继续 ...
  } catch (err) {
    // (5) 错误分类处理
    if (err.name === 'AbortError' || signal.aborted) {
      // 静默：abort 是预期行为
      return;
    }
    console.error('[FilmLab] processImage error:', err);
    setRenderError(err);
  }
}, [/* 显式依赖 */]);
```

### 2.3 stale 检查点

每个 `await` 之后**必须**插入检查：

```js
if (renderIdRef.current !== myId || signal.aborted) return;
```

检查点位置（按 S.2b 实现顺序）：

| 检查点 | 位置 | 理由 |
|---|---|---|
| CP-1 | `processCanvasWithRenderCoreAsync` 前 | CPU 渲染启动前若已被取代，跳过 |
| CP-2 | 每个 chunk 之后（由 `signal.aborted` 触发） | `processCanvasWithRenderCoreAsync` 内部分块检查 |
| CP-3 | `getImageData` 后（如果改为 async） | 读回前若已被取代，跳过直方图 |
| CP-4 | `setHistograms` 前 | 避免设置 stale 直方图 |

> **注意**：WebGL 路径目前是同步的（`processImageWebGL` 不返回 Promise）。S.2 阶段**不**把 WebGL 路径改 async——它已经够快（<5ms），async 化反而引入 rAF 抖动。只把 CPU 路径改 async。

### 2.4 rAF 去重

```js
// FilmLab.jsx:802 的 rAF effect 改为：
useEffect(() => {
  if (!canvasRef.current) return;
  if (processRafRef.current) cancelAnimationFrame(processRafRef.current);
  processRafRef.current = requestAnimationFrame(() => {
    processRafRef.current = null;
    processImage();
  });
  return () => {
    if (processRafRef.current) {
      cancelAnimationFrame(processRafRef.current);
      processRafRef.current = null;
    }
  };
}, [rotation, orientation, isCropping, isRotating, webglParams, processImage]);
```

**为什么不加 in-flight 跳过？**

原计划考虑过"rAF 内若 in-flight 未完成则跳过新帧"。但深入分析后发现：
- `renderIdRef` + `signal.aborted` 已经保证旧渲染被取消（不会写 stale 数据）
- 跳过新帧会导致用户操作无反馈（拖滑块 → 画面不更新）
- 新渲染启动成本极低（WebGL 路径 <5ms，CPU 路径首块 <10ms）

**结论**：每个 rAF 都启动新 `processImage`，由 `renderIdRef` 保证只有最新一次能写入 canvas。旧渲染的 async 工作会被 `signal.aborted` 提前终止。

### 2.5 AbortSignal 传播

```
processImage (signal)
   ↓
processCanvasWithRenderCoreAsync(canvas, params, { signal, chunkRows })
   ↓
每个 chunk 间：if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
```

**统一 abort 机制**（v3 修正：原计划 S.2 用 `staleRef`、U.1 用 `AbortSignal` 两套机制）：

- CPU 渲染：`signal.aborted`（不再用 `shouldAbort` 回调）
- WebGL 渲染：同步，无需 signal
- `getImageData` / `setHistograms`：`renderIdRef.current !== myId` 检查
- ComputeService fetch（Phase U.1）：同一 `signal` 传给 `fetch(url, { signal })`

### 2.6 错误处理

| 错误类型 | 处理 | UI 反馈 |
|---|---|---|
| `AbortError` | 静默 return | 无（预期行为） |
| WebGL context lost | retry 计数 ≤3，超过则 setRenderError | 顶部 banner "WebGL 上下文丢失，已切换到 CPU 模式" |
| 其他 Error | `setRenderError(err)` | 顶部 banner "渲染失败：<msg>" + 重试按钮 |

```jsx
{renderError && (
  <div className="render-error-banner">
    渲染失败：{renderError.message}
    <button onClick={() => processImage()}>重试</button>
  </div>
)}
```

### 2.7 context loss 重试

```js
let contextLossCount = 0;
const MAX_CONTEXT_LOSS_RETRIES = 3;

// 在 webglcontextlost 监听器内（FilmLabWebGL.js:118）：
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLossCount++;
  if (contextLossCount <= MAX_CONTEXT_LOSS_RETRIES) {
    console.warn(`[FilmLab] WebGL context lost, retry ${contextLossCount}/${MAX_CONTEXT_LOSS_RETRIES}`);
    // 触发 re-render，processImage 会重建 canvas
    setRenderError(null);
    // 通过 renderId 自增触发新渲染
    renderIdRef.current++;
    requestAnimationFrame(() => processImage());
  } else {
    setRenderError(new Error('WebGL 上下文多次丢失，已切换到 CPU 模式'));
    setUseGPU(false);  // 自动降级到 CPU
  }
});
```

## 3. 测试策略

### 3.1 单元测试（jest + fake timers）

| 测试 | 验证点 |
|---|---|
| `renderIdRef` 单调递增 | 连续 5 次 processImage 调用，renderIdRef.current = 5 |
| 旧渲染被 abort | 启动渲染 A → 启动渲染 B → A 的 `signal.aborted === true` |
| 旧渲染不写 canvas | mock canvas ctx，A 启动后 B 立即启动，A 的 `putImageData` 不被调用 |
| AbortError 静默 | `processCanvasWithRenderCoreAsync` 抛 AbortError，processImage 不 setRenderError |
| 非 AbortError 进 error state | mock throw Error('boom')，`renderError.message === 'boom'` |
| rAF effect 依赖 processImage | processImage 身份变化时 rAF 重订阅（mock rAF 计数） |

### 3.2 集成测试

| 测试 | 验证点 |
|---|---|
| 快速切换 10 张照片 | 只保留最后一次渲染结果（mock ctx.drawImage 计数 = 1） |
| 拖动滑块 60fps | 每帧都启动新 processImage，但只有最新一次写 canvas |

## 4. 实现顺序（S.2a/b/c）

- **S.2a**：引入 `renderIdRef` + `abortRef` + `renderError` state；改 `processImage` 为 async；加 stale 检查点；加错误分类处理。**不**改 CPU 渲染调用（仍同步）。
- **S.2b**：CPU 路径替换为 `await processCanvasWithRenderCoreAsync(canvas, params, { signal, chunkRows: 64 })`。同时把 `CpuRenderService.js:165` 的 `shouldAbort` 选项改为 `signal`。
- **S.2c**：加 `renderError` UI banner + context loss retry 逻辑。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| async 化引入 rAF 抖动 | WebGL 路径保持同步（<5ms，不阻塞）；只有 CPU 路径走 async |
| `renderIdRef` 检查点漏掉 | 代码审查清单：每个 `await` 后必须有检查；测试覆盖 |
| AbortController 兼容性 | Electron 43 / Chrome 90+ 全支持；旧浏览器 fallback 不在 v3 范围 |
| 错误 banner 影响 UX | banner 只在 `renderError !== null` 时显示；新渲染启动自动清除 |

## 6. 与 v3 计划的对应

- `01-issues-by-priority.md` P0-2 → S.2a/b/c
- `04-resource-management.md` P1-23 → S.2a 的 AbortSignal 复用给 U.1
- `05-execution-plan.md` Phase S.2 拆为 S.0（本文档）+ S.2a + S.2b + S.2c
