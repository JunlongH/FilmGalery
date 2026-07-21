# FilmLab 优化计划 v4（2026-07-21）

> **基于 v3 完成后的第五轮全量审阅**

v4 在 v1（算法正确性）、v2（边缘检测/色彩/数据完整性）、v3（性能与响应性）基础上，
将范围从 FilmLab 渲染管线扩展到**全栈**：前端、后端、算法、架构、安全。

## 调查方法

- **5 路并行 explore agent**：前端（25 项）、后端（31 项）、算法（16 项）、架构（36 项）、安全（5 项）
- 覆盖：React 组件、Express 路由、SQLite 数据库、GLSL 着色器、Electron 安全、CI/CD、i18n
- 每条发现均有 `file:line` + 严重度 + 可操作建议

## 与 v3 的关系

v3 聚焦 **FilmLab 渲染管线**的性能优化（canvas 复用、async CPU、React.memo、LUT 预构建）。
v4 扩展到：
- **前端**：错误边界、AIPanel 上下文重渲染、触摸支持、无障碍访问
- **后端**：分页、索引、安全（auth 默认开放、文件上传验证、路径遍历）
- **算法**：CPU/GPU 渲染一致性（shoulder 边界差异、WB 系数不一致、自定义 profile 丢失）
- **架构**：CI/CD 空白、React 版本分裂、GPU 窗口安全、E2E 测试空白
- **安全**：auth soft-mode 默认 ON、GPU 窗口 nodeIntegration:true

## 优先级概览

### P0 — 关键安全/正确性（8 项）

| # | 领域 | 问题 |
|---|---|---|
| 1 | 安全 | **Auth soft-mode 默认 ON** — LAN 内任意设备可无认证访问全部写接口（上传/删除/修改） |
| 2 | 安全 | **GPU 窗口 nodeIntegration:true + contextIsolation:false** — 隐藏渲染器有完整 Node.js 权限 |
| 3 | 算法 | **GLSL shoulder bound 0.25 vs CPU 0.5** — WebGL 预览与导出图像的 shoulder 压缩不同 |
| 4 | 算法 | **WB 亮度补偿使用 BT.601 而非 BT.709** — 与代码库其他模块不一致，暖色 WB 偏暗 |
| 5 | 前端 | **handleAutoColor/handleDensityAutoLevels 全画布 getImageData** — 12MB GPU 读回阻塞 UI |
| 6 | 后端 | **GET /api/photos 无分页** — 千张照片时 OOM + 慢响应 |
| 7 | 后端 | **日志打印完整 req.body + EXIF GPS** — 信息泄漏 |
| 8 | 算法 | **自定义 film profile 在 CPU 路径丢失** — RenderCore 只看内置 profile，WebGL 路径正常 |

### P1 — 高性能/正确性影响（12 项）

| # | 领域 | 问题 |
|---|---|---|
| 9 | 前端 | **useEffect 依赖重复触发** — 一个参数变化触发 2 次 rAF（webglParams + 独立 geometry deps） |
| 10 | 前端 | **AIPanelContext 导致 FilmLab 级联重渲染** — AI 面板关闭时上下文变化仍触发 FilmLab re-render |
| 11 | 前端 | **FilmLab 无子树 ErrorBoundary** — 单张照片崩溃导致整个 App 崩溃 |
| 12 | 前端 | **PhotoSwitcher smooth scroll 与点击冲突** — 快速点击时滚动动画堆积 |
| 13 | 前端 | **AIPanel 拖拽手柄无触摸支持** — iPad/触摸设备无法调整面板大小 |
| 14 | 算法 | **GLSL saturation 无负数保护** — < -100 时 chroma 反转 vs CPU 钳制 |
| 15 | 算法 | **processPixelFloat contrast 无钳制** — 超范围 contrast 产生 NaN/Infinity |
| 16 | 算法 | **processPixelFloat 文档声称线性输入但实际 sRGB** — 维护风险 |
| 17 | 后端 | **photos 表缺索引（roll_id/date_taken/rating）** — 全表扫描 |
| 18 | 后端 | **CORS origin:true + Private Network 过于宽松** — LAN 恶意网页可发起请求 |
| 19 | 后端 | **WAL 模式 PASSIVE checkpoint 持续负载下永不完成** — WAL 文件无限增长 |
| 20 | 后端 | **compute 端点无限速** — 全分辨率导出请求可耗尽 CPU |

### P2 — 中等影响（24 项，精选）

- 前端：slider global listener 未清理、preset 名验证弱、LUT 上传无大小限制、renderOriginal 硬编码 maxWidth
- 后端：错误响应格式不一致（ok/error/success 混用）、health 端点暴露路径、POST locations 无事务、AI API key 明文存储、空 search 返回全部、Docker 无资源限制、LUT 文件上传无重名保护
- 算法：GLSL dMax==dMin 除零、rectangleFinder centerPenalty=0、findBestRectangle 副作用排序、gaussianBlur 边界归一化、log inversion float vs 8-bit 1 LSB 偏差
- 架构：CRA→Vite 完成（正面）、三消费者架构清晰（正面）、CI/CD 空白、E2E/组件测试空白、Docker Node 版本分裂、React 版本冲突

### P3 — 清理/增强（21 项）

- 前端：无障碍零 ARIA、i18n 全硬编码、buildRenderCoreParams 仍被 handleSave 误用
- 后端：API 版本化缺失、db.serialize 阻塞启动、版本号硬编码 1.9.2、sync fs 调用、multer 错误未处理
- 算法：applyFilmCurveLegacy GLSL 死函数、HSL_CHANNEL_ORDER 硬编码
- 架构：legacy-peer-deps 全局开启、state 分割策略未文档化、无崩溃报告、EAS build scripts Windows-only

## 测试基线

- 当前（v3 后）：62 suites / 939 tests / 0 failing
- v4 目标：~1100 tests，新增 CI/CD gate（lint + test 强制通过），E2E smoke test

## 执行建议

1. **P0-1/P0-2（安全）最先** — auth 默认值 + GPU 窗口隔离（已写 gpu-preload.js 但未接线）
2. **P0-3/P0-4/P0-8（算法正确性）** — CPU/GPU 渲染一致性问题（用户可见输出差异）
3. **P0-6/P1-17（后端分页+索引）** — 数据库性能
4. **P1-11（前端 ErrorBoundary）** — 防止单张照片崩溃全应用
5. **架构 CI/CD** — 自动化测试门禁，防止回归

## 分卷索引

| 卷 | 内容 |
|---|---|
| [01-frontend.md](01-frontend.md) | 前端 25 项（错误边界、上下文、无障碍、i18n） |
| [02-backend.md](02-backend.md) | 后端 31 项（分页、索引、安全、验证） |
| [03-algorithms.md](03-algorithms.md) | 算法 16 项（CPU/GPU 一致性、精度、边界条件） |
| [04-architecture.md](04-architecture.md) | 架构 36 项（CI/CD、Electron、测试、构建） |
| [05-security.md](05-security.md) | 安全 5 项（auth、GPU 窗口、上传验证、路径遍历） |
| [06-execution-plan.md](06-execution-plan.md) | 分阶段执行计划（Phase W–Z） |
