# 03 — 移动端数码模式：实现计划

> 总工作量：~8 人天（单人全时约 1.5-2 周）  
> 分波：M1（探测）→ M2-A（Library + 网格）→ M2-B（相册）→ M2-C（PhotoView + 共享屏 + i18n + 测试）  
> 每波结束跑 `cd mobile && npx jest` + `npx tsc --noEmit`，绿了再进下一波

## M1 · 探测与提示（0.5 人天）

**目标**：用户在桌面启用数码模式后，移动端能看到提示。

### 工作项

| # | 项 | 文件 | 验收 |
|---|---|---|---|
| M1-1 | `SettingsScreen` 加数码启用卡片 | `mobile/src/screens/settings/SettingsScreen.tsx` | 调 `api.http.get('/api/discover')`，读 `data.capabilities.digital`（**注意：字段名是 `digital`，不是 `digitalEnabled`**）；为 `true` 时显示卡片 |
| M1-2 | 卡片点击跳转 Library（数码分支） | 同上 | 跳转 + 写 `library_mode@${baseUrl}='digital'` |
| M1-3 | i18n 文案 | `mobile/src/i18n/{zh,en}.ts` 加 `digital.enabledTitle` / `digital.enabledBody` / `digital.goToDigital` | 双语齐 |

### 依赖
- 桌面端 `/api/discover` 已暴露 `capabilities`（W2 验证过）。

---

## M2-A · Library 模式切换 + 数码网格（2 人天）

**目标**：Library tab 能切到数码，看到数码照片时序网格。

### 工作项

| # | 项 | 文件 | 验收 |
|---|---|---|---|
| A-1 | `LibraryModeToggle` 组件 | `mobile/src/components/digital/LibraryModeToggle.tsx` | segmented control「胶片/数码」，读写 `library_mode@${baseUrl}` |
| A-2 | `LibraryScreen` 接入 toggle + 分支渲染 | `mobile/src/screens/library/LibraryScreen.tsx` | mode='film' 显示现有内容；mode='digital' 显示 `DigitalLibraryScreen` |
| A-3 | `DigitalPhotoGrid` 组件 | `mobile/src/components/digital/DigitalPhotoGrid.tsx` | FlatList numColumns=3，每项 CachedImage，点击 → `navigate('PhotoView', { photo, photosKey, source_type:'digital' })` |
| A-4 | `DigitalLibraryScreen` | `mobile/src/screens/library/DigitalLibraryScreen.tsx` | **不要用 `api.photos.search()`**（其调 `/api/photos/search` 服务端不存在 → 404）；改用 `api.http.get('/api/photos', { mode:'digital', page, pageSize:60, sort:'date_taken', order:'desc' })`。下拉刷新；滚动到底加载下一页；顶部"最近导入 sessions"区块（`api.digitalSessions.list()`）；空状态 |
| A-5 | LibraryStack 注册路由 | `mobile/App.tsx` | 不需要——DigitalLibraryScreen 嵌在 LibraryScreen 内部，不走 Stack push。但 `DigitalAlbumList` / `DigitalAlbumDetail` 需要注册（M2-B 做） |

### 验收
- 启动 app → Library tab → 切到数码 → 看到数码照片网格。
- 下拉刷新 + 滚动分页正常。
- 杀进程重启 → Library mode 保持上次选择（持久化生效）。

### 依赖
- A-4 依赖桌面 `/api/photos?mode=digital&sort=date_taken&order=desc&page=N` 主列表端点 —— 已交付（注意：**不**是 `/api/photos/search`，服务端无此路由）。
- A-4 依赖 `/api/digital-sessions` —— 已交付。

---

## M2-B · 数码相册闭环（2 人天）

**目标**：浏览、创建（可选）、加入、移除、设封面。

### 工作项

| # | 项 | 文件 | 验收 |
|---|---|---|---|
| B-1 | `DigitalAlbumListScreen` | `mobile/src/screens/library/DigitalAlbumListScreen.tsx` | `api.albums.list()`，渲染父子嵌套（root + 缩进 children），点击 → `DigitalAlbumDetail`；空状态；右上"+"按钮 → 创建相册对话框（Paper Portal） |
| B-2 | `DigitalAlbumDetailScreen` | `mobile/src/screens/library/DigitalAlbumDetailScreen.tsx` | `api.albums.getPhotos(id, {})`——**注意服务端 `server/routes/albums.js` 的 prepared statement 不读 `req.query`，一次性返回全部照片，无分页**；前端 FlatList 窗口化渲染即可（<500 项可接受）；长按照片 → ActionDialog（加入其他相册 / 从本相册移除 / 设为本相册封面）；invalidate 相应缓存 |
| B-3 | `AlbumPickerSheet` | `mobile/src/components/digital/AlbumPickerSheet.tsx` | BottomSheet 列出所有相册 + "新建相册"行；选中后调 `api.albums.addPhotos(albumId, [photoId])`；关闭回调 |
| B-4 | LibraryStack 注册路由 | `mobile/App.tsx` | 注册 `DigitalAlbumList` / `DigitalAlbumDetail` 两条 Stack.Screen，title 用 i18n |
| B-5 | DigitalLibraryScreen 入口 | 同 A-4 | 顶部加"我的相册"入口卡片，navigate 到 B-1 |

### 操作语义
- **加入相册**：PhotoView 或 AlbumDetail 长按 → `AlbumPickerSheet` → `albums.addPhotos`。成功 snackbar "已加入 N 个相册"。
- **从相册移除**：仅在 AlbumDetail 内长按显示。`albums.removePhoto(id, photoId)`。成功后从列表移除 + snackbar。
- **设封面**：仅在 AlbumDetail 内长按显示。`albums.setCover(id, photoId)`。成功后顶部封面图更新。
- **删除照片**：仅在 PhotoView 操作菜单（不在网格长按，防误操作）。`DELETE /api/photos/:id`（软删）。成功后 `goBack()` + invalidate `digitalPhotos@*`。

### 验收
- 创建相册 → 列表出现。
- 从 DigitalLibrary 点照片进 PhotoView → 操作菜单 → 加入相册 → AlbumDetail 能看到。
- AlbumDetail 长按 → 移除 → 列表更新。
- AlbumDetail 长按 → 设封面 → 列表卡片封面更新（缓存失效）。

### 依赖
- 全部端点已交付（桌面 W2-A + W3-B）。

---

## M2-C · PhotoView 分支 + 共享屏 mode 过滤 + 测试（3.5 人天）

**目标**：数码照片的全屏查看体验完整；共享视图支持 mode 过滤；测试覆盖。

### 工作项

| # | 项 | 文件 | 验收 |
|---|---|---|---|
| C-1 | PhotoView 数码分支 | `mobile/src/screens/viewing/PhotoViewScreen.tsx` | `isDigital = photo.source_type==='digital'`；数码隐藏底片切换；数码显示 EXIF 信息块（可折叠）；数码显示所属相册 chips；数码显示操作菜单按钮（加入相册 / 删除） |
| C-2 | `ExifSheet` | `mobile/src/components/digital/ExifSheet.tsx` | BottomSheet 显示完整 EXIF（相机/镜头/焦距/光圈/快门/ISO/GPS/拍摄时间/文件名/文件大小），从 `photo` 字段渲染 |
| C-3 | `FavoritesScreen` mode prop | `mobile/src/screens/library/FavoritesScreen.tsx` | `route.params.mode` 透传到 `api.http.get('/api/photos/favorites', { mode })`（**不要用 `api.photos.getFavorites()`**——零参签名会吞掉 `{mode}`）；默认 `'film'` |
| C-4 | `ThemesScreen` mode prop | 同上 | `api.http.get('/api/tags', { mode })` |
| C-5 | `TagDetailScreen` mode prop | 同上 | `api.http.get('/api/tags/:id/photos', { mode })` |
| C-6 | `StatsScreen` mode prop | 同上 | **直接用 `api.http.get('/api/stats/summary', { mode })`** 等（不要用 `api.stats.*()`——零参签名会吞掉 `{mode}`）；多处 stats 调用均需带 mode |
| C-7 | `MapScreen` mode segmented | `mobile/src/screens/map/MapScreen.tsx` | 顶部"胶片/数码/全部"分段；选中值传给 `/api/photos/geo?mode=` |
| C-8 | Library mode 透传 | `mobile/src/screens/library/LibraryScreen.tsx` | 数码分支点击 Favorites/Themes 入口时，navigate 参数带 `mode:'digital'`；胶片分支不变 |
| C-9 | i18n 全量 | `mobile/src/i18n/{zh,en}.ts` | `digital.*` 命名空间全部补齐（library/albums/photoView/exif/actions 等子组） |
| C-10 | 测试：DigitalLibraryScreen | `mobile/__tests__/digital/DigitalLibraryScreen.test.tsx` | 渲染 / 分页 / 空状态 / 网络错误 |
| C-11 | 测试：DigitalAlbumDetail | `mobile/__tests__/digital/DigitalAlbumDetail.test.tsx` | 加载 / 加入相册 / 移除 / 设封面 |
| C-12 | 测试：PhotoView 数码分支 | `mobile/__tests__/digital/PhotoViewDigital.test.tsx` | 数码时隐藏底片切换；数码时显示 EXIF；source_type=film 行为不变（回归） |
| C-13 | 测试：相册 API 集成 | `mobile/__tests__/digital/albums-integration.test.tsx` | mock client，验证调用契约（参数 / 路径） |

### 验收（M2 整体）
- `cd mobile && npx jest` 全绿（含既有测试无回归）。
- `cd mobile && npx tsc --noEmit` 0 错误。
- 在桌面端导入数码照片 + 创建相册 → 移动端能浏览全部内容 + 操作（加入/移除/设封面/点赞/标签/笔记/下载）。
- 数码照片的 PhotoView 显示完整 EXIF + 所属相册，无底片切换按钮。
- Timeline tab（胶片卷列表）行为完全不变。

### 依赖
- C-1 ~ C-8 全部依赖桌面端已交付的服务端契约（已确认）。
- C-10 ~ C-13 依赖 M2-A / M2-B 完成的组件。

---

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 大库（10k+ 数码照片）FlatList 性能差 | M2-A 已规划 `removeClippedSubviews` + 分页 60/页；若实测卡顿，加 `getItemLayout` + `initialNumToRender=12` |
| Paper BottomSheet 在 Android 行为不稳定 | `AlbumPickerSheet` / `ExifSheet` 用 `react-native-paper` 的 `Modal`（更稳）或 `@react-native-community/blur` 包装；如必要降级到全屏 Modal |
| 共享视图 mode 透传链路长（Library → navigate params → 子屏 useRoute） | 提供 `useLibraryMode()` hook 封装，集中处理默认值与回退 |
| 用户期待"在手机上调色" | 产品文案明示"数码调色请用桌面端"；PhotoView 不暴露任何调色入口 |
| 旧胶片用户的 Library 入口被数码切换"打扰" | segmented control 默认胶片 + 持久化；首次切到数码时一次性 tip "数码模式已启用，可随时切回" |

---

## 附录：手机照片直接导入（Phase 3，**不**在本计划内）

设计文档 06 §6.1 Phase 3 提到的"手机照片直接导入"是移动端数码最强动机，但工作量与复杂度远超 M1+M2：

- 后台传输服务（Android Foreground Service / iOS Background Tasks）
- 断点续传（分块上传 + 状态持久化）
- 相册权限申请 + 用户引导
- 上传完成通知桌面端（WebSocket / polling）
- 失败重试 + 部分成功 UI

**预估**：5-8 人天（设计文档 06 估 5，本计划修订为 5-8，因 RN 后台传输库碎片化严重）。

**建议**：M1+M2 上线后，观察用户反馈（是否反复尝试"导入"按钮、是否抱怨 AirDrop 摩擦），再决定是否启动 Phase 3。**不要在 M1+M2 期间顺手做**。

---

## 工作量汇总

| 波 | 内容 | 人天 |
|---|---|---|
| M1 | 探测 + 提示卡片 + i18n | 0.5 |
| M2-A | Library 切换 + 数码网格 | 2 |
| M2-B | 数码相册闭环 | 2 |
| M2-C | PhotoView 分支 + 共享 mode + 测试 | 3.5 |
| **总计** | | **8 人天** |

可在 2 周内（含集成测试与缓冲）单人交付。

---

## Review 修订记录（v2，2026-07-25）

经 `@review` 子 agent 对抗审查，本计划作出以下修正：

### Critical 修正

| # | 原内容 | 修正后 |
|---|---|---|
| C1 | `api.photos.search({mode,...})` | `api.http.get('/api/photos', {...})` —— 客户端 `search` 方法调 `/api/photos/search`，服务端无此路由 |
| C2 | `api.photos.getFavorites({mode})` | `api.http.get('/api/photos/favorites', {mode})` —— 客户端 `getFavorites` 零参签名，吞掉 `{mode}` |
| C3 | `capabilities.digitalEnabled` | `capabilities.digital` —— `/api/discover` 实际返回的字段名 |
| C4 | `photo.gps_lat` / `gps_lon` | `photo.latitude` / `longitude` —— 数据库实际列名 |

### Warning 修正

| # | 内容 |
|---|---|
| W5/W7 | `StatsScreen` 与共享 `api.stats.*()` 也不接受参数 —— 一律用 `api.http.get()` 绕过 |
| W6 | 全计划统一用 `/api/discover`（不用 `/api/app-config`），避免响应 shape 混淆 |
| W9 | `api.albums.getPhotos(id, {page})` 服务端忽略分页参数 —— M2-B 改为前端一次性接收 + FlatList 窗口化 |
| W8 | 已确认 `api.photos.search()` 在桌面端也无消费者——本计划是其第一个用户，因此 Critical C1 必须修正 |

### 不修（已评估）

- 共享 `packages/@filmgallery/api-client/` 的方法签名 bug（`search`/`getFavorites`/`stats.*`）—— 修复属于另一 ticket，避免触发桌面端 418 测试的回归风险。移动端一律用 `api.http.get()` 绕过。
