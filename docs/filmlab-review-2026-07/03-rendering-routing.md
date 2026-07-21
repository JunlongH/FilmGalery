# 03 · 渲染管线与系统路由

涉及文件：
- GPU：`client/src/components/FilmLab/FilmLabWebGL.js`、`packages/shared/shaders/*`、`packages/shared/render/RenderCore.js`
- 路由：`client/src/services/ComputeService.js`、`CpuRenderService.js`、`packages/shared/serverCapabilities.js`
- 预览 hooks：`useFilmLabRenderer.js`、`useFilmLabPipeline.js`、`useFilmLabState.js`

## 高严重度

### R1 · 预览存在两套并行管线，无统一路由抽象
组件内 `useFilmLabRenderer`（本地 WebGL/CPU）与服务层 `smartFilmlabPreview`（服务器/Electron GPU/CPU）并存。预览分辨率不一致：`CpuRenderService.js:18` 1400、`useFilmLabRenderer.js:24` 2000、ComputeService 默认 1400。参数序列化、几何处理各不相同。
**修复**：服务层提供统一 `preview()` 入口封装"本地 WebGL → 服务器 → 本地 GPU → CPU"优先级；常量收敛到 shared。

### R2 · 回退协议断裂（NAS 场景）
- `serverCapabilities.js:23-31` `COMPUTE_ROUTES` 缺 `/api/filmlab/export`、`/api/photos/:id/render-positive` → 客户端基于 `503+E_NAS_NO_COMPUTE` 的回退永远不会触发。
- `ComputeService.js:78-84` 能力探测失败默认 `compute:true`；失败结果无负缓存，preview 热路径每次多一次 `/api/discover`。
- `ComputeService.js:148` 503 回退丢失 `sourceType` → negative 用户回退后拿到 original 源渲染。
**修复**：补齐路由；负缓存；回退参数补齐；加客户端路由表 vs COMPUTE_ROUTES 契约测试。

### R3 · 三条像素路径三种算法（所见非所得）
GPU shader / `processPixelFloat`（CpuRenderService.js:145-175）/ `processPixel` 8-bit（useFilmLabRenderer.js:144）。`CpuRenderService.js:160-168` 注释自认 float 路径期望线性输入却喂 sRGB，"因为 GPU 也这么做"。服务器端若先行线性化，则三端输出互不相同。
**修复**：RenderCore 统一输入空间约定，三端共享线性化代码，黄金图 PSNR 测试锁定。

### R4 · paramsEqual 键列表严重不全 → 预览冻结
`useFilmLabRenderer.js:34-66`：遗漏 temp/tint/red/green/blue、baseMode、baseDensity*、curves、hslParams、splitToning、densityLevels、filmCurveProfile、LUT；且检查的 `rotate`/`gains` 键名在 state 中根本不存在（永远 undefined===undefined）。改动这些参数时 requestRender 直接返回缓存 canvas。
**修复**：改为序列化比较或版本号/脏标记。

### R5 · CPU 预览路径完全忽略几何 + canvas context 混用
`useFilmLabRenderer.js:123-152` 无 applyGeometry：rotation/cropRect/orientation 在 CPU 回退下不生效。同一 canvas 先取 webgl 再取 2d context 返回 null（:120-125）→ 画面停在旧帧。
**修复**：CPU 分支复用 applyGeometry；两个独立 canvas 切换。

### R6 · 服务层无取消/无序列化 → 预览竞态
`ComputeService.js:121-160` smartFilmlabPreview 无 AbortController、无请求序号。滑块快速拖动时慢的旧响应后返回覆盖新结果。
**修复**：递增 requestId 仅接受最新 + AbortController。

### R7 · GPU uniform 缺 profile 解析、lut2 丢失、曲线 sampler 回落
- `RenderCore.js:629-635` vs `:280-290`：GPU 无 profile.gammaR/toe/shoulder 回退（见 02-H3）。
- `RenderCore.js:695-696` / `shaders/index.js:205-219`：GPU 只应用 lut1，lut2 静默丢弃。
- `FilmLabWebGL.js:501-511`：曲线通道缺失时对应 sampler 从未 uniform1i，默认值 0 → shader 拿照片图像当曲线 LUT 采样，花屏无报错。
**修复**：任一通道缺失时上传 identity LUT 或整体 u_useCurves=0；lut2 支持或 JS 侧先合并。

### R8 · 预览永远 mediump + WebGL1 着色器
`FilmLabWebGL.js:88,251`：优先创建 webgl2 上下文，却无条件 `buildFragmentShader({isGL2:false})`（默认 mediump，`shaders/index.js:66`）。移动端 LUT 纹素寻址（33³ 分母 1089）、密度域 log/pow 精度崩塌 → banding/串色。
**修复**：按实际上下文传 isGL2 与 `precision:'highp'`。

## 中严重度

- `useFilmLabPipeline.js:143,280`：pendingEvents 用 Set 存新建对象，去重失效；:294 flush 定时器无卸载清理；:239-245 直方图依赖图不含颜色事件（调色后直方图不刷新）；:293 16ms trailing debounce 连续输入下渲染饿死。
- `useFilmLabState.js:187-190,330-333`：浅拷贝共享模块级 DEFAULT_* 可变对象，曲线/HSL 原地编辑污染全局、跨照片串味；:344-359 hasModifications 漏判 base/curves/hsl/splitToning；:278-281 deserialize 浅合并嵌套丢字段。
- `ComputeService.js:315`：contentType 硬编码（GPU 路径 png 也报 image/jpeg）；:695-771 batchProcess 进度 percent 不含 failed 永远到不了 100%；:176-208 GPU 回退不校验结果非空。
- `CpuRenderService.js:262-265`：先颜色后几何，与自身 PipelinePriority 约定相反（裁剪外像素白处理 + 与 GPU 先 UV 后采样结果不同）；:292+ 全分辨率导出主线程逐像素 float，无 Worker/分块，大图 OOM/阻塞；:341 扩展名映射与 ComputeService.js:571 不一致；:389-413 getPhotoImageUrl 与 ComputeService.js:216-241 重复实现已漂移。
- `FilmLabWebGL.js`：无 dispose（GL 对象泄漏至页面卸载）；每帧全量重传所有纹理（:327,489-497,524-580）；每帧 ~45 次 getUniformLocation（:329-391）；无 dithering。
- `render-buffer.js:77-102`：tiff16 时 processPixelFloat 每像素算两遍。
- `shaders/index.js:157-203`：main 内联 baseDensity/inversion 逻辑，模块函数成死代码（漂移温床）；GL1/GL2 LUT uniform 命名分裂（u_useLut3d vs u_hasLut3d）。
- `shaders/tonemap.js:31-44`：shadows/highlights 基函数输入未 clamp，与 float CPU 路径不一致（三处实现各不相同）。
- `shaders/lut3d.js:52-82`：手动三线性 + 纹理 LINEAR 过滤 = 双重插值（应 NEAREST）；8-bit LUT 量化暗部 banding。
- `shaders/hslAdjust.js`：缺 CPU 的 s<0.05 灰像素分支（见 02-M3）。
- `serverCapabilities.js:85-100` vs `ComputeService.js:64-70`：能力 schema 不对齐（服务端发 storage，客户端读 files）。
- `render/math/exposure.js`：EV 语义（2^ev）与主 pipeline（2^(exposure/50)）并存，易混用。
- `RenderCore.js` 死代码：:992-999 `_applyFilmCurveFloat` 私有版（无 toe/shoulder）、:1121-1127 `_sampleCurveLUTFloat`、:678 `u_hslParams` 死输出、:707-927 deprecated GLSL 方法（旧 splitTone 无 midtone）。

## 低严重度

- `RenderCore.js:178` prepareLUTs 无失效机制（params 可变则 LUT 过期）。
- `FilmLabWebGL.js:579` `gl.RGBA8 || gl.RGBA` 巧合式写法；:571 FLIP_Y 注释误导；preserveDrawingBuffer:true 可关。
- `shaders/uniforms.js`：sampler2D 无显式精度（GLSL ES 1.0 默认 lowp）。
- `ComputeService.js:477-525` XHR 上传无 abort；:99 window.__electron 依赖注入时序。
- `render/math/color-space.js:13-19`：linearToSrgb/srgbToLinear 对负输入无 clamp。

## 契约测试建议

- 客户端路由表（ComputeService 的 smart* 函数 URL）vs `COMPUTE_ROUTES` 双向匹配。
- CPU float / CPU 8-bit / GLSL 数值一致性：固定参数集 → 三路径输出 PSNR ≥ 阈值。
- paramsEqual/脏标记：对每个参数字段变更断言触发重渲染。
