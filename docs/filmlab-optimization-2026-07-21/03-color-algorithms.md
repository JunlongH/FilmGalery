# 03 · 色彩算法与数据完整性详细问题

## P0 — 数据校验

### P0-9 validateExportParams 跳过 splitToning + HSL NaN 过关
`filmLabExport.js:230-330` 校验覆盖 tone/WB/curves/saturation/HSL，但 splitToning 完全未校验。`filmLabSplitTone.js` 已导出 validateSplitToneParams 但未被调用。HSL 校验 `hsl.hue < -180 || hsl.hue > 180` 对 NaN 返回 false（NaN 静默通过）。

**建议**：
```js
if (params.splitToning) {
  const stResult = validateSplitToneParams(params.splitToning);
  errors.push(...stResult.errors.map(e => `splitToning.${e}`));
}
// HSL 校验前置 typeof/Number.isFinite
```

### P0-10 hasParamsDifference 用 JSON.stringify（键序敏感）
`filmLabExport.js:478,483,488` `JSON.stringify(p1.curves) !== JSON.stringify(p2.curves)` 按对象自身属性插入序输出。mergeDeep 后嵌套对象键序取决于输入顺序，语义相等的参数误报差异 → 不必要重渲染。

**建议**：改用 `stableSerializeParams`（仓库已有，递归排序键）。

### P0-11 mergeDeep 数组引用泄漏
`filmLabExport.js:178-193` 注释称"数组按索引合并"，实际 `dst[key] = sv` 整体替换且 sv 是 src 数组引用——返回 params 中 curves.rgb 与输入共享同一数组。调用方修改返回值污染输入。

**建议**：
```js
} else if (Array.isArray(sv)) {
  dst[key] = sv.map(item => (item && typeof item === 'object' ? { ...item } : item));
}
```

## P1 — 死代码/SSOT

### P1-27 filmLabExport DEFAULT_HSL_PARAMS/SPLIT_TONING 重复定义 + dead import
`filmLabExport.js:22-23` 导入 HSL_CANONICAL_DEFAULTS/SPLIT_TONE_CANONICAL_DEFAULTS 但从未使用。模块内又定义本地 DEFAULT_HSL_PARAMS（:33-42）和 DEFAULT_SPLIT_TONING（:45-50），值相同但独立对象。若 filmLabHSL.js 更新 DEFAULT_HSL_PARAMS 此处不同步。

**建议**：删除本地定义，直接用 canonical 导入。

### P1-28 filmLabInversion 片基校正 3 份实现
- 8-bit CPU：filmLabInversion.applyLogBaseCorrectionRGB（0-255 域，round+clamp）
- Float CPU：RenderCore.js:315-338 内联重写（0-1 域，无 round）
- GPU：shaders/baseDensity.js GLSL

float 路径注释称"linearDomainInversion 下 T 已是线性透射率"，但 8-bit 路径在 sRGB 域做同样计算——两路径密度定义域不同但用相同公式，linearDomainInversion 开关隐式改变片基校正物理含义。

**建议**：filmLabInversion.js 新增 applyLogBaseCorrectionFloat(value_0_1, density)，RenderCore 调用它，消除内联。明确文档域。

### P1-30 filmLabWhiteBalance Y 保持块死代码
`filmLabWhiteBalance.js:107-159` 注释声称"von Kries 色度适应 + Y 通道保持"，但 Y=1.0（:99）→ Y_original 恒为 1.0 → r_chroma×1.0×3.0 → max 归一化。整个块恒等于 max 通道归一化，与 von Kries 无关。3.0 系数被 max 归一化抵消。

**建议**：删除 107-159，保留 :103-105 XYZ→sRGB + :157-159 负值 clamp。亮度补偿已在 computeWBGains:257-264 完成。

### P1-32 filmLabConstants DEFAULT_BASE_CORRECTION/DEFAULT_BASE_GAINS 死导出
`filmLabConstants.js:60-72,196-215` 全仓库无 require。filmLabExport.js 自行内联定义。

**建议**：删除，或让 filmLabExport 改用。

## P2 — 算法健壮性

### P2-1 HSL 通道权重不构成单位分解（弱响应区）
`filmLabHSL.js:23-32` 相邻通道 range 之和 ≠ 中心距：
- yellow(60,range=30) + green(120,range=45)：中心距 60，range 和 75 → 重叠不足
- h=90 处：yellow=0（距离=30≥range），green=0.25（t=0.667）→ 总权重 0.25
- 用户设 green.hue=180，在 h=90 只生效 25%

类似缺口在 purple(280,30)→magenta(330,30) 的 h=300。代码仅对 totalWeight>1 归一化，<1 不补偿，弱区调整强度比中心弱 4 倍。

**建议**：调整 range 使相邻和=中心距（yellow range→45 或 green range→30），或归一化时 `除以 max(1, totalWeight)`。

### P2-2 tint 轴线性近似与 temp 耦合
`filmLabWhiteBalance.js:230-233` tint 用固定增益系数（0.15/0.30/0.15）线性近似，不随 temp 变化。极端色温下 tint 效果被 Rec.709 亮度补偿部分抵消。

**建议**：tint 转 CIE xy 平面色度偏移，与 temp 在 XYZ 合并后一次性转 RGB。或至少让 tint 增益随 targetKelvin 缩放。

### P2-3 对比度公式除零风险
`filmLabToneLUT.js:44-45` ctr>259（绕过 validateExportParams 直接调用 buildToneLUT）时除零/负分母。

**建议**：`const ctr = Math.max(-258, Math.min(258, ...*2.55))`。

### P2-4 paramSerializer TypedArray 采样哈希漏检
`paramSerializer.js:24-31` 3D LUT（33³，length=107811）step=1684，仅采样 64 点。单像素差异未采样位置 → false equality → 缓存命中 → 渲染旧结果。

**建议**：基于 LUT 元信息（文件名+大小+完整内容哈希），或采样含首尾+随机固定位置。

### P2-5 autoCropCoord 90° 旋转未处理非方形宽高比
`autoCropCoord.js:75-106` UV 空间绕中心旋转 90° 假定方形。非方形图（3:2）旋转后归一化坐标看似合理但映射回像素宽高比错误。

**建议**：旋转 90°/270° 引入 aspectRatio = imgWidth/imgHeight，对 y 做缩放后旋转再还原。

### P2-6 autoCropCoord extraDeg 冗余计算
`autoCropCoord.js:62-68` `extraDeg = newClientRotation + rotationOffset = detectedRotation - orientation - rotationOffset + rotationOffset = detectedRotation - orientation`。rotationOffset 恒抵消，注释错误。

**建议**：直接 `extraDeg = (detectedRotation||0) - orientation`，重新推导是否需要 rotationOffset。

### P2-7 filmLabInversion invertLog float 版本在 linear 域物理错误
`filmLabInversion.js:52` vs `RenderCore.js:351`：float 版本 `1.0 - Math.log(r*255+1)/log256` 在 linearDomainInversion=true 时对线性光 r 做 r*255+1，把线性光当 sRGB 值——物理错误。

**建议**：invertLog float 版本明确仅 sRGB 域使用，或 linearDomainInversion 时改用线性反转（1-r）。

### P2-8 filmLabCurve gamma 未校验非零
`filmLabCurve.js:86,126` gamma=0 时 pow(densityNorm,0)=1，输出恒定。buildExportParams 不校验 gamma 范围。

**建议**：`const safeGamma = Number.isFinite(gamma) && gamma > 0.1 ? gamma : 0.6`。

### P2-9 filmLabSaturation float 版本强 clamp 不兼容 HDR
`filmLabSaturation.js:42-45` clamp[0,1] 在 linearDomainInversion=true 时截断 HDR 线性光。

**建议**：增 applySaturationLinear 不做 clamp 变体，或文档明确仅 sRGB 域。

### P2-10 filmLabHelpers sampleLUT3D 输出未 clamp
`filmLabHelpers.js:274-287` interp 返回 LUT 原始值（可能 >1，HDR .cube），*255 后可能 >255。intensity=1 时直接返回越界值。

**建议**：`Math.max(0, Math.min(255, interp(...)*255))`。

### P2-11 filmLabCurves maxOvershoot 文档声明但未实现
`filmLabCurves.js:36` JSDoc 声明 `@param maxOvershoot=0.05`，函数体从不读取。buildCurveLUTFloat（:256）也不传。

**建议**：实现（样条求值后 clamp 到 [min(y),max(y)]+maxOvershoot*range），或从 JSDoc 移除。

### P2-12 filmLabWhiteBalance solveTempTintFromSample 初始估计与迭代模型不匹配
`:369-378` Phase 1 线性模型解作初始估计，Phase 2 Newton-Raphson 迭代 Kelvin 模型。暖色调区斜率差 40%，初始估计可能落吸引盆地外。

**建议**：Phase 1 改为 Kelvin 模型粗采样查表。

## P3

- filmLabWhiteBalance.js:46 CIE D 边界 7000K 导数连续性注释不准确（混淆 7000K CIE 断点与 6600K Tanner Helland 断点）
- filmLabCurve.js:208 applyFilmCurveRGB 中间 base 对象冗余（gamma 字段永不被使用）
- filmLabCurves.js:256 buildCurveLUTFloat 不传 maxOvershoot
- filmLabHSL.js:386 validateHSLParams 缺 NaN/类型校验
- filmLabSplitTone.js:177 applySplitTone 与 Fast 版代码重复（应直接调 applySplitToneFast(prepareSplitTone(params))）
- filmLabSplitTone.js:395 validateSplitToneParams 缺 NaN/类型校验
- filmLabHelpers.js:175 buildCombinedLUT aData 越界未保护
- paramSerializer.js:17 stableSerializeParams 循环引用无保护（加 WeakSet 或深度限制）
- lutParser.js:53 畸形数据行静默跳过（收集 warning 含行号）
- lutParser.js:31 size 上限 256 过于宽松（256³×3≈192MB，改 128）
- autoCropCoord.js:101 钳制后 w/h 可能为 0（设最小 0.01）
