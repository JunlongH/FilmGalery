# 02 · 渲染管线详细问题

## 高严重度

### P0-1 WebGL2 模式下 3D LUT 完全失效
`FilmLabWebGL.js:252-253` 检测到 WebGL2 时构建 `isGL2:true` 着色器；该分支（`shaders/index.js:215-222`）使用 `u_hasLut3d`/`u_lut3dSize`/`u_lut3dTex`（sampler3D）。但客户端（`FilmLabWebGL.js:607-610`）只设置 `u_useLut3d`/`u_lutSize`/`u_lut3d`（sampler2D）—— 名字完全不同。现代浏览器默认 WebGL2，LUT 静默不应用。

**建议**：统一只走 WebGL1 packed-2D 路径（删除 WebGL2 LUT 分支），或客户端按 isGL2 分支用 `gl.texImage3D` 创建真 3D 纹理。统一命名消除混乱。

### P0-2 disposeWebGL 从未被调用
`FilmLabWebGL.js:746` 导出 disposeWebGL，但 `useFilmLabRenderer.js:205-211` 清理 effect 只 cancelAnimationFrame。每次组件卸载/换图泄漏 program + 6 张纹理 + buffer。

**建议**：useFilmLabRenderer 清理 effect 调 `disposeWebGL(canvas)`；image 变化 effect 也调。

### P1-15 每帧 50 次 uniform location 重建
`FilmLabWebGL.js:331-393` 注释"每次强制重新获取，因为 cache 每次都是新的"——注释错误。cache 是 WeakMap 复用对象，cache.locs 在 program 重建时已置 null。但无条件 `const locs = {}; cache.locs = locs;` 然后调 ~50 次 getUniformLocation。

**建议**：`if (!cache.locs) { cache.locs = {}; ...填充... }`。

### P1-16 曲线纹理每帧全量重传 + 16KB 临时分配
`FilmLabWebGL.js:480-501` uploadCurve 无脏标记（对比 LUT3D 路径有 lutChanged）。每帧 4 条曲线 × 256×4 字节 = 16KB new Uint8Array + 4 次 texImage2D + 16 次 texParameteri（参数从未变）。

**建议**：缓存 cache.curveRef = arr 引用；引用未变跳过。texParameteri 只在 createTexture 后调一次。预分配 Uint8Array 复用。

### P1-20 u_linearDomainInversion 客户端从未绑定
`RenderCore.js:728` 返回该 uniform，uniforms.js:23 声明，shader index.js:158,211 消费。但 FilmLabWebGL.js:335-393 location 列表里没有它。用户启用线性域反转时 CPU 生效但 GPU 预览静默忽略。

**建议**：加 `locs.u_linearDomainInversion` + `gl.uniform1f(..., params.linearDomainInversion ? 1.0 : 0.0)`；修正 RenderCore.js:727 过期注释。

### P1-21 图像纹理每帧无条件重传
`FilmLabWebGL.js:320-329` 每帧 texImage2D(... image)。用户只调参不换图时图像数据没变。

**建议**：`if (cache.imageRef !== image) { ...上传...; cache.imageRef = image; }`。

## 中严重度

### P1-25 RenderCore 死代码 ~300 行
- `_applyFilmCurveFloat`（:1024，不支持 toe/shoulder，与实际路径语义分叉）
- `_sampleCurveLUTFloat`（:1153，8-bit 输入版，无调用方）
- `getHSLGLSL`/`getSplitToneGLSL`（:739-959，~150 行 @deprecated GLSL 副本，与 SSOT 已分叉，带 console.warn）

**建议**：直接删除。

### P1-26 GLSL 死函数
baseDensity.js（applyBaseDensityCorrection/applyDensityLevels）、inversion.js（applyInversion）、filmCurve.js（applyFilmCurveLegacy）的函数被 buildFragmentShader 字符串拼接包含进着色器，但 main() 内联了等价逻辑不调用这些函数。两份等价代码是维护陷阱。

**建议**：删函数、main 调函数（减少 main 体积），或删函数、保留内联。

### P2-6 processPixelFloat 在 linearDomainInversion 下 clamp 过早
`RenderCore.js:456-458` clamp[0,1] 在 curves 之前。linearDomainInversion=true 且 inversion 后值 > 1（HDR 负片）时 clamp 丢高光信息。GPU 同样 clamp（一致但物理不正确）。

**建议**：考虑把 clamp 推迟到 curves 之后。需同步改 GPU。

### P2-7 log 模式 base correction 在 linearDomainInversion 下语义
`RenderCore.js:327-329` linear 模式 clamp[0,1] 在 linearDomainInversion 下截断 >1 的线性光（base gain >1 时）。

**建议**：linear 模式在 linearDomainInversion=true 时不 clamp，inversion 后再 clamp。与 GPU 对齐。

### P2-8 processPixelFloat NaN 守卫位置过晚
`RenderCore.js:382-385` 守卫在 WB 之后、tone 之前。film curve/base/inversion/LUT 产生的 NaN 会经过 WB 乘法。

**建议**：inversion 后（:360 之后）加一次 NaN 守卫，WB 前再加。

### P2-9 processPixel 8-bit 路径与 processPixelFloat 数值分叉
processPixel 用 8-bit toneLUT + 8-bit curve LUT + 256 级量化；processPixelFloat 用 inline 数学 + 1024-entry float LUT。useFilmLabRenderer CPU 回退调 processPixel（8-bit），服务端 renderBuffer 调 processPixelFloat。

**建议**：useFilmLabRenderer CPU 回退改用 processCanvasChunkedSync（SSOT，已用 processPixelFloat），或删 processPixel 8-bit 路径。

### P2-10 _packHSLParams 返回嵌套数组但客户端不消费
`RenderCore.js:1252-1267` 返回 [[h,s,l],...]，但 FilmLabWebGL.js:627-666 不用它（客户端自己重新拆 hslParams）。getGLSLUniforms 的 u_hslParams 死输出。

**建议**：删除 u_hslParams 字段，或客户端改用它。

### P2-1 processPixelFloat 每像素分配数组
`render-buffer.js:73,80` `const [rF,gF,bF] = core.processPixelFloat(...)` 每像素 new Array(3)。4K 图 8M 像素 = 8M 次分配。

**建议**：processPixelFloat 改为接受 out 数组参数，或写入预分配 Float32Array(3)。

### P2-5 prepareLUTs 同时构建 8-bit 和 float LUT
`RenderCore.js:200-211` 总是构建 8 个曲线 LUT（4×8-bit + 4×float）+ toneLUT。renderBuffer 只用 float，processPixel 只用 8-bit。

**建议**：prepareLUTs(options) 按需构建，或懒构建。

## 低严重度

- P3: RenderCore.js:1244 _hasCurves 默认曲线检测不健全（pts.length===0 误判为"有曲线"）
- P3: render-buffer.js:55 writePixel 闭包每调用创建
- P3: render-buffer.js:71 16-bit channels 未校验 byteLength 偶数
- P3: renderChunked.js:26 手动 clamp 多余（Uint8ClampedArray 自动）
- P3: renderChunked.js 与 renderBuffer 循环重复
- P3: shaders/tonemap.js:58 applyWhitesBlacks 浮点 != 比较（应用 abs > 0.001）
- P3: shaders applyContrast/WhitesBlacks/HighlightsShadows 无条件执行（可加守卫）
- P3: shaders/lut3d.js LINEAR 过滤 + 手动三线性冗余（改 NEAREST）
- P3: shaders/index.js:252 curves 块缩进异常
- P3: shaders/index.js:327 SHADER_VERSION 未随变更 bump
- P3: render/math/exposure.js applyWhiteBalance 死代码
- P3: render/math/tone-curves.js reinhard/reinhardExtended/filmicACES 死代码
- P3: render/math/color-space.js applyGamma/removeGamma 死代码
- P3: render/math/index.js spread 合并丢失命名空间
- P3: FilmLabWebGL.js:422 等 8 条 uniform3fv 每帧 new Float32Array
- P3: FilmLabWebGL.js:296 顶点缓冲每帧重传 + Float32Array 分配
- P3: FilmLabWebGL.js:323 pixelStorei 状态泄漏
- P3: FilmLabWebGL.js:746 disposeWebGL cache.locs 在 context lost 时的行为（补测试）
