Research FilmGalery app structure

Searched codebase for "feature list, main features, core features, functionality", 17 results

Searched codebase for "technical stack, frontend, backend, database, react version, express, node, react native, expo", 20 results

Searched codebase for "TODO|FIXME|error|validation|performance|missing|gap", 28 results

Searched codebase for "user workflow, add film, add roll, view photo, edit photo, tag, favorite, search, upload, storage", 14 results

根据对你的胶片管理软件的全面分析，我有以下改进建议：

## 🎯 **优先级高的改进方向**

### 1. **批量操作功能**
- **批量编辑照片**：同时设置多张照片的标签、评分、说明
- **批量导出**：选择多张照片导出（支持原图/编辑后/缩略图）
- **批量删除**：删除多张照片或胶卷

### 2. **数据备份与导出**
- **完整数据导出**：导出所有照片、元数据、编辑历史为压缩包
- **数据库备份**：定期自动备份 SQLite 数据库
- **云端同步**：集成 OneDrive/Dropbox/iCloud API 实现自动同步

### 3. **增强搜索功能**
- **高级搜索**：按标签、日期范围、相机、胶片、拍摄者组合搜索
- **全文搜索**：搜索照片说明、胶卷备注内容
- **搜索历史**：保存常用搜索条件

### 4. **FilmLab 编辑器增强**
- **预设管理**：保存/加载常用编辑参数（例如"Portra 400 预设"）
- **批量应用**：将编辑参数应用到整卷胶片
- **对比模式**：编辑时显示前/后对比视图
- **更多滤镜**：添加颗粒感、锐化、降噪等效果

## 🔧 **技术优化方向**

### 5. **性能优化**
- **虚拟滚动**：照片网格使用虚拟滚动（react-window）处理大量照片
- **图片懒加载优化**：使用 Intersection Observer 改进加载策略
- **Worker 线程**：将图片处理移至 Web Worker 避免 UI 卡顿

### 6. **数据验证与错误处理**
- **文件上传验证**：限制文件类型（JPEG/PNG/TIFF）和大小
- **表单验证增强**：必填字段提示、格式校验
- **友好的错误提示**：替换 alert 为美观的 toast 通知

### 7. **代码质量**
- **添加单元测试**：使用 Jest + React Testing Library
- **添加 E2E 测试**：使用 Playwright 测试关键流程
- **TypeScript 迁移**：逐步迁移到 TypeScript 提高类型安全

## 📱 **用户体验改进**

### 8. **移动端完善**
- **功能对齐**：确保移动端与桌面端功能一致
- **离线模式**：支持离线查看已缓存的照片
- **分享功能**：直接分享照片到社交媒体

### 9. **界面优化**
- **主题支持**：深色/浅色主题切换
- **快捷键**：添加常用操作的键盘快捷键（如 F 收藏、E 编辑）
- **拖拽排序**：支持拖拽调整照片顺序

### 10. **智能功能**
- **标签建议**：基于历史标签自动建议
- **重复照片检测**：识别并标记相似照片
- **EXIF 自动填充**：上传时自动读取相机、镜头等 EXIF 信息

## 🌟 **创新功能**

### 11. **统计与可视化**
- **拍摄统计**：每月拍摄数量、使用最多的胶片/相机
- **时间线视图**：按时间轴展示所有胶卷
- **地图视图**：如果有 GPS 信息，在地图上显示拍摄位置

### 12. **社区与分享**
- **导出画廊页面**：生成静态 HTML 画廊用于分享
- **水印功能**：导出时自动添加可自定义的水印
- **打印排版**：生成适合打印的联系表（Contact Sheet）

### 13. **AI 辅助**
- **自动标签**：使用本地 AI 模型自动识别照片内容并添加标签
- **智能曝光**：AI 辅助的自动曝光和色彩校正
- **场景识别**：自动识别风景/人像/静物等场景类型

## 🔒 **安全与协作**

### 14. **用户系统（可选）**
- **多用户支持**：如果需要多人使用，添加简单的用户认证
- **权限管理**：只读/编辑权限控制

---

## 💡 **我的建议优先级排序**

**立即可做（工作量小、价值高）：**
1. ✅ 批量操作（选择、标签、导出）
2. ✅ 数据备份/导出功能
3. ✅ 高级搜索（标签+日期组合）
4. ✅ FilmLab 预设管理

**中期规划（需要一定开发时间）：**
5. ⚙️ 性能优化（虚拟滚动、Worker）
6. ⚙️ 表单验证与错误处理改进
7. ⚙️ 主题切换 + 快捷键
8. ⚙️ 移动端功能对齐

**长期目标（需要较大投入）：**
9. 🚀 云端同步
10. 🚀 AI 辅助功能
11. 🚀 TypeScript 迁移 + 完整测试

你觉得哪些方向最符合你的需求？我可以帮你制定详细的实施计划！


先用你的工作流整理一下需求，然后给出一个清晰的文件结构和前后端设计方案（面向 16bit、但前台主看 JPG），方便后面按步骤实现。

**1. 你的目标工作流（整理成系统视角）**

- 输入：
  - 扫描得到的原片：正片 or 负片。
  - 原始格式：`JPG / TIFF / BMP`，其中 TIFF/BMP 可能是 16bit。
- 在应用里：
  - 先把“原片”（即扫描文件）上传到系统（无论是正片还是负片）。
  - 对正片：在 Film Lab 里做色彩 / 曲线等调整。
  - 对负片：在 Film Lab 里做去色罩、反转、色彩校正等。
- 输出与展示：
  - 前台主要展示**高质量 JPG 正片**：
    - 对正片：调整后的高质量 JPG。
    - 对负片：Film Lab 输出的高质量“正片 JPG”。
  - 针对“上传时就是负片的文件”，前台还要展示**一张高质量的“负片 JPG”缩略图/大图**，方便对比与浏览。
- 技术要求：
  - 希望保留 16bit 宽容度：  
    原始 TIFF/BMP 不被破坏，编辑尽量在高精度空间发生，JPG 仅作为最终展示格式。

---

**2. 文件与数据库结构设计**

以 `photos` 表为中心，为每张照片明确三类资源：

1. **原始扫描文件（原片，高位深）**
   - 可能是：`original_scan.tif / .tiff / .bmp / .jpg`。
   - 不参与直接展示，只作为高精度源。
2. **负片展示 JPG（仅当原片是负片时）**
   - 一张高质量的 **负片 JPG**，用于前台“负片模式”展示。
   - 可以是从原片直接轻度压缩得到（若原片是 TIFF/BMP 负片），或从已有负片 JPG 拷贝。
3. **正片展示 JPG（Film Lab 输出）**
   - 一张高质量的 **正片 JPG**，作为主展示图（相册里/大图浏览/Film Lab 之后的结果）。

建议在数据库 `photos` 表里新增/规范以下字段（新分支上可以加迁移）：

- `original_rel_path`：原始扫描文件的相对路径（TIFF/BMP/JPG）。
- `negative_rel_path`：负片 JPG 的相对路径（如果有负片展示需求）。
- `positive_rel_path`：正片 JPG 的相对路径（Film Lab 输出的主图）。
- `is_negative_source`：布尔（或 0/1），标记“上传源是否为负片”。

现在你已有的字段里有：

- `full_rel_path`：之前的主图路径（可以平滑迁移为 `positive_rel_path`，兼容老数据）。
- `negative_rel_path`：已经存在，用于负片浏览。

在新结构中，可以约定：

- **向后兼容**：
  - 若 `positive_rel_path` 为空，则使用原来的 `full_rel_path`。
  - 新照片则直接填 `positive_rel_path`，老逻辑逐步迁移。

---

**3. 后端处理流程设计**

以“上传单张扫描文件到某个 roll”为例，完整流水线：

1. **上传阶段（`/api/rolls/:id/photos` 或类似路由）**

- 接收文件（支持 `.jpg/.jpeg/.png/.tif/.tiff/.bmp`）。
- 一律将源文件保存为 `original_rel_path`：
  - 存在 `uploads/originals/<roll_id>/<photo_id>/original.ext`。
- 根据前端传入的元数据 `isNegative`（你已经有这个字段）：
  - 若 `isNegative = true`：
    - 使用 `sharp(original)` 生成一张高质量 **负片 JPG**：
      - 例如：`uploads/rolls/<roll_id>/<photo_id>_neg.jpg`。
    - 写入 `negative_rel_path` 指向这张负片。
    - 此时**不立即生成正片 JPG**，把“从原片反转+去色罩+校正”的工作交给 Film Lab。
  - 若 `isNegative = false`（源是正片）：
    - 使用 `sharp(original)` 直接生成一张高质量 **正片 JPG**：
      - `uploads/rolls/<roll_id>/<photo_id>_pos.jpg`。
    - 写入 `positive_rel_path`（以及兼容的 `full_rel_path`）。

2. **Film Lab 打开时**

- 无论正片/负片，Film Lab 的编辑输入都应该从**原片**开始读取：
  - 如果可行，后端为 Film Lab 提供一个渲染接口（16bit 模式中我们打算这样做）：
    - `GET /api/photos/:id/render?mode=preview&params=...`
    - 这个接口用 `sharp` 从 `original_rel_path` 读入，按当前 Film Lab 参数运算（高精度），返回一张用于前端 `<img>` / `<canvas>` 的预览 JPG/PNG。
  - 这样可以最大限度利用 16bit 动态范围。

- 对负片：
  - 在 Film Lab 里额外包含反转/去色罩步骤（已经有 inversion + 基底采样逻辑，可迁移到后端）。
  - 渲染时，后端先在高位深空间进行反转、色调整，再输出 8bit 预览。

3. **Film Lab 完成编辑后“应用/保存”**

- 用户点击“保存到正片”时：
  - 前端把当前参数打包发送到一个“导出端点”：
    - `POST /api/photos/:id/export-positive`
    - Body：`{ params, quality: 95 }`
  - 后端从 `original_rel_path` 读取原片，以 16bit/float精度执行完整处理：
    - 对正片：色彩/曲线/曝光等。
    - 对负片：反转、去色罩、色彩/曲线等。
  - 生成一张终版 **正片 JPG**：
    - `uploads/rolls/<roll_id>/<photo_id>_pos.jpg`
  - 写入/更新：
    - `positive_rel_path`（并兼容更新 `full_rel_path`）。

这样：

- 源始终保存在 `original_rel_path`（高位深不丢）。
- 对于负片：
  - `negative_rel_path`：用于前台显示负片。
  - `positive_rel_path`：Film Lab 输出的正片 JPG。
- 对于正片：
  - 只有 `original_rel_path` + `positive_rel_path`。
- 前台展示时：
  - 默认使用 `positive_rel_path` 作为主图。
  - 如果 `is_negative_source = true`，某些页面上可以同时展示 `negative_rel_path` 的预览（例如在详情页左右对比）。

---

**4. 前端展示与 Film Lab 接入**

1. **列表 / 缩略图**

- 统一使用 `positive_rel_path`（若为空则回退到历史的 `full_rel_path` 或负片路径）。
- 对于“负片来源”的照片：
  - 在详情页增加一个“查看负片”区域，使用 `negative_rel_path` 生成小缩略图或点击放大。

2. **Film Lab 打开逻辑**

- 目前 Film Lab 是直接拿 `imageUrl`（JPG 文件）本地做 8bit 运算。
- 在 16bit 模式下，可以分两阶段推进（兼容旧逻辑）：

  - 阶段 1（过渡期）：
    - 打开 Film Lab 时：
      - 仍旧拿 `positive_rel_path` 或 `negative_rel_path` 作为输入（即现有逻辑），感知到的是 8bit 图。
      - 只是多记录一下此时参数，之后为导出准备。
    - 真正 16bit 处理仅在“导出端点”发生。

  - 阶段 2（真正高位深实时预览）：
    - Film Lab 的参数变化不在前端本地 `processImage()` 运算，而是：
      - 通过 `POST /api/photos/:id/preview` 发送参数（带一个小型 preview 请求）。
      - 后端根据 `original_rel_path` 与参数生成一张降分辨率但高精度运算的预览 JPG（例如宽 1000）。
      - 前端只负责展示新预览图，让直方图/曲线 UI 跟参数一致。
    - 导出时再调用 `export-positive`，生成高质量正片 JPG。

---

**5. 下一步实现建议**

在你当前的 `feature/filmlab-16bit` 分支上，我建议按以下顺序推进代码改造（保持每一步可运行）：

1. **DB 与文件结构**
   - 在 server.js 里给 `photos` 表加：
     - `original_rel_path TEXT`
     - `positive_rel_path TEXT`
     - `is_negative_source INTEGER DEFAULT 0`
   - 保持现有 `negative_rel_path`。
   - 写一个小迁移函数（类似现在的 `ensureExtraColumns`）自动添加这些列。

2. **上传逻辑调整**
   - 在上传路由（`routes/rolls.js` / `routes/uploads.js` 等）：
     - 保存原始文件到 `uploads/originals/...`。
     - 按 `isNegative`：
       - 若负片：
         - 用 `sharp` 生成负片 JPG，填 `negative_rel_path`。
       - 若正片：
         - 用 `sharp` 生成正片 JPG，填 `positive_rel_path`（兼容旧字段）。

3. **前端读取逻辑**
   - 在列表/详情/Film Lab 入口处：
     - 对于主展示：优先使用 `positive_rel_path`（或现有 `full_rel_path`），保持当前界面体验不变。
     - 对于负片：详情页里多展示 `negative_rel_path` 的缩略图（这可以之后再加）。

4. **Film Lab 导出端点**
   - 后端新增：
     - `POST /api/photos/:id/export-positive`：基于 `original_rel_path + params` 生成正片 JPG。
   - 前端 Film Lab 加一个“高质量保存”按钮，调用这个端点。

等上面这几步落地后，我们再继续把“实时预览”逐步迁到后端高位深预览，这时你的 16bit 价值会慢慢体现出来。

---

如果你认可这个整体结构，我可以从第一步（DB 列 + 上传逻辑调整）开始在仓库里直接改实现。

在后端保留原始 16bit TIFF/BMP，并在 DB 中记录 original_rel_path。
在 Electron/Node 侧实现一个高位深渲染服务（先用 Node + sharp 做 float/16bit pipeline，之后如有需要再逐步迁到 WebGL float）。
在 Film Lab 中添加"16bit 模式"开关，参数统一发给高位深渲染服务，前端只接收预览帧。
逐步把曝光/曲线等核心调整迁移到高精度管线，并保持现有 8bit 管线做 fallback。
