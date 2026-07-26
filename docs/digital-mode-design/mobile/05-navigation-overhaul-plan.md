# 05 — 移动端导航改造：全局模式 + Overview + 数码 Timeline/Albums

> 前置：`04-mobile-implementation-checklist.md`（数码模式 M1–M2C 已完成并 e2e 通过）。
> 本文档是下一阶段改造的实施计划。状态：**待实施**。

## 1. 需求与决策记录

### 用户原始需求（2026-07-26）

1. 首页目前是胶片 Timeline，数码没有对应物 → 胶片/数码在 app 级完全分开，顶部设切换按钮；新建 Overview 屏（类似桌面端），双模式共用
2. Timeline 屏：数码改为按月收纳的照片
3. 数码新增 Album 屏；胶片 Timeline、数码 Timeline、数码 Album 采用类似界面语言
4. Map 屏保持不动，但初始 mode 跟随当前全局模式；顶部三态切换保留

### 决策（用户已确认）

| # | 决策点 | 结论 |
|---|--------|------|
| D1 | 模式切换层级 | **全局唯一切换**：app 级 mode（Context + AsyncStorage），各 tab 主屏 header 右侧统一切换；Library 内 toggle 移除；Map 例外（三态为局部浏览过滤，仅默认值跟随全局，不回写） |
| D2 | Tab 结构 | **5 tab**：Overview / Timeline / Albums / Map / Library（Library 改名「更多」） |
| D3 | 数码 Timeline 形态 | **连续分节网格**：单一长网格，按月插入 section header（iOS Photos 风格） |
| D4 | 胶片模式 Albums tab | **显示 Collections 合集**（`/api/tags` 已有 cover_thumb + count，卡片网格复用） |
| D5 | Overview 内容 | **桌面对齐版**：HeroCarousel + QuickStats + Browse 区块 |

## 2. 现状盘点（改造前）

```
Tabs (3): Timeline(HomeScreen: 卷列表) | Map | Library
Library stack: Favorites/Collections/TagDetail/Stats/Equipment/Films/Inventory/
               DigitalAlbumList/DigitalAlbumDetail/...
模式状态: LibraryScreen 内部 AsyncStorage library_mode@${baseUrl}，仅 Library 感知
Map: SegmentedButtons 三态(film/digital/all)，默认 'all'，不持久化
数码入口: Library 数码分支 = DigitalLibraryScreen(相册卡+sessions+照片网格)
```

已核实的 API 事实（服务端零改动前提）：
- `/api/photos?mode=digital&sort=date_taken&order=desc&page=N&pageSize=60` ✅（数码 Timeline 数据源，现成）
- `/api/photos/random?limit=8&mode=film|digital` ✅（HeroCarousel 数据源，桌面同用）
- `/api/stats/summary?mode=` ✅（QuickStats，C-6 已接入 mode）
- `/api/tags?mode=film` 返回 `cover_thumb`/`cover_full`/`photo_count` ✅（胶片 Albums=Collections 数据源）
- `/api/albums`、`/api/albums/:id/photos` ✅（数码 Albums，现成）

## 3. 目标架构

### 3.1 全局模式状态

新增 `mobile/src/context/AppModeContext.tsx`：

```tsx
type AppMode = 'film' | 'digital';
AppModeContext = { mode: AppMode, setMode: (m: AppMode) => void }
```

- 持久化 key **复用** `library_mode@${baseUrl}`（保留用户既有选择，不引入迁移）
- baseUrl 变化时重新读取；Provider 挂在 App.tsx 根部（ApiContext 内层，因为 key 依赖 baseUrl）
- `useLibraryMode()`（navigation params 版）改为：`route.params?.mode ?? useAppMode().mode`——共享屏（Favorites/Themes/TagDetail/Stats）显式传参仍优先，缺省跟随全局，消除硬编码 'film' 回退

### 3.2 顶部切换按钮

新增 `mobile/src/components/ModeHeaderToggle.tsx`：
- 紧凑双态（film 图标 / digital 图标，或 130pt 宽 SegmentedButtons），写 AppModeContext
- 挂载点：Overview / Timeline / Albums / Library 四个 tab 主屏的 `headerRight`
- Map **不放**（其三态 SegmentedButtons 已含模式语义，避免双重控制）
- 切换时**不做**全屏 loading；各屏靠 useApiQuery 缓存键含 mode 自然重拉

### 3.3 Tab 结构（5 tab）

```
┌──────────┬───────────────────────────┬───────────────────────────┐
│ Tab      │ 胶片模式                  │ 数码模式                  │
├──────────┼───────────────────────────┼───────────────────────────┤
│ Overview │ HeroCarousel+Stats+Browse │ 同左（数据 mode=digital） │
│ Timeline │ 卷卡片列表（现有 Home）   │ 按月分节照片网格（新）    │
│ Albums   │ Collections 合集卡片网格  │ 相册列表（现有屏迁移）    │
│ Map      │ 默认段=film               │ 默认段=digital            │
│ 更多     │ 入口列表（现有 Library）  │ 入口列表（重构数码分支）  │
└──────────┴───────────────────────────┴───────────────────────────┘
```

Stack 归属调整：
- 新建 `AlbumsStack`：数码 = `DigitalAlbumList` + `DigitalAlbumDetail`（从 LibraryStack 移入）；胶片 = `CollectionsAlbums`（新）→ `TagDetail`
- `TagDetail`/`Favorites`/`Stats` 仍保留在 LibraryStack（更多屏进入），Albums 栈内各注册一份同名路由会冲突——**结论**：`TagDetail` 移出到根 Stack（与 RollDetail/PhotoView 同级），两处皆可 navigate
- Timeline tab：film 分支 = 现有 HomeScreen 不动；digital 分支 = 新 `DigitalTimelineScreen`（同屏内条件渲染，与 LibraryScreen 的 mode 分支同构）

### 3.4 数码 Timeline 分节网格（D3 技术方案）

数据源与分页逻辑**整体复用** DigitalLibraryScreen 的 page 累加方案（fetchQuery + setQueryData + loadingMoreRef），仅渲染层重构：

```
pages(全部已加载照片, date_taken desc)
  → useMemo 打平为 FlatList data:
    [{type:'header', key:'m-2026-07', label:'2026年7月'},
     {type:'row', key:'r-2026-07-0', photos:[p1,p2,p3]},   ← 每行满 3 张
     {type:'row', key:'r-2026-07-1', photos:[p4,p5]},
     {type:'header', key:'m-2026-06', ...}, ...]
```

- 分组键：`date_taken`（缺失回退 `created_at`）截取 YYYY-MM；i18n 格式 zh `2026年7月` / en `Jul 2026`（Intl.DateTimeFormat）
- FlatList `renderItem` 按 type 分派：header → 月份标题行；row → 3 格 CachedImage 行（复用 DigitalPhotoGrid 的单格渲染，抽 `GridCell` 子组件共享）
- `getItemLayout` 不可再用固定高度（header/row 异高）→ 删除该优化，用 `initialNumToRender`+`windowSize` 控制；照片行高仍固定，header 高度固定，可提供近似 getItemLayout（row 数可算）——**实施时实测决定，非阻塞**
- sticky header：FlatList 不支持，SectionList 多列要自行分行且丢掉现有网格优化——**不做 sticky**（记录在开放问题）
- 点照片 → PhotoView，`photosKey` 复用 `digitalPhotosAggregate@${baseUrl}` 约定

### 3.5 Overview 屏（D5 桌面对齐版）

新 `mobile/src/screens/overview/OverviewScreen.tsx` + `mobile/src/components/overview/`：

| 区块 | 数据源 | 说明 |
|------|--------|------|
| HeroCarousel | `GET /api/photos/random?limit=8&mode={mode}` | FlatList 横向 `pagingEnabled` 轮播（无新依赖），全宽大图 + 渐变遮罩 + 日期/相机文字；点击 → PhotoView；自动播放（4s）+ 指示点 |
| QuickStats | `GET /api/stats/summary {mode}` | 单行 3–4 个统计卡：胶片=卷/照片/最爱/地点；数码=照片/相册/本月新增/最爱（相册数从 `/api/albums` 长度派生，本月新增从 summary 或客户端筛） |
| Browse | 入口卡 + 最近照片 | 入口卡 2×2：Favorites / Stats / Albums（数码）或 Collections（胶片）/ Map；下方「最近照片」横向滚动条（`/api/photos?mode=&pageSize=20&sort=date_taken&order=desc`） |

- 整屏 ScrollView + RefreshControl；mode 切换时缓存键变 → 自动重拉
- 数码特有「最近导入 sessions」**不放** Overview（保留在数码 Timeline 顶部？——决策：挪到 Albums 数码分支顶部，Timeline 保持纯照片流）

### 3.6 Library →「更多」改造

- tab label：`tab.more`（更多 / More）
- 移除 LibraryModeToggle + fadeAnim 分支（全局切换接管；e2e 修复的 didMountRef 逻辑随分支移除而退役——film 主体不再被条件卸载）
- 内容重构为**模式感知的入口列表**（ListItem 行）：
  - 胶片：Favorites / Collections / Stats / Films / Equipment / Inventory / ShotLog（维持现状）
  - 数码：Favorites / Stats / Sessions（新入口，`/api/digital-sessions` 列表屏 P2 可做，本期放简单列表）/ Map
- 数码分支的相册入口卡、sessions 区块、照片网格**全部移出**（分别归 Albums / Albums / Timeline），DigitalLibraryScreen 组件**删除**，其分页网格逻辑被 DigitalTimelineScreen 吸收

### 3.7 Map 默认 mode

`useState<MapMode>(globalMode)` 初始化（'film'|'digital'，不再默认 'all'）；三态切换保留为屏内局部 state，不回写全局。globalMode 变化时（用户在别的屏切了模式再进 Map）effect 同步一次——但若用户已在 Map 内手动改过，尊重其选择（didMountRef 模式，仅首次跟随）。

## 4. 分阶段工作项

### N1 · 全局模式基建（~0.5d）

| # | 工作项 | 文件 |
|---|--------|------|
| N1-1 | AppModeContext + Provider（持久化复用 `library_mode@${baseUrl}`） | 新增 `src/context/AppModeContext.tsx`；改 `App.tsx` |
| N1-2 | ModeHeaderToggle 组件 + 四主屏 headerRight 挂载 | 新增 `src/components/ModeHeaderToggle.tsx`；改各主屏 |
| N1-3 | useLibraryMode 默认值改读全局 context | 改 `src/hooks/useLibraryMode.ts` |
| N1-4 | MapScreen 默认 mode 跟随全局（仅首次） | 改 `src/screens/map/MapScreen.tsx` |
| N1-5 | 单元测试：Context 持久化 + useLibraryMode 回退链 | 新增 `__tests__/app-mode.test.tsx` |

### N2 · Overview 屏 + tab 注册（~1.5d）

| # | 工作项 | 文件 |
|---|--------|------|
| N2-1 | OverviewScreen 骨架（ScrollView+RefreshControl+mode 感知） | 新增 `src/screens/overview/OverviewScreen.tsx` |
| N2-2 | HeroCarousel（FlatList paging 轮播+自动播放+指示点+点击进 PhotoView） | 新增 `src/components/overview/HeroCarousel.tsx` |
| N2-3 | QuickStats 行（stats/summary + albums 派生） | 新增 `src/components/overview/QuickStatsRow.tsx` |
| N2-4 | Browse 区块（入口卡 2×2 + 最近照片横滚） | 新增 `src/components/overview/BrowseSection.tsx` |
| N2-5 | Tab 注册为第 1 tab + ModeHeaderToggle | 改 `App.tsx` |
| N2-6 | 测试：渲染/模式切换数据重拉/空态 | 新增 `__tests__/overview.test.tsx` |

### N3 · 数码 Timeline 分节网格（~1d）

| # | 工作项 | 文件 |
|---|--------|------|
| N3-1 | DigitalTimelineScreen：分页逻辑自 DigitalLibraryScreen 移植 + 月份打平算法 | 新增 `src/screens/timeline/DigitalTimelineScreen.tsx` |
| N3-2 | GridCell 抽取（DigitalPhotoGrid 单格 → 共享子组件） | 改 `src/components/digital/DigitalPhotoGrid.tsx` |
| N3-3 | HomeScreen（Timeline tab）：mode='digital' 分支渲染 DigitalTimelineScreen | 改 `src/screens/home/HomeScreen.tsx`（或 tab 容器处） |
| N3-4 | 测试：分组打平算法（跨月边界/缺 date_taken/单行不足 3 张/分页追加重分组） | 新增 `__tests__/digital-timeline.test.tsx` |

### N4 · Albums tab（~1d）

| # | 工作项 | 文件 |
|---|--------|------|
| N4-1 | AlbumsStack 建立；DigitalAlbumList/Detail 从 LibraryStack 迁入 | 改 `App.tsx` |
| N4-2 | 数码分支顶部加「最近导入 sessions」横向区块（自 DigitalLibraryScreen 挪入） | 改 `src/screens/library/DigitalAlbumListScreen.tsx` |
| N4-3 | 胶片分支 CollectionsAlbumsScreen：`/api/tags?mode=film` 卡片网格（cover_thumb+title+count）→ TagDetail | 新增 `src/screens/albums/CollectionsAlbumsScreen.tsx` |
| N4-4 | TagDetail 路由移至根 Stack（双栈可达） | 改 `App.tsx`、`src/navigation/types.ts` |
| N4-5 | 测试：胶片合集网格渲染 + 数码相册回归 | 新增 `__tests__/albums-tab.test.tsx` |

### N5 · Library「更多」改造 + i18n（~0.5d）

| # | 工作项 | 文件 |
|---|--------|------|
| N5-1 | Library 移除 toggle/数码网格分支，改模式感知入口列表；tab 改名「更多」 | 改 `src/screens/library/LibraryScreen.tsx`、`App.tsx` |
| N5-2 | 删除 DigitalLibraryScreen（逻辑已被 N3/N4 吸收）+ LibraryModeToggle 退役 | 删除 2 文件 |
| N5-3 | i18n：`tab.overview/albums/more`、`overview.*`、`timeline.months*`、`albums.collections*` 双语 | 改 `src/i18n/{zh,en}.ts` |

### N6 · 测试 + e2e（~1d）

| # | 工作项 |
|---|--------|
| N6-1 | jest 全绿（既有 49 + 新增）+ tsc 0 错误 |
| N6-2 | e2e 模拟器：全局切换×5 tab、Overview 双模式、数码 Timeline 分节滚动、Albums 双模式、Map 默认跟随、杀进程持久化、胶片全量回归 |
| N6-3 | @review 对抗审查 + 修复 |
| N6-4 | 勾选本计划验收项，更新 04-checklist 关联说明 |

**合计 ~4.5–5 人天。** 依赖序：N1 → (N2 ∥ N3 ∥ N4) → N5 → N6。

## 5. 显式不做（防 scope creep）

- 不做 sticky 月份 header（开放问题，见 §6）
- 不做数码 Timeline 的「日」级下钻
- 不做 Overview 的 LifeLog/AI 区块（桌面有，移动端本期不搬）
- 不做 Sessions 独立管理屏（仅 Albums 顶部横向区块）
- 不改服务端任何文件（所需 API 全部现成，§2 已核实）
- 不改 PhotoView/RollDetail 等既有详情屏
- 不做模式切换的全屏过渡动画

## 6. 风险与开放问题

| 项 | 说明 | 处置 |
|----|------|------|
| 分节网格 getItemLayout 失效 | header/row 异高，固定高度优化不可用，长列表滚动性能待实测 | N3 实施时实测；必要时 header 高度固定化后仍可提供精确 offset（row 数可计算） |
| sticky header | FlatList 不支持；SectionList 多列需自行分行 | 本期不做；若用户反馈需要，P2 用 SectionList+分行重构 |
| HeroCarousel 自动播放与 PhotoView 手势冲突 | 轮播定时器在屏内停留时持续触发 | 离开屏（blur）时 clearInterval；点击后暂停 |
| `/api/photos/random` 数码数据量少 | seed/真实库照片少时轮播单薄 | limit 内不足 8 张按实际渲染；0 张时隐藏区块 |
| 5 tab 宽度 | 小屏设备 5 个中文 label 可能拥挤 | label 用「更多」二字；必要时 icon-only |
| 既有用户首次升级 | AsyncStorage 已有 `library_mode@` 值直接被全局接管，行为一致 | 无需迁移 |
| e2e 修复的 fadeAnim bug | N5 移除条件分支后该修复代码退役 | 删除时确认无回归（e2e 覆盖） |

## 7. 验收清单（实施完成后勾选）

- [ ] 全局切换：任一主屏 header 切换，5 个 tab 内容全部跟随（Map 为默认段跟随）
- [ ] Library 内无残留 toggle；`library_mode@` 持久化跨重启生效
- [ ] Overview：双模式 HeroCarousel/QuickStats/Browse 渲染正确，轮播可点进 PhotoView
- [ ] 数码 Timeline：按月 header 正确、分页追加不重复分组、缺 date_taken 照片归入 created_at 月份
- [ ] Albums：胶片=Collections 网格可进 TagDetail；数码=相册列表+详情+sessions 区块，长按操作回归
- [ ] Map：数码模式进入默认段=digital；手动切三态后不被全局切换打断
- [ ] jest 全绿 + tsc 0 错误 + e2e 通过 + @review 无未修复 Critical
