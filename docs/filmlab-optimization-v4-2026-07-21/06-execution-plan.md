# 06 · 执行计划（Phase W–Z + X2）

## 阶段总览

| 阶段 | 内容 | 对应发现 | 估时 |
|---|---|---|---|
| W | 安全修复（auth + GPU 窗口） | P0-1/2（安全） | 4-8h |
| X | 算法正确性（CPU/GPU 一致性） | P0-3/4/8 + P1-1/2/4（算法） | 1-2d |
| **X2** | **渲染性能（CPU 热路径 + WebGL 诊断）** | **P0-9/10 + P1-21/22/23 + P2-10~14（性能）** | **1d** |
| Y | 后端强化（分页 + 索引 + 安全） | P0-6 + P1-1/3/4（后端） | 1-2d |
| Z | 架构补全（CI/CD + 测试 + i18n） | Critical 2 + High 4（架构） | 3-5d |

---

## Phase W — 安全修复（先做）

### W.1 Auth 默认关闭 soft-mode
- `server/server.js:210` → 改默认值为 `AUTH_SOFT_MODE=0`
- `electron-main.js:184` → spawn 时强制设为 `'0'`
- 添加 UI 警告横幅（当 soft-mode 启用时）
- 测试：LAN 设备访问 → 401

### W.2 GPU 窗口安全隔离
- `electron-main.js:677-687` → 改用 preload
- `electron-gpu/gpu.html` → 加载 `gpu-renderer.bundle.js`
- 更新 `gpu-renderer.js` → 用 `window.__gpu` API 而非 `require('electron')`
- 测试：GPU 渲染仍然可用，无 regressions

---

## Phase X — 算法正确性

### X.1 GLSL shoulder bound 同步（P0-3）
- `shaders/filmCurve.js:30` → `0.25` → `0.5`
- 测试：相同 params 下 WebGL 输出 vs CPU 输出像素差值 < 1 LSB

### X.2 WB 系数 BT.601→BT.709（P0-4）
- `filmLabWhiteBalance.js:228` → `0.299/0.587/0.114` → `0.2126/0.7152/0.0722`
- 测试：旧参数批处理验证（BT.701→BT.709 可能轻微改变已保存预设的观感，需重新验证）

### X.3 自定义 profile CPU 路径支持（P0-8）
- RenderCore 构造器加 `customProfiles` 参数
- `_prepareFilmCurveContext` → 合并 builtin + custom
- 测试：自定义 profile → WebGL = CPU = 导出

### X.4 GLSL saturation 负数钳制（P1-1）
- `shaders/saturation.js:28` + `s = max(0.0, s)`

### X.5 processPixelFloat contrast 钳制（P1-2）
- `RenderCore.js:456` → `ctr = Math.max(-258, Math.min(258, ...))`

### X.6 GLSL dMax==dMin 除零保护（P2-4）
- `shaders/filmCurve.js:57` → `dRange = max(dMax - dMin, 1e-6)`

---

## Phase X2 — 渲染性能（详见 [07-preview-performance.md](07-preview-performance.md)）

### X2.0 WebGL 失败诊断（P1-21）— **先做：确认瓶颈是否在 CPU**

> 如果 WebGL 实际可用，所有 CPU 优化都不需要。先诊断再做 CPU 热路径优化。

- `FilmLab.jsx:1311-1315` catch 块 → 记录失败原因到 state
- UI 显示"WebGL 不可用，使用 CPU 模式"提示（可关闭）
- `webglcontextrestored` 事件 → 调 `_resetWebGLAvailableCache()` + 重新检测
- context loss retry 计数（≤3，v3 S.2c 已设计）
- 测试：模拟 WebGL context loss → UI 显示降级提示 → restore 后自动恢复

### X2.1 帧级常量预计算（P0-9）— **最高 ROI：15min，省 10-15ms/帧**

- `RenderCore.js prepareLUTs()` 新增：
  ```js
  const exposure = Number(p.exposure) || 0;
  const contrast = Number(p.contrast) || 0;
  this.luts._tone = {
    expFactor: Math.pow(2, exposure / 50),
    ctr: Math.max(-258, Math.min(258, contrast * 2.55)),  // P1-23: 配套钳制
    contrastFactor: (259 * (ctr + 255)) / (255 * (259 - ctr)),  // 预计算
    blackPoint: -(Number(p.blacks) || 0) * 0.002,
    whitePoint: 1.0 - (Number(p.whites) || 0) * 0.002,
    sFactor: (Number(p.shadows) || 0) * 0.005,
    hFactor: (Number(p.highlights) || 0) * 0.005,
  };
  ```
- `processPixelFloat` 内改为 `const t = luts._tone; r *= t.expFactor; ...`
- 测试：相同 params → 预计算前后 `processPixelFloat` 输出完全一致（逐像素 diff = 0）

### X2.2 消除 per-pixel 数组分配（P0-10）— **1h，省 5-15ms/帧 GC**

- `processPixelFloat(r, g, b, out)` 可选 `out` 参数：
  ```js
  processPixelFloat(r, g, b, out) {
    // ... pipeline ...
    if (out) { out[0] = clamp(r); out[1] = clamp(g); out[2] = clamp(b); return out; }
    return [clamp(r), clamp(g), clamp(b)];  // 向后兼容
  }
  ```
- `renderChunked.js processBlock` 用预分配 buffer：
  ```js
  const outBuf = [0, 0, 0];
  for (...) {
    core.processPixelFloat(r, g, b, outBuf);
    data[i] = Math.min(255, Math.max(0, Math.round(outBuf[0] * 255)));
    // ...
  }
  ```
- 测试：现有 15+ 测试文件不传 `out` → 保持原行为；`processBlock` 输出不变

### X2.3 移除冗余 clamp（P2-10）— **5min，省 2-5ms/帧**

- `RenderCore.js:918` `_sampleCurveLUTFloatHQ` → 移除内部 `Math.max(0, Math.min(1, val))`
- 加注释 `// val pre-clamped by caller at line 514`

### X2.4 highlightRollOff LUT（P2-13）— **30min，省 5-15ms/帧（亮区图）**

- `prepareLUTs()` 预构建 1024-entry Float32Array，按 `tc` 参数计算 `Math.exp(2.0 * tc)` 查找表

### X2.5 _sampleLUT3DFloat 闭包内联（P2-11）+ applySaturationFloat out 参数（P2-12）

- 仅在 LUT 激活 / saturation 非默认时有效，可与 X2.1/X2.2 一并做

### X2.6 交互时降分辨率（P1-22）— **仅当 X2.0 确认 CPU 是主路径时才做**

- 新增 `isInteracting` state（slider mousedown → true，mouseup + 150ms debounce → false）
- `geometry` memo + `webglParams` memo 中 `maxWidth = isInteracting ? PREVIEW_MAX_WIDTH_CLIENT / 2 : PREVIEW_MAX_WIDTH_CLIENT`
- 仅 CPU 路径（WebGL 已 <5ms）
- mouseup 后延迟 150ms 渲染全分辨率（progressive refinement）

### X2 测试

- X2.0: WebGL context loss → UI 降级提示 → restore 后恢复
- X2.1: `prepareLUTs()._tone` 存在且值正确；预计算前后逐像素 diff = 0
- X2.2: `processPixelFloat(r,g,b,outBuf)` 写入 outBuf；不传 out 仍返回数组
- X2.3: `_sampleCurveLUTFloatHQ` 内无 `Math.max(0, Math.min(1, ...))`
- X2.4: highlightRollOff LUT 存在；亮区像素输出 diff < 0.002

**预期**：+15 测试

---

## Phase Y — 后端强化

### Y.1 photos 表分页
- `GET /api/photos` → 加 `LIMIT ? OFFSET ?` + totalCount 元数据
- favorites/negatives/tag-photos 同理

### Y.2 数据库索引
- `photos(roll_id)`, `photos(date_taken)`, `photos(location_id)`, `photos(rating)`, `rolls(filmId)`, `rolls(start_date)`

### Y.3 安全修复
- 移除日志中的 req.body 打印
- 所有 fs.unlink 前加 `isPathConfined`
- CORS origin 限制为已知值

### Y.4 其他后端 P1/P2
- compute 端点加强限速
- WAL checkpoint 策略优化
- LUT 文件名防冲突

---

## Phase Z — 架构补全

### Z.1 CI/CD pipeline
- GitHub Actions: lint + test on push/PR
- 桌面构建 pipeline（electron-builder Windows/macOS/Linux）
- 移动构建 pipeline（EAS build Android APK/AAB）
- Docker build + push pipeline

### Z.2 前端 ErrorBoundary + 测试
- FilmLab 子树 ErrorBoundary
- vitest + @testing-library/react 基础组件测试
- Playwright + Electron E2E smoke test

### Z.3 代码共享
- client 迁移到 @filmgallery/api-client
- CpuRenderService.getPhotoImageUrl → @filmgallery/shared
- PhotoSwitcher 事件委托优化

### Z.4 i18n 基础设施
- 桌面端集成 i18n 框架（复用移动端的 zh/en 翻译）
- 提取全部 alert() / confirm() / 按钮文字

### Z.5 构建依赖对齐
- Docker Node 22 统一
- legacy-peer-deps 移除
- React 版本矩阵文档化

---

## 执行顺序

```
Phase W（安全，最高优先级，已有 gpu-preload.js 只需接线）
  ↓
Phase X2.0（WebGL 诊断——确认瓶颈是否在 CPU）          ← 决策门
  ├─ WebGL 可用 → 跳过 X2.1-X2.6，直接进 X/Y
  └─ CPU 是主路径 ↓
     Phase X2.1-X2.5（CPU 热路径优化，<2h，省 17-35ms/帧）
       ↓
     Phase X2.6（交互降分辨率，4h，额外 4× 加速）
  ↓
Phase X（算法正确性，可与 X2 并行——不同函数域）
  ↓
Phase Y（后端，可与 X/X2 并行）
  ↓
Phase Z（架构，独立于 W/X/X2/Y，最后做）
  ↓
最终全量测试 + CI gate 启用
```

**关键决策点**：X2.0 的 WebGL 诊断结果决定 X2.1-X2.6 是否值得投入。如果 WebGL 实际可用，
CPU 热路径优化省下的 17-35ms 只影响 fallback 场景——ROI 低于算法正确性和后端强化。

## 测试基线

- 当前（v3 后）：62 suites / 939 tests / 0 failing
- Phase W 后：不变（无渲染变更）
- Phase X2 后：~954（+15 渲染性能测试）
- Phase X 后：~975（+21 算法一致性测试）
- Phase Y 后：~995（+20 后端测试）
- Phase Z 后：~1035（+40 E2E / 组件测试）
- 最终目标：~1035 tests + E2E smoke + CI gate 强制通过

## Top 7 优先修复项

1. **Auth soft-mode ON** (P0-1) — 影响所有用户的安全漏洞
2. **GPU 窗口安全** (P0-2) — CVE-worthy，已有修复只需接线
3. **WebGL 失败诊断** (P1-21) — 确认用户是否在走 CPU 路径（可能是一切慢的根因）
4. **帧级常量预计算** (P0-9) — 15min，省 10-15ms/帧，最高 ROI 性能优化
5. **CPU/GPU shoulder 不一致** (P0-3) — 用户可见输出差异
6. **自定义 profile CPU 丢失** (P0-8) — 数据完整性 bug
7. **CI/CD 空白** — 无自动化防止回归
