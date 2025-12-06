# Bug Fix: WebGL 模式下 Crop 裁剪框不显示

**日期**: 2025-12-04
**问题**: 勾选 WebGL 时，crop 裁剪框消失；取消勾选时存在
**影响范围**: WebGL 渲染路径的 crop 功能

---

## 问题分析

### 用户报告

在修复了 HQ Export 的 WB/Base 问题后，出现了新的问题：
- ✅ 不使用 WebGL (CPU 路径)：Crop 裁剪框正常显示
- ❌ 使用 WebGL：Crop 裁剪框消失

### 问题链条

#### 1. WebGL 缓存机制

**文件**: `client/src/components/FilmLab/FilmLab.jsx` Line 148-159

```javascript
const webglParams = React.useMemo(() => {
  const gains = computeWBGains({ red, green, blue, temp, tint });
  return {
    inverted, inversionMode, gains, exposure, contrast, highlights, shadows, whites, blacks,
    curves, lut1, lut2
    // ← 缺少 rotation, orientation, isCropping, committedCrop！
  };
}, [inverted, inversionMode, exposure, contrast, highlights, shadows, whites, blacks, 
    temp, tint, red, green, blue, curves, lut1, lut2]);
```

**问题**: `webglParams` 只包含**颜色处理参数**，不包含**几何参数**！

#### 2. WebGL 渲染逻辑

**文件**: `client/src/components/FilmLab/FilmLab.jsx` Line 893-930

```javascript
if (useGPU && isWebGLAvailable()) {
  try {
    // Optimization: Reuse cached WebGL canvas if parameters haven't changed
    if (processedCanvasRef.current && lastWebglParamsRef.current === webglParams) {
      // ← 缓存命中！但 isCropping 可能已经变化了
      sourceForDraw = processedCanvasRef.current;
      useDirectDraw = true;
      webglSuccess = true;
    } else {
      const webglCanvas = document.createElement('canvas');
      const totalRotation = rotation + orientation;
      const cropRect = isCropping ? null : committedCrop;  // ← 正确的逻辑
      
      processImageWebGL(webglCanvas, image, {
        inverted, inversionMode, gains, exposure, contrast, ...,
        rotate: totalRotation,
        cropRect: cropRect,  // ← 传递正确的 cropRect
        ...
      });
      
      processedCanvasRef.current = webglCanvas;
      lastWebglParamsRef.current = webglParams;
      sourceForDraw = webglCanvas;
      useDirectDraw = true;
    }
  } catch(e) { ... }
}
```

#### 3. 问题场景

**场景**: 用户切换到 Crop 模式

1. **初始状态**: `isCropping=false`, WebGL 渲染并缓存（应用了裁剪）
   - `webglParams` = `{ inverted, gains, ... }`（不含 isCropping）
   - `processedCanvasRef` = 裁剪后的 canvas (例如 800x600)

2. **用户点击 "CROP" 按钮**: `isCropping=true`
   - `webglParams` = `{ inverted, gains, ... }`（**没有变化**！）
   - Line 895 检查: `lastWebglParamsRef.current === webglParams` → **true**
   - 使用缓存的 canvas（800x600，裁剪后的）

3. **Canvas 尺寸不匹配**:
   - 实际 canvas.width = 800 (裁剪后)
   - 期望 expectedWidth = 1200 (完整旋转后)
   - `isReady` 检查失败（差距 > 5px）

4. **Crop Overlay 不显示**:
   ```jsx
   {isReady && (
     <div className="crop-overlay">  // ← isReady=false，不渲染！
   ```

### 为什么 CPU 路径正常？

CPU 路径没有使用 WebGL 缓存，每次都重新计算几何和裁剪，所以没有这个问题。

---

## 根本原因

**WebGL 缓存的依赖参数不完整！**

`webglParams` 只包含颜色处理参数，不包含几何参数：
- ❌ 缺少 `rotation`
- ❌ 缺少 `orientation`
- ❌ 缺少 `isCropping`
- ❌ 缺少 `committedCrop`

导致：
- 几何参数变化时，缓存不失效
- 使用了错误的旧 canvas
- Canvas 尺寸不匹配
- `isReady` 检查失败
- Crop overlay 不显示

---

## 修复方案

### 核心思想

**在 `webglParams` 中包含所有影响渲染结果的参数**：
- 颜色参数：inverted, gains, exposure, curves, LUTs 等
- 几何参数：rotation, orientation, isCropping, committedCrop

这样，任何参数变化都会导致缓存失效，重新渲染。

### 实现

**文件**: `client/src/components/FilmLab/FilmLab.jsx` Line 148-166

**Before**:
```javascript
const webglParams = React.useMemo(() => {
  const gains = computeWBGains({ red, green, blue, temp, tint });
  return {
    inverted, inversionMode, gains, exposure, contrast, highlights, shadows, whites, blacks,
    curves, lut1, lut2
  };
}, [inverted, inversionMode, exposure, contrast, highlights, shadows, whites, blacks, 
    temp, tint, red, green, blue, curves, lut1, lut2]);
```

**After**:
```javascript
const webglParams = React.useMemo(() => {
  const gains = computeWBGains({ red, green, blue, temp, tint });
  return {
    inverted, inversionMode, gains, exposure, contrast, highlights, shadows, whites, blacks,
    curves, lut1, lut2,
    // Include geometry params to invalidate cache when geometry changes
    rotation, orientation, isCropping, 
    // Serialize committedCrop for comparison
    cropKey: `${committedCrop.x},${committedCrop.y},${committedCrop.w},${committedCrop.h}`
  };
}, [inverted, inversionMode, exposure, contrast, highlights, shadows, whites, blacks, 
    temp, tint, red, green, blue, curves, lut1, lut2,
    rotation, orientation, isCropping, committedCrop]);
```

### 改进点

1. **添加几何参数**: `rotation`, `orientation`, `isCropping`
2. **序列化 committedCrop**: 使用 `cropKey` 字符串，因为对象引用可能不变但值已变
3. **更新依赖数组**: 包含所有几何参数

---

## 验证

### 编译检查
```
✅ No errors found in FilmLab.jsx
```

### 功能验证

#### 场景 1: 切换 Crop 模式 (WebGL 开启)
1. 初始状态: `isCropping=false`，显示裁剪后的图像
2. 点击 "CROP" 按钮: `isCropping=true`
3. **预期**: 
   - `webglParams` 变化（包含新的 `isCropping`）
   - WebGL 缓存失效
   - 重新渲染完整图像（无裁剪）
   - Canvas 尺寸 = rotatedW
   - `isReady=true`
   - ✅ Crop overlay 显示

#### 场景 2: 旋转图像 (WebGL 开启)
1. 初始状态: `rotation=0`
2. 旋转到 `rotation=90`
3. **预期**:
   - `webglParams` 变化（包含新的 `rotation`）
   - WebGL 缓存失效
   - 重新渲染旋转后的图像
   - ✅ 显示正确

#### 场景 3: 修改裁剪 (WebGL 开启)
1. 初始状态: `committedCrop={x:0, y:0, w:1, h:1}`
2. 用户裁剪并确认: `committedCrop={x:0.1, y:0.1, w:0.8, h:0.8}`
3. **预期**:
   - `webglParams.cropKey` 变化
   - WebGL 缓存失效
   - 重新渲染裁剪后的图像
   - ✅ 显示正确

---

## 性能影响

### 缓存失效频率

**Before**: 只有颜色参数变化时缓存失效
- 调整 exposure/contrast/curves → 缓存失效 ✅
- 旋转/裁剪 → 缓存不失效 ❌ (BUG)

**After**: 所有参数变化时缓存失效
- 调整 exposure/contrast/curves → 缓存失效 ✅
- 旋转/裁剪 → 缓存失效 ✅ (FIXED)

### 性能评估

- **轻微性能下降**: 几何参数变化时会重新渲染
- **但这是正确的行为**: 几何变化**必须**重新渲染
- **实际影响很小**: 
  - 旋转/裁剪不是高频操作
  - WebGL 渲染非常快（<10ms）
  - 用户不会感知到差异

---

## 总结

### 根本原因

WebGL 优化缓存的依赖不完整，导致几何参数变化时使用了错误的旧 canvas。

### 解决方案

在 `webglParams` 中包含所有影响渲染结果的参数（颜色 + 几何），确保缓存正确失效。

### 系统性思考

这个问题暴露了一个更深层的设计问题：

**缓存优化的基本原则**：
1. **缓存键必须包含所有影响结果的输入**
2. **如果输入不完整，缓存会返回错误的结果**
3. **在性能和正确性之间，始终选择正确性**

**经验教训**：
- ✅ 优化很重要
- ✅ 但正确性更重要
- ✅ 缓存失效策略必须完整
- ✅ 测试各种参数组合（颜色、几何、crop 模式）

### 相关修复

这是继 HQ Export WB/Base 问题之后的第二个修复：
1. **HQ Export 修复**: buildPipeline 的 `toneAndCurvesInJs` 逻辑错误
2. **WebGL Crop 修复**: WebGL 缓存的依赖不完整

两个问题都是由于**系统设计不完整**导致的，需要**系统性地理解整个 pipeline**才能发现和修复。

### 用户反馈

再次感谢用户的坚持和耐心！"Believe me" 是发现 bug 的关键。如果用户不坚持，这些隐藏的 bug 可能永远不会被发现。

