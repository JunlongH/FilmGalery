# 06 · 系统性改造计划

原则：**单一事实来源（SSOT）、模块化、可测试**。所有参数解析/默认值/路由决策收敛到 shared 包；每项修改前先回到代码确认问题存在与修复方法；每阶段后全量测试 + 新增针对性测试（非烟测）。

## 阶段划分

| 阶段 | 内容 | 对应发现 | 状态 |
|---|---|---|---|
| A | 渲染一致性：对比度 ×2.55 统一、film profile 回退、splitTone 单位分解、HSL satRamp、曲线除零防护 | 02-H1/H2/H3/M3/M4/M2, 03-R7 | ✅ +27 tests |
| B | 路由契约：COMPUTE_ROUTES 补齐、能力探测负缓存、预览请求序号、GPU 结果校验 | 03-R2/R6 | ✅ +11 tests |
| C | 预览冻结：paramsEqual → 序列化脏标记、webglParams memo 依赖 | 03-R4, 04-U5 | ✅ +17 tests |
| D | 数据完整性：迁移顺序、aqua→cyan、createDefaultParams 深拷贝、自动裁剪坐标系 | 02-H4/M5, 04-U1/U2 | ✅ +19 tests |
| E | 健壮性：parseCubeLUT 校验、Canny BFS、Hough 环绕、blob URL、CPU 旋转崩溃 | 04-U2/U3/U4/U5/U6 | ✅ +11 tests |
| F | 性能：renderBuffer 单循环、highp、buildFragmentShader 变体 | 05-P2/P8, 03-R8 | ✅ +5 tests |
| G | types.d.ts 与运行时对齐 | 04-types | ✅ +8 tests |
| H | 死代码清理（LutManager/ExportQueuePanel/useHistogram） | 04-死代码 | ✅ 删 3 文件 |
| I | 负片反转线性域转换层（opt-in + RFC + 视觉验证） | 01-反转/07-参照 | ✅ +10 tests |
| J | 大图导出分块让步（SSOT renderChunked） | 05-P6 | ✅ +4 tests |
| K | P4 收尾：类型保留/getPhotoImageUrl 合并/直方图依赖/WebGL 缓存+dispose | 04/05 | ✅ +7 tests |

## 每阶段工作流

1. 回到代码复核该发现仍然成立（引用行号）。
2. 设计修复：优先收敛到 shared 包单实现，保持 CPU/GPU 公式同源。
3. 实施修改（遵循现有代码风格，无注释原则按仓库惯例——本仓库注释密集，保留并更新受影响的注释）。
4. 新增/更新 `tests/` 下针对性测试。
5. 全量 `npx jest --config tests/jest.config.js` 回归。

## 测试策略（非烟测）

- **数值一致性**：固定参数集在 CPU float / CPU 8-bit / GLSL（正则转译执行）三路径输出逐点比对（沿用 04-algorithm-consistency 的模式扩展）。
- **契约**：ComputeService smart* URL 集合 vs COMPUTE_ROUTES 双向匹配；参数序列化往返（serialize→deserialize→serialize 恒等）。
- **回归**：迁移函数 v1/v2 真实输入执行路径断言；splitTone 权重和≡1 全 luminance 扫描；HSL 过渡带权重和=1；profile 回退在 normalize/uniforms 两端的有效性。
- **边缘检测**：合成图像（已知矩形）端到端检测精度断言。

## 进度日志

- 2026-07-21 基线：41 suites / 452 tests 通过。
- 2026-07-21 Phase A（渲染一致性）完成：+27 tests → 479。对比度 ×2.55 三路径统一、splitTone 单位分解、HSL satRamp 连续、film profile 回退修复、曲线除零防护。
- 2026-07-21 Phase B（路由契约）完成：+11 tests → 490。COMPUTE_ROUTES 补齐 export/render-positive、能力探测负缓存、预览请求序号、GPU 结果校验、batch 进度修正。
- 2026-07-21 Phase C（预览冻结）完成：+17 tests → 507。paramsEqual 重写为全字段序列化比较（SSOT 收敛到 packages/shared/paramSerializer）；webglParams memo 加入 filmCurveProfiles。
- 2026-07-21 Phase D（数据完整性）完成：+19 tests → 526。版本迁移顺序修复、aqua→cyan 不再覆盖、createDefaultParams 深拷贝工厂、buildExportParams 深合并、自动裁剪坐标变换模块 + 接线、rectangleFinder 角点排序。
- 2026-07-21 Phase E（健壮性）完成：+11 tests → 537。parseCubeLUT 收敛到 shared 并加完整校验、Canny 滞后连接改 BFS 洪泛、Hough NMS θ 环绕、mergeLines ρ 符号规范化、blob URL 生命周期、CPU 路径旋转崩溃守卫、LUT 上传错误捕获。
- 2026-07-21 Phase F（性能）完成：+5 tests → 542。renderBuffer 单循环（tiff16 不再 ×2 计算）、buildFragmentShader highp + isGL2 实际上下文检测。
- 2026-07-21 Phase G（types.d.ts 对齐）完成：+8 tests → 550。重写 types.d.ts 与运行时一致（baseMode/inversionMode 枚举、DensityLevels 嵌套结构、ratioMode 含 original、FilmCurveParams Q13、UseHistogramReturn 实际签名）。
- 2026-07-21 Phase H（死代码清理）完成：删除 LutManager.jsx / ExportQueuePanel.jsx / useHistogram.js（均无外部引用），hooks/index.js 移除 useHistogram re-export。
- 2026-07-21 Phase I（线性域反转）完成：+10 tests → 560。color-space 负值 clamp 修复；RenderCore 新增 linearDomainInversion opt-in 参数（默认 false 向后兼容），片基校正+反转在线性光下进行；RFC 文档 08-rfc-linear-domain-inversion.md；**视觉验证（vision agent 分析合成负片对比图）确认线性域反转色调平衡显著优于 gamma 域**。
- 2026-07-21 Phase J（大图导出分块让步）完成：+4 tests → 564。抽出 SSOT packages/shared/renderChunked.js（processBlock/processCanvasChunkedSync），客户端 async wrapper 复用并周期性 setTimeout 让出主线程；localCpuRender/导出路径切换至 async 版本。
- 2026-07-21 Phase K（P4 收尾）完成：+7 tests → 571。pipeline 直方图依赖修复、getPhotoImageUrl SSOT 合并、TypedArray 类型保留、WebGL LUT 脏标记缓存、disposeWebGL API、视觉验证 4×4 网格图。
- 2026-07-21 Phase L（最终遗留）完成：+8 tests → 579。
  - GPU shader 线性域反转实现：colorMath.js 新增 srgbToLinear/linearToSrgb GLSL 函数（IEC 61966-2-1，与 CPU 数值等价）；uniforms.js 声明 u_linearDomainInversion；shaders/index.js main 在 ②/③ 周围用标志控制 srgb↔linear 转换。CPU↔GPU 契约测试验证。
  - FilmLabCanvas split 对比修复：原图 canvas 宽度改为容器宽度的倒数倍（`100/compareSlider%`），不再被裁剪容器压缩，与右侧处理图对齐。
  - FilmLab.jsx undo/redo 完整快照：captureSnapshot/applySnapshot 涵盖全部参数（含 LUT/HSL/splitToning/saturation/baseMode/baseDensity/densityLevels/inversionMode/filmCurve），旧实现漏存半数参数的 bug 修复。
  - **最终视觉验证（6×3 网格图）**：默认恒等、gamma/线性反转对比（线性域色调更平衡，GPU↔CPU 对齐）、曝光+对比度、HSL 红饱和、分离色调（无 banding）——全部通过，无 bug 征兆。
- 最终：53 suites / **579 tests 全部通过**（基线 452 → 净增 127 个非烟测），ESLint 0 errors，客户端 JSX 语法检查通过。

## 最终视觉验证（Phase L，6×3 网格）

vision agent 分析 `/tmp/opencode/final-verify.png`：
- 行0 默认：肤色/天空蓝/灰梯度保持原色，灰梯度中性无色偏 ✓
- 行1 vs 行2（gamma vs 线性反转）：行2（线性域）色调明显更平衡，肤色反转后偏色显著减少 ✓
- 行3 曝光+对比度：整体变亮、对比增加，无高光裁切 ✓
- 行4 HSL 红饱和+50：仅列0肤色变红，列1/2 基本不受影响 ✓
- 行5 分离色调：高光偏暖、阴影偏冷，过渡平滑**无 banding**（Phase A 单位分解修复确认）✓
- 整体：无纯黑/纯白/花屏/色带断层，管线表现正常 ✓

## 视觉验证（Phase I）

合成"带橙色色罩的负片梯度图"，分别用 gamma 域 / 线性域反转生成对比 PNG，经 vision agent 分析：
- gamma 域反转：明显蓝色偏色，梯度生硬。
- 线性域反转：色调明显更接近中性灰，蓝色偏色大幅减轻，梯度过渡更平滑，整体亮度更合适。
结论：opt-in 线性域反转在色调平衡上显著优于 gamma 域，与 darktable negadoctor / RawTherapee filmnegative 的业界实践一致。

## 新增的共享模块（SSOT 收敛）

- `packages/shared/paramSerializer.js` — 渲染参数稳定序列化（替代各路径散落的 paramsEqual）
- `packages/shared/autoCropCoord.js` — 自动裁剪坐标系重映射（纯函数，可测试）
- `packages/shared/lutParser.js` — 3D LUT 解析（客户端/服务器共用，带校验）
- 客户端 `utils.js` 对上述三者 re-export，保持 API 不变

## 完成状态

**所有审查发现的问题已修复**（Phase A–L 全部完成）。无算法性遗留。

## 未来可选优化（非 bug，已记录供后续迭代）

- 性能：WebGL uniform location 缓存（每帧 ~45 次 getUniformLocation 可减至 program 重建时）、曲线纹理脏标记缓存（同 LUT 模式）。
- 性能：WebGL2 sampler3D 原生 3D 纹理路径（当前 WebGL1 packed 2D，精度 8-bit）。
- 架构：FilmLab.jsx（2666 行）拆分为更细粒度子组件 + useReducer 统一状态 dispatch（消除 30+ 个独立 useState 的 deserialize 开销）。
- 架构：直方图计算独立组件化 + React.memo（消除每帧 setHistograms 致全面板重渲染）。
- 文档：GPU shader 线性域反转的黄金图 PSNR 回归（CPU 已契约验证，端到端 fixture 待补）。

