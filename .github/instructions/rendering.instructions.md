---
description: "Use when working on film rendering pipeline, image processing, RenderCore, GLSL shaders, tone mapping, white balance, color science, or film emulation code."
applyTo: "packages/shared/**"
---
# 渲染管线开发规范

## 架构

`packages/shared/` 是跨平台共享的渲染引擎，被 server 和 client 同时使用。

## Float32 渲染管线（核心）

处理顺序严格固定，不可更改：
```
FilmCurve → Base → Density → Inversion → 3DLUT → WB →
Exposure → Contrast → B/W → S/H → RollOff → Curves →
HSL → SplitTone
```

- 所有像素数据在 Float32 空间处理，延迟到最终输出才 clamp 到 [0,1]
- 不得在中间步骤进行 8-bit 截断
- `processPixelFloat()` 是核心处理函数

## 模块职责

| 模块 | 职责 |
|------|------|
| `RenderCore.js` | 统一 CPU/GPU 渲染入口 |
| `FloatPipeline.js` | Float32 路径 |
| `filmLabCurve.js` | 胶片特性曲线 |
| `filmLabToneLUT.js` | 色调映射 LUT |
| `filmLabWhiteBalance.js` | 白平衡校正 |
| `filmLabSaturation.js` | 饱和度控制 |
| `filmLabInversion.js` | 底片反转 |
| `filmLabHSL.js` | HSL 色彩调整 |
| `filmLabSplitTone.js` | 分色调处理 |
| `filmLabExport.js` | 导出格式处理 |
| `shaders/` | GLSL WebGL 着色器 |

## 关键约束

- 修改渲染参数后必须运行 `npm test` 验证 CPU/GPU 一致性
- GLSL uniform 名称必须与 JS 端一一对应
- LUT 使用三线性插值，不得使用最近邻
- 新增渲染步骤须同步更新 8-bit 和 Float32 两条路径
- `packages/shared/index.js` 负责聚合导出，新增模块需在此注册

## 测试

```bash
npm test   # 运行 5 组渲染一致性测试
# 01-shader-build     GLSL 编译验证
# 02-uniform-consistency  Uniform 一致性
# 03-pipeline-order   管线顺序验证
# 04-algorithm-consistency  CPU/GPU 算法比对
# 05-cross-path-integration 路径集成测试
```
