# 02 — 移动端数码模式：架构

## 2.1 导航结构（修订后）

```
RootStack (Native Stack)
└── Main (HomeTabs · Bottom Tab)
    ├── Timeline (胶片专属，不改) ─── TimelineStack
    │   └── TimelineHome → HomeScreen
    ├── Map (共享，加 mode 过滤) ─── MapStack
    │   └── MapHome → MapScreen   ← 加顶部分段「胶片/数码/全部」
    └── Library (改造主战场) ─── LibraryStack
        ├── LibraryHome → LibraryScreen (改造：顶部 segmented「胶片/数码」)
        │     ├── [胶片分支] 现有 LibraryScreen 内容（不变）
        │     └── [数码分支] DigitalLibraryScreen（新）
        ├── Favorites          (共享，加 mode 过滤)
        ├── Collections        (共享，加 mode 过滤)
        ├── Equipment          (胶片专属，数码分支隐藏)
        ├── Inventory          (胶片专属，数码分支隐藏)
        ├── Stats              (共享，加 mode prop)
        ├── Films / Negatives  (胶片专属，数码分支隐藏)
        ├── DigitalAlbumList   (新，仅数码分支可入)
        └── DigitalAlbumDetail (新，仅数码分支可入)

RootStack 直接挂载（跨 tab 共享）
├── RollDetail       (胶片)
├── PhotoView        (共享 — 数码照片分支渲染) ← 主要修改点
├── ShotLog          (胶片)
├── Settings         (加数码启用提示卡片)
├── AISettings       (共享)
├── LocationDiagnostic
├── Pairing
└── LocationPicker
```

### 关键设计：`LibraryStackScreen` 的模式分支

`LibraryStackScreen` 是一个 Native Stack，里面注册了**所有** Library 子屏（胶片 + 数码）。模式分支不在导航层面（Stack 看不到"模式"），而在 **`LibraryScreen`（栈顶 Home）的渲染层面**——根据 segmented control 选中值，决定显示胶片内容（Favorites/Collections/Equipment/... 入口）还是数码内容（DigitalLibrary + 数码相册入口）。

**导航 push 不受限**：从数码分支点击相册 → `navigate('DigitalAlbumDetail', { id })`；从胶片分支点击相册 → 现有 Favorites/Themes 路径不变。两个分支共用同一个 Stack 实例，避免嵌套 Navigator。

### 模式持久化

`AsyncStorage` 键：`library_mode@${baseUrl}` → `'film' | 'digital'`。

- `LibraryScreen` mount 时读取初始值，segmented control 切换时写入。
- App 启动时**不**自动跳到数码（即使桌面默认工作区是 digital），保持移动端"现场胶片日志"定位。

## 2.2 数据流

### 共享 API Client（已就绪——但部分方法签名需绕过）

```
mobile/src/api/client.ts
  └── api (Proxy → @filmgallery/api-client 的 createApiClient)
        ├── albums.list({ include_deleted })         ← M2 用 ✓ 签名匹配
        ├── albums.get(id) / getPhotos(id, params)   ← M2 用 ⚠️ 服务端忽略 page/pageSize 参数（见 §2.2.1）
        ├── albums.addPhotos(id, photoIds)            ← M2 用 ✓
        ├── albums.removePhoto(id, photoId)           ← M2 用 ✓
        ├── albums.setCover(id, photoId)              ← M2 用 ✓
        ├── http.get('/api/photos', {mode,page,pageSize,sort,order})  ← M2-A 用 ⚠️ 不用 api.photos.search()（见 §2.2.1）
        ├── http.get('/api/photos/favorites', {mode}) ← 共享 Favorites ⚠️ 不用 api.photos.getFavorites()（见 §2.2.1）
        ├── photos.get(id) / update / delete          ← 共享 ✓
        ├── http.get('/api/tags', {mode})             ← 共享 Themes ⚠️ 直接 http.get
        ├── http.get('/api/stats/summary', {mode})    ← 共享 Stats ⚠️ 不用 api.stats.*()（见 §2.2.1）
        ├── digitalSessions.list()                    ← DigitalLibrary "最近导入" ✓
        └── http.get('/api/discover')                 ← Settings 提示卡片（读 capabilities.digital）
```

**移动端不需要新增 API 文件**，但**必须绕过若干 API client 方法直接用 `api.http.get()`**——原因见 §2.2.1。

### 2.2.1 API Client 方法绕过清单（review Critical #1/#2/#5/#7）

经审查 `packages/@filmgallery/api-client/` 与服务端路由对照，以下方法签名与服务端契约**不一致**，必须改用 `api.http.get(path, params)` 直接调用：

| 方法 | 问题 | 绕过方案 |
|---|---|---|
| `api.photos.search(filters)` | 客户端调 `/api/photos/search`，**服务端无此路由**（404）；服务端主列表是 `GET /api/photos` | `api.http.get('/api/photos', {mode,page,pageSize,sort,order})` |
| `api.photos.getFavorites()` | **零参签名**，传 `{mode}` 被吞掉 | `api.http.get('/api/photos/favorites', {mode})` |
| `api.stats.summary()` / `.gear()` | **零参签名**，传 `{mode}` 被吞掉 | `api.http.get('/api/stats/summary', {mode})` 等 |
| `api.tags.list()` | 同上 | `api.http.get('/api/tags', {mode})` |

> 这些方法的修复属于 `packages/@filmgallery/api-client/` 的范畴，**本移动端计划不修**（避免触发桌面端回归测试）。移动端一律用 `api.http.get()` 绕过。

### 2.2.2 服务端忽略的查询参数（review Warning #9）

`api.albums.getPhotos(id, {page,pageSize})` 会把参数拼到 query string，但服务端路由 `server/routes/albums.js` 的 prepared statement **不读取 req.query**——它返回该相册全部照片，不分页。

**影响**：相册照片数量大（>200）时一次返回，移动端 FlatList 处理 200+ 项仍可接受（窗口化）。

**对策**：
- M2-B 不依赖服务端分页，前端一次性接收全部相册照片，FlatList 窗口化渲染。
- 在 `DigitalAlbumDetailScreen` 加注释说明此约束。
- 如未来相册规模超 500，再开服务端 ticket 给 `albums.js` 加分页（**不属于本计划**）。

### 查询缓存

复用 `mobile/src/hooks/useApiQuery`（封装了 React Query）。键命名见 MD7。

失效策略：
- 进入相册详情 → invalidate `digitalAlbumPhotos@*`
- 操作完成（加入/移除/设封面）→ invalidate `digitalAlbums@*` + `digitalAlbum@${id}`
- 软删照片 → invalidate 所有 `digitalPhotos@*` 和 `digitalAlbumPhotos@*`

### 照片 URL

数码照片在 `photos` 表的字段（与桌面统一）：
- `positive_thumb_rel_path`（缩略图）
- `positive_rel_path`（全尺寸）
- `full_rel_path`（备份全尺寸）

`mobile/src/utils/urls.ts` 的 `getPhotoUrl(baseUrl, photo, 'thumb'|'full')` 已经按 `positive_thumb_rel_path → thumb_rel_path` / `positive_rel_path → full_rel_path` 顺序回退——**无需改动**。

### 数字照片的"点赞/标签/笔记"

- 点赞：`PUT /api/photos/:id { rating: 0|1 }`（与胶片共用语义，桌面 W2-B 已确认全站 `rating≠0` 即收藏）
- 标签：`TagEditModal`（现有）直接复用，服务端 `photo_tags` 表数码胶片共用
- 笔记：`PUT /api/photos/:id { caption }`，共用

### 下载

复用 `PhotoViewScreen` 的 `downloadPhoto()`——`POST /api/photos/:id/download-with-exif` 服务端通用，对数码照片会带上完整 EXIF 写入下载文件。

## 2.3 共享视图的 mode 过滤

桌面 W2-B 已完成 6 个服务端 mode 过滤点：`/api/photos/favorites`、`/api/photos/geo`、`/api/tags`、`/api/tags/:id/photos`、`/api/stats/themes`、`/api/stats/locations`。

移动端共享屏改造：

| 屏 | 当前调用 | 改造 |
|---|---|---|
| `FavoritesScreen` | `api.http.get('/api/photos/favorites')` | 加 mode prop / `useRoute` 参数，调 `api.http.get('/api/photos/favorites', { mode })`（**不要用 `api.photos.getFavorites()`**，零参签名会吞掉 mode） |
| `ThemesScreen` | `api.http.get('/api/tags')` | 加 mode prop，调 `api.http.get('/api/tags', { mode })` |
| `TagDetailScreen` | `api.http.get('/api/tags/:id/photos')` | 加 `{ mode }` query |
| `MapScreen` | `api.http.get('/api/photos/geo')` | 加顶部分段「胶片/数码/全部」，分段值传给 geo 请求 |
| `StatsScreen` | `/api/stats/summary` + `/api/stats/gear` | 加 mode prop，**直接用 `api.http.get('/api/stats/summary', { mode })`**（不要用 `api.stats.*()`，零参签名会吞掉 mode） |

mode 值的传递：`LibraryScreen` / `MapScreen` 顶部 segmented control 选中的值 → 通过 `navigation.navigate(name, { mode })` 的 params 传给子屏。子屏 `useRoute().params.mode` 读取，默认 `'film'`。

## 2.4 PhotoViewScreen 的数码分支（核心修改）

`mobile/src/screens/viewing/PhotoViewScreen.tsx` 当前 356 行。改造点：

### 隐藏（数码照片）

```tsx
const isDigital = photo?.source_type === 'digital';
// 原：{anyNegatives && (<TouchableOpacity>...底片切换</TouchableOpacity>)}
// 改：{anyNegatives && !isDigital && (...)}
```

### 新增 EXIF 信息块（数码照片）

Footer 区域加 EXIF overlay（参考桌面 `PhotoDetailsSidebar` 字段集）：
- 相机 + 镜头（`photo.camera` + `photo.lens`，或 EXIF 字段）
- 焦距 / 光圈 / 快门 / ISO（`photo.focal_length` / `photo.aperture` / `photo.shutter_speed` / `photo.iso`）
- 拍摄时间（`photo.date_taken`，已格式化）
- GPS（如有 `photo.latitude` / `photo.longitude`——**注意是 `latitude`/`longitude`，不是 `gps_lat`/`gps_lon`**）

折叠/展开：默认收起，点击 chevron 展开（避免遮挡图像）。

### 新增"所属相册"chips（数码照片）

调 `api.http.get('/api/albums', { photo_id: photo.id })`（桌面 W3-B 加的过滤参数）→ 渲染 chips，点击跳转 `DigitalAlbumDetail`。

### 操作菜单（长按 / 新增按钮）

数码照片加：
- "加入相册" → 弹出 `AlbumPickerSheet`（新 RN 组件，对应桌面 `AlbumAddPhotosModal`）
- "从相册移除"（仅当照片在某相册中查看时显示）
- "删除照片" → 调 `DELETE /api/photos/:id`（服务端走软删），snackbar 提示"已移入回收站（可在桌面端恢复）"

## 2.5 文件清单（新增 vs 修改）

### 新增（移动端）

| 文件 | 作用 | 估行 |
|---|---|---|
| `mobile/src/screens/library/DigitalLibraryScreen.tsx` | 数码照片网格 + 最近导入 sessions | ~250 |
| `mobile/src/screens/library/DigitalAlbumListScreen.tsx` | 相册列表（父子嵌套） | ~180 |
| `mobile/src/screens/library/DigitalAlbumDetailScreen.tsx` | 相册详情 + 长按操作 | ~220 |
| `mobile/src/components/digital/DigitalPhotoGrid.tsx` | FlatList 3 列网格（MD5） | ~100 |
| `mobile/src/components/digital/AlbumPickerSheet.tsx` | 相册选择 BottomSheet | ~120 |
| `mobile/src/components/digital/ExifSheet.tsx` | EXIF 详情 BottomSheet | ~140 |
| `mobile/src/components/digital/ModeSegmentedControl.tsx` | 胶片/数码分段控件 | ~60 |
| `mobile/src/components/digital/LibraryModeToggle.tsx` | LibraryScreen 顶部包装（含持久化） | ~50 |
| `mobile/__tests__/digital/DigitalLibraryScreen.test.tsx` | 渲染/分页/错误测试 | ~80 |
| `mobile/__tests__/digital/DigitalAlbumDetail.test.tsx` | 加入/移除/设封面测试 | ~100 |
| `mobile/__tests__/digital/PhotoViewDigital.test.tsx` | source_type 分支测试 | ~80 |

### 修改（移动端）

| 文件 | 改动点 | 估改动 |
|---|---|---|
| `mobile/App.tsx` | `LibraryStack` 注册 `DigitalAlbumList` / `DigitalAlbumDetail` 路由 | +20 |
| `mobile/src/screens/library/LibraryScreen.tsx` | 顶部加 `LibraryModeToggle`，按 mode 分支渲染主体 | +60 |
| `mobile/src/screens/viewing/PhotoViewScreen.tsx` | `source_type='digital'` 分支 + EXIF/相册/操作 | +120 |
| `mobile/src/screens/library/FavoritesScreen.tsx` | 加 mode prop + 透传到 API | +15 |
| `mobile/src/screens/library/ThemesScreen.tsx` | 加 mode prop | +10 |
| `mobile/src/screens/library/TagDetailScreen.tsx` | 加 mode prop | +10 |
| `mobile/src/screens/library/StatsScreen.tsx` | 加 mode prop | +15 |
| `mobile/src/screens/map/MapScreen.tsx` | 顶部 mode segmented + geo 请求带 mode | +40 |
| `mobile/src/screens/settings/SettingsScreen.tsx` | 数码启用卡片（探 `/api/discover`） | +40 |
| `mobile/src/i18n/zh.ts` / `en.ts` | `digital.*` 命名空间 | +50 each |

### 不改（确认清单）

- `mobile/src/api/client.ts` —— 共享 client 已就绪（用 `api.http.get()` 绕过有问题的方法）
- `mobile/src/api/queryCache.ts` —— 通用
- `mobile/src/utils/urls.ts` —— `getPhotoUrl` 已支持数码字段（review 实测确认：`positive_thumb_rel_path` / `positive_rel_path` / `full_rel_path` 优先级正确）
- `mobile/src/components/CachedImage.tsx` —— 通用
- `mobile/src/hooks/useApiQuery.ts` —— 通用（内存级 React Query 缓存，重启失效——已确认无持久层）
- `mobile/src/context/ApiContext.tsx` —— 不加 mode context（mode 是 LibraryScreen 局部状态）
- `mobile/src/api/stats.ts` —— **不改**（其辅助函数零参，但移动端绕过它直接用 `api.http.get()`）
- `packages/@filmgallery/api-client/**` —— **不改**（其 `photos.search` / `photos.getFavorites` / `stats.*` 签名问题由移动端绕过；修复属于另一 ticket，避免桌面回归）
- 服务端任何文件 —— 零改动（review 已逐项确认所有引用端点存在并支持 `?mode=`）

## 2.6 错误处理与离线

- 网络错误：`ApiErrorSnackbar`（现有）自动触发，数码屏不特殊处理。
- 服务端数码未启用（`/api/discover` 返回 `capabilities.digital` 为 `false` 或缺字段）：LibraryScreen 的数码 segmented **置灰 + 不可点击**，tooltip「请在桌面端启用数码模式」。
- 空状态：每个数码屏都要有空状态 UI（参考桌面 `AlbumLibrary` 的 `BookMarked` empty state 风格，用 RN 实现）。

## 2.7 性能

- 数码库可达 50k+，分页 60/页，FlatList 窗口化默认开启（`removeClippedSubviews` / `maxToRenderPerBatch=8`）。
- 图片走 `CachedImage`（现有，内部 expo-image + 磁盘缓存）。
- 不做无限预加载——只在用户滚动接近底部时拉下一页（`onEndReachedThreshold=0.5`）。
