# 04 — 移动端数码模式：实现检查清单

> 实现完成后逐项打勾。每项对应 `03-mobile-implementation-plan.md` 的工作项编号。

## M1 · 探测与提示

- [x] M1-1 `SettingsScreen.tsx` 调 `api.http.get('/api/discover')`，读 `data.capabilities.digital`（**不是 `digitalEnabled`**）条件渲染卡片
- [x] M1-2 卡片点击 → `navigation.navigate('Main', { screen: 'Library' })` + 写 `` AsyncStorage `library_mode@${baseUrl}` = 'digital' ``（注意用模板字符串拼接 baseUrl）
- [x] M1-3 i18n `digital.enabledTitle` / `enabledBody` / `goToDigital` 双语齐
- [x] M1-TEST：`capabilities.digital=false`（或缺字段）时卡片不渲染

## M2-A · Library 切换 + 数码网格

- [x] A-1 `LibraryModeToggle.tsx`：Paper `SegmentedButtons`，读写 `library_mode@${baseUrl}`
- [x] A-1 切换时调 `setState` + 持久化，不阻塞 UI
- [x] A-2 `LibraryScreen.tsx`：mode='film' 走原逻辑；mode='digital' 替换主体为 `DigitalLibraryScreen`（保留 HeaderRight 等顶层装饰）
- [x] A-2 App.tsx `LibraryStack` 不动（DigitalLibrary 是嵌入组件）
- [x] A-3 `DigitalPhotoGrid.tsx`：`FlatList numColumns={3}`，`CachedImage` + 占位骨架，`onPress(item, index)`
- [x] A-3 `keyExtractor=(item)=>String(item.id)`，`getItemLayout` 固定高度优化（review 修复：offset 按 `Math.floor(index/NUM_COLUMNS)` 计算）
- [x] A-4 `DigitalLibraryScreen.tsx`：**未用 `api.photos.search()`**；改用 `api.http.get('/api/photos', { mode:'digital', page, pageSize:60, sort:'date_taken', order:'desc' })`
- [x] A-4 缓存键 `digitalPhotos@${baseUrl}?mode=digital&page=${page}`
- [x] A-4 `RefreshControl` 下拉刷新；`onEndReached` 加载下一页（review 修复：useRef 锁防重复 fetch）
- [x] A-4 顶部"最近导入" sessions 区块：`api.http.get('/api/digital-sessions')`（api-client 类型未声明 digitalSessions，按 §2.2.1 策略直调），横向滚动卡片
- [x] A-4 "我的相册"入口卡片（M2-B 完成后激活），navigate 到 `DigitalAlbumList`
- [x] A-4 空状态：无照片时显示"还没有数码照片，请用桌面端导入"
- [x] A-4 网络错误：`ApiErrorSnackbar` 自动触发，骨架屏保留
- [x] A-5 杀进程重启，Library mode 持久化生效（e2e 已验证：force-stop 重启后保持数码/胶片模式）

## M2-B · 数码相册闭环

- [x] B-1 `DigitalAlbumListScreen.tsx`：`api.http.get('/api/albums')`，缓存键 `digitalAlbums@${baseUrl}`
- [x] B-1 父子嵌套渲染：root albums + 缩进 children（`parent_id` 树）；孤儿提升为 root（与桌面 AlbumLibrary 对齐）
- [x] B-1 每条显示 title + photo_count + cover_photo（缩略图圆角）
- [x] B-1 右上 "+" → 自定义 Modal 创建相册（`api.http.post('/api/albums', {title, parent_id?})`），成功后 invalidate `digitalAlbums@*`
- [x] B-1 点击 album → `navigate('DigitalAlbumDetail', { id, title })`
- [x] B-1 空状态 UI
- [x] B-2 `DigitalAlbumDetailScreen.tsx`：`api.http.get('/api/albums/:id/photos')`——**服务端忽略 `page`/`pageSize` 参数**（prepared statement 不读 req.query），一次性返回全部照片，FlatList 窗口化渲染
- [x] B-2 复用 `DigitalPhotoGrid` 渲染
- [x] B-2 长按照片 → Paper `Modal` ActionDialog：「加入其他相册」/「从本相册移除」/「设为本相册封面」/「取消」
- [x] B-2 移除：`api.http.delete('/api/albums/:id/photos/:photoId')` → 列表过滤掉该 photo（review 修复：从 getQueryData 读最新值）→ invalidate
- [x] B-2 设封面：`api.http.post('/api/albums/:id/cover', {photo_id})` → invalidate `digitalAlbums@*` → snackbar
- [x] B-2 加入了相册的所有相册列表（"加入其他相册"）：`AlbumPickerSheet`（B-3）
- [x] B-3 `AlbumPickerSheet.tsx`：Paper Modal；列出 `api.http.get('/api/albums')`；"新建相册"行（输入框 + 创建）；单选（RadioButton，偏离：设计写多选，实现为单选——一次操作一个目标相册）
- [x] B-3 选中后 `api.http.post('/api/albums/:id/photos', {photo_ids:[photoId]})` → snackbar
- [x] B-4 `App.tsx`：`LibraryStack.Screen name="DigitalAlbumList"` + `name="DigitalAlbumDetail"`（title 用 i18n）
- [x] B-5 DigitalLibraryScreen 顶部"我的相册"卡片激活

## M2-C · PhotoView + 共享 + 测试

- [x] C-1 `PhotoViewScreen.tsx`：`const isDigital = photo?.source_type === 'digital'`
- [x] C-1 底片切换按钮条件改为 `{anyNegatives && !isDigital && (...)}`
- [x] C-1 Footer 加数码专属区：EXIF 摘要 + 相册 chips（可折叠）
- [x] C-1 Header 加「加入相册」「删除」按钮（仅 isDigital）
- [x] C-1 「删除」二次确认 Alert：调 `api.photos.delete(id)`（服务端软删），snackbar "已移入回收站"（review 修复：finally 清 busy + 1.2s 窗口内禁止滑动切图）
- [x] C-2 `ExifSheet.tsx`：完整 EXIF（camera / lens / focal_length / aperture / shutter_speed / iso / **latitude,longitude** / date_taken / filename / file_size）
- [x] C-2 缺失字段不渲染该行（避免 "undefined"）
- [x] C-3 `FavoritesScreen.tsx`：`route.params?.mode ?? 'film'`，调 `api.http.get('/api/photos/favorites', {mode})`（未用 `api.photos.getFavorites()`）
- [x] C-4 `ThemesScreen.tsx`：mode 透传到 `api.http.get('/api/tags', {mode})`
- [x] C-5 `TagDetailScreen.tsx`：mode 透传到 `api.http.get('/api/tags/:id/photos', {mode})`
- [x] C-6 `StatsScreen.tsx`：直接用 `api.http.get('/api/stats/summary', {mode})` 等（未用 `api.stats.*()`）；所有 stats 调用均带 mode
- [x] C-7 `MapScreen.tsx`：顶部"胶片/数码/全部"分段（review 修复：all 时显式不传第二参，不依赖 buildQueryString({}) 内部行为）；geo 请求带 mode
- [x] C-8 `LibraryScreen.tsx`：胶片分支显式 `navigate(name, {mode:'film'})`；数码分支当前无 Favorites/Themes/Stats 入口（DigitalLibraryScreen 未渲染这些入口），子屏 `useLibraryMode()` 默认回退 'film'，未来加入口即自动生效
- [x] C-9 i18n `digital.*` 全部双语齐（62 键 zh/en 完全对齐）
- [x] C-10 测试：`DigitalLibraryScreen.test.tsx` 渲染 / 分页 / 空状态 / 错误（4 测）
- [x] C-11 测试：`DigitalAlbumDetail.test.tsx` 加载 / 加入 / 移除 / 设封面（5 测）
- [x] C-12 测试：`PhotoViewDigital.test.tsx` 数码隐藏底片切换 + 显示 EXIF；film 分支回归（3 测）
- [x] C-13 测试：`albums-integration.test.tsx` API 契约（mock fetch 驱动真实 api-client 验证路径与参数，4 测）

## 全局验收

- [x] `cd mobile && npx jest` 全绿（49/49：33 既有 + 16 新增），既有测试无回归
- [x] `cd mobile && npx tsc --noEmit` 0 错误
- [x] `cd mobile && npx expo start` 在 Android 模拟器实跑通：数码库浏览（网格/session/相册入口）/ 相册操作（长按操作表、设封面、加入其他相册→DB 验证）/ PhotoView EXIF + 删除（软删 DB 验证 + 返回刷新）/ 共享视图 mode 过滤（地图三态：数码=4 张 2 地点）
- [x] Timeline tab（胶片卷）行为完全不变（e2e 已验证：Sardinia Trip/Portra 400 正常；胶片图库统计/收藏正常）
- [x] 桌面端删除照片后，移动端列表不再显示该照片（e2e 已验证：删除后相册 5→4、地图计数同步；失效前缀全覆盖）
- [x] 服务端代码零改动（本任务 `git status server/` 无新增改动；working tree 中 server/ 修改为前序后端阶段既有内容）

## e2e 中发现并修复的 bug（2026-07-25 模拟器实测）

- **Critical: DigitalLibraryScreen 永远 loading（空白主体）**——`derived` useMemo 依赖 `[pages, pageKey]` 未含 renderTick，fetchQuery 完成后 forceRender 触发重渲染但 memo 返回缓存旧值。修复：`const [renderTick, forceRender] = useState(0)` 并加入依赖。配套修正 C-10 测试假阳性（原断言依赖过期 memo，改为 mock HTTP 响应）。
- **Critical: 数码→胶片实时切换后胶片主体不可见**——应用以数码模式启动时，useFocusEffect 的 fadeAnim/slideAnim 入场动画（useNativeDriver）在未挂载的胶片 ScrollView 上执行，终值未落到后挂载的视图。修复：mode 切回 film 时 setValue 吸附到终值（didMountRef 跳过首挂载以保留正常入场动画）。
- 环境修复：`react-refresh` 缺失导致 metro 500（npm 安装）；metro 运行中 npm install 致 watcher 崩溃（重启 metro）；模拟器未配置 api_base_url（写入 RKStorage）；FG_TLS_DISABLE=1 纯 HTTP；adb reverse 8081/4000/4001。
- e2e 测试数据：`server/scripts/seed-e2e-digital.py`（9 张数码照片 + 2 嵌套相册 + 1 session，可重复运行重置）。

## 显式不做（防 scope creep）

- [x] **不**做数码照片导入向导
- [x] **不**做调色 UI（DigitalDevelop）
- [x] **不**做拖拽排序相册照片
- [x] **不**做硬删除照片 / 相册（彻底删除走桌面）
- [x] **不**做回收站屏（恢复走桌面）
- [x] **不**做手机照片直接导入（Phase 3，单独立项）
- [x] **不**改服务端任何文件
- [x] **不**改 `mobile/src/utils/urls.ts`（已通用）
- [x] **不**改 `mobile/src/api/client.ts`（共享 client 已就绪）
- [x] **不**改 `mobile/src/components/CachedImage.tsx`

## Review 修复记录（@review 对抗审查后）

- Critical: DigitalPhotoGrid `getItemLayout` offset 按 3 列修正
- Critical: PhotoViewScreen 删除成功路径 `finally { setBusy(false) }`
- Critical: DigitalLibraryScreen `onEndReached` 改 useRef 锁防闭包竞态重复 fetch
- Warning: PhotoViewScreen 加入相册后用 photoRef 校验防旧照片 chips 写到新照片
- Warning: DigitalAlbumDetailScreen 移除照片从 `getQueryData` 读最新数组
- Warning: 删除后 1.2s 窗口 `onImageIndexChange` busy guard
- Warning: MapScreen all 模式显式无参调用
- Nit: ExifSheet 去冗余 Portal + 去底部重复关闭按钮 + 修 hitSlop 拼写
- Nit: AlbumPickerSheet 内联 useAlbumsKey
- Nit: navigation/types.ts 补 DigitalAlbumList/DigitalAlbumDetail 路由类型
- Bug: DigitalAlbumDetailScreen `handleAddToAlbum` 不再提前清 activePhoto（原实现导致 POST 永不发出）
