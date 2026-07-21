# 02 · 图像处理算法（色彩科学模块）

涉及文件：`packages/shared/` 的 `filmLabWhiteBalance.js`、`filmLabCurve(s).js`、`filmLabHSL.js`、`filmLabSplitTone.js`、`filmLabSaturation.js`、`filmLabToneLUT.js`、`filmLabHelpers.js`、`filmLabConstants.js`、`filmLabExport.js`

## 正确的部分（手推/交叉验证通过）

- 样条曲线：Thomas 三对角算法、自然边界条件、Fritsch-Carlson、Hermite 系数、二分查找——全部正确。
- 白平衡：CIE D 系列公式、xyY→XYZ、XYZ→sRGB 矩阵、3500-4000K 混合连续性、增益方向（temp+ → 暖）、Newton-Raphson 求解器（数值 Jacobian、阻尼、收敛判据）——正确。
- `.cube` LUT：R-fastest 索引、三线性插值、WebGL 打包布局与 GLSL UV 公式——CPU/GPU 逐点一致。
- 饱和度和 splitTone 的 GLSL 与 CPU 公式逐分支对齐（除下述问题外）。

## 高严重度

### H1 · 对比度公式 GPU/CPU 差一倍
`shaders/tonemap.js:21` 有 `contrast * 2.55`；CPU 两条路径（`RenderCore.js:374-380`、`filmLabToneLUT.js:43-44`）直接代入原始值。contrast=50 时 CPU factor≈1.48、GPU≈2.96。`RenderCore.js:659` 注释声称 shader 内缩放是"标准公式"，CPU 从未同步。
**修复**：统一两边（选定 ×2.55 语义后三处一致），加一致性测试。

### H2 · 分离色调区权重不守恒且跳变
`filmLabSplitTone.js:101-147`：luminance 进入 `[midpoint-0.1, midpoint+0.1]` 平台时 midtone 强制为 1，但 shadow 残留权重不清零（权重和达 1.283），且边界处不连续——平滑渐变产生可见色带。CPU/GPU 应用顺序相反（CPU: highlight→mid→shadow；GLSL: shadow→mid→highlight，`shaders/splitTone.js` 注释"matches CPU"不成立），lerp 不可交换。
**修复**：改为单位分解（partition of unity）权重，shadow+mid+highlight≡1，顺序即无关。

### H3 · 胶片曲线 profile 回退全路径失效
- `RenderCore.js:100-105` `normalizeParams` 给 `filmCurveGamma/DMin/DMax` 填硬默认 0.6/0.1/3.0，使 CPU 端 `?? profile.gamma` 回退永远失效——portra800 等 profile 的 dMin/dMax/gammaR/G/B 在任何路径都用不到。
- `RenderCore.js:629-635` `getGLSLUniforms` 完全不解析 profile（无 toe/shoulder/gammaR/G/B 回退）。
**修复**：normalizeParams 中这三个字段默认 undefined；getGLSLUniforms 做与 CPU 相同的 profile 解析。

### H4 · 参数版本迁移全是死代码 + aqua→cyan 数据丢失
- `filmLabExport.js:142-145`：`buildExportParams` 先 `params.version = PARAMS_VERSION(=3)` 再 `migrateParams`，`migrateParams` 内读到的永远是 3 → v1→v2、v2→v3 迁移块永不执行。
- `filmLabExport.js:350-366`：`migrateOldHSLFormat` 中 'aqua' 在 'cyan' 之前迭代，aqua 写入 result.cyan 后被 cyan 迭代无条件重写 → 旧数据只有 aqua 时迁移后 cyan 清零。
**修复**：version 盖章移到迁移之后；cyan 迭代时检测数据源再选择映射。

## 中严重度

### M1 · 白平衡
- `filmLabWhiteBalance.js:107-146`："Y 保持"块 Y 硬编码 1.0，数学上恒等于 max 通道归一化，注释声称 von Kries 严重误导。应删除并如实注释。
- `filmLabWhiteBalance.js:257-264`：亮度补偿在组合基础增益之后计算，用户统一增益（red=green=blue=2）被静默归一回 1。补偿应只针对 temp/tint 引起的部分。
- `filmLabWhiteBalance.js:248,257,276`：注释称 Rec.709，系数实为 601（0.299/0.587/0.114）；全项目其他地方（`filmLabSaturation.js:25-27`、splitTone、shader）均 709。luma 定义不统一。
- `filmLabWhiteBalance.js:98-100`：极端色温下 XYZ→sRGB 负值在 clamp 前参与色度归一化。
- Kang 近似外推到 1667K 以下（:79）；solveTempTintFromSample 的极端增益减半处理可能破坏已收敛解（:445-449）。

### M2 · 曲线
- `filmLabCurves.js:57-60`：重复 x 控制点 h=0 除零 → 全 LUT NaN（n=2 分支同样存在）。
- `filmLabCurves.js:30,35`：文档承诺的 `maxOvershoot` 参数从未实现。
- `filmLabCurves.js:114-132`：Fritsch-Carlson 缺 α/β 符号预处理，极端折线仍可能轻微非单调。
- `filmLabCurve.js:79,120`：dMax===dMin 除零。
- `filmLabCurve.js:197-203`：`applyFilmCurveRGB` 忽略逐通道 gamma（profile.gammaR/G/B），与 RenderCore 浮点路径结果不一致。
- `filmLabCurve.js:150-186`：toe/shoulder 的 gamma 变换方向与真实 H&D 物理叙述矛盾（肩部应变平缓而非抬密度）——作为艺术化 S 曲线可用，注释需改写。

### M3 · HSL
- `filmLabHSL.js:243-248`：权重仅在 totalWeight>1 时归一，余弦基函数权重和恒≤1（green/cyan 间仅 0.25），过渡带调整强度稀释 → 均匀调整产生色相依赖 banding。应改用单位分解基函数。
- `filmLabHSL.js:192-210`：s<0.05 灰像素特殊分支硬切换不连续；且 **GPU `hslAdjust.js` 完全没有该分支**——近灰像素 CPU/GPU 结果不同。应统一为连续 satRamp 缩放。
- `filmLabHSL.js:309-335`：`applyHSLToArray` 把 Uint8ClampedArray 转成 Uint8Array，返回类型不一致。

### M4 · 色调 LUT / 饱和度
- `filmLabToneLUT.js:54`：曝光乘法作用在 gamma 编码域，并非注释声称的"摄影档位"（曝光档是线性光概念）。
- `filmLabToneLUT.js:64-72`：shadows/highlights Bernstein 权重在未 clamp 的 val 上计算，val>1 时 highlights 项符号反转。三处实现（shader/float CPU/LUT CPU）各不相同。
- `filmLabSaturation.js:38-46`：strength<-100 无防护 → 负饱和度色度反转。

### M5 · LUT 合并 / 导出参数
- `filmLabHelpers.js:128-196`：`buildCombinedLUT` 不校验两 LUT size 一致（越界错读）；且是"混合"（B 采样在输入格点）而非"复合"（B(A(input))），与串联语义不符。
- `filmLabHelpers.js:314-320`：`normalizeInversionMode` 拒绝 'film'，但 `filmLabConstants.js:92` 注释声明支持——三处口径不一致。
- `filmLabExport.js:78-127`：嵌套默认值全浅拷贝，`DEFAULT_PROCESSING_PARAMS.curves.rgb` 与 `DEFAULT_CURVES.rgb` 共享数组引用——消费方原地修改即污染全局默认值。需 `createDefaultParams()` 深拷贝工厂。
- `filmLabExport.js:135,139`：preset 覆盖为浅合并，部分嵌套对象整体替换丢兄弟字段。
- `filmLabExport.js:22-23`：canonical 默认值死导入，本地重复定义双份真源。
- `filmLabExport.js:260-277`：HSL 校验放 NaN 过关；splitToning 完全未校验；cropRect 无 typeof 检查。
- `filmLabExport.js:132`：preset 字符串 JSON.parse 无 try/catch。

## 低严重度

- `filmLabCurves.js:195-199`：注释称"线性外推"实为常数外推。
- `filmLabConstants.js:48`：CONTRAST_MID_GRAY=0.46 vs 注释推导 0.4586。
- `filmLabSplitTone.js:172-174`：`saturation && saturation!==0` 对 NaN 失效；:390-436 validate 不校验 midtones。
- `filmLabToneLUT.js:60`：whitePoint===blackPoint 静默跳过。
- `filmLabExport.js:424-436`：JSON.stringify 比较对键序敏感。
- 全模块普遍缺失色彩空间声明（输入是 gamma 编码 sRGB 还是线性）——建议模块头统一标注并收敛到 filmLabConstants 单一真源。

## 测试建议（非烟测）

黄金值/一致性用例：contrast=±50 三路径数值比对；具名 film profile 的 gamma/toe/shoulder 在 CPU/GPU uniform 输出中生效；splitTone 权重和≡1 全 luminance 扫描；HSL 过渡带权重和=1；迁移函数 v1/v2 输入的实际执行路径。
