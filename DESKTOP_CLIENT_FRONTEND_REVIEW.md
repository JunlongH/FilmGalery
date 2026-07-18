# FilmGallery 桌面客户端前端审查报告

> 审查对象：`client/`（React 18 + Electron + CRA/craco + @tanstack/react-query v5 + Tailwind v4 + HeroUI）
> 审查维度：前端审美 / 缓存策略 / 加载效率
> 审查日期：2026-07-17

---

## 概览：关键数据

| 指标 | 实测值 | 评价 |
|---|---|---|
| 主 bundle（`main.*.js`，minified） | **4.44 MiB**（gzip 1.31 MiB） | 过大 |
| 异步 chunk | 仅 367 B | 实质**零代码分割** |
| three.js / react-globe.gl 3D 栈 | 1.78 MiB，占主 bundle **40%** | 被急切导入 |
| recharts 栈 | 393 KB（9%） | 被急切导入 |
| 生产构建携带 sourcemap | **18.4 MiB** 打入产物 | 应关闭 |
| React Query v5 迁移 bug | `invalidateQueries(['k'])` 约 25 处失效为"清空全部" | 高优先修复 |
| ImageViewer 渲染体内 `?t=Date.now()` | 每次交互重新下载原图 | 最大缓存破坏点 |
| HeroUI 的 Tailwind 插件未注册 | `bg-primary` 等语义类**静默失效** | 全应用样式病根 |

**一句话结论**：三个维度存在共同的"设计-实现断层"——缓存分级策略、图片缓存键、UI 套件、懒加载等**设计都已就位**，但 v5 迁移遗漏、静态导入点未清理、HeroUI 插件未注册等执行层问题使其大面积失效。修复少量关键点即可收获巨大收益。

---

# 第一部分：前端审美与 UI/UX

## 1.1 样式系统架构（核心问题区）

### 🔴 HeroUI 的 Tailwind 插件未注册 —— 全应用语义类静默失效

HeroUI 2.8.7 + Tailwind v4 要求在 CSS 中注册插件（`@plugin` + `@source` 指向 node_modules），但 `src/styles/tailwind.css:9` 只有 `@import "tailwindcss"`，全仓库无任何 `@plugin` / `@source` 指令。经独立编译验证：

- `.bg-primary`、`.text-primary`、`.text-primary-foreground`、`.bg-secondary` 等均不生成；
- `.bg-default-100`、`.text-default-500` 等只以 `.dark xxx` 形式存在（`tailwind.css:389-450` 手工补丁），**亮色模式下完全无样式**。

受害代码遍布全应用：

- `RollLibrary.jsx:27` — "New Roll" 按钮 `bg-primary text-primary-foreground`，实际无品牌色；
- `Sidebar/SidebarItem.jsx:103` — 徽章 `bg-primary/20 text-primary`；
- `Gallery/PhotoGrid.jsx:84-90`、`Statistics.jsx:152`、`TagGallery.jsx:108` 等；
- 57 处 `color="primary"` 的 HeroUI 组件内部产生的类同样无样式支撑。

团队目前在用 **88 处 `!important`**（tailwind.css 34 / styles.css 36 / map.css 14 / FilmInventory.css 4）和 `[data-slot]` 全局覆写（`tailwind.css:461-502`、`styles.css:1518-1579`）打补丁，而非注册插件。**一处修复，全应用语义色复活，补丁层可批量删除。**

### 🔴 三套设计令牌 / 五种暗色判定互相矛盾

- **令牌重复定义且取值漂移**：暗色 `--shadow-md` 在 `variables.css:56` 与 `tailwind.css:122` 不一致；暗色背景有 `#000000`（variables.css:46）、`#18181b`（styles.css:170）、`#0a0a0a`（forms.css:12）三种并存，页面拼接处有色差；圆角 3 级 / 5 级 / 硬编码 4-16px 三套并存。
- **暗色判定方式有 5 种**：`.dark` class、`[data-theme="dark"]`、`prefers-color-scheme` 媒体查询、JS `useTheme()` context、以及 11 个文件里复制粘贴的 `MutationObserver`/`classList.contains('dark')` 检测（`StatCard.jsx:20-48`、`ChartCard.jsx:11-27`、`ModalDialog.jsx:7-8` 等）。

### 🔴 遗留视觉语言与新设计直接冲突

- 旧主题"胶片绿 + 米色棕"（`#2f7d32`、`#5a4632`、`#f5f0e6`）仍存在于激活态（`styles.css:415,506,1071`）、悬浮刷新按钮（`styles.css:1467-1505`，米色渐变，**无暗色变体**）、标题栏按钮（`styles.css:257`）；
- `ModalDialog.jsx:50` 用 `#007acc`（VS Code 蓝），与设计系统 `#2563eb` 不一致。

### 🟡 大量死 CSS / 未引用文件

- `src/styles/FilmButtons.css`（322 行）与 `src/components/EquipmentManager.css` **从未被 import**；
- `styles.css` 中 `.sidebar`（280-369）、`.fg-tab`（398-419）、`.tag-cloud-*`、`.roll-detail-header`、`.segmented-control` 等约 600+ 行无 JSX 使用；
- 同名类双重定义：`.roll-card`（styles.css:386 vs roll-detail-card.css:3）、`.photo-grid`（styles.css:1452 vs tailwind.css:245，**后者响应式版本实际是死代码**）、`.timeline-container`、`.scrollbar-hide`；
- `tailwind.css` 自定义 utility 多数零引用：`glass`、`card-hover`、`text-gradient`、`nav-item` 等；
- **死动画类**：`Settings.jsx:124`、`Statistics.jsx:95` 等使用 `animate-in fade-in`——这是未安装的 `tailwindcss-animate` 插件的类，从未生效。

### 🟡 非作用域全局选择器

- `styles.css:121-154` 用 `*` 通配覆写全应用滚动条；
- `styles.css:455-484` 全局 `form button { background:#2f7d32 }`，需 `:not()` 补丁排除 HeroUI；
- `tailwind.css:461-470` 全局 `[data-slot] { box-shadow: none !important }` **抹掉了 HeroUI 输入框的 focus ring**（可访问性受损）。

## 1.2 自定义 UI 套件形同虚设

- `components/ui/`（Button/Card/GlassModal/Skeleton/icons）仅被 3 个文件引用；`ui/icons.js`（164 行 lucide 再导出）与 `ui/Skeleton.jsx` 的全部预设组件 **0 处使用**；
- 内联样式才是事实主流：`ShotLogModal.jsx` 161 处 `style={{}}`、`FilmLabControls.jsx` 160 处（仅内联 fontSize 就 85 处）、`NewRollForm.jsx` 71 处；`Statistics.jsx:111-116` 注释 "use inline grid for reliable alignment" 表明开发者对 Tailwind 类不信任；
- `ui/Card.jsx:35` 用 `slate-*`，全应用主流是 `zinc-*`，同页两种灰色系混用；
- `ui/Button.jsx:44-53` 默认外包 `motion.div className="inline-block"`，使 `w-full` 按钮失效且每个按钮常驻一个 framer-motion 实例。

## 1.3 暗色模式漏光点

- 🔴 `map.css:729-774` 只听系统媒体查询，**绕过应用内主题 Toggle**；
- 🔴 `StatCard.jsx:198-202` / `ChartCard.jsx:39-44` 命令式 `setProperty(..., 'important')` 直接操作 DOM"绕过任何框架样式"，且 `hasDarkClass || prefersDark` 判定在"深色 OS + 手动亮色"时错误——StatCard 为此手写了 250 行双主题渐变色表，正是 CSS 变量本应免费提供的；
- 🔴 硬编码浅色：`RollDetail.jsx:394-401` 空状态 `#f9f9f9`、Timeline/Calendar 亮绿区块（`styles.css:530-618`，**整段无暗色变体**，暗色下一片荧光绿）、`.card` / `.card-overlay` / `.tag-cloud-item` 无暗色适配、`PhotoItem.jsx:292` `#f0f0f0` 占位；
- 🟡 `ModalDialog.jsx:7-8` 只在渲染瞬间读取一次 dark class，打开期间切主题不更新。

## 1.4 动画

- 🟢 时长/缓动克制统一（0.2/0.3s、`[0.4,0,0.2,1]`），`HeroCarousel.jsx:113-123` 用 CSS crossfade 替代 JS 动画并做了 `willChange` 条件优化；
- 🟡 布局属性动画：`AIPanel.jsx:252-255` 动画 `width`（每帧触发主内容重排）、`Sidebar.jsx:102-104` 动画 width、`SidebarItem.jsx:133-136` 动画 `height: auto`——可用 transform/clip-path 替代；
- 🟡 `Gallery/PhotoGrid.jsx:106` 每张照片 variants motion.div 内又嵌套 `PhotoCard.jsx:73-76` 的 whileHover motion.div，大网格下 motion 实例翻倍；
- 🟡 `tailwind.css:373-379` 的 reduced-motion 一刀切规则杀不掉 framer-motion 的 JS 动画（0 处 `useReducedMotion`），却误杀了主题切换的 `transition-colors`。

## 1.5 字体排印 / 图标 / 状态一致性

- 🟡 无自定义字体加载却指定了 `'JetBrains Mono'`（styles.css:1288）、`'Monaco'`（roll-detail-card.css:37）等，静默回退；body 字体 `"Segoe UI"` 写死（styles.css:161），跨平台回退不一致；
- 🟡 同级页面三种标题规范：`text-3xl` vs `text-2xl` vs `.page-header h3 20px`；9-11px 小字泛滥（FilmLabControls、LifeLogYearGrid `text-[9px]`）；
- 🟡 Emoji 混入 UI 且无暗色适配：`⚠️`（ConflictBanner 32px）、`🎞️`、`💬`、`📍`、`★`、`✎/✓` 等十余处；HeroUIProvider 手绘太阳/月亮 SVG 与 lucide `Sun/Moon` 重复造轮子；
- 🟡 空状态三种画风并存（Favorites 规范模板 vs 纯文本一行 vs 自定义虚线框）；加载态四种表现（纯文本 / 手写 spinner / HeroUI Spinner / Skeleton）；对话框三套体系并存（HeroUI Modal / fg-modal / 全内联 portal，z-index 11000 vs 10500）；
- 🔴 焦点可视性被全局规则破坏（见 1.1），hover-only 的照片操作无 `focus-within` 回退；`text-zinc-400`（约 2.4:1 对比度）大量用于辅助文字；`.card-overlay` 半透明白底 + `#111` 文字在深色照片上不可读。

---

# 第二部分：缓存策略

## 2.1 React Query 缓存：设计完善，实现有 v5 迁移断层

🟢 **做得好的**：`lib/queryClient.js` 的 CACHE_STRATEGIES（STATIC/SEMI_STATIC/DYNAMIC/REALTIME）+ DATA_CACHE_MAP 分级设计针对桌面环境调优合理；`getCacheStrategy` 被 8 个组件真实使用；桌面化配置（refetchOnWindowFocus/reconnect/Mount 全关）得当。

### 🔴 `invalidateQueries(['key'])` 数组写法在 v5 中失效为"使全部查询失效"

v5 的 `matchQuery` 从 filters 解构 `queryKey`，传入数组时 `queryKey === undefined`，**key 过滤被跳过 → refetch 所有 active 查询**。涉及约 25 处：

- `RollDetail.jsx:96-128, 188-189, 467, 496-512`（每次点赞/改备注/删照片都触发全站 refetch）
- `TagGallery.jsx:45-46`、`FilmLibrary.jsx:148,257,267,371,411`、`RollGrid.jsx:24`、`Favorites.jsx:34`

讽刺的是同文件 `RollDetail.jsx:692-704` 已正确使用 `{ queryKey: [...] }` 对象形式。**全局替换为对象形式后，细粒度缓存才真正生效。**

### 🔴 `keepPreviousData: true` 在 v5 中被静默忽略

`BrowseSection.jsx:62,70`、`RollLibrary.jsx:16` —— v5 应为 `placeholderData: keepPreviousData`。当前筛选/搜索切换时丢失"保留旧数据"体验，闪 loading 态。

### 🟡 其他 v4 残留与 key 问题

- `useGeoPhotos.js:82` 用 v4 参数名 `cacheTime`（静默忽略）；且 `bounds` 被排除在 queryKey 外 + 全局 refetchOnMount=false → **地图拖动永远不会按视野刷新**，bounds 过滤只在首次挂载生效；
- `FilmLibrary.jsx:71` 用 `getCacheStrategy('filmItems')`，但 `filmItems` 不在 DATA_CACHE_MAP → 静默回退 DYNAMIC；
- 启动预取 key 与消费 key 不匹配：`prefetchCommonData` 预取 `['equipment','cameras']`、`['equipment','lenses']`、`['locations']`，**没有任何 useQuery 消费这些 key**（设备/地点全走裸 fetch），3 个启动请求纯浪费；
- `dataPrefetch.js` 中 `prefetchOverviewData` 等 5 个预取函数从未被调用（死代码），且 `prefetchOverviewData` 的 `['quickStats']` 数据形状与 `QuickStats.jsx` 同 key 的 queryFn **不同**，若启用会污染缓存。

### 🟡 裸 fetch 绕过 React Query

| 位置 | 数据 | 应属策略 |
|---|---|---|
| `EquipmentManager.jsx:45-69` | 设备列表 | STATIC |
| `NewRollForm.jsx:63-71`、`EquipmentSelector.jsx` | films/metadata | STATIC |
| `BatchRenderModal.jsx:730-748` | LUT 列表（每次开弹窗重取） | STATIC |
| `App.js:93-103` | 侧边栏 tags（与 `['tags']` 查询并存的双轨制） | SEMI_STATIC |

## 2.2 图片缓存与 URL 策略

🟢 **做得好的**：
- 服务端（`server/server.js:88-99, 167-178`）：原图 `maxAge: 1y, immutable, etag`，`/thumb/` 走 `maxAge:0 + etag` 再验证——"原图不可变、缩略图可变"策略正确；
- 客户端 `api/core.js` 的全局 cache-buster 仅在手动硬刷新时触发，并非每渲染 bust；
- `services/FileAccessService.js:17-57` 的有界 LRU（100 文件 / 500MB / 10min）是全库最规范的内存缓存；
- 图片经 HTTP（127.0.0.1:4000/uploads）而非 file://，缓存头能有效作用——架构决策正确。

### 🔴 `ImageViewer.js:171` —— 全应用最大的缓存破坏点

```js
const imgUrl = buildUploadUrl(rawCandidate) + '?t=' + Date.now()
```

位于**渲染体**内：每次 zoom、pan、任何 state 变化都生成新 URL，**全尺寸原图被强制重新下载+解码**。应改用 `photo.updated_at` 作缓存键并 useMemo。

### 🟡 缩略图解析重复 7 处且缓存键不一致

`utils/thumbResolver.js` 自称 "Single source of truth" 但**零引用（死代码）**。回退链被手写重复至少 7 处且互不一致：`PhotoItem.jsx:104-150`（有 `?v=`）、`RollPhotoGrid.jsx:22-56`（有）、`Gallery/PhotoCard.jsx:16-32`（无）、`HoverPhotoCard.jsx:19-27`（无）、`ImageViewer.js:157-169` 等——导致"有的图片刷新得到、有的刷新不到"。应统一到 thumbResolver + addCacheKey。

### 🟡 其他

- 服务端 thumb 缓存正则 `/\/\d+\/thumb\//`（server.js:169）覆盖不全：负片缩略图路径 `rolls/{folder}/negative/thumb/` 与非数字 folderName 均落入 1y immutable，但缩略图会随重导出再生。建议放宽为 `/\/thumb\//`；
- URL 拼接 bug：`PhotoItem.jsx:161-162`、`RollPhotoGrid.jsx:53-54` 直接 `+ '?v=...'`，若 `_cb` 已激活则产生 `...?_cb=123?v=456` 双问号，`v` 被吞失效；
- `fg-cache-bust` 事件（core.js:52 dispatch）**没有任何监听者**；硬刷新后整个会话所有图片 URL 带 `_cb`，作废 immutable 长期缓存——"一次点击、全会话降级"；
- `imageOptimization.js` 的 `imageCache`/`loadingPromises` 是**无界 Map**，只增不减（轻微内存泄漏），且 `preloadImages`、`imageLoadQueue`、`getResponsiveImageUrl` 全是死代码（注意：`?w&q&f` 参数服务端根本不处理，即使启用也无效）；
- `Overview/HeroCarousel.jsx:62-65` 头图直接加载全尺寸原图（8 张轮换，无缓存键）；
- 服务端缩略图固定 240px，2x DPR 屏 160-240px 卡片会模糊（质量问题）。

## 2.3 localStorage / hooks

- 🟢 `SidebarContext.jsx:26-39`、`HeroUIProvider.jsx:37-99`：惰性 useState 初始化（读一次）、仅变更时写入，规范；
- 🟡 `useLocalStorage.js` 全库无引用（死代码），且 dispatch `local-storage-change` 却只监听原生 `storage` 事件——同 tab 多实例不同步，启用即踩坑；
- 🟡 `useFilePreviews.js`：blob URL 清理正确，但 files 数组每次变更都**重新提取全部文件**的 exifr 缩略图（O(n) 重复 CPU），应按文件指纹增量缓存；
- 🟡 `geocoding.js:201-203,342-344` 每次地理编码同步读 localStorage 两次，外部 API 无结果缓存。

---

# 第三部分：加载效率

## 3.1 零代码分割 —— 最大的单点问题 🔴

`App.js:6-29` 静态导入全部 14 个路由组件 + AIPanel。实测构建归因（基于 sourcemap）：

| 依赖栈 | minified 体积 | 占比 | 导入链 |
|---|---|---|---|
| three / react-globe.gl / leaflet | **1.97 MiB** | **44%** | `App.js:20` → `MapPage.jsx:10` → `PhotoMap.jsx:16` 静态 import PhotoGlobe → react-globe.gl → three |
| HeroUI / react-aria | 518 KB | 12% | 全局 Provider（合理保留） |
| recharts 栈（含被动带入的 redux/toolkit） | 393 KB | 9% | `App.js:12` → `Statistics.jsx` |
| react-markdown 栈 | 165 KB | 4% | `App.js:29` → `AIPanel`（**始终挂载**） |
| framer-motion | 153 KB | 3% | 30+ 组件 + HeroUI 依赖 |
| exifr | 72 KB | 2% | `App.js:7` → `NewRollForm` → `useFilePreviews` |

**被抵消的懒加载**：`PhotoGrid.jsx:5` 有 `React.lazy(() => import('./ImageViewer'))`，但 ImageViewer 被另外 **7 处静态导入**（RollDetail/TagGallery/Favorites/PhotoCalendar/LifeLogDayModal/OverviewView/HeroRandomPhotos），webpack 将其全部提升进 main——lazy chunk 只剩 367 B。FilmLab 链（42.4+29.3+19.2 KB min）、ShotLogModal（38.4 KB）、BatchExport/ImportPositive/RawImport 三组低频模态框随之全部进主 bundle。

**改进与预估收益**：

- `React.lazy` MapPage 路由：**−1.97 MiB（−44%）**；
- lazy Statistics：−393 KB；AIPanel markdown 首次打开时再加载：−165 KB；
- ImageViewer 统一 lazy：−110 KB+；NewRollForm lazy（exifr 按需）：−72 KB；各模态框 lazy：−100 KB；
- **合计主 bundle 4.44 MiB → ~1.5-1.7 MiB（gzip 1.31 MiB → ~450-550 KB），启动 JS 解析时间省 60% 以上。**

## 3.2 构建产物

- 🟡 **生产构建携带完整 sourcemap（18.4 MiB）**——CRA 默认 `GENERATE_SOURCEMAP=true`，会打进 Electron asar 白白增加安装体积。建议关闭或用 `hidden-source-map`。另注意 `build_debug/`（22 MB）与 `build_unmin/`（35 MB）勿入发布包；
- 🟡 `craco.config.js:50-64` 禁用了 `concatenateModules` 与 Terser `collapse_vars/reduce_vars`（TDZ 规避）——每个模块独立闭包包裹，体积与启动执行开销均增加。中长期应定位 TDZ 根因（通常是循环依赖）后恢复；
- 🟢 CSS 280 KB（gzip 46.5 KB）可接受；无外部字体/CDN 依赖（Electron 下正确做法）。

## 3.3 列表虚拟化与 memo 失效

🟢 `VirtualPhotoGrid.jsx` 用了 react-window；🟢 网格普遍请求服务端 240px 预生成缩略图而非原图。

- 🔴 `VirtualPhotoGrid.jsx:30-39`：**Cell 组件在 render 内联定义**，每次父渲染产生新组件类型，react-window 把所有 cell 卸载重挂载，虚拟化收益被严重侵蚀；
- 🔴 `RollDetail.jsx:434-451`：照片墙**无虚拟化、无 memo**——`PhotoItem` 非 memo 且自身有 5 个 state；任何 state 变化触发整墙重渲染；`selectedPhotos.some(sp => sp.id === p.id)` 造成 **O(n×m)** 比较；`filteredPhotos` 每次 render 重新 filter 未 useMemo。300+ 张时交互明显卡顿；
- 🟡 `PhotoGrid.jsx:45`：`PhotoThumb` 有 `React.memo` 但 `onClick={() => setViewerIndex(idx)}` 每次生成新闭包 → **memo 完全失效**；
- 🟡 `Gallery/PhotoGrid.jsx:105-117` 全量渲染 + 每张照片一个 stagger motion.div；`Favorites.jsx:83-92` 的 `delay={idx * 0.02}` 在 500 张时最后一张动画延迟 10 秒；
- 🟡 `LazyImage.jsx:63` 每张图片创建一个 IntersectionObserver 实例，建议共享单例。

## 3.4 重渲染热点 / Context / 定时器

- 🟡 `AIPanelContext.jsx:39-44`：Provider value 内联新对象；拖拽调宽时每个 mousemove 都 setPanelWidth，所有消费者高频重渲染。应 useMemo + 节流/拆分高频状态；
- 🟡 `LifeLogContext.jsx:117-141`、`TimelineContext.jsx:178-196`：context value 最后一步未 useMemo；
- 🟡 `BatchExportProgress.jsx:98-101`、`ImportPositiveModal.jsx:267-271`：递归 setTimeout 轮询**无 timer id、无卸载 cleanup**——弹窗关闭后轮询继续跑（对已卸载组件 setState + 持续请求）；
- 🟡 `TimelineContext.jsx:124-134` useMemo 内残留调试 `console.log`；
- 🟢 所有 setInterval 均有 cleanup；绝大多数 window 监听器有 removal；localStorage 读取均在 lazy initializer；`HeroUIProvider.jsx:106-110` 的 context memo 化规范。

## 3.5 启动路径与请求

- 启动即发约 7-8 个并发请求，其中 **AIPanel 在关闭状态下仍发 3 个请求**（`AIPanel.jsx:86-120`），完全可推迟到首次打开面板；
- 🟢 `prefetchCommonData` 延迟 3s + 队列间隔 300ms，设计克制（但其预取 key 有一半无消费者，见 2.1）；
- 🟡 三套懒加载机制并存：自写 `LazyImage`、`react-lazy-load-image-component`（27 KB min，4 处使用且 `PhotoCalendar.jsx:483` 与原生 `loading="lazy"` 重复）、原生 lazy——建议统一为自写 LazyImage 并移除该依赖；
- 🟡 `piexifjs` 是死依赖（0 处 import），可移除；
- 🟢 无 moment、无 lodash；date-fns 命名导入可 tree-shake（实测仅 31.8 KB）。

---

# 第四部分：优先级行动清单

| 优先级 | 事项 | 预估收益 |
|---|---|---|
| **P0** | 路由级 `React.lazy`（MapPage/Statistics/Settings/EquipmentManager/NewRollForm 等）+ ImageViewer 7 处静态导入统一改 lazy + 低频模态框 lazy | 主 bundle −60%+，启动解析时间大幅下降 |
| **P0** | 全局修复 `invalidateQueries(['k'])` → `invalidateQueries({queryKey:['k']})`（约 25 处） | 细粒度缓存失效真正生效，杜绝全站 refetch |
| **P0** | `ImageViewer.js:171` 去掉渲染体内 `?t=Date.now()`，改 `updated_at` + useMemo | 原图不再被重复下载解码 |
| **P0** | 注册 HeroUI Tailwind 插件（`@plugin` + `@source`），随后批量删除 88 处 `!important` 补丁与命令式 DOM 覆写 | 全应用语义色复活（含无底色的 New Roll 按钮），样式补丁层整体下线 |
| **P1** | 生产构建 `GENERATE_SOURCEMAP=false` | 安装包 −18 MiB |
| **P1** | RollDetail 照片墙：PhotoItem memo 化 + 回调稳定化 + selectedPhotos 改 Set + filteredPhotos useMemo；修复 VirtualPhotoGrid 内联 Cell 与 PhotoGrid 内联 onClick | 大卷交互帧率显著提升 |
| **P1** | 修复 v5 死参数：`keepPreviousData`（3 处）、`cacheTime`（useGeoPhotos） | 筛选/地图体验正确性 |
| **P1** | 统一暗色判定到 `.dark`/`useTheme`，删除 map.css 媒体查询暗色块与 11 处 JS classList 检测；给 Timeline/Calendar 亮绿区块与 `.card` 系列补暗色变体 | 消除暗色模式最刺眼的漏光区 |
| **P2** | 统一缩略图解析到 thumbResolver + addCacheKey（消除 7 处重复）；服务端 thumb 缓存正则放宽至 `/\/thumb\//` | 图片刷新行为一致 |
| **P2** | 设备/地点/LUT/tags 等 STATIC 数据改走 useQuery（或删除无效预取 key）；AIPanel 数据延迟到首次打开 | 消除启动白请求 |
| **P2** | 轮询 setTimeout 加 cleanup（BatchExportProgress、ImportPositiveModal）；Context value 全部 useMemo 化 | 消除泄漏与高频重渲染 |
| **P3** | 清死代码：FilmButtons.css、EquipmentManager.css、styles.css 约 600 行死规则、`animate-in` 死类、ui/icons.js、ui/Skeleton 预设、PhotoCalendar、HeroRandomPhotos、thumbResolver 之外的重复回退链、cacheUtils、useLocalStorage、imageOptimization 未用 API、piexifjs、react-lazy-load-image-component | 维护成本与体积双降 |
| **P3** | 收敛三套对话框/按钮/空状态实现到 HeroUI + GlassModal + Favorites 式模板；淘汰 `#2f7d32` 绿与 `#5a4632` 棕遗留配色 | 视觉统一 |
| **P3** | 定位 TDZ 根因（排查循环依赖），恢复 concatenateModules 与 Terser 压缩选项 | 体积与执行效率进一步改善 |

---

# 附录：做得好的地方（应予保留）

- **缓存设计**：React Query 分级策略、服务端"原图 immutable + 缩略图可再验证"、`updated_at` 缓存键、FileAccessService 有界 LRU、图片走 HTTP 而非 file://；
- **加载设计**：服务端预生成 240px 缩略图、自写 LazyImage（IntersectionObserver + 渐进加载思路）、`PhotoGrid.jsx:5` 已有 lazy ImageViewer 的意识、启动预取队列克制有序；
- **审美基础**：新代码路径（Sidebar、RollHeader、Favorites、Gallery、QuickStats）的 `dark:` 成对写法规范；zinc 中性灰 + primary 蓝配色现代；动效时长/缓动统一（0.2/0.3s + `[0.4,0,0.2,1]`）；HeroUIProvider 主题管理完整（localStorage 优先 + 系统监听 + meta theme-color 同步）；`@variant dark` class 策略配置正确；FilmLab 的 WebGL 为自写零依赖实现（未引入 three）；
- **工程卫生**：无 moment/lodash；所有 setInterval 有 cleanup；ErrorBoundary 全局兜底；map 页组件内部 memo/清理齐全（问题仅在它被放进主 bundle）。
