# 04 · UI 功能代码与自动裁剪/边缘检测

涉及文件：`packages/shared/edgeDetection/*`、`AutoCropButton.jsx`、`FilmLab.jsx`、`FilmLabControls.jsx`、`FilmLabCanvas.jsx`、`useHistogram.js`、`utils.js`、`types.d.ts` 及其余面板组件。

## 高严重度

### U1 · 自动裁剪坐标系断裂（该功能最核心 bug）
服务端在 EXIF 定向后的原图坐标系检测并返回归一化 cropRect；客户端 cropRect 是"总旋转（rotation+orientation+rotationOffset）后包围盒"坐标系。
- `AutoCropButton.jsx:56-60` + `FilmLabControls.jsx:944-956`：直接 `setCropRect(result.cropRect)` / `setRotation(result.rotation)`，未做任何变换；正确 rotation 应为 `检测角 − orientation − rotationOffset`。
- `rectangleFinder.js:336-368` 返回"原图系矩形 + 非零 rotation"，与客户端"旋转后包围盒系 cropRect"数学上不自洽。
EXIF orientation=6/8 或用户已旋转时，自动裁剪必然错位。
**修复**：应用前把检测矩形逆变换到当前总旋转包围盒坐标系，并修正 rotation 计算。

### U2 · rectangleFinder 角点上下判定错误
`rectangleFinder.js:203-212`：用 `h1.rho > h2.rho` 判断上/下，仅 sin(θ)>0 时成立；θ≈-90° 时 ρ=-y，排序恰好相反 → 点序自交 → 凸性检查误杀合法矩形。
**修复**：按交点实际 y 坐标排序角点。

### U3 · Hough θ 轴 ±90° 环绕三处未处理
- `houghTransform.js:61-84`：峰值 NMS 邻域不取模，近水平强线票数分裂到累加器两端 → 水平边框丢失。
- `houghTransform.js:111-146`：mergeLines 加权平均对跨 ±90° 边界的线完全错误（(-89+89)/2=0°）。
- `rectangleFinder.js:183-185`：computePairScore 角度差未环绕（θ=-89° 与 +89° 差值≈3.1 rad 被罚 ~310 分）。
**修复**：统一规范化表示（强制 cosθ≥0，必要时 ρ 取反、θ 减 180°）。

### U4 · Canny 滞后连接截断长边缘
`cannyEdge.js:136-168`：用"全图迭代扫描、最多 10 次"代替标准 BFS/栈洪泛，距强边缘 >~10px 的弱边链被截断。
**修复**：显式栈洪泛（STRONG 全入栈，弹出时提升邻域 WEAK），一次遍历。

### U5 · FilmLab.jsx 预览/资源问题
- :238-243 webglParams 的 useMemo 依赖缺 `filmCurveProfiles`（异步加载），profile 到达后缓存命中旧结果 → 预览不刷新。
- :1164,1230-1287 CPU 路径+旋转拖动：`!webglSuccess && isRotating` 时 data=null → :1251 `data[idx]` TypeError 被 :1302 catch 吞掉 → 用户看到未处理原图且每帧报错。
- :611,642,1580-1585 blob URL 从不 revokeObjectURL → 每次切照片泄漏数 MB；:1934-1937 `a.click()` 后同步 revoke，部分浏览器取消下载。
- :920-925,983-988 WB 取色器 `getImageData(x-1,y-1,3,3)` 画布右/下边缘越界抛 IndexSizeError。

### U6 · parseCubeLUT 零校验
`utils.js:73-95`：parseInt 失败得 size=NaN；数据行数与 size³×3 不符不报错；不拒绝 LUT_1D_SIZE；不处理 DOMAIN_MIN/MAX。畸形文件静默生成 NaN LUT 并污染预设/导出（`FilmLab.jsx:1521-1536` 零校验 + FileReader 无 onerror）。

## 中严重度

- `FilmLab.jsx:656-684` EXIF fetch 无 AbortController/active 标志，快速切图竞态覆盖 rotationOffset。
- `FilmLab.jsx:687-697` 重绘 effect 依赖缺 useGPU/cropRect → GPU/CPU 切换不重绘、直方图扫描区用过期 cropRect；:700-705 renderOriginal 缺 rotationOffset 依赖且 maxWidth 硬编码 1200。
- `FilmLab.jsx:489-548` undo/redo 不恢复 LUT/inversionMode/baseMode/baseDensity/densityLevels/hsl/splitToning/saturation/filmCurve → 半数调整不可撤销。
- `FilmLab.jsx:1940-2138` SAVE(EXPORT_MAX_WIDTH=8000) 与 downloadClientJPEG(maxSaveWidth=4000) 分辨率不一致。
- `FilmLab.jsx:2423-2432` 全局 'x' 快捷键未过滤 INPUT/contentEditable。
- `FilmLab.jsx:1485-1517` 拖拽中卸载，window mousemove/mouseup 监听器泄漏。
- `FilmLab.jsx:1234-1286,1545-1577,1649-1679,2100-2130` RenderCore 参数组装+逐像素循环 4 处近乎逐字重复，已漂移（:1545 缺 filmCurveGamma 等参数）。
- `FilmLabCanvas.jsx:364-383` split 对比：内部 canvas `maxWidth:100%` 相对裁剪容器 → 原图被压缩错位，分屏对比不可用（应 clip-path 方案）；:269-270 普通点击即 pushToHistory 污染撤销栈；:410 'new' 拖拽类型无处理分支；:36-61 尺寸轮询无超时兜底、全文件无 DPR 处理；:243 拖拽 effect 依赖 localCropRect 每帧重装监听器。
- `FilmLabControls.jsx:268-277` updateChannelLevel 每次 onChange 都 pushToHistory；:506-577 1174 行 57 props 巨型组件无 memo。
- `useHistogram.js` 全文死代码（与 FilmLab 内联逻辑两套实现行为不一致）；:138 GPU 全分辨率 readPixels 设计不可行。
- `edgeDetection/index.js:66-76` `'120'` 格式选项与服务端 `120_645/66/67` 不匹配 → 无效 UI；:105-106 houghThreshold 小图算 0；:182-238 isResultValid 全图矩形高置信度也放行、两段全图判断重复且阈值不一致。
- `edgeDetection/utils.js:47-89` toGrayscaleEnhanced 4× 内存/时间且"全图梯度能量"与边框对比度无因果；:244-254 normalizeRect 不保证 x+w≤1。
- `AutoCropButton.jsx:49-109` 无 AbortController，卸载/切照片后竞态覆盖。
- `PhotoSwitcher.jsx:144-152` getPhotos 无 abort；:289,357 currentIndex=-1 显示 "0/5"。
- `ToneCurveEditor.jsx:126-180` 拖拽闭包捕获 activeChannel，拖中切通道错位；:23-44 每渲染 2×256 点路径拼接 + 261 次 spline 求值无 memo。
- `types.d.ts` 多处与运行时不符：DensityLevels 结构（{minR} vs {red:{min,max}}）、orientation 无界累积 vs 限定 0|90|180|270、UseHistogramReturn 完全不符、baseMode 含运行时不用的 'off'/'auto'。

## 低严重度

- `houghTransform.js:201-254` getLineEndpoints 死代码且 y<=height 应为 height-1。
- `edgeDetection/index.js:36-42` maxWidth=1200 声明未使用；:109-142 库内 console.log 刷屏；:154 filter 计数复制全尺寸数组。
- `rectangleFinder.js:9,380-431` findRectangleByDensity fallback 未接线；:85 confidence 量纲任意。
- `AutoCropButton.jsx:41-46` 浮点 !== 比较；:62-72 生产 console.log。
- `LutSelectorModal.jsx:176-185` 伪 LUT 预览（按文件名 hash 渐变）；:257-279 接受 .3dl/.csp/.lut 但解析器只懂 .cube。
- `SliderControl.jsx:26-41` 全局 mouseup 监听每次渲染重订阅。
- `SplitToningPanel.jsx:17-27` 色轮只响应 click 且不进历史；`HSLPanel.jsx` 键盘调整不进历史。
- `ExportQueuePanel.jsx` 死代码（无轮询/WS，retryJob 是 TODO）；`LutManager.jsx` 死代码且与 Controls 内联 LUT UI 两份实现已漂移。

## 死代码清理清单

`useHistogram.js`、`ExportQueuePanel.jsx`、`LutManager.jsx`、`onAutoEdgeDetection`/`photos`/`rotation` 死 props、`findRectangleByDensity`、`RenderCore` deprecated GLSL、`getLineEndpoints`。
