# FilmLab 优化计划 v2（2026-07-21）

基于第二轮系统性审查。本轮审查在上一轮（docs/filmlab-review-2026-07/，已修复 Phase A–L 共 127 个测试）基础上，发现了一批**新问题**与**未触及的优化项**。本计划按"先暴露再修复"原则组织。

## 调查方法

- 4 个并行审查 agent，分别覆盖：渲染管线、色彩算法、UI/路由、边缘检测/测试
- 仅报告"当前仍未解决"或"新引入"的问题，不重复已修复项
- 每条发现均有 文件:行号 与可操作建议

## 分卷索引

| 卷 | 内容 |
|---|---|
| [01-issues-by-priority.md](01-issues-by-priority.md) | 全部发现按优先级排序（P0–P3） |
| [02-rendering-pipeline.md](02-rendering-pipeline.md) | 渲染管线（WebGL/shader/RenderCore）详细问题 |
| [03-color-algorithms.md](03-color-algorithms.md) | 色彩算法与数据完整性详细问题 |
| [04-ui-routing.md](04-ui-routing.md) | UI 组件、状态管理、路由服务详细问题 |
| [05-edge-detection-testing.md](05-edge-detection-testing.md) | 边缘检测残留问题与测试覆盖缺口 |
| [06-execution-plan.md](06-execution-plan.md) | 分阶段执行计划（Phase M–R） |

## 优先级概览

### P0 — 功能性 Bug（应立即修复，8 项）

1. **WebGL2 模式下 3D LUT 完全失效**（FilmLabWebGL.js:252 + shaders/index.js:215）— 现代浏览器默认 WebGL2，LUT uniform 名不匹配导致静默不应用
2. **disposeWebGL 从未被调用**（useFilmLabRenderer.js:205）— GL 资源全量泄漏至页面卸载
3. **WB/普通取色器边缘越界 IndexSizeError**（FilmLab.jsx:961,1024）— 点击 canvas 右/下边缘崩溃
4. **savePreset 漏存半数参数**（FilmLab.jsx:375）— baseMode/baseDensity/densityLevels/rotation/cropRect/saturation 丢失
5. **CpuRenderService.applyGeometry 漏算 rotationOffset**（:86）— CPU fallback 旋转角度错误
6. **'x' 快捷键未过滤输入框**（FilmLab.jsx:2479）— 预设名/搜索框输入 x 误触发 ratioSwap
7. **renderOriginal effect 缺 rotationOffset 依赖**（FilmLab.jsx:740）— compare 模式原图旋转错误
8. **downloadClientJPEG GPU 路径 filmCurve 漏取 gammaR/G/B/toe/shoulder**（FilmLab.jsx:2035）

### P0 — 数据校验（3 项）

9. **validateExportParams 跳过 splitToning 校验**（filmLabExport.js:230）+ HSL NaN 过关
10. **hasParamsDifference 用 JSON.stringify（键序敏感）**（filmLabExport.js:478）— 应改用 stableSerializeParams
11. **mergeDeep 数组引用泄漏**（filmLabExport.js:178）— 调用方修改返回值污染输入

### P0 — 测试覆盖（3 项，边缘检测主入口零测试）

12. **detectEdges 端到端合成图测试缺失**（tests/）— 主入口零测试
13. **isResultValid 7 条分支全未测**（tests/）
14. **findBestRectangle 及子函数零测试**（tests/）

### P1 — 性能/架构（10 项）

15. **每帧 50 次 uniform location 重建**（FilmLabWebGL.js:331）
16. **曲线纹理每帧全量重传 + 16KB 临时分配**（FilmLabWebGL.js:480）
17. **每帧 setHistograms 致全面板重渲染**（FilmLab.jsx:1347）— 提取 HistogramContext
18. **4 处 new RenderCore({...}) 参数组装重复**（FilmLab.jsx:1281/1601/1705/2156）
19. **3 处 filmCurve profile 解析重复 + GPU 路径漏字段**（FilmLab.jsx:1123/1756/1850/2035）
20. **u_linearDomainInversion 客户端从未绑定**（FilmLabWebGL.js:335）— GPU 预览忽略线性域反转
21. **图像纹理每帧无条件重传**（FilmLabWebGL.js:320）
22. **CpuRenderService 本地常量与 shared 漂移**（:18-19，4000 vs 8000）
23. **ToneCurveEditor getHistogramPath/getCurvePath 每帧重算未 memo**（:23-94）
24. **SliderControl 每实例注册全局 mouseup 监听器**（:26，15+ 个）

### P1 — 死代码/SSOT（8 项）

25. **RenderCore 死代码 ~300 行**（_applyFilmCurveFloat/_sampleCurveLUTFloat/getHSLGLSL/getSplitToneGLSL）
26. **GLSL 死函数**（baseDensity/inversion/filmCurve 模块的函数被 main 内联，未调用）
27. **filmLabExport DEFAULT_HSL_PARAMS/SPLIT_TONING 重复定义 + dead import**（:22-50）
28. **filmLabInversion 片基校正 3 份实现**（filmLabInversion/RenderCore/shaders）
29. **hooks/*.js 全部 1062 行未使用 + schema 不兼容**（useFilmLabState DENSITY_LEVELS 扁平 vs 嵌套）
30. **filmLabWhiteBalance Y 保持块死代码**（:107-159，恒等于 max 归一化）
31. **CpuRenderService getPhotoImageUrl 重复**（已在 K 阶段委托，但 CpuRenderService 本地 EXPORT_MAX_WIDTH/PREVIEW_MAX_WIDTH 仍漂移）
32. **compute service 三个 local* 函数 90% 重复**（localGpuPreview/localRenderPositive/localExportPositive）

### P1 — 边缘检测残留（6 项）

33. **classifyLines 漏掉 θ≈3π/2 方向**（houghTransform.js:174）— 倾斜边框水平线被丢弃
34. **mergeLines 加权平均 θ 未做环形均值**（:127）— 0/2π 边界合并产生错误 θ
35. **findRectangleByDensity fallback 未接线**（index.js:113）— Hough 失败无兜底
36. **normalizeRect 不保证 x+w≤1**（utils.js:244）
37. **isResultValid 逻辑混乱 + 死分支**（index.js:182-238）
38. **'120' 胶片格式选项静默失效**（index.js:66）

### P2 — 健壮性/UX（12 项，详见分卷）

- HSL 通道权重不构成单位分解（弱响应区）、tint 轴线性近似、对比度除零、paramSerializer 哈希漏检、autoCropCoord 非方形宽高比、ComputeService 全部 fetch 无 AbortController、PhotoSwitcher 竞态、三个 picker 非互斥、图像加载双网络请求、FilmLabCanvas DPR 缺失、Ctrl+↑/↓ 冲突、processPixelFloat 每像素分配数组

### P3 — 清理/微优化（10+ 项，详见分卷）

- math 模块死代码、Sobel 行指针优化、console.log 副作用、cycleCompare 未 useCallback、filmType 死状态、hslKey/splitToneKey 死字段等
