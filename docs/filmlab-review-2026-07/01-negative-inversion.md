# 01 · 负片去色罩逻辑与反转算法

涉及文件：
- `packages/shared/filmLabInversion.js`
- `packages/shared/shaders/inversion.js`、`shaders/baseDensity.js`、`shaders/index.js`
- `packages/shared/render/RenderCore.js`（`processPixelFloat` / `processPixel`）

## 管线顺序（CPU/GPU 一致，正确）

```
① 胶片曲线(H&D) → ② 片基校正(去色罩) → ②.5 密度色阶 → ③ 反转 → ③b 3D LUT → ④ 白平衡 → ⑤ 曝光/对比度/色调
```

色罩在负片域、反转之前去除——顺序物理正确。

## 正确的部分

- 对数域减法 `D_img − D_base`（`filmLabInversion.js:164-182`、`shaders/index.js:160-167`）是去除 C-41 橙色色罩的物理正确模型（色罩为叠加密度）。
- `minT=0.001` 防 log(0)；负密度回卷 T>1 后 clamp 到 1，处理正确。
- `invertLog`（`filmLabInversion.js:50-53`）端点映射 0→1、1→0，单调，数学正确（但属艺术曲线而非物理反转）。
- Density Levels 在密度域逐通道归一化以拉平三层染料响应，思路正确。

## 发现的问题

### [中] 反转在 gamma 编码域进行，非物理正确
`invertLinear`（`filmLabInversion.js:36-38`）与 GPU `1.0 - c`（`shaders/index.js:203-208`）都作用在 sRGB 编码值上；"密度"也是对 gamma 值取 -log10 的**伪密度**，不是线性透射率密度。业界做法（negfix8 等）在线性 RAW 域反转。作为艺术化工具可接受，但需在模块头声明，且是"所见非所得"风险源之一。

### [中] log 模式与 linear 模式数学上等价，却维护 4 份实现
`pow(10, -(D−D_base)) ≡ T/T_base ≡ T×gain`。对数减法 = 除以片基透射率 = 线性增益。重复实现点：
1. `filmLabInversion.js:164-201`（0-255 整数域）
2. `RenderCore.js:301-322`（内联 float 版）
3. `shaders/index.js:160-167`（main 内联 GLSL）
4. `shaders/baseDensity.js`（**死代码**，main 未调用模块函数）

漂移温床，应收敛为单实现。

### [中] Density Levels 的 avgRange 钳制 0.5–2.5 会静默压缩对比度
`shaders/baseDensity.js:79-80`、`RenderCore.js:1010+`：默认 min=0/max=3.0 时 avgRange=3.0 被压到 2.5；真实负片密度范围可超 2.5，钳制悄悄压缩高光。

### [中] Density Levels 与 baseMode==='log' 硬耦合
`RenderCore.js:324, 523, 643`：用户选 linear 片基模式时密度色阶被静默禁用，UI 无提示。

### [低] 胶片曲线在片基校正之前应用
曲线作用于含色罩的伪密度，色罩使各通道曲线工作点偏移不同。作为风格化控制可接受，但与"H&D 密度模型"的注释定位不符。

### [低] GPU log 片基校正无全零跳过分支
CPU 有（`RenderCore.js:301`），GPU 无：纯黑 0 被 `max(c, 0.001)` 抬高，半浮点路径黑位 +1/1000。

## 修复方向

1. 片基校正收敛为单一实现（建议保留线性增益形式，参数推导统一从密度换算 gain = 1/T_base）。
2. 模块头统一声明色彩空间约定："输入为 gamma 编码 sRGB，密度为伪密度"。
3. avgRange 钳制范围扩大或改为可配置；linear 模式下也允许 Density Levels。
4. GPU main 改为调用 baseDensity.js 模块函数，消除死代码与内联副本。
