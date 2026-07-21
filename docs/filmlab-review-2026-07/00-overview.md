# FilmLab 全量代码审查报告（2026-07-21）

审查范围：
- `client/src/components/FilmLab/`（约 1 万行，21 个文件）
- `packages/shared/` 的 `filmLab*.js`、`render/`、`shaders/`、`edgeDetection/`（约 1 万行）
- 服务层路由：`client/src/services/ComputeService.js`、`CpuRenderService.js`、`packages/shared/serverCapabilities.js`

## 分卷索引

| 卷 | 内容 |
|---|---|
| [01-negative-inversion.md](01-negative-inversion.md) | 负片去色罩逻辑与反转算法 |
| [02-color-algorithms.md](02-color-algorithms.md) | 图像处理算法（WB/曲线/HSL/分离色调/饱和度/色调LUT/导出参数） |
| [03-rendering-routing.md](03-rendering-routing.md) | 渲染管线与系统路由（GPU/CPU/服务器三路径、预览路由） |
| [04-ui-edge-detection.md](04-ui-edge-detection.md) | UI 功能代码与自动裁剪/边缘检测 |
| [05-performance.md](05-performance.md) | 性能优化问题 |
| [06-refactor-plan.md](06-refactor-plan.md) | 系统性改造计划（执行中） |

## 总评

核心数学（样条、Hough、密度域、色彩空间矩阵）功底扎实；splitTone/saturation/filmCurve 的 CPU-GPU 公式对齐做得认真。问题集中在**工程一致性**——三/四条渲染路径各自实现参数解析导致的系统性漂移、路由契约断裂、React 状态管理的浅拷贝/竞态。

## 修复优先级

| 优先级 | 事项 |
|---|---|
| P0 | `paramsEqual` 键列表（预览冻结）；自动裁剪坐标系；COMPUTE_ROUTES 契约；对比度 ×2.55；film profile 回退失效 |
| P1 | 版本迁移死代码 + aqua→cyan 覆盖；splitTone 权重不守恒；CPU 路径旋转崩溃；blob URL 泄漏；mediump/highp |
| P2 | 统一三条像素路径输入空间约定；路由入口收敛 + AbortController；HSL 灰像素分支对齐；直方图重渲染治理 |
| P3 | 死代码清理（useHistogram/LutManager/ExportQueuePanel）；DEFAULT_* 深拷贝工厂；types.d.ts 重写；Worker 化导出 |

## 验证基线

- 修复前基线：`npx jest --config tests/jest.config.js` → **41 suites / 452 tests 全部通过**（2026-07-21）。
- 每阶段修复后需全量重跑，并新增针对该阶段的一致性测试（非烟测）。
