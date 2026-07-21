# 01 · 全部发现按优先级排序

## P0 — 功能性 Bug（立即修复）

| # | 文件:行号 | 问题 | 建议 |
|---|---|---|---|
| 1 | FilmLabWebGL.js:252 + shaders/index.js:215 | WebGL2 模式 3D LUT 完全失效（uniform 名不匹配：`u_hasLut3d`/`u_lut3dSize`/`u_lut3dTex` vs 客户端设置的 `u_useLut3d`/`u_lutSize`/`u_lut3d`） | 客户端按 isGL2 分支绑定正确 uniform；或统一只走 WebGL1 packed-2D 路径；统一命名 |
| 2 | useFilmLabRenderer.js:205 | disposeWebGL 从未被调用（GL 资源全量泄漏） | 在 useFilmLabRenderer 清理 effect 调 disposeWebGL(canvas)；image 变化时也调 |
| 3 | FilmLab.jsx:961,1024 | WB/普通取色器 getImageData 边缘越界 IndexSizeError（只保护下界，未保护上界） | `Math.min(canvas.width-3, ...)` |
| 4 | FilmLab.jsx:375 | savePreset 漏存 baseMode/baseDensity*/densityLevels/rotation/orientation/cropRect/saturation | 抽 serializeAllParams SSOT |
| 5 | CpuRenderService.js:86 | applyGeometry 漏算 rotationOffset | `rotation + orientation + rotationOffset` |
| 6 | FilmLab.jsx:2479 | 'x' 快捷键未过滤输入框 | `if (e.target.tagName === 'INPUT'\|\|'TEXTAREA'\|\|isContentEditable) return` |
| 7 | FilmLab.jsx:740 | renderOriginal effect 缺 rotationOffset 依赖 | 依赖数组加 rotationOffset |
| 8 | FilmLab.jsx:2035 | downloadClientJPEG GPU 路径 filmCurve 漏取 gammaR/G/B/toe/shoulder | 抽 resolveFilmCurveParams memo |
| 9 | filmLabExport.js:230 | validateExportParams 跳过 splitToning + HSL NaN 过关 | 调 validateSplitToneParams + typeof/Number.isFinite 前置校验 |
| 10 | filmLabExport.js:478 | hasParamsDifference 用 JSON.stringify（键序敏感） | 改用 stableSerializeParams |
| 11 | filmLabExport.js:178 | mergeDeep 数组引用泄漏（dst[key]=sv 共享引用） | 数组深拷贝元素 |

## P0 — 测试覆盖（边缘检测主入口零测试）

| # | 文件 | 问题 | 建议 |
|---|---|---|---|
| 12 | tests/ | detectEdges 端到端合成图测试缺失（主入口零测试） | 新建 19-edge-e2e：合成黑底白矩形 fixture |
| 13 | tests/ | isResultValid 7 条分支全未测 | 新建测试覆盖全分支 |
| 14 | tests/ | findBestRectangle 及 15 个子函数零测试 | 新建测试 |

## P1 — 性能/架构

| # | 文件:行号 | 问题 | 建议 |
|---|---|---|---|
| 15 | FilmLabWebGL.js:331 | 每帧 50 次 uniform location 重建（cache.locs 应复用） | `if (!cache.locs) { ...填充... }` |
| 16 | FilmLabWebGL.js:480 | 曲线纹理每帧全量重传 + 16KB 临时分配 | 脏标记缓存（同 LUT 模式）+ 预分配 |
| 17 | FilmLab.jsx:1347 | 每帧 setHistograms 致全面板重渲染 | 提取 HistogramContext / useSyncExternalStore |
| 18 | FilmLab.jsx:1281/1601/1705/2156 | 4 处 new RenderCore({...}) 参数组装重复 | 抽 buildRenderCoreParams |
| 19 | FilmLab.jsx:1123/1756/1850/2035 | 3 处 filmCurve profile 解析重复 + GPU 路径漏字段 | 抽 resolveFilmCurveParams memo |
| 20 | FilmLabWebGL.js:335 | u_linearDomainInversion 客户端从未绑定 | 加 location + gl.uniform1f |
| 21 | FilmLabWebGL.js:320 | 图像纹理每帧无条件重传 | `if (cache.imageRef !== image)` |
| 22 | CpuRenderService.js:18-19 | 本地 EXPORT_MAX_WIDTH=4000/PREVIEW_MAX_WIDTH=1400 与 shared 漂移 | 从 shared 导入 |
| 23 | ToneCurveEditor.jsx:23-94 | getHistogramPath/getCurvePath 每帧重算未 memo | useMemo |
| 24 | SliderControl.jsx:26 | 每实例注册全局 mouseup 监听器（15+ 个） | 单全局监听器 + context |

## P1 — 死代码/SSOT

| # | 文件:行号 | 问题 | 建议 |
|---|---|---|---|
| 25 | RenderCore.js:1024/1153/739-959 | _applyFilmCurveFloat/_sampleCurveLUTFloat/getHSLGLSL/getSplitToneGLSL 死代码 ~300 行 | 删除 |
| 26 | shaders/baseDensity.js/inversion.js/filmCurve.js | GLSL 函数被 main 内联，模块函数未调用（两份等价代码） | 删函数或 main 调函数 |
| 27 | filmLabExport.js:22-50 | DEFAULT_HSL_PARAMS/SPLIT_TONING 重复定义 + canonical import 未使用 | 用 canonical 导入 |
| 28 | filmLabInversion.js:164 + RenderCore.js:315 + shaders/baseDensity.js | 片基校正 3 份实现 | 抽 applyLogBaseCorrectionFloat |
| 29 | hooks/*.js | 1062 行未使用 + schema 不兼容（DENSITY_LEVELS 扁平 vs 嵌套、CURVES 0-1 vs 0-255） | 删除或修复后真正使用 |
| 30 | filmLabWhiteBalance.js:107-159 | Y 保持块死代码（恒等于 max 归一化） | 删除并如实注释 |
| 31 | ComputeService.js:200/298/403 | 三个 local* 函数 90% 重复 | 抽 localRender 通用函数 |
| 32 | filmLabConstants.js:60/196 | DEFAULT_BASE_CORRECTION/DEFAULT_BASE_GAINS 死导出 | 删除 |

## P1 — 边缘检测残留

| # | 文件:行号 | 问题 | 建议 |
|---|---|---|---|
| 33 | houghTransform.js:174 | classifyLines 漏掉 θ≈3π/2 方向 | 环形距离判定 |
| 34 | houghTransform.js:127 | mergeLines 加权平均 θ 未做环形均值（0/2π 边界合并错误） | atan2 环形均值 |
| 35 | index.js:113 | findRectangleByDensity fallback 未接线 | findBestRectangle 返回 null 后调用 |
| 36 | utils.js:244 | normalizeRect 不保证 x+w≤1 | 末尾加 `if (x+w>1) w=1-x` |
| 37 | index.js:182-238 | isResultValid 逻辑混乱 + 死分支 | 加 borderDetected 标志，重写判定 |
| 38 | index.js:66 | '120' 胶片格式选项静默失效（formats 表无 '120' 键） | 补 '120' 别名或修 JSDoc |

## P2 — 健壮性/UX（详见分卷）

- HSL 通道权重不构成单位分解（弱响应区，filmLabHSL.js:23）
- tint 轴线性近似与 temp 耦合（filmLabWhiteBalance.js:230）
- 对比度公式除零风险（filmLabToneLUT.js:44，越界输入 ctr>259）
- paramSerializer TypedArray 采样哈希漏检（paramSerializer.js:24）
- autoCropCoord 90° 旋转未处理非方形宽高比（autoCropCoord.js:75）
- autoCropCoord extraDeg 冗余计算（rotationOffset 恒抵消）
- ComputeService 全部 fetch 无 AbortController（6 处）
- PhotoSwitcher getPhotos 无竞态防护
- 三个 picker 状态非互斥（FilmLab.jsx:58）
- 图像加载双网络请求（Image + fetch EXIF）
- FilmLabCanvas 缺少 DPR 处理（HiDPI 模糊）
- PhotoSwitcher Ctrl+↑/↓ 与系统快捷键冲突
- processPixelFloat 每像素分配数组（render-buffer.js:73）
- prepareLUTs 同时构建 8-bit 和 float LUT（浪费）
- useFilmLabRenderer CPU 回退用 8-bit processPixel（与 float 路径分叉）
- filmLabInversion invertLog float 版本在 linear 域物理错误
- filmLabCurve gamma 未校验非零
- filmLabSaturation float 版本强 clamp 不兼容 HDR
- filmLabHelpers sampleLUT3D 输出未 clamp
- filmLabCurves maxOvershoot 文档声明但未实现
- computeRectangleFromCorners 旋转路径几何错误
- confidence 量纲任意未校准
- toGrayscaleEnhanced 全图梯度与边框无因果 + 4×内存
- FilmLabControls onAutoEdgeDetection 死 prop
- FilmLabControls require 在事件回调内
- FilmLabCanvas drag effect 依赖过长
- FilmLabCanvas isReady 轮询不优雅
- AutoCropButton detectEdges 无 AbortController
- useFilmLabState hasModifications 漏检多数参数
- useFilmLabPipeline 事件依赖表不完整

## P3 — 清理/微优化（详见分卷）

- math 模块死代码（exposure.js applyWhiteBalance、tone-curves.js reinhard/filmicACES、color-space.js applyGamma/removeGamma）
- Sobel 行指针优化（cannyEdge.js:27，预期 2-3× 提速）
- edgeDetection console.log 副作用（index.js 4 处 + isResultValid 6 处）
- edgeDetection 死导出（getEdgePoints/getLineEndpoints/convolve3x3/calculateIoU 等 6 个）
- FilmLab.jsx filmType 死状态
- FilmLab.jsx hslKey/splitToneKey 死字段
- FilmLab.jsx useEffect 强制 setInverted(false) 重复逻辑
- FilmLabControls cycleCompare 未 useCallback
- FilmLabControls DensityLevelsPanel 内联样式重复
- LutSelectorModal fileInputRef 未使用
- LutSelectorModal handleUpload 仅校验扩展名
- shaders applyWhitesBlacks 浮点 != 比较
- shaders applyContrast/WhitesBlacks/HighlightsShadows 无条件执行
- shaders lut3d LINEAR 过滤 + 手动三线性冗余
- shaders index.js curves 块缩进异常
- shaders SHADER_VERSION 未随变更 bump
- render-buffer writePixel 闭包 / 16-bit channels 未校验
- renderChunked processBlock 手动 clamp 多余（Uint8ClampedArray 自动）
- renderChunked 与 renderBuffer 循环重复
- CpuRenderService canvasToBlob TIFF16 fallback 谎报 contentType
- CpuRenderService loadImageToCanvas 30s 超时不可配置
- ComputeService batchProcess 并发控制简单（非真正 pool）
- ComputeService uploadProcessedResult xhr.timeout 不可配置
