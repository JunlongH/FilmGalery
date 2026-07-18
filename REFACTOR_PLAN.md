# FilmGallery 桌面客户端前端改造计划

> 依据：`DESKTOP_CLIENT_FRONTEND_REVIEW.md`（2026-07-17）
> 原则：系统性、完整性、可维护性、模块化；每阶段可独立验证（构建通过）
> 目标：主 bundle 4.44 MiB → ≤1.8 MiB；React Query v5 语义正确；HeroUI 语义色复活；暗色判定统一；死代码清零

---

## 阶段总览

| 阶段 | 内容 | 风险 | 验证方式 |
|---|---|---|---|
| A | React Query v5 语义修复 | 低 | 构建 + grep 归零 |
| B | ImageViewer 图片缓存破坏修复 | 低 | 构建 + 代码审查 |
| C | 代码分割（路由/查看器/模态框/AI面板） | 中 | 构建产物 chunk 对比 |
| D | HeroUI Tailwind v4 插件注册 + 补丁层下线 | 中 | 独立 CSS 编译验证 + 构建 |
| E | P1：sourcemap / 列表渲染性能 / 暗色统一 / 轮询泄漏 | 中 | 构建 + grep |
| F | P2：缩略图解析统一 / 服务端缓存正则 / 数据层收敛 / Context memo | 中 | 构建 + grep |
| G | P3：死代码与死依赖清理 / TDZ 根因排查 | 低-高 | 构建 + 引用归零检查 |

---

## 阶段 A — React Query v5 语义修复（P0）

1. `invalidateQueries(['k'])` → `invalidateQueries({ queryKey: ['k'] })`，约 25 处：
   `RollDetail.jsx`、`TagGallery.jsx`、`FilmLibrary.jsx`、`RollGrid.jsx`、`Favorites.jsx`
2. `keepPreviousData: true` → `placeholderData: keepPreviousData`（从包导入 helper）：
   `Overview/BrowseSection.jsx:62,70`、`RollLibrary.jsx:16`
3. `useGeoPhotos.js:82` `cacheTime` → `gcTime`
4. `FilmLibrary.jsx:71` `getCacheStrategy('filmItems')` 在 `DATA_CACHE_MAP` 中补 `filmItems: STATIC`

**验收**：`grep -rn "invalidateQueries(\[" client/src` 为空；`keepPreviousData:` 仅作为值出现。

## 阶段 B — ImageViewer 缓存破坏修复（P0）

1. `ImageViewer.js:171`：`buildUploadUrl(rawCandidate) + '?t=' + Date.now()` → `useMemo` + `addCacheKey(url, photo.updated_at)`
2. 同文件 `:277` FilmLab 源 URL 同法处理
3. 顺带修复 `PhotoItem.jsx:161-162`、`RollPhotoGrid.jsx:53-54` 的 `+ '?v='` 双问号拼接 bug → 统一改用 `addCacheKey()`

**验收**：`grep -rn "Date.now()" client/src/components/ImageViewer.js` 为空；`+ '?v='` 拼接归零。

## 阶段 C — 代码分割（P0）

设计：新建 `client/src/components/common/Lazy.jsx`，提供：
- `lazyPage(loader)` — 路由级懒加载包装（带 `Suspense` 骨架屏 fallback）
- `LazyImageViewer` — 7 个消费方共用的懒加载 ImageViewer 封装
- `lazyModal(loader)` — 模态框懒加载包装（`isOpen` 时才挂载）

改造点：
1. `App.js`：14 个路由组件全部 `lazyPage`（保留 Overview 同步或懒加载均可，统一懒加载 + 骨架屏）
2. ImageViewer 7 处静态导入（`RollDetail/TagGallery/Favorites/PhotoCalendar/LifeLogDayModal/OverviewView/HeroRandomPhotos`）→ `LazyImageViewer`；`PhotoGrid.jsx:5` 已有 lazy，统一替换
3. `RollDetail.jsx` 的 BatchDownload/BatchRender/RawImport/ImportPositive/ContactSheet 五个模态框 → `lazyModal`
4. `FilmLibrary.jsx` ShotLogModal → `lazyModal`
5. `AIPanel`：Provider 保留同步，面板主体改为首次打开时才 `import()`（含 react-markdown 链）；面板数据请求（templates/models/shortcuts）推迟到首次打开

**验收**：构建产物中 `main.*.js` ≤ 1.8 MiB min；出现独立 chunk：map（three/leaflet）、stats（recharts）、ai（markdown）、viewer（FilmLab）。

## 阶段 D — HeroUI Tailwind v4 插件注册（P0）

设计：
1. 新建 `client/src/styles/hero.plugin.js`（CJS）：
   ```js
   const { heroui } = require('@heroui/theme/plugin');
   module.exports = heroui({ /* themes: primary 对齐 #2563eb 品牌蓝，保持视觉一致 */ });
   ```
2. `tailwind.css` 顶部：
   ```css
   @plugin "./hero.plugin.js";
   @source "../../node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}";
   ```
3. 用 @tailwindcss/postcss 独立编译验证 `.bg-primary` / `.text-primary-foreground` / `.bg-default-100` / `.text-foreground` / `.bg-background` / `.border-divider` 全部生成后，再删除补丁层：
   - `tailwind.css:389-450`（.dark 语义类手工补丁）
   - `styles.css:1518-1579`（HeroUI 覆写补丁）
   - 保留但收窄 `tailwind.css:461-502` 的 `[data-slot]` 覆写：去掉 `box-shadow: none !important`（恢复 focus ring），只保留背景定制
4. 收敛 `StatCard.jsx` / `ChartCard.jsx` 的命令式渐变覆写：改用 CSS 变量（`var(--stat-gradient-x)`），由 class 切换，删除 250 行双主题色表与 `setProperty(..., 'important')`

**验收**：独立编译产物含全部语义类；构建通过；`!important` 计数显著下降（88 → ≤20）。

## 阶段 E — P1 修复

1. **sourcemap**：`client/package.json` build 脚本加 `cross-env GENERATE_SOURCEMAP=false`
2. **RollDetail 照片墙**：
   - `PhotoItem` 包 `React.memo`，回调 `useCallback` 稳定化
   - `selectedPhotos` 比较 O(n×m) → 派生 `Set`（`useMemo`）
   - `filteredPhotos` `useMemo`
3. **VirtualPhotoGrid**：`Cell` 提升到模块级 + `itemData` 传参
4. **PhotoGrid**：`onClick={() => setViewerIndex(idx)}` → 稳定回调（`useCallback((idx)=>...)`，PhotoThumb 内部回传 idx）
5. **暗色统一**：
   - 新建 `src/hooks/useIsDarkMode.js`（基于 HeroUIProvider 的 theme context + class 监听，单一实现）
   - 替换 11 处复制粘贴的 MutationObserver/classList 检测（StatCard/ChartCard/ModalDialog/UploadModal/ShotLogModal/BatchExport/ImportPositiveModal 等）
   - `map.css:729-774` 媒体查询暗色块 → 改为 `[data-theme="dark"]` / `.dark` 选择器
   - 补暗色变体：Timeline/Calendar 亮绿区块（styles.css:530-618）、`.card`/`.card-overlay`/`.tag-cloud-item`、`RollDetail` 空状态、`NewRollForm` 信息卡、`PhotoItem` 占位
6. **轮询泄漏**：`BatchExportProgress.jsx:98-101`、`ImportPositiveModal.jsx:267-271` 递归 setTimeout 保存 id + unmount cleanup

## 阶段 F — P2 收敛

1. **缩略图解析统一**：重写 `utils/thumbResolver.js` 为唯一入口：
   ```js
   resolvePhotoThumb(photo) → { thumbUrl, fullUrl } // 内部统一走 buildUploadUrl + addCacheKey(updated_at)
   ```
   替换 7 处手写回退链（PhotoItem/RollPhotoGrid/Gallery PhotoCard/HoverPhotoCard/LifeLogContext/ImageViewer/PhotoCalendar 死代码）
2. **服务端**：`server/server.js:169` 正则 `/\/\d+\/thumb\//` → `/\/thumb\//`
3. **数据层收敛**：
   - `EquipmentManager.jsx` 设备列表 → `useQuery(['equipment', 'cameras'/'lenses'], STATIC)`（与预取 key 对齐）
   - `NewRollForm.jsx`、`BatchRenderModal.jsx`（LUT）、`App.js` tags → useQuery
   - 删除 `dataPrefetch.js` 死函数（prefetchOverviewData/prefetchRollDetailData/prefetchFilmLibraryData/prefetchEquipmentData/createHoverPrefetch），保留 prefetchCommonData 并修正 key
   - `App.js` tags 双轨制 → 统一 `['tags']` 查询 + 事件触发 invalidate
4. **Context memo**：`AIPanelContext`/`LifeLogContext`/`TimelineContext`/`SidebarContext` 的 value `useMemo`；`TimelineContext` 删调试 console.log
5. **`useGeoPhotos`**：bounds 纳入 queryKey（或文档化说明有意为之）——采用纳入 queryKey + `placeholderData` 保体验

## 阶段 G — P3 清理

1. **删死文件**：`styles/FilmButtons.css`、`components/EquipmentManager.css`、`Overview/HeroRandomPhotos.jsx`、`components/PhotoCalendar.jsx`（确认无引用后）、根 `TimelineView.jsx`（确认无引用后）
2. **删死 CSS**（styles.css ~600 行）：旧 `.sidebar*`（280-369）、`.fg-tab*`、`.tag-cloud-*`、`.roll-detail-header/.roll-title/.roll-meta-grid`、`.btn-back`、`.segmented-control`、`.roll-cover-image` 等；逐一 grep 确认零引用
3. **删死工具**：`ui/icons.js`（或改为全项目统一入口并推广——选择删除，lucide 直引已足够规范）；`ui/Skeleton.jsx` 未用预设保留基础组件；`cacheUtils` 未用导出；`useLocalStorage.js`；`imageOptimization.js` 未用 API（保留 addCacheKey/getPhotoUrlWithCache）；`dataPrefetch` 死函数（阶段 F 已处理）
4. **死动画类**：`animate-in fade-in duration-*` → `@theme` 已定义的 `animate-fade-in`（真实生效）
5. **死依赖**：`npm uninstall piexifjs react-lazy-load-image-component`（后者 4 处用法先替换为自写 LazyImage）
6. **TDZ 根因排查**：用脚本检测循环依赖；若定位并修复，则恢复 `concatenateModules` + Terser `collapse_vars/reduce_vars`，构建验证；若无法确认运行时安全，保留现状并文档化

---

## 验证策略

- 每阶段结束跑 `cd client && npm run build`，确认通过并记录主 bundle 体积变化
- 阶段 D 前先用 @tailwindcss/postcss 独立编译 CSS 验证语义类生成
- 清理类改动先做引用归零检查（grep），再删除
- 最终：构建产物对比表 + 改造总结追加到本文档

## 不做的事（明确边界）

- 不升级任何依赖大版本（React 19、Tailwind、HeroUI 等保持现状）
- 不重写 FilmLab/地图等业务逻辑
- 不改 Electron 主进程行为（除文档化建议）
- 不做视觉 redesign（仅修复一致性问题，配色保持 zinc + blue-600）

---

# 改造结果（2026-07-17 完成）

## 量化成果

| 指标 | 改造前 | 改造后 | 变化 |
|---|---|---|---|
| 主 bundle（minified） | 4.44 MiB | **693 KB** | **−84.7%** |
| 主 bundle（gzip） | 1.31 MiB | **198 KB** | **−85.2%** |
| 异步 chunk | 1 个（367 B） | **42 个**（地图 2.1 MB 独立） | 真代码分割 |
| 生产 sourcemap | 18.4 MiB | 0 | 安装包 −18 MB |
| build 目录总体积 | 24 MB | **4.9 MB** | −80% |
| `!important` 数量 | 88 | 34 | 补丁层下线 |
| React Query v5 语义 bug | 27 处 | 0 | 细粒度缓存生效 |
| 代码净变化 | — | **+747 / −4180 行** | 净删 3400+ 行 |

## 验证结果

- 全部 11 个路由在 jsdom 冒烟测试中渲染成功，**0 TDZ 错误、0 非网络错误**
- 生产 CSS 中 HeroUI 语义类（bg-primary / text-foreground / bg-content1 / border-divider 等）全部生成
- 服务端测试 273/273 通过；根级 eslint 0 error
- craco build 通过（警告均为既有的 react-hooks/exhaustive-deps 与未使用变量）

## 各阶段执行明细

### 阶段 A — React Query v5 ✓
- 23 处 `invalidateQueries(['k'])` → `{ queryKey: ['k'] }`（RollDetail/TagGallery/FilmLibrary/RollGrid/Favorites）
- 3 处 `keepPreviousData: true` → `placeholderData: keepPreviousData`（RollLibrary、BrowseSection×2）
- `useGeoPhotos`：`cacheTime` → `gcTime`；bounds 移出服务端过滤（"一次拉取 + 客户端筛选"，修复地图拖动永不刷新问题）
- `DATA_CACHE_MAP` 补 `filmItems: STATIC`

### 阶段 B — 图片缓存 ✓
- `ImageViewer.js` 两处渲染体 `?t=Date.now()` → `addCacheKey(url, updated_at)` + useMemo（主图 URL 上移至 early return 前）
- 缩放/平移不再触发原图重新下载

### 阶段 C — 代码分割 ✓
- 新增基础设施：`common/PageLoading.jsx`、`common/LazyImageViewer.jsx`、`common/lazyModal.jsx`（首次 isOpen 才加载 chunk）
- `App.js`：14 个路由组件全部 `React.lazy` + Suspense；AIPanel 首次打开才挂载（其 3 个启动数据请求随之延迟）
- ImageViewer 7 处静态导入 → `LazyImageViewer`（PhotoGrid 原有 lazy 统一）
- RollDetail 5 个低频模态框 + FilmLibrary ShotLogModal → `lazyModal`

### 阶段 D — HeroUI 插件 ✓
- 新增 `src/styles/hero.plugin.js`（heroui() + primary 对齐品牌蓝 #2563eb/#3b82f6）
- `tailwind.css` 顶部 `@plugin` + `@source`（独立编译验证 9 项语义类全部生成）
- 删除 `tailwind.css` 暗色语义类手工补丁（~60 行）与 `styles.css:1512-1579` HeroUI Electron 兼容补丁（68 行）
- `[data-slot]` 覆写移除 `!important` 与 `box-shadow: none`（HeroUI focus ring 恢复）
- StatCard/ChartCard：删除 250 行 JS 双主题色表 + 命令式 `setProperty(..., 'important')`，改为 `stat-card.css` CSS 变量双主题

### 阶段 E — P1 ✓
- `GENERATE_SOURCEMAP=false`（client build 脚本）
- RollDetail：filteredPhotos/positiveCount/negativeCount useMemo；selectedPhotos → Set 查找（O(n×m) → O(n)）；showAlert/showConfirm/handleToggleSelect/handleSelectPhoto/handleEditTags useCallback
- PhotoItem：`React.memo` + URL 派生改 useMemo（少一轮渲染）+ rating 同步 effect；onSelect 改传 index
- VirtualPhotoGrid：Cell 提升模块级 + itemData（修复 cell 全量卸载重挂载）
- PhotoGrid：稳定 onClick/useCallback render；删除冗余 Suspense；`color:'#666'` 暗色漏光修复
- 暗色统一：新建 `hooks/useIsDarkMode.js`（基于 theme context），替换 9 个组件的复制粘贴检测；`map.css` 媒体查询暗色 → `.dark`；`styles.css` 末尾新增 Legacy Dark-Mode Adaptations（.card 系列）；RollDetail/NewRollForm/PhotoItem/RollGrid 内联硬编码浅色 → Tailwind dark: 类
- 轮询泄漏：BatchExportProgress/ImportPositiveModal 递归 setTimeout 保存 id + 卸载 cleanup

### 阶段 F — P2 ✓
- `thumbResolver.js` 扩展 `resolveThumbUrl/resolveFullUrl`（buildUploadUrl + addCacheKey + filename 兜底 + 负片链补 full_rel）；统一 Gallery/PhotoCard、HoverPhotoCard、RollPhotoGrid、LifeLogContext、PhotoGrid、HeroCarousel 共 6 处手写回退链（含双问号拼接 bug 修复）
- `server/server.js` thumb 缓存正则 `/\/\d+\/thumb\//` → `/\/thumb\//`（覆盖 negative/thumb 与非数字 folderName）
- EquipmentManager：裸 fetch → `useQuery(['equipment', tab], STATIC)` + CRUD invalidate；NewRollForm films/metadataOptions/filmItems → useQuery；BatchRenderModal LUT 列表 → useQuery(['luts'])
- App.js tags 双轨制 → 统一 `useQuery(['tags'])` + 'refresh-tags' 事件转 invalidate
- dataPrefetch：删除 5 个死预取函数；预取 key 与消费者严格对齐（移除无消费者的 ['locations']）
- Context memo：AIPanel/Sidebar/LifeLog/Timeline 四个 Provider value 全部 useMemo；TimelineContext 删调试 console.log

### 阶段 G — P3 ✓
- 删死文件：FilmButtons.css（322 行）、EquipmentManager.css、HeroRandomPhotos.jsx、PhotoCalendar.jsx、根 TimelineView.jsx（494 行）、useLocalStorage.js
- styles.css 删 442 行死规则（旧 sidebar/fg-tab/tag-cloud/roll-detail-header/segmented-control/roll-cover-image/Overview/Timeline 区块）
- tailwind.css 删死 utility：glass-dark/card-hover/text-gradient/skeleton/photo-grid/timeline-container/timeline-item/nav-item/nav-item-active/animation-delay-*/safe-top
- 死动画类 `animate-in fade-in duration-*`（8 处）→ 真实动画工具类（animate-fade-in/slide-in-right/fade-in-up/scale-in）
- imageOptimization.js：删除 8 个死 API（含无界 Map 泄漏点），仅保留 addCacheKey/getPhotoUrlWithCache
- cacheUtils（lib）、getCacheBusterVersion（api）死导出删除
- 死依赖卸载：piexifjs、react-lazy-load-image-component（LifeLog 两处迁移到自写 LazyImage）
- **TDZ 根因**：静态分析确认 client/src 无循环依赖；恢复 `concatenateModules` + Terser `collapse_vars/reduce_vars`，构建通过且 jsdom 全路由冒烟 0 TDZ（主 bundle 再省 35 KB）；回退方法已注释在 craco.config.js

## 遗留事项（需人工 QA 或后续迭代）

1. HeroUI 插件注册后，Popover/Dropdown/Modal 的实心背景由原 `!important` 补丁改为插件自身样式，建议在真机 Electron 中过一遍主要弹窗视觉
2. `[data-slot="inputWrapper"]` 的项目定制底色保留（无 !important），如与 HeroUI focus 态边框有视觉冲突可再调
3. 服务端缩略图固定 240px，高 DPR 屏建议后续生成 480px 版本（server 侧改动）
4. Electron 主进程未设置磁盘缓存上限（低优先级建议）
5. 构建环境 Node 为 v18（项目要求 ≥20），CI 建议固定 Node 20+

---

# 视觉测试迭代（2026-07-18）

## 测试方法

headless Chromium (snap) + puppeteer-core，对 11 个路由 × 暗/亮双主题截图审查，并对关键交互态（ImageViewer、UploadModal、AddCamera 表单、Select 下拉、AIPanel）做点击级测试。测试数据：seed.sql + 8 张程序生成测试图（含地理位置）。

## 发现的并修复的问题

### 🔴 HeroUI CSS 变量被 variables.css 历史补丁污染（暗色模式全站文字变黄色）

**现象**：设置页所有 `text-foreground`/`text-default-*` 文字计算为 `rgb(255,255,0)` 纯黄色；RollDetail 工具栏、Films 状态页签、LazyImage 错误占位背景同样变黄/芥末色。

**根因**：`variables.css` 在插件缺失时期手工定义了 `--heroui-*` 变量（RGB 三值如 `17 24 28`），且为非分层 CSS（unlayered），优先级天然高于插件的分层（@layer）变量；HeroUI 语义类按 `hsl(var(--heroui-foreground)/1)` 消费，RGB 三值在 Chrome 的宽松 hsl 解析下产生怪色（实测 `hsl(236 237 238 / 1)` → 黄色）。

**修复**：
1. 删除 `variables.css` 中全部 `--heroui-*` 手工变量（插件已接管，含正确的 HSL 值与 `.dark` 覆写）
2. 5 处遗留 CSS 消费方从裸 `var(--heroui-x, #fallback)` 改为 `hsl(var(--heroui-x) / 1)`（styles.css、equipment-selector.css、FilmInventory.css）

**验证**：修复后设置页/工具栏/状态页签/错误占位全部恢复正常配色（截图 d2-*/l-*）。

## 视觉确认清单（双主题）

| 页面 | 暗色 | 亮色 | 备注 |
|---|---|---|---|
| Overview | ✅ | ✅ | HeroCarousel + QuickStats 正常 |
| Roll Library | ✅ | ✅ | New Roll 按钮品牌蓝生效 |
| RollDetail | ✅ | ✅ | 头部/工具栏/照片墙/LazyImage 错误态正常 |
| Map | ✅ | ✅ | 筛选面板 .dark 适配生效，标记/聚类正常 |
| Statistics | ✅ | ✅ | StatCard CSS 变量渐变双主题均优雅 |
| Films | ✅ | ✅ | 状态页签颜色修复 |
| Calendar/Timeline | ✅ | — | 无亮绿漏光（遗留 CSS 已删） |
| Equipment | ✅ | — | useQuery 改造后数据加载正常 |
| Settings | ✅ | ✅ | 黄色 bug 修复核心验证页 |
| LUT Library | ✅ | — | 正常 |
| ImageViewer | ✅ | — | 全尺寸图 updated_at 缓存键生效 |
| UploadModal | ✅ | — | HeroUI Modal 实心背景（无补丁） |
| AddCamera 表单 | ✅ | — | inputWrapper 定制底色正常 |
| Select 下拉 | ✅ | ✅ | Listbox 实心背景双主题正常 |
| AIPanel | ✅ | — | 首次打开才挂载/加载数据，动画正常 |

## 运行时性能验证

- 首屏（Overview）：仅加载 main + 6 个小组件 chunk，**未加载地图 chunk**（2.1 MB three.js 栈）
- 切换 /map：按需加载地图相关 chunk
- 懒加载模态框（ShotLogModal/BatchRender 等）首次打开时才请求对应 chunk

## 测试产物

- 截图存于 `.visual-test/`（已加入 .gitignore）
- 测试脚本在 `/tmp/opencode/vis-test/`（snap.js / interact.js / select-test.js / split-test.js），可供后续回归使用

