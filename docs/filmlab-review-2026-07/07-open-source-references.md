# 07 · 开源参照库对比分析（2026-07-21）

针对图像处理算法类问题，查阅了以下开源实现作为业界标准参照：

## 1. 负片反转 / 去色罩

### darktable `negadoctor`（src/iop/negadoctor.c，GPL-3.0）
基于 Kodak Cineon 密度计量学：
- **在线性 RGB 域处理**（输入色彩配置之后、display-referred 之前），`description()` 明确标注 "linear, RGB, display-referred"。
- 橙色色罩建模为 **Dmin（片基密度，逐通道）**：彩负默认 Dmin = (1.13, 0.49, 0.27)——正是橙色。去除方式为线性域除法 `density = Dmin / max(pix, THRESHOLD)`（= 密度域减法），与我们 log 域减法**原理一致**。
- 反转隐式完成：`print = ((1 - 10^corrected_density + black) * exposure)^gamma`，配合 paper gamma（默认 4.0）与指数高光滚降（OpenEXR 邮件列表公式）。
- log(0) 防护用 THRESHOLD = 2^-32 EV（远小于我们的 0.001 ≈ -10 EV，黑位保持更好）。
- Dmin 取样指引："measure Dmin from the film edges first"——与我们的 Pick Base 概念相同。

### RawTherapee `filmnegative`（rtengine/filmnegativeproc.cc，GPL-3.0）
- **在线性域处理**（0..65535 float，raw 或工作色彩空间），公式为**幂指数反转**：`out = mult · in^(−exp)`，逐通道指数 `rexp = −(greenExp · redRatio)`。
- 片基参考值估计用**通道中位数 + 20% 边界裁剪**（排除片夹 outliers）——比我们 3×3 单点取样鲁棒得多。
- 参考灰点映射：中位数 → 输出的 1/24。

### 对本项目的结论
| 项 | 本项目 | darktable | RawTherapee | 结论 |
|---|---|---|---|---|
| 处理域 | gamma 编码 sRGB（伪密度） | 线性 RGB | 线性 RGB | **系统性偏差**，文档化并列入长期改造 |
| 色罩去除 | 密度域减法 ✓ | Dmin 除法（≡密度减法）✓ | 幂指数 | 原理正确 |
| log(0) 防护 | 0.001 (D≤3.0) | 2^-32 EV | max(x, 1.f)/65535 | 我们的防护过强，深密度被截断到 3.0 |
| 片基估计 | 单点 3×3 | 区域取样 | 中位数+20% 裁剪 | 应升级为中位数/区域平均 |

## 2. Canny 边缘检测

OpenCV 官方文档（docs.opencv.org/4.x Canny tutorial）确认滞后阈值（hysteresis）的正确语义是**基于连通性**：弱边像素只有与"确定边缘"连通时才保留。OpenCV 实现为栈式洪泛（canny.cpp 中 map/stack 单遍遍历）。本项目 `cannyEdge.js:136-168` 的"全图迭代扫描×10"是错误近似——Phase E 修复方向（显式栈洪泛）与 OpenCV 一致。

## 3. 分离色调

darktable `splittoning`（src/iop/splittoning.c）采用**单 pivot + compress 死区**模型：
- `l < balance − compress` → 阴影色，混合比 `ra = CLIP((balance−compress−l)·2)`；`l > balance + compress` → 高光色；死区内不处理。
- 两侧权重关于 pivot 互补（ra + la = 1），**天然满足单位分解**。

本项目是 Lightroom 风格三区模型（shadow/midtone/highlight），不同范式无需照搬，但 darktable 印证了我们 Phase A 修复的核心原则：**分区权重必须互补守恒（partition of unity）且关于过渡点连续**。我们采用 shadow/midtone 在 [shadowEnd, midpoint]、midtone/highlight 在 [midpoint, highlightStart] 的 smoothstep 互补过渡，`midtone = 1 − shadow − highlight`，全域连续且和≡1。

## 4. 对比度公式

测试套件 `tests/04-algorithm-consistency.test.js`（BUG-11）已将 `contrast × 2.55 → (259(C+255))/(255(259−C))` 定义为规范语义（该公式源自 GIMP/常见图像处理实践，C 域 [-255, 255]）。CPU 两条路径缺 ×2.55 是 bug 方，Phase A 对齐。

## 参考许可说明

darktable 与 RawTherapee 均为 GPL-3.0。本报告仅将其作为**算法原理参照**，不复制代码；本项目相关实现为独立编写，公式层面的数学等价不构成代码复制。
