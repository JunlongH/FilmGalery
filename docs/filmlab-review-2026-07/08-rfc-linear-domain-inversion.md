# RFC: 线性域负片反转（linearDomainInversion）

## 状态

已实现 CPU 路径（`RenderCore.processPixelFloat`），opt-in（默认 `false` 保持现有观感）。
GPU shader 路径未实现（uniform `u_linearDomainInversion` 已透传，待 shader 端补全）。

## 背景

审查（`01-negative-inversion.md`）与开源参照分析（`07-open-source-references.md`）确认：
当前 FilmLab 的负片反转与片基（橙色色罩）校正在 **gamma 编码的 sRGB 域**进行，
而 darktable negadoctor 与 RawTherapee filmnegative 均在**线性 RGB 域**操作。

gamma 域反转的问题：
- 密度 `D = -log10(T)` 应作用于线性透射率 `T`，gamma 值的 log 不是物理密度。
- `1 - v`（线性反转）在 gamma 域中是感知不对称的：中灰反转后 tonal 响应偏移。
- 与服务器端渲染（若引入线性化）结果不一致。

## 设计

新增参数 `linearDomainInversion: boolean`（默认 false）。当为 true 时，`processPixelFloat`
仅包装三个步骤：

```
① Film Curve (sRGB 域，不变)
   ↓ srgbToLinear
② Base Correction (线性域，密度计算物理正确)
②.5 Density Levels (线性域)
③ Inversion (线性域，1-v 是真正的线性补数)
   ↓ linearToSrgb
③b 3D LUT / ④ WB / ⑤ Tone (sRGB 域，保持现有观感)
```

### 为何只包装 ②/②.5/③

- ① Film Curve 是风格化密度模型，本就在"伪密度"上操作，保留 sRGB 域不改变现有胶片模拟。
- ③b+（LUT、WB、Tone）是显示域调色，业界惯例在 sRGB/display 域，无需线性化。

### 数值验证（tests/15-phaseI-linear-inversion.test.js）

- color-space 往返误差 < 1e-9，负值 clamp，单调。
- 线性域反转下中性灰三通道对称（核心视觉性质）。
- 橙色色罩 log 域校正后三通道平衡（色偏收敛）。
- 默认 false 时输出与未加参数完全一致（向后兼容）。
- true/false 输出在中灰处数值不同（证明转换层生效）。

## GPU shader 实现路线（待办）

`shaders/index.js` 的 main 需在 ② 前插入 `c = srgbToLinear(c)`、③ 后 `c = linearToSrgb(c)`，
受 `u_linearDomainInversion` 控制。需在 `shaders/colorMath.js` 补 `srgbToLinear`/`linearToSrgb`
GLSL 函数（幂函数精确实现，非近似）。

## 启用策略

建议先作为"实验性"选项暴露给高级用户，收集对比反馈后再决定是否设为默认。
切换不会破坏已存预设（字段缺省 = false）。
