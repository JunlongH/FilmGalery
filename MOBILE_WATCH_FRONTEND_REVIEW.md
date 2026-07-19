# Mobile & Watch 前端审查报告

> 审查范围：`mobile/`(Expo SDK 54 / RN 0.81)与 `watch-app/`(RN 0.83 / Wear OS)的前端代码。
> 方法：全量代码静态审查 + 本机 Android 模拟器（API 31）实机运行视觉审查。
> 截图存档：`tmp/review-*.png`。

---

## 一、视觉审查实机发现（模拟器运行验证）

通过模拟器安装 debug APK、连接 Metro、配置 socat 代理（`10.0.2.2:4100` → 测试服务器）后实测：

| # | 现象 | 证据 | 对应代码问题 |
|---|------|------|--------------|
| R1 | 首次启动显示 "0 rolls" 空白页，无任何空状态提示与引导 | `tmp/review-home.png` | `configureApi` 时序竞争 + `HomeScreen` 无空状态（见 C2/L1） |
| R2 | 头部 AI 按钮渲染为紫色圆底白色 "?"——`bot` 图标在 Lucide 与 Material 两套图标库中均不存在，运行时双重回退失败 | `tmp/review-home.png`;logcat: `[Icon] "bot" not found in Lucide, falling back to Material` → `"bot" is not a valid icon name` | `mobile/src/components/ui/Icon.tsx:6-98` 名称映射表缺 `bot` |
| R3 | Settings 页：青色 Paper 主题标题与**棕色硬编码按钮**（"开始发现"、"Save Settings"、Swap 链接）同屏冲突；中英文混排 | `tmp/review-settings.png`、`tmp/review-settings2.png` | `SettingsScreen.tsx` 7 处 `buttonColor="#5a4632"` 硬编码 |
| R4 | 保存服务器地址后，**每个失败的请求各自弹出一个 "Connection Error" 模态 Alert**(API_ERROR ×6 连发），用户需逐个关闭 | `tmp/review-home-data.png`;logcat 6 连 `API_ERROR` | `mobile/src/api/client.ts:6-17` 每个传输错误都 `Alert.alert` |
| R5 | 全图查看页：黑屏 + 居中 spinner 约 20s（代理链路）才出图，无任何缩略图过渡——本地已缓存的缩略图未被用作占位 | `tmp/review-photoview.png` → `tmp/review-photoview2.png` | `PhotoViewScreen.tsx:96-98` 直接全量映射 `'full'` URL，无渐进加载 |
| R6 | 地图页统计卡（813 Photos / 9 Locations）已返回，但 Leaflet WebView 45s+ 后仍停在**蓝色** spinner(`color="#0000ff"`，全 App 唯一蓝色）灰色空图——Leaflet/markercluster 从 unpkg CDN 运行时加载，CDN 不可达时地图完全不可用且无任何错误提示 | `tmp/review-map-final3.png`、`tmp/review-map-final4.png` | `leafletHtml.ts:18-20` CDN 依赖；`LeafletMap.tsx:87-91` 硬编码蓝 spinner |
| R7 | 图片查看页的关闭按钮对短触击无响应（查看器吞掉了单击事件用于切换菜单），需较长按压才生效 | 实测操作 | `react-native-image-zoom-viewer` 单击切换菜单与自定义控件层 (`PhotoViewScreen.tsx:311` `controlsLayer`) 事件竞争 |

有数据后的 Timeline、RollDetail(3 列缩略图网格）、Library（概览卡 + 收藏九宫格）视觉完成度尚可（`tmp/review-home-final.png`、`tmp/review-rolldetail2.png`、`tmp/review-back3.png`)，主框架观感统一——问题集中在上述细节与暗色模式。

---

## 二、Mobile 端：前端审美

### A1. 三套互相矛盾的设计令牌（设计系统事实分裂）
- `src/theme.ts:3-23`：**青色系**(`primary '#0097A7'`),Paper MD3 主题，实际运行时主题。
- `tailwind.config.js:13-51`：**暖棕色系**(`primary '#5A4632'`)，注释自称"synchronized with src/theme.js"——实际每个色值都与 `theme.ts` 冲突，圆角令牌也不一致。
- `src/styles/spacing.ts`:第三份间距令牌，**全仓库无引用**。

### A2. NativeWind 全链路配置但零使用（死管线）
`global.css`、`withNativeWind`(metro.config.js:39)、babel preset、`import './global.css'`(App.tsx:11）全部就位，但 `src/` 内 `className=` **零匹配**。纯构建负担。

### A3. 硬编码颜色泛滥：262 处 hex 字面量（theme.ts 之外）
最突出的是一套**遗留棕/米色**(`#5a4632`/`#f5f0e6`/`#d7d2c7`）散落在共享组件中，与运行时的青色主题直接冲突：
- `FilmCard.tsx:34,37`、`TagCard.tsx:38,41`（米色卡片底）
- `SettingsScreen.tsx` 7 处棕色按钮（实机截图 R3 证实）
- `NoteEditModal.tsx:29-49`、`TagEditModal.tsx:118-167`（同一文件内 `#5a4632` 与 `#0097A7` 混用）
- `ui/Button.tsx:14-18` 按压态、`ui/Icon.tsx:112` 默认色仍为棕色
- 多个 spinner 用 `color="#5a4632"`，其余用 `theme.colors.primary`——加载态品牌色不统一
- 另有第三套视觉语言：`StatsScreen.tsx:12-24` 图表渐变紫粉、`ShotLogScreen.tsx:507,517` 彩虹渐变

### A4. 暗色模式半残
基础设施齐全（`appDarkTheme`、持久化开关、导航/状态栏/地图联动），但被以下硬编码击穿：
- `app.json:8` `"userInterfaceStyle": "light"` 原生层强制浅色
- `RollDetailScreen.tsx` 整个卷头卡片用导出的静态 `colors.*`(221-289）而非 `useTheme()`——暗色下保持浅色
- `TagDetailScreen.tsx:72`、`FilmsScreen.tsx:106`(`'#fdfdfd'`)、两个编辑 Modal(`'white'`)、`StatsScreen` 图表容器、`SkeletonBox.tsx:16`、`CachedImage.tsx:20` 占位色均不随主题

### A5. 加载与空状态体系薄弱
- **51 处 `ActivityIndicator`** vs **仅 1 处骨架屏**(`ThemesScreen.tsx:98-103`)，且 `SkeletonBox` 无闪烁/呼吸动画；`TagCard` 的骨架模式无任何屏幕使用。
- 空状态普遍有（收藏/主题/地图/装备等），但 `InventoryScreen` 过滤为空时白屏、`HomeScreen` 0 卷时只有一行 "0 rolls"（实机截图 R1 证实：大面积空白无引导）。

### A6. 组件/图标体系三套并存
- 卡片：Paper `Card`、204 行自定义 `ui/Card`（仅被 `LibraryScreen` import 且**从未渲染**)、各屏 ad-hoc View 卡片。
- 图标：自定义 `Icon`(Lucide→Material 回退 + 90 行手维护映射表，R2 的 `bot` 事故即源于此）、直接用 `MaterialCommunityIcons`、Paper `IconButton`。
- Tab 图标 `focused ? 'film' : 'film'`(App.tsx:60-77)——选中态图标无变化。

---

## 三、Mobile 端：缓存

### C1. 唯一真正的数据缓存是 expo-image 磁盘缓存——且可被一键清空
- `CachedImage.tsx:34` 全部 `cachePolicy="disk"`（好）。
- 但 6 个屏幕的"刷新"按钮（`RollDetailScreen.tsx:53-54`、`FavoritesScreen.tsx:62-63`、`ThemesScreen.tsx:61-62`、`FilmsScreen.tsx:58`、`FilmRollsScreen.tsx:50-51`、`EquipmentRollsScreen.tsx:54-55`）在刷新前先 `clearImageCache()` **清空整个磁盘图片缓存**——刷新一卷数据 = 全 App 图片重新下载。这是全 App 唯一的缓存淘汰路径：要么永不清，要么全清。
- `useCachedImage.ts:3` 的模块级 `Set` 只记录"是否加载过"以跳过 150ms 淡入，无界增长、非数据缓存。

### C2. API 响应零缓存
- 共享客户端 `packages/@filmgallery/api-client` 无 ETag/Cache-Control/TTL/在途去重；无 react-query/SWR;**每个屏幕 mount 即全量重取**(rolls、photos、tags、films、equipment、stats、geo、negatives),`FavoritesScreen` 还在每次 tab 聚焦时重取。同一卷打开两次 = 两次完整请求。
- `getFilmItems` 支持分页参数但只有 `QuickMeterSheet` 传了 `limit: 50`,`InventoryScreen.tsx:43-46` 无界拉全量。
- AsyncStorage 只存 8 个设置键，无任何数据持久化 → 冷启动完全依赖局域网服务器在线（R1 的直接成因之一）。

### C3. 定位缓存：内存 5 分钟 TTL（合理，但仅内存）
`locationService.native.ts:22,337-346`。持久化（如写入 AsyncStorage）可让冷启动即有上次位置。

---

## 四、Mobile 端：加载效率

### L1. 启动链路
- `App.tsx:175` `if (loading) return null`：冷启动白屏帧等待 5 个 AsyncStorage 读取（实机观察到白屏）。
- 19 个屏幕全部静态 import(App.tsx:18-39)，含 vision-camera/worklets 重栈；`inlineRequires`(metro.config.js:33）缓解但未消除。
- `AIChatSheet`、`QuickMeterSheet` 挂在 Timeline 的 headerRight 里随首页常驻挂载（App.tsx:115 → HeaderButtons.tsx:93-101),Markdown/fetch-event-source 栈白白常驻。
- 底部 tab 无 `freezeOnBlur`，后台 tab 的 FlatList/WebView 保持活跃。

### L2. 列表全部默认虚拟化参数、零分页
- 全 `src/` 无 `getItemLayout/windowSize/initialNumToRender/maxToRenderPerBatch/removeClippedSubviews`——而所有网格 tile 尺寸在模块作用域已知（如 `RollDetailScreen.tsx:13-15`),`getItemLayout` 是白捡的收益。
- 无 `onEndReached` 服务端分页：`/api/rolls/:id/photos` 一卷数百帧一次拉全。
- 无 `React.memo`,renderItem 内联闭包逐帧重建；`EquipmentScreen.tsx:238-246` renderItem 里还有 `console.log`。
- `RollDetailScreen.tsx:162` 每个 tile `findIndex` → 网格 O(n²)。

### L3. 图片策略：网格用缩略图（好），三处失守
- `NegativeScreen.tsx:67`:4 列底片网格优先取 `negative_rel_path` **全尺寸扫描原图**——全 App 最重的列表。
- `PhotoViewScreen.tsx:96-98`：把整卷每张照片映射为 `'full'` URL 传给查看器，滑动即逐张下载全图；无缩略图→全图渐进（R5 实机证实黑屏等待）。
- 无 `expo-image` `prefetch()`;`blurhash` 显式置空（`CachedImage.tsx:38-41`)，占位只是纯色块。
- `LibraryScreen`/`InventoryScreen`/`MapScreen` 仍用 RN `Image` 加载网络缩略图，完全绕开磁盘缓存封装。

### L4. 渲染与状态
- `ApiContext.Provider` value 未 memo(App.tsx:180)——App 任意状态变化 → 15+ 消费组件全树重渲染。
- `StyleSheet.create` 写在渲染函数体内：`LibraryScreen.tsx:158`、`MapScreen.tsx:263`、`QuickMeterSheet.tsx:122`。
- 整卷照片数组通过导航 params 传递（`RollDetailScreen.tsx:166-172` 等），每次点图全量序列化过桥。
- `MapScreen.tsx:205-261` JS 侧 O(n²) 聚类（底sheet 列表用）与 WebView 内 Leaflet 聚类重复劳动，且列表关闭时也在算。

### L5. 死重与运行时 CDN 依赖
- `react-native-maps` + `react-native-map-clustering` 已安装并编进原生包，但 `src/` **零引用**（地图实为 Leaflet WebView)。
- Leaflet 1.9.4 + markercluster 运行时从 unpkg CDN 加载（R6 实机证实：CDN 不可达 = 地图永久蓝 spinner 灰屏，无错误提示、无重试、无降级）。

### L6. 错误反馈风暴
`client.ts:6-17` 给每次传输错误弹 `Alert.alert`。一次加载 5 个并发请求失败 = 5 个模态框连发（R4 实机证实）。应改为内联 banner/Snackbar 聚合。

---

## 五、Watch 端：前端审美

### W-A1. 无主题系统，全部硬编码
无 theme 文件、无共享常量、无 `components/` 目录；每屏自带 `StyleSheet.create` 字面量。`react-native-paper` 是声明依赖但 `src/` 零引用（死依赖）。绿色 `#4CAF50` 约 15 处重复，卡片灰有 `#1a1a1a` 与 `#121212`/`#1f1f1f` 两种配方，另有孤立蓝色 `#2196F3`(`ShotLogLocationScreen.tsx:245`）与 Tailwind 风 hex(`#86efac`/`#9be28a`）混入——四套色彩词汇表。

### W-A2. 重复与一致性
- 加载/错误/空态三件套在 `ShotLogSelectRollScreen` 与 `MyRollsScreen` 间近乎逐字复制（样式定义相同）；`RollDetailScreen` 错误态**缺 Retry 按钮**（其余屏都有）。
- 图标全部用 emoji(📷🎞️⚙️📍🔒);Settings 中文、其余英文混排。
- **圆表盘无 SafeArea 处理**:`react-native-safe-area-context` 已装但零使用，角部控件（如 `PhotoViewerScreen.tsx:91-101` 关闭按钮 `top/right: 16`）在圆屏上有裁切风险。
- 亮点：Home 的缩略图→全图渐进升级 + 角落小 spinner(`HomeScreen.tsx:153-172`）是全项目唯一一处渐进图片 UX，值得移植到 mobile。

### W-A3. 导航未类型化
每屏 `useNavigation<any>()`。

---

## 六、Watch 端：缓存

### W-C1. 唯一 API 缓存：films 目录 5 分钟内存缓存
`api.ts:20-21,71-83`。其余端点（random/rolls/photos/items）每次调用都打网络；缓存不随写操作失效（`updateFilmItemShotLogs` 不动它）。

### W-C2. imageCache 是有死代码的 prefetch 记账器
`imageCache.ts` 维护 20 条/30 分钟的 Map 记录"是否 prefetch 过"，实际字节靠 RN 原生缓存；`has()/clear()/size()` **无任何调用方**，淘汰逻辑不影响行为。

### W-C3. 定位缓存无新鲜度检查
`location.ts:153-156`:`getCurrentLocation` 直接返回 App 启动时的缓存坐标，无 staleness 判断——戴着表走了几公里，记录的仍是旧位置。

### W-C4. 零持久化
AsyncStorage 只存 `@server_url`；无离线能力。零 `useMemo/useCallback/React.memo`。

---

## 七、Watch 端：加载效率

### W-L1. 激进的全尺寸预载（手表端最重问题）
Home 首屏：5 张缩略图 + **3 张全尺寸原图**并行预载，之后每次滑动再预载当前+下一张全图（`HomeScreen.tsx:39-87`)。胶片扫描原图数 MB 级，经蓝牙 tether 是主导流量成本；20 条 imageCache 上限管不住 RN prefetch 队列。隐藏 0×0 `<Image>` 升级技巧与 prefetch 重复请求同一 URL，靠原生缓存去重。

### W-L2. 阻塞式网络瀑布
- `ShotLogSelectRollScreen.tsx:55-71`：点选卷时**先 await `getCamera()` 再跳转**——每次点击白付一次往返，列表加载时不预取。
- 保存 shot log 是读-改-写两次串行往返（`ShotLogLocationScreen.tsx:82,110`)，有并发写竞态。
- 定位三级串行回退 5s+10s+15s(`location.ts:195-226`)，最坏 ~30s 才报错。
- API 15s 超时 + 2 次重试（`api.ts:14-18`)：服务器宕机时单次调用最坏 ~45s+。

### W-L3. 启动竞争（与 mobile 同款）
`App.tsx:30-38` 不 await `loadServerURL()`,Home 同时发请求；`DEFAULT_URL=''` → 首请求必败，靠用户下拉重试。

### W-L4. 无取消、无列表调优
所有屏幕 fetch 无 `AbortController`/unmount 守卫；3 个 FlatList 全默认参数（手表列表小，可接受）；`metro.config.js` 裸默认——**无 monorepo 配置、无 `inlineRequires`**，能跑只是因为 `node_modules/@filmgallery/*` 是**物理拷贝**而非软链。

### W-L5. 共享包物理拷贝已漂移（隐患）
watch 的 `@filmgallery/api-client` 拷贝**缺 Phase 2B 认证层**（与 canonical 包 diff 70 行）;`packages/` 的更新 silently 到不了 watch；一旦重新 `npm install` 变成软链，Metro 直接解析失败。

---

## 八、优化建议（按优先级）

### P0 —  correctness / 可用性
1. **修图标映射**：补 `bot`（及全量校验 90 行映射表与 Lucide 名），或直接用 Paper 图标；实机已现 "?" 事故（R2)。
2. **刷新按钮不再清空整个图片磁盘缓存**：改为 `query 重取 + expo-image 对变更 URL 自然失效`，或仅清当前屏幕相关 key(C1)。
3. **错误提示改内联聚合**:client 层去掉逐请求 `Alert.alert`，各屏用 banner/Snackbar(L6/R4)。
4. **修 `configureApi` 时序竞争**:App 启动同步解析默认 URL 初始化 `_client`,mobile 与 watch 同病（L1/W-L3/R1)。
5. **Leaflet 资源本地化**:leaflet/markercluster 打进 assets 或 inline 进 HTML，去掉 unpkg 运行时依赖，加加载失败提示（L5/R6)。
6. **watch 共享包改回 file: 软链 + 补齐 metro monorepo 配置**，消除物理拷贝漂移（W-L5)。

### P1 — 感知性能
7. **全图查看渐进加载**：先展示已缓存缩略图，全图 onLoad 后切换（watch HomeScreen 已有范本，反向移植）;`PhotoViewScreen` 增加相邻帧 `Image.prefetch`(L3/R5)。
8. **引入轻量数据缓存层**（如 TanStack Query 或自实现 TTL+SWR):rolls/photos/tags/stats 至少内存级缓存 + 焦点失效，消灭"每屏 mount 全量重取";`InventoryScreen` 补分页参数（C2)。
9. **网格 `getItemLayout` + `initialNumToRender/windowSize` 调优 + 行组件 `React.memo`**;`NegativeScreen` 改用缩略图（L2/L3)。
10. **memo `ApiContext` value**；三处渲染内 `StyleSheet.create` 上移或改 `useMemo`(L4)。
11. **watch 全图预载降级为"当前帧一张"**，其余只预载缩略图；`getCamera()` 改列表加载时预取（W-L1/W-L2)。

### P2 — 审美一致性 / 减负
12. **统一设计令牌**：删除 `tailwind.config.js` 与 NativeWind 全链路（或真正迁移到 NativeWind，二选一）；删除无引用的 `styles/spacing.ts`；把 262 处硬编码 hex 收敛进 `theme.ts`，重点清除 `FilmCard/TagCard/Settings/NoteEditModal/TagEditModal` 的遗留棕色系（A1-A3)。
13. **补全暗色模式**:`app.json` 改 `"userInterfaceStyle": "automatic"`;`RollDetailScreen` 等改用 `useTheme()`;SkeletonBox/CachedImage 占位色主题化（A4)。
14. **骨架屏替代 spinner**：列表/网格首屏加载统一用带动画的骨架（`SkeletonBox` 加 pulse);`HomeScreen`、`InventoryScreen` 补空状态（A5/R1)。
15. **删死重**：卸载 `react-native-maps`/`react-native-map-clustering`(mobile)、`react-native-paper`/`@react-native/new-app-screen`(watch)；删未渲染的 `ui/Card` 复合组件或真正启用（L5/W-A1/A6)。
16. **UI 文案统一语言**（当前中英混排:mobile Settings/AIChat,watch Settings)。

---

*附：模拟器复现环境 = AVD test31 (API 31 x86_64) + Metro 8081 + socat 代理；截图位于 `tmp/review-*.png`。*

---

## 九、页面组织形式（信息架构与导航）

### 现状结构

**Mobile(3 Tab + 单一扁平 Stack,19 屏）:**

```
RootStack
├── Main (BottomTabs)
│   ├── Timeline → HomeScreen            (headerRight: AI + 测光 + 设置)
│   ├── Map      → MapScreen             (headerRight: 设置)
│   └── Library  → LibraryScreen         (headerRight: 设置) ← 事实上的二级首页
└── 其余 16 屏全部平铺在 RootStack:
    RollDetail, PhotoView, TagDetail, FilmRolls, FilmItemDetail,
    Favorites, Themes(标题叫 Collections), Equipment, EquipmentRolls,
    Inventory, Stats, ShotLog, Settings, AISettings, LocationDiagnostic
    + FilmsScreen, NegativeScreen  ← 【孤儿:import 了但从未注册,无任何入口】
```

入口实测（grep `navigate(` 全量）:Library 承担 5 个一级功能（Favorites/Themes/Equipment/Inventory/Stats）的唯一入口；**ShotLog（拍摄记录，核心创作流程）唯一入口埋在 `FilmItemDetailScreen.tsx:494`**(库存条目详情→一个 outlined 按钮）,3 层深；Settings 里另藏一个重复的 Equipment 入口（`SettingsScreen.tsx:310`)。

**Watch（纯线性 Stack,9 屏）:**

```
Home(随机照片,手势驱动) → MainMenu(3 项菜单)
  → ShotLogSelectRoll → ShotLogParams → ShotLogLocation   (3 步向导)
  → MyRolls → RollDetail → PhotoViewer                    (浏览线)
  → Settings
```

### 问题

**N1. 两个完成度很高的页面是死代码（mobile)。** `FilmsScreen`（胶卷目录浏览）与 `NegativeScreen`（底片九宫格）被 `App.tsx:26,29` import，但既未注册进 Navigator，也无任何 `navigate('Films'/'Negative')` 调用——功能彻底不可达，却参与打包与静态 import 开销。要么注册（底片浏览对胶片 App 是核心卖点），要么删除。

**N2. 信息架构是"仪表盘 hub + 扁平 stack"，语义分层缺失（mobile)。** Favorites/Themes/Equipment/Inventory/Stats 在产品语义上从属于 Library，但导航结构里它们与 Tab 平级地躺在 RootStack 中，由 Library 页手写 5 组 "See All" 链接维持关系。后果：(a) 无法利用导航器表达分区（如 Library 分区的共用 header/返回栈）;(b) 深链、状态恢复无法按分区配置；(c) 每新增一个 Library 子页都要改 LibraryScreen 的仪表盘 JSX 和 RootStack 两处。

**N3. 路由命名与 UI 语义漂移（mobile)。** 路由 `Themes` → 标题 "Collections" → 组件 `ThemesScreen` → 详情叫 `TagDetail`；路由 `LocationDiagnostic` 标题是中文"位置诊断"、`AISettings` 标题"AI 助手设置"、其余英文。路由名、组件名、标题三套词汇表互不一致，新人看代码无法从路由名推断页面。

**N4. 入口分布失衡（mobile)。** 创作主流程 ShotLog 深埋 3 层（且依赖库存条目存在），而 Stats/Inventory 等低频页占据 Library 一级位置；Timeline header 拥挤 3 个按钮（AI/测光/设置）而 Map/Library 只有设置——全局功能的入口随 tab 变化，位置记忆失效。Tab 图标 `focused ? 'film' : 'film'`(`App.tsx:60-77`）三态全同，选中反馈仅靠颜色。

**N5. 全屏媒体页用普通 push 转场（mobile)。** `PhotoView` 是黑底全屏查看器（`headerShown:false`)，却以默认右滑 push 入场；视觉上应是底部升起/淡入的 modal 转场（`presentation: 'fullScreenModal'` 或透明 modal)。

**N6. 导航 params 不可序列化阻断状态恢复（mobile)。** 整卷照片数组经 params 传递（`RollDetailScreen.tsx:166-172` 等）,React Navigation 的 state persistence(`@react-navigation/native` + AsyncStorage）要求 params 可序列化——当前结构下 App 被杀后无法恢复导航现场，也拿不到任何深链能力（无 `linking` 配置）。

**N7. Watch 端三步向导用 3 个独立导航页实现。** SelectRoll/Params/Location 是同一事务的三个步骤，拆成 3 个 stack 页带来：中途返回的状态残留（Params 页返回后已填参数靠 route params 带回）、保存完成后的回退目标需手工 `popToTop` 类处理、每步一次整页转场在手表上显得拖沓。另外 watch 每个屏幕 `useNavigation<any>()`，路由参数完全无类型约束，与 mobile 一样无法静态检查跳转。

### 建议的目标结构

**Mobile——按域分组嵌套，root 只留 modal:**

```
RootStack (全屏/模态层)
├── Tabs
│   ├── TimelineStack:  Home → RollDetail
│   ├── MapStack:       Map
│   └── LibraryStack:   Library → Favorites / Collections(原 Themes) / TagDetail
│                        → Equipment → EquipmentRolls
│                        → Inventory(注册 Films/FilmRolls/FilmItemDetail 或并入)
│                        → Stats
├── PhotoView        (presentation: fullScreenModal,淡入)
├── ShotLog          (modal;入口提升:Timeline FAB + FilmItemDetail)
├── Settings / AISettings / LocationDiagnostic  (push)
└── Negatives        (注册进 LibraryStack 或作为 Timeline 的视图切换)
```

落地要点：
1. **消灭孤儿**：注册或删除 `FilmsScreen`/`NegativeScreen`（建议注册并修掉 `NegativeScreen` 的全尺寸图问题后，作为 Timeline 的"底片/成片"分段切换）。
2. **每组一个 nested stack**,Library 子页迁出 RootStack;Tab 级启用 `freezeOnBlur` 顺带解决 L1 后台活跃问题。
3. **统一命名**：路由名 = 组件名 = 英文语义（`Themes`→`Collections` 一并改），标题文案进入统一 i18n 常量文件（配合建议 16 的中英统一）。
4. **ShotLog 入口提升**为 Timeline 的 FAB（创作主流程一级可达）,Settings 内重复的 Equipment 入口删除。
5. **导航只传 id**:PhotoView 改收 `photoId + rollId`，数据由各屏从缓存层（建议 8 的数据缓存）读取——顺带解锁导航状态持久化与深链（`/roll/:id`、`/photo/:id`)。
6. 目录按域收敛：`screens/timeline/`、`screens/library/`、`screens/shooting/`、`screens/viewing/`，替代当前 20 文件平铺。

**Watch——向导合并、手势符合 Wear 规范:**
7. ShotLog 三步合并为**单屏 stepper**（一个 ShotLog 容器 + 内部 step state，步骤间淡切而非整页 push)，保存成功后 `goBack()` 一处收口；消除跨页 route params 传递的表单状态。
8. 遵循 Wear OS 导航惯例：垂直滚动列表 + 右滑返回（已开 `fullScreenGestureEnabled`，保持），菜单层级不超过 2 级（当前达标）；为 `useNavigation` 补路由参数类型（与 mobile 共用一份 route 类型定义）。

> 上述 1/3/5 条分别与第八节 P0-6、P2-16、P1-8 联动，建议合并排期。

---

## 十、改造记录（2026-07-19 实施）

全部 P0/P1/P2 与第九节导航方案已实施完毕，经模拟器两轮视觉迭代验证。

### 新增基础设施

| 文件 | 作用 |
|------|------|
| `mobile/src/api/queryCache.ts` | 查询缓存内核：TTL(默认 60s)+ SWR + 在途去重 + 前缀失效 + 订阅 |
| `mobile/src/hooks/useApiQuery.ts` | `useApiQuery(key, fetcher, ttl)` hook(`{data,error,loading,refreshing,refresh}`)+ `useQueryData` 订阅 hook |
| `mobile/src/components/ProgressiveImage.tsx` | 缩略图→全图渐进组件（底层已缓存缩略图，全图 onLoad 淡入，期间 spinner) |
| `mobile/src/components/ApiErrorSnackbar.tsx` | 全局错误 Snackbar(4s 同消息去重）,client 层 Alert 改为 errorBus 订阅 |
| `mobile/src/components/map/leafletVendor.ts` | 内联打包 Leaflet 1.9.4 + markercluster 1.4.1（约 200KB)，去除 unpkg CDN 运行时依赖 |

### Mobile 修复明细

- **P0**
  - 图标：`Icon.tsx` 增加 kebab→PascalCase 自动回退（`bot`/`map-pin-off` 等任意合法 lucide 名直接可用）;Material 回退先校验 glyphMap，最终占位 `help-circle-outline`；默认色改主题 `onSurface`。实机验证 AI 按钮由 "?" 变为机器人图标。
  - 6 个屏幕刷新按钮不再 `clearImageCache()` 清空全磁盘图片缓存，改走 query 层 `refresh()`。
  - `client.ts` 移除逐请求 `Alert.alert` → `subscribeApiErrors` + App 级 Snackbar。
  - Leaflet 本地化；**顺带发现并修复了地图从未工作的真正根因**:`leafletHtml.ts` 内联脚本里残留 3 处 TS 类型标注（`(url: any)` 等）被原样打进 HTML,WebView 解析即 SyntaxError——此前 CDN 问题掩盖了它。`LeafletMap` 增加 15s 超时 + "Map failed to load / Retry" 失败态，spinner 改主题色。实机验证地图（含暗色）正常渲染聚类。
- **P1**
  - 15 个屏幕/组件接入 `useApiQuery`：卷列表 `rolls@` 被 Home/FilmRolls 共享；收藏 `favorites@` 被 Library/Favorites 共享并由 PhotoView 点赞后失效；RollDetail 双键（`roll:` + `rollPhotos:`)；装备库 `films@` 与 Films 页共享；Stats/Library/Inventory/Map 各一组合键。同屏二次进入零请求。
  - PhotoView 改收 `photosKey + initialIndex`（不再传整卷数组）；渐进加载 + 相邻帧 `ExpoImage.prefetch`；点赞/标签/备注写回缓存并失效相关键；关闭按钮加 hitSlop。实机验证点击后即时出图（原黑屏 spinner ~20s)。
  - 网格列表统一 `initialNumToRender/windowSize/maxToRenderPerBatch/removeClippedSubviews`，无表头网格（Favorites/TagDetail/Negative）加 `getItemLayout`;Negative 网格改优先缩略图；RollDetail 去掉逐 tile `findIndex`(O(n²))。
  - `ApiContext` value `useMemo`;Library/Map/QuickMeterSheet 三处渲染内 `StyleSheet.create` 改 `useMemo(createStyles)`。
- **P2**
  - 拆除 NativeWind 全链路（babel/metro/global.css/tailwind.config/nativewind-env.d.ts/package.json 依赖）；删除无引用的 `styles/spacing.ts`、`ui/Card.tsx`;package.json 移除 `react-native-maps`、`react-native-map-clustering`（需下次 prebuild 生效）。
  - 棕色系硬编码清除：`FilmCard`/`TagCard` 米底色、`SettingsScreen` 7 处、`NoteEditModal`、`TagEditModal`、`ui/Button` 按压态、各处 `#5a4632` spinner 全部主题化。
  - 暗色：`app.json` 改 `automatic`;RollDetail 整页 `useTheme`;`SkeletonBox` 加呼吸动画且主题化；`CachedImage` 占位色主题化；`StatsScreen` 图表容器/配置主题化；`Favorites/Themes` 分隔线主题化。实机验证 Timeline/RollDetail/Map 暗色正常。
  - Home/Inventory 补空状态；Home/RollDetail/Favorites/TagDetail/Films/FilmRolls/EquipmentRolls/Negative 首屏加载改骨架屏。
- **导航（第九节）**
  - 嵌套化：`TimelineStack`/`MapStack`/`LibraryStack`(Library 11 个子页迁入）+ Root 仅留共享详情（RollDetail）与 modal(PhotoView、ShotLog 均 `fullScreenModal`)+ Settings 组；Map tab 启用 `freezeOnBlur`。
  - 孤儿页面注册：`Films`(Film Catalog)、`Negatives` 进入 LibraryStack,Library Quick Access 新增两张入口卡；实机验证可达。
  - 路由 `Themes`→`Collections`（标题已是 Collections);AISettings/LocationDiagnostic 标题改英文统一。
  - Tab 图标改 Material 填充/描边对（movie-open/map/view-grid)。
  - Timeline 新增拍摄 FAB → 打开 QuickMeterSheet 选已装卷 → ShotLog（修复了 FAB 直导 ShotLog 缺 itemId 的问题）。
  - Settings 删除重复的 Equipment 入口。
- **目录**:20 个屏幕按域收拢 `screens/{timeline,map,library,viewing,shooting,settings}/`。

### Watch 修复明细

- 启动门：`App.tsx` await `loadServerURL()` 后再渲染（黑底 #4CAF50 spinner 过渡），消除首请求空 baseUrl 竞争。
- ShotLog 三步向导合并为单屏 `ShotLogScreen`(step state + BackHandler/beforeRemove 分步返回），三个旧步骤屏删除；选卷时后台预取 `getCamera()`，点选零等待。
- Home 预载降级：仅当前帧全图，滑动时仅预取下一帧；`imageCache.has()` 启用（消除死 API)。
- 定位缓存加 2 分钟新鲜度；`metro.config.js` 补齐 monorepo 支持 + `inlineRequires`;`node_modules/@filmgallery/*` 物理拷贝与 canonical 包重新同步（diff 干净）;package.json 移除 `react-native-paper`、`@react-native/new-app-screen`；导航补 `RootStackParamList` 类型。

### 验证

- mobile `tsc --noEmit` 0 错；mobile jest 33/33;`expo export` bundle 8.16MB 成功；watch `tsc` 0 错、jest 通过；root jest 331/332(1 失败为 server 端 `sessions-store` 预存时序抖动用例，已 stash 验证与本次改动无关）。
- 模拟器两轮视觉迭代截图：`tmp/iter1-*.png`、`tmp/iter2-*.png`、`tmp/iter3-*.png`（首页/卷详情/全图/地图明暗双色/Settings/Library/FAB 流程）。

### 遗留（未做，建议后续）

1. UI 文案中英统一（产品决策，建议全中文或全英文一把梭）。
2. `PhotoView` 的 `react-native-image-zoom-viewer` 单击关菜单与控件层的事件竞争（关闭按钮短击不灵敏，已加 hitSlop 缓解，建议中长期换 `react-native-image-viewing` 或自写查看器）。
3. MapScreen JS 侧 O(n²) 聚类（当前 813 点约 66 万次比较/次，可接受；超 2k 点后建议换 supercluster 或只在列表展开时计算）。
4. watch-app 未做视觉验证（无 Wear 模拟器镜像）;metro monorepo 配置待下次 `npm install` 转软链后生效验证。
5. `userInterfaceStyle: automatic` 与移除 react-native-maps 需重新 prebuild 才进原生包。
