# 05 · 边缘检测残留问题与测试覆盖缺口

## P0 — 测试覆盖（主入口零测试）

### P0-12 detectEdges 端到端合成图测试缺失
`tests/` 全目录无 detectEdges 测试。没有合成图 fixture 验证整条管线（灰度→模糊→Canny→Hough→findBestRectangle→normalizeRect）。

**建议**：新建 `tests/19-edge-detection-e2e.test.js`：
1. 合成 200×200 黑底 + 中央 150×150 白矩形，调 detectEdges，断言 cropRect 在 [0.1,0.1,0.75,0.75] 附近（±0.05）、confidence>0.3、|rotation|<1
2. 合成纯白图（无边框），断言 confidence<0.2、cropRect≈{0,0,1,1}
3. 合成旋转 10° 矩形，断言 |rotation-10|<2
4. 合成 35mm (3:2) 矩形，传 filmFormat:'35mm'，断言 aspect∈[1.4,1.6]

### P0-13 isResultValid 7 条分支全未测
`index.js:182-238` 7 条分支（L183/191/197/203/213/221/225/231）全部未测。service 以 minConfidence=0.1 调用，默认 0.5，两套阈值都未测。

**建议**：新建测试覆盖：confidence=0.3/minConf=0.5→false；confidence=0.6/cropRect={0.1,0.1,0.8,0.8}/rotation=5→true；confidence=0.95/cropRect={0,0,0.99,0.99}→当前 true（断言此为 bug 或预期）；confidence=0.1/cropRect={0,0,1,1}→true（minConf=0.1）；rotation=20→false；cropRect.x=-0.1→false；cropRect.w=0.05→false。

### P0-14 findBestRectangle 及 15 个子函数零测试
`rectangleFinder.js` 的 findBestRectangle/findBestLinePairs/computePairScore/isValidQuadrilateral/isConvexQuadrilateral/quadrilateralArea/computeRectangleFromCorners（含旋转路径）/findRectangleByDensity/findPeaks 全部无测试。

**建议**：新建测试：
- findBestRectangle：构造 4 条线（2 水平+2 垂直，100×100 矩形边框），断言返回 rect 在预期范围
- isValidQuadrilateral：凹四边形被拒、面积过小被拒、角点超界被拒
- computeRectangleFromCorners：rotation=0 和 rotation=10 两条路径
- findRectangleByDensity：上下左右各一行/列高密度边缘

## P1 — 边缘检测残留

### P1-33 classifyLines 漏掉 θ≈3π/2 方向
`houghTransform.js:174-195` mergeLines 的 norm 将 θ 规范化到 [0,2π)。原 θ≈-π/2 且 ρ>0 的线，norm 后 θ≈3π/2（270°）。classifyLines 只检查 θ≈0、π/2、π，**不检查 3π/2**。近水平线（原 θ∈[-90°,-65°], ρ>0）经 norm 后 θ∈[270°,295°] 被静默丢弃。轻微倾斜底片边框的水平线可能落入此区间 → findBestRectangle 因水平线不足回退 "no borders"。

**建议**：改用环形距离判定：
```js
const d = Math.min(
  angleDifference(theta, 0),
  angleDifference(theta, Math.PI/2),
  angleDifference(theta, Math.PI),
  angleDifference(theta, 3*Math.PI/2)
);
if (d < tol) { /* 0/π→vertical, π/2/3π/2→horizontal */ }
```
添加测试：θ=3π/2 的线断言被分类为 horizontal。

### P1-34 mergeLines 加权平均 θ 未做环形均值
`houghTransform.js:127-161` 加权平均用算术均值 `thetaSum/votesSum`。当两条等价线落在 0/2π 边界两侧（θ₁=0.01, θ₂=6.273），thetaDiff 经短弧=0.02<阈值触发合并，但 avgTheta=π → 表示 x=-100，与输入 x=+100 完全不同。12-phaseE 测试只断言 merged.length===1，不检查 θ/ρ 数值，故 bug 未发现。

**建议**：环形加权均值：
```js
let sumSin=0, sumCos=0;
// each line: sumSin += Math.sin(theta)*votes; sumCos += Math.cos(theta)*votes;
avgTheta = Math.atan2(sumSin, sumCos);
if (avgTheta < 0) avgTheta += 2*Math.PI;
```
添加测试：合并 (θ≈0,ρ=100) 与 (θ≈2π-ε,ρ=100)，断言 merged[0].theta≈0（非 π）、rho≈100。

### P1-35 findRectangleByDensity fallback 未接线
`index.js:113-140` rectangleFinder.findRectangleByDensity 已实现+导出，但 detectEdges 在 findBestRectangle 返回 null 时直接跳过密度法，进入 "no borders" 分支（confidence=0.1）。密度法从未被调用，是生产死代码。

**建议**：findBestRectangle 返回 null 后调用 findRectangleByDensity(edges,width,height)，若命中用其 rect 并赋 confidence=0.4。

### P1-36 normalizeRect 不保证 x+w≤1
`utils.js:244-254` 四个分量独立 clamp 到 [0,1]。computeRectangleFromCorners 旋转路径返回 x=cx-topWidth/2（可负）、w=topWidth（可超界）。经 normalizeRect x→0（clamped）、w→0.8（clamped），但 x+w 可达 1.0+。isResultValid L225 只允许 x+w>1.01 才拒绝。

**建议**：normalizeRect 末尾加：
```js
if (x+w > 1) w = 1-x;
if (y+h > 1) h = 1-y;
if (w < 0) w = 0;
if (h < 0) h = 0;
```
添加测试覆盖负 x、超界 w 输入。

### P1-37 isResultValid 逻辑混乱 + 死分支
`index.js:182-238` 三处重叠"全图放行"分支：L191 confidence<minConfidence→false；L203-210 全图且 confidence<0.2→true；L213-219 近全图且 confidence<0.3→true。当 minConfidence≥0.3 时 L205/L216 的 confidence<0.2/0.3 永不成立（已被 L191 拦截）是死分支。且条件只看几何形状+置信度数值，无法区分"无边框 fallback"与"真实检测到的高置信度全图矩形"——后者（confidence=0.95, w=h=0.99）会到 L237 return true，注释说"允许全图裁剪（无边框情况）"实际放行范围远超该语义。

**建议**：detectEdges 返回结果加显式标志 `borderDetected: boolean`。isResultValid 据此判定：borderDetected=false 走专门"无边框"分支（独立 minConfidence 阈值），borderDetected=true 时全图矩形应触发警告而非静默放行。删除 L213-219 重叠分支。

### P1-38 '120' 胶片格式选项静默失效
`index.js:66-76` JSDoc 声明 filmFormat 接受 'auto'|'35mm'|'120'|'4x5'，但 getExpectedAspectRatio 的 formats 表只有 '120_645'/'120_66'/'120_67'，无 '120' 键。用户传 '120' 时 formats['120']=undefined，静默回退 'auto'（宽松范围 0.5-2.5），宽高比约束完全失效。无测试覆盖。

**建议**：formats 表补 '120'（取 120 系最宽范围 0.9-1.4），或从 JSDoc 移除 '120' 要求显式传子格式。添加 getExpectedAspectRatio 单测覆盖所有声明格式。

## P2 — 边缘检测

### P2-1 computeRectangleFromCorners 旋转路径几何错误
`rectangleFinder.js:328-376` |rotation|≥5 分支返回 `{x:cx-topWidth/2, y:cy-leftHeight/2, w:topWidth, h:leftHeight}`——既非旋转矩形轴对齐包围盒（应是 maxX-minX, maxY-minY），也非内接矩形，而是"以质心为中心、以顶边长为宽、以左边长为高"的居中矩形。对梯形只取 topWidth 忽略 bottomWidth。x/y 可为负，clamp 后中心偏移。无测试。

**建议**：|rotation|≥5 返回 min/max 包围盒（与 <5 分支统一），result 额外返回 corners 供下游透视变换。或返回内接最大轴对齐矩形。添加测试。

### P2-2 confidence 量纲任意未校准
`rectangleFinder.js:85,436` findBestRectangle: `confidence = Math.min(1, score/1000)`，score 由 votes*0.1+areaRatio*500-angleDiff*100-perpAngle*50 拼出，1000 除数无物理意义。findRectangleByDensity 硬编码 confidence=0.5，"no borders" fallback 硬编码 0.1。三套量纲互不校准，isResultValid 阈值（0.5/0.1）拍脑袋。

**建议**：confidence 拆为 borderStrength（边缘像素占周长比例，0-1，可验证）+ geometricFit（角点垂直度/平行度评分，0-1）。confidence = 二者加权或取 min。删除任意除数。

### P2-3 toGrayscaleEnhanced 全图梯度与边框无因果 + 4×内存
`utils.js:47-89,99-114` computeEdgeContrast 在整图采样 Sobel 近似并求和选策略，但"整图梯度强"≠"边框可检测"——高频细节照片 max-channel 策略可能胜出即便边框对比度未提升。性能：同时分配 gray1/gray2/gray3 三个 Float32Array(size)，3×3.84MB=11.5MB 临时分配+3 次扫描，最终只返回 1 个。

**建议**：算法改为只比较边框候选区（外圈 10% 环带）梯度对比度，或固定 BT.601+saturation boost 删除策略选择。性能：单 pass 计算三策略指标（不存全图），选最优后第二 pass 只分配 1 个 Float32Array。内存 3×→1×，扫描 3×→2×。

### P2-4 getExpectedAspectRatio/getThresholdsFromSensitivity 零测试
无测试覆盖 '120' 格式失效（P1-38）和阈值映射边界（sensitivity=0/50/100）。

**建议**：测试 getThresholdsFromSensitivity(0)={low:100,high:200}、(100)={low:30,high:100}、(50)={low:65,high:150}。测试 getExpectedAspectRatio('120') 不应回退 auto。

### P2-5 normalizeRect/denormalizeRect/calculateIoU/lineIntersection 零测试
无 utils 测试。P1-36 的 x+w>1 问题、lineIntersection 平行线处理（det≈0）、calculateIoU 边界情况都无测试。

**建议**：新建 `tests/20-edge-utils.test.js`：normalizeRect({x:-10,y:-10,w:2000,h:2000},1000,1000)→断言 x+w≤1（当前会失败）；lineIntersection 平行线→null；calculateIoU 包含/相离/部分重叠。

### P2-6 Hough/mergeLines 测试不验证合并后数值
`tests/12-phaseE-robustness.test.js:89-115` L100-104 只断言 merged.length 和 top.theta 方向，不验证 top.rho。L107-115 只断言 merged.length===1 和 mergedCount===2，不验证合并后 theta/rho。P1-34 环形均值 bug 因此未暴露。

**建议**：L100-104 后加 `expect(top.rho).toBeCloseTo(25, 0)`。L107-115 后加 `expect(merged[0].rho).toBeCloseTo(100, 1)` 和 `expect(merged[0].theta).toBeLessThan(Math.PI/4)`。

### P2-7 classifyLines 零测试
P1-33 的 3π/2 漏分类因无测试未发现。

**建议**：测试 θ∈{0,π/2,π,3π/2,0.1,π/2+0.1,3π/2+0.1} 的线，断言分类正确。测 tolerance=25 与 35。

## P2 — 可测试性

### P2-8 detectEdges 非纯函数，中间结果不可观察
`index.js:85-162` 78 行 monolithic 函数，混合灰度/模糊/Canny/Hough/矩形查找/归一化/console.log/debugInfo。中间结果（edges、lines）仅在 returnDebugInfo=true 时暴露 edgePixelCount 和 linesDetected（两个标量），不暴露实际数组。测试只能断言最终 cropRect，无法断言"Canny 检测到 N 条边"。

**建议**：提取纯函数 `detectEdgesPipeline(imageData, options)` 返回 `{grayscale, blurred, edges, lines, rectangleResult, cropRect, rotation, confidence}`。detectEdges（公共 API）调用 pipeline 返回当前格式。测试针对 pipeline 断言中间结果。

## P3

### P3-1 Sobel 行指针未优化
`cannyEdge.js:27-53` 内层 3×3 循环每次重算 `data[(y+ky)*width+(x+kx)]` 索引（9 次乘加+9 次寻址）。1200×800 图 ~960K 像素×9=8.6M 索引计算。

**建议**：缓存三行指针+循环展开：
```js
const r0=(y-1)*width, r1=y*width, r2=(y+1)*width;
const gx = -data[r0+x-1]+data[r0+x+1]-2*data[r1+x-1]+2*data[r1+x+1]-data[r2+x-1]+data[r2+x+1];
```
预期 2-3× 提速。

### P3-2 死代码：6 个导出函数从未被调用
- getEdgePoints (cannyEdge.js:202)
- getLineEndpoints (houghTransform.js:217)
- convolve3x3 (utils.js:216) — cannyEdge 自带内联 Sobel
- calculateIoU (utils.js:280) — service 另写 isRectSimilar 重复
- toGrayscale (utils.js:18) — detectEdges 只用 toGrayscaleEnhanced
- arePerpendicular/areParallel/pointToLineDistance (utils.js:345/361/375) — rectangleFinder 自带 angleDiffWrap 内联
- angleDifference (utils.js:329) — 仅被上面死函数调用
- denormalizeRect (utils.js:264) — service 另写同名方法重复

**建议**：删除确认无用导出。calculateIoU/denormalizeRect 标注公共 API 让 service 复用（消除重复）。

### P3-3 detectEdges console.log 副作用
`index.js:109,120-122,139,142` 4 处 console.log + isResultValid 6 处。测试时污染 stdout，生产每张图打日志。纯函数变不纯。

**建议**：引入 opts.verbose 或注入 logger 函数，默认静默。

### P3-4 findPeaks 边界遗漏
`rectangleFinder.js:447-460` 跳过 i=0 与 i=n-1，漏掉位于图像最外缘的边框峰值。

**建议**：循环扩到 [0,n-1]，端点做单侧比较。
