# 07 · 预览渲染性能（11 项）

v3 完成后的渲染热路径深度剖析。起因：用户报告预览刷新"从上到下逐块更新、不流畅"。
经分析发现双缓冲缺失（已修）+ CPU 路径 6 处 per-pixel 浪费 + WebGL 诊断空白。

---

## 背景：当前瓶颈全景

### 两条渲染路径

| 路径 | 触发条件 | 典型耗时（1200×800 预览） | 瓶颈 |
|---|---|---|---|
| **WebGL**（主路径） | `useGPU && isWebGLAvailable()` | <5ms（GPU 并行） | 已优化到位（纹理缓存、scratch buffers、dirty flag） |
| **CPU**（fallback） | WebGL 不可用或失败 | 86-200ms+（per-pixel JS） | **本文重点** |

### CPU 路径像素流量

```
processBlock (renderChunked.js:18)
  └─ for each pixel (960K 次/帧 for 1200×800)
       ├─ data[i]/255                           ← 3 次除法
       ├─ core.processPixelFloat(r, g, b)       ← 完整管线（~60-80 ops）
       │    ├─ ① Film Curve LUT 查找              ← 快（v3 S.5 已优化）
       │    ├─ ② Base Correction                 ← 条件，3 次乘法
       │    ├─ ③ Inversion                       ← 条件
       │    ├─ ③b 3D LUT                        ← 条件，三线性插值
       │    ├─ ④ White Balance                   ← 3 次乘法
       │    ├─ ⑤ Tone Mapping                    ← ★ per-pixel Math.pow + 6× Number()
       │    ├─ ⑤b Highlight Roll-Off            ← ★ 条件 Math.exp
       │    ├─ ⑥ Curves LUT                      ← 6-7 次函数调用（含冗余 clamp）
       │    ├─ ⑦ HSL                             ← 条件，色彩空间转换
       │    ├─ ⑧ Split Tone                      ← 条件
       │    └─ return [r, g, b]                  ← ★ 每像素分配数组
       └─ Math.round(rF * 255)                   ← 3 次乘法 + round + clamp
```

★ 标记为已识别的热点瓶颈。

---

## 已完成修复

### ✅ 双缓冲消除"上到下逐块刷新"

- **问题**：v3 S.2b 的 async CPU 渲染在**显示 canvas 上原地分块处理**。每个 `putImageData` + `await _yieldToMain()` 让浏览器绘制部分结果。
- **修复**：offscreen work canvas 绘制+处理 → 完成后一次性 blit 到显示 canvas。用户看到旧帧 → 新帧，无逐块刷新。
- **文件**：`FilmLab.jsx` `cpuWorkCanvasRef` + CPU 路径改用 work canvas。
- **状态**：✅ 已实现，939 tests passing。

---

## P0 — 关键性能（2 项）

### P0-9 processPixelFloat 每像素重算帧级常量

- **RenderCore.js:449-489**
- 以下 6 个表达式依赖 `this.params`（帧级不变），但在 `processPixelFloat` 方法体内对每个像素重算：

```js
// 每像素执行 960K 次/帧：
const expFactor = Math.pow(2, (Number(p.exposure) || 0) / 50);  // ← Math.pow ~50ns/次
const ctr = (Number(p.contrast) || 0) * 2.55;                   // ← Number() 类型转换
const blackPoint = -(Number(p.blacks) || 0) * 0.002;
const whitePoint = 1.0 - (Number(p.whites) || 0) * 0.002;
const sFactor = (Number(p.shadows) || 0) * 0.005;
const hFactor = (Number(p.highlights) || 0) * 0.005;
```

- **影响**：`Math.pow` × 960K ≈ **48ms/帧**；6× `Number()` × 960K ≈ **6ms/帧**。合计 **~54ms 浪费**。
- **修复**：在 `prepareLUTs()` 中预计算存入 `this.luts._tone = { expFactor, ctr, blackPoint, whitePoint, sFactor, hFactor, contrastFactor }`，`processPixelFloat` 内直接引用。
- **预期**：省 **10-15ms/帧**（`Math.pow` 是主要开销；`Number()` V8 可 peephole 优化但仍有方法调用开销）。
- **风险**：✅ 零——`this.params` 在实例生命周期内不可变（v3 S.6 保证）。

### P0-10 processPixelFloat 每像素分配 `[r,g,b]` 数组

- **RenderCore.js:550-554** + **renderChunked.js:25**
- `processPixelFloat` 返回 `return [Math.max(0,...), Math.max(0,...), Math.max(0,...)]`——每像素 new 一个 3 元素数组。`processBlock` 解构 `const [rF, gF, bF] = core.processPixelFloat(r, g, b)` 立即丢弃。
- 960K 次/帧的数组分配 → V8 Scavenge（minor GC）每 ~150K 像素触发一次 → **每帧 6-7 次 minor GC**，每次 1-10ms。
- **影响**：**5-15ms/帧 GC 压力**（取决于堆状态）。
- **修复**：`processPixelFloat(r, g, b, out)` 可选 `out` 参数——传入时写 `out[0]=r; out[1]=g; out[2]=b; return out`，不传时保持原行为（向后兼容测试）。`processBlock` 用预分配 `const outBuf = [0,0,0]`。
- **风险**：⚠️ API 变更——15+ 测试文件直接调 `processPixelFloat` 并解构。用可选参数模式可保持兼容。

---

## P1 — 高性能/诊断（3 项）

### P1-21 WebGL 失败静默——用户可能不知在走 CPU 路径

- **FilmLab.jsx:1311-1315**
- WebGL 异常被 `catch(e) { console.error("WebGL failed", e); }` 静默吞掉。无 UI 指示器、无失败原因、无恢复尝试。用户可能**一直走在 86ms+ 的 CPU 路径上**而不知原因。
- **附加问题**：`isWebGLAvailable()` 的 `_webglAvailableCache` 在 GPU 崩溃后永不清除（P2-11），恢复后 `isWebGLAvailable()` 仍 true 但 `getContext()` 返回 null。
- **影响**：如果 WebGL 实际可用但因 transient failure（context loss, driver reset）被 catch，所有 CPU 性能优化都是治标不治本。
- **修复**：
  1. catch 块内记录失败原因到 state（`setWebglFailReason(e.message)`）
  2. UI 显示"WebGL 不可用，使用 CPU 模式（较慢）"提示
  3. context loss 后重试（v3 S.2c 设计的 retry 计数 ≤3）
  4. 暴露 `_resetWebGLAvailableCache()` 供 context restore 后调用

### P1-22 CPU 路径交互时降分辨率

- **FilmLab.jsx:278, 408**（`PREVIEW_MAX_WIDTH_CLIENT` 使用点）
- 拖动滑块时全分辨率渲染（1200×800 = 960K 像素）。Lightroom/Capture One 在交互时降至 1/2 或 1/4 分辨率，释放后恢复全分辨率。
- **影响**：拖动时降至 600×400 = 240K 像素 = **4× 加速**。配合 P0-9/P0-10 可达 **<10ms/帧**（60fps 实时）。
- **前置条件**：需新增 `isInteracting` 状态（slider mousedown/touchstart → true，mouseup/touchend → false；键盘 arrow key → 临时 true + 100ms debounce）。
- **风险**：⚠️ 分辨率切换可见（需要渐进式 refinement——先低分辨率立即响应，mouseup 后延迟 150ms 渲染全分辨率）；crop rect 坐标用归一化（0-1）不受影响；histogram 已用 256×256 scratch 不受影响。
- **适用范围**：仅 CPU 路径（WebGL 已 <5ms，降分辨率无必要）。

### P1-23 processPixelFloat contrast 计算缺少安全钳制

- **RenderCore.js:456-462**（原 v4 P1-2，此处归类为性能+正确性交叉项）
- 移至 P0-9 的 `_tone` 预计算时，须一并加 `Math.max(-258, Math.min(258, ctr))` 钳制，避免 contrast > 101.57 时除零。8-bit 路径 `filmLabToneLUT.js:47` 已有钳制。

---

## P2 — 中等性能（5 项）

### P2-10 _sampleCurveLUTFloatHQ 冗余 clamp

- **RenderCore.js:918-925**
- `val` 在调用前（line 514）已被 `Math.max(0, Math.min(1, r))` 钳制。函数内 `Math.max(0, Math.min(1, val)) * maxIdx` 再次钳制——**6 次冗余比较/像素**。
- **修复**：移除函数内 clamp，或加 `// val pre-clamped by caller` 注释 + 直接 `val * maxIdx`。
- **预期**：省 **2-5ms/帧**。

### P2-11 _sampleLUT3DFloat 每次调用创建闭包

- **RenderCore.js:872-874**
- `const getIdx = (ri,gi,bi) => ...` 和 `const interp = (offset) => ...` 在 `_sampleLUT3DFloat` 方法体内创建——每次调用 new 两个函数对象。仅在 LUT 激活时（`lut1`/`lut2` 非 null）触发。
- **修复**：将 `getIdx` 提升为静态方法或内联 `(ri + gi * size + bi * size * size) * 3`；`interp` 改为内联展开。
- **预期**：仅在 LUT 激活时省 2-5ms/帧。

### P2-12 applySaturationFloat 也分配数组

- **filmLabSaturation.js:41-45**
- 同 P0-10 模式：`return [Math.max(...), Math.max(...), Math.max(...)]` 每像素 new 数组。仅在 saturation 非默认时触发。
- **修复**：同 P0-10 的 `out` 参数模式，或内联到 `processPixelFloat`。

### P2-13 highlightRollOff 每像素 Math.exp

- **tone-curves.js:57-70**（通过 RenderCore.js:504 调用）
- 亮区像素（maxVal > 0.8）触发 `Math.exp(2.0 * tc)`，~100ns/次。天空/灯泡等大面积亮区图像中，~30-50% 像素命中。
- **修复**：预构建 256-entry LUT（8-bit 路径）或 1024-entry Float32Array（float 路径），在 `prepareLUTs()` 中按 `tc` 参数计算。
- **预期**：亮区图像省 5-15ms/帧。

### P2-14 isWebGLAvailable 缓存在 GPU 崩溃后失效

- **FilmLabWebGL.js:79-92**
- `_webglAvailableCache` 永久缓存。GPU driver reset 后 `isWebGLAvailable()` 仍 true 但 `getContext('webgl2')` 返回 null。
- **修复**：`webglcontextrestored` 事件中调 `_resetWebGLAvailableCache()` + 重新检测；或在 `processImageWebGL` catch 块中清缓存。

---

## 修复优先级与累积加速

| 步骤 | 修复 | 省时 | 累积 CPU 路径耗时 |
|---|---|---|---|
| 基线 | — | — | ~86ms（默认参数）/ ~200ms+（全功能开启） |
| P0-9 | 帧级常量预计算 | -10-15ms | ~71-76ms |
| P0-10 | 消除数组分配 | -5-15ms | ~56-71ms |
| P2-10 | 移除冗余 clamp | -2-5ms | ~51-69ms |
| P2-13 | highlightRollOff LUT | -5-15ms（亮区图） | ~36-64ms |
| P1-22 | 交互时降分辨率 | 4×（仅 drag 时） | drag: ~9-16ms / idle: ~36-64ms |
| P1-21 | WebGL 诊断+恢复 | 回到 <5ms（如果 WebGL 可用） | <5ms（WebGL 路径） |

**结论**：
1. **P0-9 + P0-10 + P2-10** 合计 <2h，省 17-35ms/帧——应最先做。
2. **P1-21（WebGL 诊断）** 可能揭示用户实际在走 CPU 路径——若 WebGL 可用，所有 CPU 优化都不需要。
3. **P1-22（降分辨率）** 是最后手段——仅在确认 CPU 路径是主要路径时才值得投入。
