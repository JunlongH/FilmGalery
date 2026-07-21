# 06 · 执行计划（Phase M–R）

原则延续上一轮：**先暴露再修复**、SSOT、每阶段先复核再改、每阶段后全量测试 + 针对性测试。

## 阶段总览

| 阶段 | 内容 | 对应发现 | 预期 tests |
|---|---|---|---|
| M | 边缘检测测试补齐（先暴露 bug） | P0-12/13/14, P2-4/5/6/7/8 | +20 |
| N | 边缘检测 bug 修复（测试驱动） | P1-33/34/35/36/37/38, P2-1/2/3, P3-1/3/4 | +15 |
| O | 渲染管线 P0/P1 修复 | P0-1/2, P1-15/16/20/21/25/26 | +12 |
| P | 色彩算法与数据 P0/P1 修复 | P0-9/10/11, P1-27/28/30/32, P2-1/3/7/8/10 | +10 |
| Q | UI P0/P1 修复 | P0-3/4/5/6/7/8, P1-17/18/19/22/23/24, P1-29/31 | +15 |
| R | 健壮性/UX P2 + 死代码清理 P3 | P2 全部 + P3 全部 | +8 |

总预期：~80 个新测试，579 → ~660。

---

## Phase M — 边缘检测测试补齐（先暴露 bug）

**目的**：detectEdges 主入口零测试，先补测试暴露 P1-N 的 bug，再在 Phase N 修复。

### M.1 新建 tests/19-edge-detection-e2e.test.js
- 合成 200×200 黑底+中央 150×150 白矩形 → detectEdges → 断言 cropRect/confidence/rotation
- 合成纯白图（无边框）→ confidence<0.2、cropRect≈{0,0,1,1}
- 合成旋转 10° 矩形 → |rotation-10|<2
- 合成 35mm (3:2) + filmFormat:'35mm' → aspect∈[1.4,1.6]
- 注：部分断言会失败（暴露 P1-33/34/35/37/38 bug），用 `test.failing` 标记或 `xit` 跳过待 Phase N 修复

### M.2 新建 tests/20-edge-utils.test.js
- normalizeRect({x:-10,y:-10,w:2000,h:2000},1000,1000) → 断言 x+w≤1（**预期失败**，暴露 P1-36）
- lineIntersection 平行线→null、垂直线→正确交点
- calculateIoU 包含/相离/部分重叠

### M.3 新建 tests/21-edge-internals.test.js
- isResultValid 全 7 分支覆盖（含 P1-37 全图+高置信度放行的 bug 断言）
- classifyLines θ∈{0,π/2,π,3π/2,...}（**3π/2 预期失败**，暴露 P1-33）
- findBestRectangle 构造 4 条线 → 断言 rect
- computeRectangleFromCorners rotation=0 和 rotation=10
- findRectangleByDensity 构造密度边缘
- getExpectedAspectRatio('120') 不回退 auto（**预期失败**，暴露 P1-38）
- getThresholdsFromSensitivity(0/50/100) 边界值
- mergeLines 合并后 θ/rho 数值断言（**0/2π 边界预期失败**，暴露 P1-34）

### M.4 扩展 tests/12-phaseE-robustness.test.js
- L100-104 后加 `expect(top.rho).toBeCloseTo(25, 0)`
- L107-115 后加 `expect(merged[0].rho).toBeCloseTo(100, 1)` + `theta<π/4`

**预期**：~20 个新测试，其中 ~8 个预期失败（标记 failing/skip），Phase N 修复后取消标记。

---

## Phase N — 边缘检测 bug 修复（测试驱动）

### N.1 classifyLines 3π/2 漏分类（P1-33）
`houghTransform.js:174` 改环形距离判定，取消 M.3 的 failing 标记。

### N.2 mergeLines 环形均值（P1-34）
`houghTransform.js:127` 改 atan2 环形加权均值，取消 M.3/M.4 的 failing 标记。

### N.3 findRectangleByDensity fallback 接线（P1-35）
`index.js:113` findBestRectangle 返回 null 后调用密度法。

### N.4 normalizeRect x+w≤1 保证（P1-36）
`utils.js:244` 末尾加 `if (x+w>1) w=1-x`，取消 M.2 的 failing 标记。

### N.5 isResultValid 重写 + borderDetected 标志（P1-37）
`index.js:182` detectEdges 返回加 `borderDetected`，isResultValid 据此判定，删除 L213-219 死分支。取消 M.3 的 failing 标记。

### N.6 '120' 格式补别名（P1-38）
`index.js:66` formats 表补 '120'（取 0.9-1.4 范围），取消 M.3 的 failing 标记。

### N.7 computeRectangleFromCorners 旋转路径（P2-1）
`rectangleFinder.js:328` |rotation|≥5 返回 min/max 包围盒（与 <5 统一），额外返回 corners。

### N.8 confidence 量纲拆分（P2-2）
`rectangleFinder.js:85` 拆 borderStrength + geometricFit，删除任意 1000 除数。

### N.9 toGrayscaleEnhanced 性能+算法（P2-3）
`utils.js:47` 单 pass 计算三策略指标（不存全图），选最优后第二 pass 只分配 1 个 Float32Array。

### N.10 Sobel 行指针优化（P3-1）
`cannyEdge.js:27` 缓存三行指针+循环展开。

### N.11 console.log 副作用（P3-3）
`index.js` + `isResultValid` 引入 opts.verbose 或 logger，默认静默。

### N.12 findPeaks 边界（P3-4）
`rectangleFinder.js:447` 循环扩到 [0,n-1]，端点单侧比较。

**预期**：M 的 ~8 个 failing 标记全部取消（变 passing），+15 个新测试覆盖修复路径。

---

## Phase O — 渲染管线 P0/P1 修复

### O.1 WebGL2 LUT 失效（P0-1）
统一只走 WebGL1 packed-2D 路径（删除 shaders/index.js WebGL2 LUT 分支），或客户端按 isGL2 用 texImage3D。统一命名（u_useLut3d vs u_hasLut3d）。

### O.2 disposeWebGL 接入（P0-2）
`useFilmLabRenderer.js:205` 清理 effect 调 `disposeWebGL(canvas)`；image 变化 effect 也调。

### O.3 uniform location 缓存（P1-15）
`FilmLabWebGL.js:331` `if (!cache.locs) { cache.locs = {}; ...填充... }`。

### O.4 曲线纹理脏标记（P1-16）
`FilmLabWebGL.js:480` 缓存 cache.curveRef = arr；texParameteri 只在 createTexture 后调；预分配 Uint8Array。

### O.5 u_linearDomainInversion 绑定（P1-20）
`FilmLabWebGL.js:335` 加 location + gl.uniform1f；修正 RenderCore.js:727 过期注释。

### O.6 图像纹理脏标记（P1-21）
`FilmLabWebGL.js:320` `if (cache.imageRef !== image)`。

### O.7 RenderCore 死代码删除（P1-25）
删除 _applyFilmCurveFloat/_sampleCurveLUTFloat/getHSLGLSL/getSplitToneGLSL（~300 行）。

### O.8 GLSL 死函数清理（P1-26）
baseDensity/inversion/filmCurve 模块：删函数 main 调函数，或删函数保留内联。

### O.9 测试
- O.1: WebGL2 LUT 路径字符串断言（含 u_useLut3d 统一）
- O.2: disposeWebGL 调用契约（mock canvas + WeakMap）
- O.3: uniform location 缓存命中（mock gl.getUniformLocation 计数）
- O.7: RenderCore 死代码删除后 exports 不含已删方法
- O.8: shader 字符串不含已删函数

**预期**：+12 个新测试。

---

## Phase P — 色彩算法与数据 P0/P1 修复

### P.1 validateExportParams 补 splitToning + NaN 校验（P0-9）
`filmLabExport.js:230` 调 validateSplitToneParams；HSL 前置 typeof/Number.isFinite。

### P.2 hasParamsDifference 改 stableSerializeParams（P0-10）
`filmLabExport.js:478` 替换 JSON.stringify。

### P.3 mergeDeep 数组深拷贝（P0-11）
`filmLabExport.js:178` 数组 sv.map(item => item&&typeof==='object' ? {...item} : item)。

### P.4 filmLabExport 用 canonical 默认值（P1-27）
删除本地 DEFAULT_HSL_PARAMS/SPLIT_TONING，用 HSL_CANONICAL_DEFAULTS/SPLIT_TONE_CANONICAL_DEFAULTS。

### P.5 片基校正 SSOT（P1-28）
filmLabInversion.js 新增 applyLogBaseCorrectionFloat，RenderCore 调用，消除内联。

### P.6 WB Y 保持块删除（P1-30）
`filmLabWhiteBalance.js:107-159` 删除，保留 :103-105 + :157-159，如实注释。

### P.7 filmLabConstants 死导出删除（P1-32）
删除 DEFAULT_BASE_CORRECTION/DEFAULT_BASE_GAINS。

### P.8 HSL 通道权重单位分解（P2-1）
调整 range 使相邻和=中心距，或归一化 `除以 max(1, totalWeight)`。同步 GPU hslAdjust.js。

### P.9 对比度除零防护（P2-3）
`filmLabToneLUT.js:44` ctr clamp [-258, 258]。

### P.10 gamma 校验非零（P2-8）
`filmLabCurve.js:86` safeGamma = Number.isFinite(gamma)&&gamma>0.1 ? gamma : 0.6。

### P.11 sampleLUT3D 输出 clamp（P2-10）
`filmLabHelpers.js:274` Math.max(0, Math.min(255, interp(...)*255))。

### P.12 测试
- P.1: validateExportParams 拒绝 NaN/越界 splitToning + HSL
- P.2: hasParamsDifference 键序无关
- P.3: mergeDeep 返回值修改不污染输入
- P.5: applyLogBaseCorrectionFloat 与内联一致
- P.6: WB 输出与删除前一致（max 归一化等价）
- P.8: HSL 弱响应区权重和≥1

**预期**：+10 个新测试。

---

## Phase Q — UI P0/P1 修复

### Q.1 取色器边缘越界（P0-3）
`FilmLab.jsx:961,1024` Math.min(canvas.width-3, ...)。

### Q.2 savePreset 完整参数（P0-4）
抽 serializeAllParams SSOT，captureSnapshot/currentParams/savePreset 统一调用。

### Q.3 applyGeometry 补 rotationOffset（P0-5）
`CpuRenderService.js:86` + (params.rotationOffset||0)。

### Q.4 'x' 快捷键过滤输入框（P0-6）
`FilmLab.jsx:2479` tagName 检查。

### Q.5 renderOriginal 依赖补 rotationOffset（P0-7）
`FilmLab.jsx:740` 依赖数组加。

### Q.6 downloadClientJPEG filmCurve 完整（P0-8）
抽 resolveFilmCurveParams memo（含 Q13 全字段），4 处统一调用。

### Q.7 histograms 拆分（P1-17）
提取 HistogramContext + useSyncExternalStore，processImage 写 store，ToneCurveEditor 订阅。

### Q.8 buildRenderCoreParams SSOT（P1-18）
抽函数，4 处调用。

### Q.9 CpuRenderService 常量从 shared 导入（P1-22）
删除本地 EXPORT_MAX_WIDTH/PREVIEW_MAX_WIDTH。

### Q.10 ToneCurveEditor memo（P1-23）
getHistogramPath/getCurvePath useMemo。

### Q.11 SliderControl 全局监听器（P1-24）
单全局 mousedown/mouseup + context。

### Q.12 hooks 删除（P1-29）
删除 useFilmLabState/useFilmLabRenderer/useFilmLabPipeline（1062 行死代码，schema 不兼容）。

### Q.13 ComputeService local* 抽通用函数（P1-31）
抽 localRender({photoId,params,sourceType,previewMode,outputFormat,uploadFn})。

### Q.14 测试
- Q.2: serializeAllParams 字段完整性
- Q.3: applyGeometry 含 rotationOffset
- Q.6: resolveFilmCurveParams 含 gammaR/G/B/toe/shoulder
- Q.9: CpuRenderService 不含本地 EXPORT_MAX_WIDTH 定义
- Q.12: hooks/ 目录删除后无 import 失败

**预期**：+15 个新测试。

---

## Phase R — 健壮性/UX P2 + 死代码清理 P3

### R.1 ComputeService AbortController（P2-1）
所有 fetch 接受 signal，smartFilmlabPreviewLatest 暴露 cancel()。

### R.2 PhotoSwitcher 竞态防护（P2-2）
useEffect 内 AbortController。

### R.3 picker 互斥（P2-3）
收敛为 pickerMode 单 state。

### R.4 图像加载单网络请求（P2-4）
fetch blob → createImageBitmap + getExifOrientation。

### R.5 FilmLabCanvas DPR（P2-5）
canvas.width = rotatedW*dpr; ctx.scale(dpr,dpr)。

### R.6 PhotoSwitcher 快捷键改 Alt（P2-6）

### R.7 FilmLabCanvas drag effect ref 化（P2-7）
useRef 存可变部分，依赖只保留 [dragState]。

### R.8 AutoCropButton AbortController（P2-9）

### R.9 paramSerializer LUT 哈希改进（P2-4 of color）
基于元信息或首尾+随机采样。

### R.10 autoCropCoord 非方形宽高比（P2-5 of color）
90°/270° 引入 aspectRatio。

### R.11 autoCropCoord extraDeg 简化（P2-6 of color）

### R.12 死代码清理（P3）
- math 模块（exposure applyWhiteBalance、tone-curves reinhard/filmicACES、color-space applyGamma/removeGamma）
- edgeDetection 6 个死导出
- FilmLab.jsx filmType/hslKey/splitToneKey/useEffect setInverted(false)
- FilmLabControls onAutoEdgeDetection/require/cycleCompare useCallback
- LutSelectorModal fileInputRef
- shaders applyWhitesBlacks 浮点!=/无条件执行守卫/curves 缩进/SHADER_VERSION bump
- render-buffer writeColor 闭包/16-bit channels 校验
- renderChunked processBlock 手动 clamp 多余/与 renderBuffer 重复
- CpuRenderService canvasToBlob TIFF16 fallback contentType/loadImageToCanvas 超时
- ComputeService batchProcess pool/uploadProcessedResult timeout

### R.13 测试
- R.1: AbortController 取消后 fetch 抛 AbortError
- R.3: pickerMode 互斥
- R.5: DPR 缩放 backing store 像素
- R.9: LUT 哈希漏检改进
- R.10: 非方形图 90° 旋转 cropRect 合理

**预期**：+8 个新测试。

---

## 执行顺序与依赖

```
Phase M（测试补齐，暴露 bug）
  ↓
Phase N（边缘检测修复，测试驱动）
  ↓ （并行）
Phase O（渲染管线） + Phase P（色彩算法）
  ↓ （并行）
Phase Q（UI） + Phase R（健壮性/清理）
  ↓
最终全量测试 + lint + 视觉验证
```

Phase O/P 可并行（不同文件域）。Phase Q/R 可并行。Phase M 必须先于 N（测试驱动）。

## 测试基线

- 当前：53 suites / 579 tests
- Phase M 后：~599（+20，含 ~8 failing 待 N 修复）
- Phase N 后：~614（failing 变 passing，+15 新）
- Phase O 后：~626
- Phase P 后：~636
- Phase Q 后：~651
- Phase R 后：~659
- 最终目标：~660 tests，0 failing

## 视觉验证计划

- Phase O 后：渲染管线网格图（含 LUT 应用、线性域反转 GPU↔CPU 对齐）
- Phase N 后：边缘检测合成图（边框检测、旋转矩形、无边框）
- Phase Q 后：UI 交互截图（split 对比、picker 互斥、histogram 独立更新）
- 最终：综合 6×3 网格验证全管线无回归
