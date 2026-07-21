# 06 · 执行计划（Phase W–Z）

## 阶段总览

| 阶段 | 内容 | 对应发现 | 估时 |
|---|---|---|---|
| W | 安全修复（auth + GPU 窗口） | P0-1/2（安全） | 4-8h |
| X | 算法正确性（CPU/GPU 一致性） | P0-3/4/8 + P1-1/2/4（算法） | 1-2d |
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
Phase X（算法正确性，可与 Y 并行——不同模块域）
  ↓
Phase Y（后端，可与 X 并行）
  ↓
Phase Z（架构，独立于 W/X/Y，最后做）
  ↓
最终全量测试 + CI gate 启用
```

## 测试基线

- 当前（v3 后）：62 suites / 939 tests / 0 failing
- Phase W 后：不变（无渲染变更）
- Phase X 后：~960（+21 算法一致性测试）
- Phase Y 后：~980（+20 后端测试）
- Phase Z 后：~1020（+40 E2E / 组件测试）
- 最终目标：~1020 tests + E2E smoke + CI gate 强制通过

## Top 5 风险项（先改）

1. **Auth soft-mode ON** (P0) — 影响所有用户
2. **GPU 窗口安全** (P0) — CVE-worthy，已有修复只需接线
3. **CPU/GPU shoulder 不一致** (P0) — 用户可见输出差异
4. **自定义 profile CPU 丢失** (P0) — 数据完整性 bug
5. **CI/CD 空白** — 无自动化防止回归
