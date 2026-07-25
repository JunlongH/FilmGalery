# 01 — 移动端数码模式：范围与决策

> 日期：2026-07-25  
> 基线：桌面端 digital mode 已交付（`../DIGITAL-MODE-IMPLEMENTATION-REVIEW.md`），418 测试全绿。  
> 对照：`../06-mobile-and-phasing.md` §6.1-6.2（原 Phase 2 移动只读）

## 1.1 范围

### 必做（M1 + M2）

- **M1 · 探测与提示**：`/api/discover` 返回 `capabilities.digital=true` 时（**注意字段名是 `digital`，不是 `digitalEnabled`**），Settings 顶部显示「数码模式已启用」卡片 + 跳转入口。
- **M2 · 只读浏览四件套**：
  - **DigitalLibraryScreen**：数码照片时序网格，按 `date_taken` 倒序，分页 60/页，下拉刷新。
  - **DigitalAlbumListScreen**：相册列表（含嵌套父子结构，复用桌面 `parent_id` 树）。
  - **DigitalAlbumDetailScreen**：相册详情网格 + 长按操作（设封面 / 移除）。
  - **DigitalPhotoViewScreen**：**复用** 现有 `PhotoViewScreen.tsx`，按 `source_type='digital'` 分支（隐藏底片切换、显示 EXIF 与所属相册 chips）。
- **导航**：Library tab 顶部 segmented control「胶片 / 数码」切换（默认胶片，记忆选择到 `AsyncStorage`）。
- **服务端依赖**：零改动（全部走桌面已交付端点）。

### 显式不做

| 项 | 不做原因 |
|---|---|
| 数码照片导入向导 | 桌面活动；移动端做上传摩擦大、收益小（已有 AirDrop / 桌面导入） |
| DigitalDevelop 调色 UI | 桌面 707 行专业 UI，移动端做不出可比体验；调色属于桌面活动 |
| RAW demosaic / EXIF 写入 | 同上 |
| 移动端照片直接导入（06 §6.1 Phase 3） | 需要后台传输 + 断点续传 + 权限，**单独立项**（见 03 §附录） |
| 回收站 UI | 桌面端有 `DeletedAlbumsSection`，移动端不做（恢复操作低频，去桌面） |
| 批量加标签 / 评分 / 多选 | 桌面 Library 已有；移动端聚焦"看"，操作走长按单条 |
| 智能相册 / FTS5 搜索 | 桌面端未做（属 Phase 2+），移动端同步推迟 |

### 显式保留为"低门槛兜底"

- **硬删除照片 / 相册**：移动端**不做彻底删除按钮**（防止误操作），只允许"移除出相册"和"软删照片"（调 `DELETE /api/photos/:id`，服务端会走软删路径返回 `{deleted:1,soft:true}`）。彻底删除走桌面。

## 1.2 决策记录

### MD1 · 薄客户端，不做本地数码库缓存

**决策**：移动端数码照片**每次都从服务端拉取**，不写入 AsyncStorage / SQLite。

**理由**：
- 50k+ 数码照片同步到手机不现实
- 桌面是 single source of truth，移动端缓存会引入一致性问题（在桌面删除的照片，移动端缓存还显示）
- 移动端胶片侧的 `useApiQuery` 缓存键是 `key@baseUrl` 的内存级 React Query，重启即失效——数码侧沿用同一机制，不新增持久层

**影响**：数码屏需要良好的骨架屏 + 分页 + 网络错误重试（沿用 `ApiErrorSnackbar`）。

### MD2 · Library tab 顶部 segmented control，不加第 4 个 tab

**决策**：在现有 Library tab 内顶部加「胶片 / 数码」分段切换，**不**新增"数码" tab。

**备选被否**：增加第 4 个底部 tab「数码」。
**否决理由**：
- 底部 tab 已经 3 个（Timeline / Map / Library），加第 4 个会挤、破坏"3-tab 主导航"既有约定
- Timeline（按卷）和 Map（地理）对数码意义有限——数码时序浏览放在 Library 下更合理
- segmented control 改动面小，与桌面侧边栏 toggle 概念对称

### MD3 · 复用 PhotoViewScreen，按 source_type 分支，不建并行屏

**决策**：`PhotoViewScreen.tsx` 一个文件同时支持胶片和数码，通过 `photo.source_type` 字段做条件渲染。

**分支点**：
- 数码照片**隐藏**：底片切换按钮（`anyNegatives && ...`）、`negative_rel_path` 相关逻辑
- 数码照片**额外显示**：完整 EXIF 块（相机/镜头/焦距/光圈/快门/ISO/GPS）、所属相册 chips（点击跳转相册详情）、文件信息（文件名/大小/拍摄时间）
- 数码照片**保留**：点赞、标签、笔记、下载（走 `/api/photos/:id/download-with-exif`，服务端已通用）

**否决**新建 `DigitalPhotoViewScreen.tsx`：会重复 300+ 行 ImageView 包装代码，维护两份。

### MD4 · 相册操作：移动端只做"浏览 + 加入 + 移除 + 设封面"，不做拖拽排序

**决策**：移动端相册详情屏支持长按照片弹操作菜单（加入其他相册 / 从本相册移除 / 设为本相册封面），**不做拖拽排序**（桌面 W2-A 已交付 HTML5 拖拽）。

**理由**：React Native 拖拽排序需要 `react-native-draggable-flatlist` 等额外依赖 + 手势冲突处理，移动端使用频率低；排序走桌面。

### MD5 · 不复用桌面 PhotoGrid，移动端用自己的 FlatList 网格

**决策**：移动端数码网格**重新写**一个轻量 `DigitalPhotoGrid.tsx`（FlatList + numColumns=3 + CachedImage），不复用桌面的 `PhotoGrid.jsx`。

**理由**：
- 桌面 PhotoGrid 是 react-window 虚拟化 + HTML5 drag + HeroUI 组件，与 RN 不兼容
- 移动端胶片侧也没有"统一照片网格"组件可复用——胶片是按卷封面卡片，结构不同
- 新写一个 100 行内的 FlatList 组件，比适配跨平台代码更便宜

### MD6 · i18n：数码相关文案双语（zh + en）

**决策**：所有新增文案同时进 `mobile/src/i18n/zh.ts` 和 `en.ts`，键名加 `digital.` 前缀。

**理由**：现有 i18n 已是双语，新增不破坏约定。

### MD7 · 缓存键命名

**决策**：移动端数码相关查询键：
- `digitalPhotos@${baseUrl}?mode=digital&page=N` 
- `digitalAlbums@${baseUrl}`
- `digitalAlbum@${baseUrl}.${id}`
- `digitalAlbumPhotos@${baseUrl}.${id}`

沿用 `key@baseUrl` 既有模式，重启后失效（与胶片一致）。

### MD8 · 主题切换、暗色模式

数码屏复用现有 Paper 主题（`appTheme` / `appDarkTheme`），不引入数码专属主题色。卡片样式参考 `LibraryScreen.tsx` 的 `statCard` / `favoriteCard` 既有风格。

## 1.3 与设计文档 06 的偏离声明

设计文档 06 §6.1 Phase 2 列了 4 个数码屏 + Library tab 切换，**估 5 人天**。本计划修订为：

| 项 | 06 估算 | 本计划估算 | 差异原因 |
|---|---|---|---|
| 4 个数码屏 | 5 人天 | 4 人天 | 复用 PhotoViewScreen（少一个屏） |
| Library tab 切换 | 1 人天 | 1 人天 | 一致 |
| EXIF/相册信息块 in PhotoView | 未估 | 1 人天 | 桌面 W3-B 已做，移动端需要 |
| Settings 提示卡片 | 未估（在 MVP） | 0.5 人天 | 与 M1 合并 |
| 软删除/相册操作/i18n/测试 | 未估 | 1.5 人天 | 桌面端验收暴露的必备项 |
| **合计** | **6 人天** | **~8 人天** | +2 人天覆盖桌面 W3-B 等价能力 |

净增 2 人天，主要花在 PhotoView 的数码分支和相册操作上——这部分桌面 W2-A/W3-B 暴露为必须项。
