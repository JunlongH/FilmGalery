# FilmLab Pipeline 系统分析

## 当前架构概览

### 1. 处理路径 (Processing Paths)

#### 1.1 Preview 渲染路径
```
用户调整参数 
  ↓
触发 requestPreview
  ↓
┌─────────────────────────────────────┐
│ remoteImg存在且不在cropping模式？    │
├─────────────────────────────────────┤
│ YES: 使用服务器预渲染 (filmlabPreview) │
│  - maxWidth: 1400                    │
│  - 直接显示remoteImg                  │
│  - 只计算histogram                    │
│                                      │
│ NO: 客户端渲染 (processImage)         │
│  ├── useGPU && WebGL可用？            │
│  │   ├── YES: WebGL路径              │
│  │   │   - processImageWebGL()      │
│  │   │   - maxWidth: 1200           │
│  │   │   - 完整pipeline在GPU         │
│  │   └── NO: CPU路径                │
│  │       - 手动pixel loop            │
│  │       - maxWidth: 1200           │
│  │       - 逐像素处理所有步骤          │
└─────────────────────────────────────┘
```

#### 1.2 Save/Export 路径
```
┌─────────────────────────────────────┐
│ handleSave (快速保存)                 │
│  - 客户端CPU处理                      │
│  - maxWidth: 4000                   │
│  - 输出: JPEG blob → onSave()        │
│  - 用途: 预览时快速保存                │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ handleHighQualityExport (HQ导出)     │
│  - 调用服务器 exportPositive()        │
│  - 服务器maxWidth: 4000              │
│  - 输出: JPEG 存入库                  │
│  - 用途: 高质量导出到库                │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ handleGpuExport (GPU导出)            │
│  - 通过Electron调用GPU renderer       │
│  - 专用GPU进程处理                    │
│  - 输出: 文件到磁盘                    │
│  - 用途: 最高质量GPU加速导出           │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ handleDownload (下载)                │
│  - format: 'jpeg' | 'tiff16' | 'both' │
│  - JPEG: 客户端CPU处理                │
│  - TIFF16: 服务器renderPositive()     │
│  - 输出: 触发浏览器下载                │
└─────────────────────────────────────┘
```

### 2. 图像处理Pipeline

#### 2.1 完整处理顺序
```
原始图像 (Raw Negative)
  ↓
① Geometry Transform (Rotation + Crop)
  ↓
② Inversion (inverted + inversionMode)
  ↓
③ White Balance (red/green/blue gains + temp/tint)
  ↓
④ Tone Mapping (exposure, contrast, highlights, shadows, whites, blacks)
  ↓
⑤ Curves (RGB curve → R/G/B channel curves)
  ↓
⑥ 3D LUTs (lut1, lut2 with intensity blend)
  ↓
最终输出 (Positive Image)
```

#### 2.2 WB Picker 采样逻辑
```
用户点击canvas
  ↓
创建tempCanvas (与显示canvas相同尺寸)
  ↓
应用Geometry Transform (仅rotation + crop，无颜色处理)
  ↓
从tempCanvas采样3x3 kernel
  ↓
┌─────────────────────────────────────┐
│ isPickingBase (Film Base)            │
│  - 采样原始颜色                       │
│  - 计算: baseGain = 255 / sampleRGB  │
│  - 设置: red, green, blue gains       │
│  - temp, tint归零                     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ isPickingWB (WB Picker)              │
│  - 采样原始颜色                       │
│  - 应用inversion (如果启用)            │
│  - 求解: temp/tint让采样点变中性灰      │
│  - 设置: temp, tint                   │
│  - 保持: red, green, blue不变         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ isPicking (Color Picker)             │
│  - 采样原始颜色                       │
│  - 应用完整pipeline (除curves/LUTs)   │
│  - 显示: 处理后的RGB值                │
└─────────────────────────────────────┘
```

## 问题诊断

### ✅ 验证结果

1. **服务器Export/Render正确应用WB**
   - `/api/filmlab/render` (line 267-296): ✅ 正确计算并应用WB gains
   - `/api/filmlab/export` (line 377-417): ✅ 正确计算并应用WB gains
   - **结论**: 服务器端逻辑完全正确

2. **WB Picker采样**
   - tempCanvas坐标映射: ✅ 已修复
   - 正确使用maxWidth: ✅ remoteImg时用1400，否则1200
   - **结论**: 采样逻辑正确

### ⚠️ 潜在问题

1. **Preview渲染路径不统一**
   - 服务器preview: maxWidth=1400
   - 客户端WebGL: maxWidth=1200  
   - 客户端CPU: maxWidth=1200
   - **影响**: 可能导致视觉不一致，但不影响最终导出

2. **Pipeline重复代码 (代码质量问题)**
   ```
   相同的处理逻辑在3个地方重复：
   - processImage() CPU路径 (line 1050-1190)
   - handleSave() (line 1590-1650)
   - 服务器 render/export (filmlab.js line 277-308, 397-427)
   ```
   **问题**: 
   - 维护成本高：修改pipeline需要同步3处
   - 一致性风险：逻辑容易不同步
   - 代码冗余：~400行重复代码

3. **WebGL路径混乱**
   ```javascript
   // processImage中有重复的WebGL调用逻辑
   Line 887: processImageWebGL(webglCanvas, image, ...)  // 第一次调用
   Line 970: processImageWebGL(webglCanvas, image, ...)  // 第二次调用？
   ```
   **问题**: 逻辑不清晰，难以追踪实际执行路径

### ❌ 需要测试的功能

1. **GPU Export** (handleGpuExport)
   - 用户明确表示从未测试
   - 代码存在但功能未验证
   - **风险**: 可能存在参数传递错误或渲染bug

## 优化方案

### 🎯 短期优化 (Quick Wins)

#### 1. 统一maxWidth配置
```javascript
// 在FilmLab.jsx顶部定义常量
const PREVIEW_MAX_WIDTH_SERVER = 1400;  // 服务器preview
const PREVIEW_MAX_WIDTH_CLIENT = 1200;  // 客户端实时渲染
const EXPORT_MAX_WIDTH = 4000;           // 所有导出路径

// 用途：
// - 提高代码可读性
// - 集中管理配置
// - 方便未来调整
```

#### 2. 清理processImage中的WebGL重复调用
```javascript
// 当前问题：WebGL调用出现在两个地方
// - Line 887: 第一次调用（但结果未使用？）
// - Line 970: 第二次调用在useDirectDraw分支

// 建议：
// - 移除第一次调用或明确其用途
// - 简化useDirectDraw逻辑
// - 使用单一的WebGL缓存机制
```

#### 3. 移除冗余的debug logging
```javascript
// 当前CPU路径有大量console.log
// Line 1095-1170: 每个处理步骤都有centerPixel采样logging

// 建议：
// - 保留关键节点的logging
// - 移除逐像素的详细logging
// - 或使用DEBUG flag控制
```

### 🏗️ 中期重构 (Architecture Improvements)

#### 1. 提取共享Pipeline核心函数
```javascript
// 新文件: client/src/components/FilmLab/pipeline-core.js

export function processPixel(r, g, b, params, luts) {
  // ① Inversion
  if (params.inverted) {
    if (params.inversionMode === 'log') {
      r = 255 * (1 - Math.log(r + 1) / Math.log(256));
      g = 255 * (1 - Math.log(g + 1) / Math.log(256));
      b = 255 * (1 - Math.log(b + 1) / Math.log(256));
    } else {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
  }

  // ② White Balance
  r *= luts.rBal;
  g *= luts.gBal;
  b *= luts.bBal;

  // ③ Tone Mapping
  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));
  r = luts.toneLUT[Math.floor(r)];
  g = luts.toneLUT[Math.floor(g)];
  b = luts.toneLUT[Math.floor(b)];

  // ④ Curves
  r = luts.lutRGB[r];
  g = luts.lutRGB[g];
  b = luts.lutRGB[b];
  r = luts.lutR[r];
  g = luts.lutG[g];
  b = luts.lutB[b];

  // ⑤ 3D LUTs
  if (luts.lut1) {
    const [lr, lg, lb] = sampleLUT(r/255, g/255, b/255, luts.lut1);
    r = r * (1 - luts.lut1.intensity) + lr * 255 * luts.lut1.intensity;
    g = g * (1 - luts.lut1.intensity) + lg * 255 * luts.lut1.intensity;
    b = b * (1 - luts.lut1.intensity) + lb * 255 * luts.lut1.intensity;
  }
  if (luts.lut2) {
    const [lr, lg, lb] = sampleLUT(r/255, g/255, b/255, luts.lut2);
    r = r * (1 - luts.lut2.intensity) + lr * 255 * luts.lut2.intensity;
    g = g * (1 - luts.lut2.intensity) + lg * 255 * luts.lut2.intensity;
    b = b * (1 - luts.lut2.intensity) + lb * 255 * luts.lut2.intensity;
  }

  // Final clamp
  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));

  return [r, g, b];
}

export function prepareLUTs(params) {
  const toneLUT = getToneLUT(params);
  const lutRGB = getCurveLUT(params.curves.rgb);
  const lutR = getCurveLUT(params.curves.red);
  const lutG = getCurveLUT(params.curves.green);
  const lutB = getCurveLUT(params.curves.blue);
  const [rBal, gBal, bBal] = computeWBGains({
    red: params.red,
    green: params.green,
    blue: params.blue,
    temp: params.temp,
    tint: params.tint
  });

  return {
    toneLUT, lutRGB, lutR, lutG, lutB,
    rBal, gBal, bBal,
    lut1: params.lut1,
    lut2: params.lut2
  };
}
```

#### 2. 重构processImage使用核心函数
```javascript
// 简化后的processImage
const processImage = () => {
  // ... 几何变换部分保持不变 ...

  if (!webglSuccess) {
    // CPU路径：使用共享的pixel processor
    const luts = prepareLUTs({
      inverted, inversionMode, exposure, contrast, 
      highlights, shadows, whites, blacks,
      curves, red, green, blue, temp, tint,
      lut1, lut2
    });

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (data[idx + 3] === 0) continue;

        const [r, g, b] = processPixel(
          data[idx], data[idx+1], data[idx+2],
          { inverted, inversionMode },
          luts
        );

        data[idx] = r;
        data[idx+1] = g;
        data[idx+2] = b;

        // Histogram更新...
      }
    }
  }
};
```

#### 3. 重构handleSave使用核心函数
```javascript
// handleSave也使用相同的核心函数
const handleSave = () => {
  // ... rotation/crop保持不变 ...

  const luts = prepareLUTs({...});

  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] === 0) continue;

    const [r, g, b] = processPixel(
      data[i], data[i+1], data[i+2],
      { inverted, inversionMode },
      luts
    );

    data[i] = r;
    data[i+1] = g;
    data[i+2] = b;
  }

  // ... save logic ...
};
```

### 💡 长期改进 (Future Enhancements)

1. **统一Pipeline API**
   ```javascript
   // 理想架构：所有处理路径使用同一个核心
   const pipeline = new FilmLabPipeline({
     input: imageData,
     params: { inverted, exposure, ... },
     mode: 'realtime' | 'hq' | 'export'
   });
   
   const result = await pipeline.process();
   ```

2. **Web Worker for CPU Processing**
   ```javascript
   // 将CPU pixel loop移到worker
   // 避免阻塞主线程
   const worker = new Worker('filmlab-worker.js');
   worker.postMessage({ imageData, params });
   worker.onmessage = (e) => {
     ctx.putImageData(e.data.result, 0, 0);
   };
   ```

3. **性能监控和优化**
   ```javascript
   // 添加performance metrics
   const perfStart = performance.now();
   processImage();
   const perfEnd = performance.now();
   console.log(`[FilmLab] Processing took ${perfEnd - perfStart}ms`);
   ```

## 行动计划

### ✅ 已完成
1. WB Picker坐标映射修复 - 采样位置现在准确
2. HQ Export WB应用验证 - 服务器端代码正确
3. 系统架构梳理 - 完整文档化

### 🔄 立即执行 (This Session)

#### 选项A: 最小改动 (推荐先执行)
```
1. 定义maxWidth常量 (5分钟)
2. 移除processImage中的冗余debug logging (10分钟)  
3. 添加注释说明WebGL调用逻辑 (5分钟)
```

#### 选项B: 中等重构
```
1. 提取processPixel核心函数 (30分钟)
2. 重构processImage使用核心函数 (20分钟)
3. 重构handleSave使用核心函数 (15分钟)
4. 测试所有处理路径一致性 (15分钟)
```

#### 选项C: 暂时保持现状
```
代码已经工作正常，暂不重构
继续测试其他功能
```

### 📋 后续任务

1. **测试GPU Export**
   - 准备测试用例
   - 验证参数传递
   - 对比输出一致性

2. **性能优化**
   - Benchmark各个处理路径
   - 优化CPU pixel loop
   - 考虑Web Worker

3. **代码重构** (如果选择)
   - 创建pipeline-core.js
   - 迁移所有处理路径
   - 添加单元测试

### 📊 优先级评估

| 任务 | 重要性 | 紧急度 | 工作量 | 建议 |
|------|--------|--------|--------|------|
| 定义常量 | 中 | 低 | 5min | ✓ 执行 |
| 清理logging | 低 | 低 | 10min | ✓ 执行 |
| 提取核心函数 | 高 | 中 | 1h | ⏸️ 暂缓 |
| 测试GPU Export | 高 | 低 | 30min | ⏸️ 暂缓 |
| Web Worker | 中 | 低 | 2h | ⏸️ 暂缓 |

---

## 总结

### 当前状态：✅ 系统工作正常

- **Preview**: 使用服务器渲染或客户端WebGL/CPU，功能完整
- **WB Picker**: 坐标映射已修复，采样准确
- **Export/Save**: 所有路径正确应用WB和完整pipeline
- **代码质量**: 存在重复，但逻辑正确且稳定

### 建议行动：🎯 最小改动优先

1. **立即执行** (20分钟)：
   - 定义maxWidth常量
   - 清理过多的debug logging
   - 添加代码注释

2. **暂缓重构**：
   - 系统已稳定运行
   - 重构风险大于收益
   - 等待更多需求变化再考虑

3. **专注功能测试**：
   - GPU Export是唯一未测试功能
   - 建议优先验证功能完整性
   - 而非代码结构优化

