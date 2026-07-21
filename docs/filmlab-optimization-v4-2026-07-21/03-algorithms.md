# 03 · 算法问题（16 项）

v3 后首次深入 CPU/GPU 渲染一致性审计，覆盖着色器、数值精度、算法正确性。

---

## P0 — 关键（3 项）

### P0-1 GLSL shoulder bound 0.25 vs CPU 0.5（渲染差异）

- **shaders/filmCurve.js:30 vs filmLabCurve.js:172**
- GPU 着色器使用 `shBound = 1.0 - 0.25 * shoulder`，CPU 路径使用 `shBound = 1.0 - 0.5 * shoulder`。v2 的 "P2-shoulder 修复"只改了 CPU，**着色器未同步**。
- shoulder=0.5 时：GPU threshold=0.875（压缩仅对密度 > 0.875 生效，8-bit 下极少触发），CPU threshold=0.75（覆盖更多像素）。
- **影响**：**WebGL 实时预览的 shoulder 压缩严重不足，用户看到的预览与导出的保存图像不同。**
- **修复**：`shaders/filmCurve.js:30` 将 `0.25` 改为 `0.5`。

### P0-2 WB 亮度补偿 BT.601 vs BT.709（数值不一致）

- **filmLabWhiteBalance.js:228**
- `computeWBGains` 使用 BT.601 权重（0.299/0.587/0.114），但代码注释声称 BT.709。代码库其他模块统一使用 BT.709（filmLabSaturation.js:25 `0.2126/0.7152/0.0722`、filmLabSplitTone.js:55、GLSL colorMath.js:71）。
- BT.601 将绿色权重压低 ~18%（0.587 vs 0.715），暖色 WB 偏移时亮度补偿过度。

| BT.601 | BT.709 |
|--------|--------|
| 0.299 / 0.587 / 0.114 | 0.2126 / 0.7152 / 0.0722 |

- **影响**：暖色 WB 调整（temp=100, tint=0）→ BT.601 补偿约 3.6% 亮度下降，BT.709 约 2.7%。用户感知为"加温后偏暗"。
- **修复**：改为 BT.709（0.2126/0.7152/0.0722），或保留 BT.601 但修正评论。

### P0-3 自定义 film profile CPU 路径丢失

- **RenderCore.js:274 vs FilmLab.jsx:334**
- RenderCore `_prepareFilmCurveContext` 调用 `FILM_CURVE_PROFILES[p.filmCurveProfile]`——仅含**内置** profile（filmLabConstants.js 静态对象）。用户自定义 profile 存储在 React state `filmCurveProfiles`（经 `mergeFilmProfiles` 合并），仅在 WebGL 路径的 `resolveFilmCurveParams` 中可访问。
- **影响**：自定义 profile 的 WebGL 预览正确，但 CPU 路径的 save/export/HQ export 全部回退到 default profile。
- **修复**：RenderCore 构造器接受 `customProfiles` 参数，或传已解析 profile 参数直接。

---

## P1 — 高（4 项）

### P1-1 GLSL saturation 缺负数钳制

- **shaders/saturation.js:28**
- `s = 1.0 + u_saturation / 100.0`——低于 -100 时 s 变负，导致 chroma 反转（色彩极性翻转）。CPU 路径 `filmLabSaturation.js:39` 有 `Math.max(0, ...)`。
- UI 限制 [-100, 100]，但 API/programmatic 调用可触发。

### P1-2 processPixelFloat contrast 无钳制

- **RenderCore.js:456-462**
- `ctr = contrast * 2.55`，分母 `255 * (259 - ctr)`——contrast > 101.57 时 ctr > 259，分母为 0（Infinity）或负（色调反转）。8-bit 路径 `filmLabToneLUT.js:47` 有 `[-258, 258]` 钳制。

### P1-3 processPixelFloat 文档声称线性输入（错误）

- **RenderCore.js:327-330**
- 文档称 "Input: linear-light RGB"，但 ①④⑤⑥⑦⑧ 步全部在 sRGB gamma 域执行。仅 `linearDomainInversion=true` 时 ②③ 步在 linear 域。新增 operaton 容易放错域（如线性色彩矩阵应用到 sRGB 数据）。

### P1-4 GLSL applyFilmCurve dMax==dMin 除零

- **shaders/filmCurve.js:57**
- `float densityNorm = clamp((density - dMin) / (dMax - dMin), 0.0, 1.0)`——无 dRange guard。CPU 路径 `filmLabCurve.js:88` 有 `Math.max(dMax - dMin, 1e-6)`。
- dMax==dMin（自定义 profile 异常值时）：GPU 产生 Infinity→clamp 到 1.0，CPU 归零到 dMin，结果完全不同。

---

## P2 — 中等（5 项）

### P2-1 applyBaseDensityCorrection GLSL 死函数

- **shaders/baseDensity.js:19-52 / inversion.js:18-35**
- 函数声明但从未从主着色器调用，main 使用内联重复代码。可能漂移。

### P2-2 rectangleFinder centerPenalty = 0

- **edgeDetection/rectangleFinder.js:180-181**
- 注释 "暂时不计算"，无中心偏差惩罚。靠近边缘的不规则区域可因更大面积超过真正的居中 film frame。
- **修复**：用线的 rho/theta 近似中点计算 `abs(midX - width/2)/width` 惩罚项。

### P2-3 findBestRectangle sort 副作用

- **edgeDetection/rectangleFinder.js:107-108**
- `horizontal.sort(...)` / `vertical.sort(...)` 直接修改调用方的输入数组。
- **修复**：`.slice().sort(...)`。

### P2-4 gaussianBlur 边界归一化

- **edgeDetection/utils.js:172-178**
- 水平+垂直独立归一化，在角点处重复应用，轻微偏移高斯核的单位和性质（~1-2% 亮度偏差）。

### P2-5 log inversion float vs 8-bit 偏差

- **RenderCore.js:406-409 vs filmLabInversion.js:52**
- float 路径 `r * 255 + 1`，8-bit 路径 `value + 1`。r * 255 非整数时 +1 offset 位置略有不同。最大偏差 ~1-2 LSB（8-bit 域），视觉不可见。

---

## P3 — 低（4 项）

### P3-1 applyFilmCurveLegacy GLSL 死代码

- **shaders/filmCurve.js:72-74** — 直接读 uniform 而非传参，主管线从不使用。

### P3-2 _packHSLParams 硬编码 channel order

- **RenderCore.js:1003** — 复制 `['red', 'orange', ...]` 字符串数组，应引用 `filmLabHSL.HSL_CHANNEL_ORDER`。

### P3-3 filmLabToneLUT Bernstein 文档可读性

- **filmLabToneLUT.js:67-78** — 文档正确但细微（vc clamp vs val increment 不对称是故意的）。

### P3-4 hysteresisThreshold DFS vs BFS

- **cannyEdge.js:137-159** — `stack.pop()` = LIFO（深度优先），标准 Canny 多用 BFS。对结果无影响，纯风格差。
