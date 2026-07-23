# 04 — 产品 UX

## 4.1 侧边栏重构

### 现状(纯胶片)
```
Main:     Overview, Rolls, Films
Browse:   Calendar, Map, Favorites, Themes (+ per-tag)
Tools:    Statistics, Equipment, LUT Library, Settings
Footer:   AI panel, theme, collapse
```

### 重构后(双模式共存,无 workspace 切换)
```
胶片 (Film):           Rolls, Films
数码 (Digital):        Albums, Import, Develop       ← Develop 是新的轻量调色入口
图库 (Library):        All Photos           ← 新增,跨模式全量时序浏览
浏览 (Browse):         Calendar, Map, Favorites, Themes
工具 (Tools):          Statistics, Equipment, LUT Library, Settings
Footer:                AI panel, theme, collapse
```

设计要点:
- **无顶部模式切换器**(D1)。胶片和数码章节始终可见;纯胶片用户自然忽略数码章节
- 章节顺序:胶片 → 数码 → Library → Browse → Tools。Library 单列出来,因为它是新的"全量入口"
- Library 是当前缺失的视图——现在只能从 Rolls 进入照片网格,没有"所有照片"的统一入口。数码模式需要它
- **Develop 入口**有两种实现选择:
  - 方案 A:侧栏独立入口 `/digital/develop`,打开最近一张数码照片或选择器
  - 方案 B:不在侧栏,只在 PhotoView 加"调色"按钮(数码照片专属)
  - **推荐 B**:DigitalDevelop 是 per-photo 操作,不需要独立侧栏入口;胶片 FilmLab 也是从 RollDetail/PhotoView 进入,没有独立侧栏入口,保持一致
- LUT Library 数码模式有意义(DigitalDevelop 可应用 LUT),保持显示
- 移动端侧边栏(Mobile Library tab)同步加 Albums 入口,但 MVP 移动端数码只读(见 06)

### 章节折叠策略
- 默认所有章节展开
- 用户可在 Settings 配置"隐藏数码章节"或"隐藏胶片章节"(对应 onboarding 的选择)
- 设置项:`sidebar.show_film_section` (默认 true), `sidebar.show_digital_section` (默认 true)
- 纯胶片用户:onboarding 选"胶片 only"后,`show_digital_section=false`,数码章节折叠

## 4.2 路由设计

### 现状路由(`client/src/App.jsx:72-88`,HashRouter)
```
/, /calendar, /map, /stats, /spending,
/rolls, /rolls/new, /rolls/:id,
/films, /favorites, /themes, /themes/:tagId,
/equipment, /luts, /settings
```

### 新增/修改路由
```
新增:
  /library                       LibraryView(所有照片按时序,可过滤模式)
  /digital/albums                AlbumLibrary(数码相册网格)
  /digital/albums/new            NewAlbumForm
  /digital/albums/:id            AlbumDetail(类比 RollDetail,简化)
  /digital/import                DigitalImportWizard

修改:
  /rolls/*                       保持不变(胶片专属)
  /films                         保持不变(胶片专属)
  /calendar, /map, /favorites, /themes, /themes/:tagId  加 ?mode=film|digital|all 过滤参数
  /stats                         加 mode tab 切换(film/digital/combined)
  /spending                      保持不变(胶片专属,数码模式侧栏不显示)

保持不变:
  /, /equipment, /luts, /settings
```

设计要点:
- 路由前缀 `/digital/*` 明确数码专属,但 `/rolls/*` 不加 `/film/*` 前缀(避免破坏现有书签/链接)
- Library 视图是胶片数码合流的唯一入口(其他 Browse 视图也支持合流,但 Library 是"全量照片网格")
- 过滤参数用 query string(`?mode=digital`),不用路径段——便于 React Query 缓存键管理

## 4.3 共享视图的过滤芯片

Calendar / Map / Favorites / Themes / Library / Overview 的 header 加一个 3-state 过滤芯片:

```
[ 胶片 | 数码 | 全部 ]
```

行为:
- 默认值:首次访问读 `app_config.default_source_filter`;之后每个视图独立记忆最后选择(localStorage)
- 切换时立即重新拉数据(React Query invalidate)
- 视图标题反映过滤:`Calendar · 数码`、`Map · 全部`
- 过滤芯片不显示在胶片专属视图(`/rolls/*`、`/films`)和数码专属视图(`/digital/*`)——这些视图本身就是模式限定的

### 数据层影响
- 共享视图的 API 调用传 `?mode=` 参数:`GET /api/photos?mode=digital`、`GET /api/photos/geo?mode=all`、`GET /api/stats/temporal?mode=film`
- 后端在 13 处审计后的 LEFT JOIN 查询里加 `WHERE p.source_type IN (...)` 过滤

## 4.4 Library 视图(新增)

### 定位
跨模式的"全量照片时序浏览"。当前缺失,数码模式必须有。

### 布局
```
┌─ Header ────────────────────────────────────┐
│ Library                  [胶片|数码|全部]    │
│ 共 12,847 张 · 按日期降序                   │
└─────────────────────────────────────────────┘
┌─ Sidebar (左) ─┐  ┌─ 主区 ─────────────────┐
│ 年份           │  │  ┌──┐ ┌──┐ ┌──┐ ┌──┐  │
│  ▾ 2026        │  │  │  │ │  │ │  │ │  │  │
│    7月 (124)   │  │  └──┘ └──┘ └──┘ └──┘  │
│    6月 (89)    │  │  ┌──┐ ┌──┐ ┌──┐ ┌──┐  │
│  ▾ 2025        │  │  │  │ │  │ │  │ │  │  │
│    ...         │  │  └──┘ └──┘ └──┘ └──┘  │
│ 相机           │  │  ...                   │
│  Sony A7IV     │  │                        │
│  Leica M6      │  │                        │
│ 镜头           │  │                        │
│  ...           │  │                        │
└────────────────┘  └────────────────────────┘
```

- 左侧筛选栏:年份/月份/相机/镜头/胶片型号(胶片)/摄影师/位置/标签
- 主区:VirtualPhotoGrid(复用现有组件),按 `date_taken` 降序
- 与 Rolls 的网格区别:不限定 roll,跨所有 roll + 所有数码 session
- 与 Calendar 区别:Calendar 是日历视图,Library 是平铺网格
- MVP 不做无限滚动分页(见 06 性能);Phase 2 加 keyset 分页

### 与现有 Overview 的区别
- Overview(`client/src/components/Overview/`):仪表盘式,HeroCarousel + QuickStats + BrowseSection
- Library:平铺照片网格,纯浏览
- 二者并存,Overview 是"今日/本月概览",Library 是"翻全量照片"

## 4.5 Albums 与 AlbumDetail

### `/digital/albums` — AlbumLibrary
```
┌─ Header ────────────────────────────────────┐
│ Albums                    [+ 新建相册]       │
│ 共 12 个相册 · 按更新时间                    │
└─────────────────────────────────────────────┘
┌──┐ ┌──┐ ┌──┐ ┌──┐
│  │ │  │ │  │ │  │   (封面 + 标题 + 照片数 + 日期范围)
└──┘ └──┘ └──┘ └──┘
"东京 2024"   "杭州婚礼"   "扫街精选"   ...
124 张         89 张        45 张
2024-04-12     2024-06-08   2023-11-...
```

- 网格布局,每张卡片显示封面、标题、照片数、日期范围、(可选)位置
- 嵌套相册显示为子相册区(类似文件夹)
- 右键菜单:重命名、删除、设为封面、导出
- 支持拖拽排序(`sort_order`)

### `/digital/albums/:id` — AlbumDetail
```
┌─ AlbumHeader ───────────────────────────────┐
│ ← Back   东京 2024                          │
│ 2024-04-10 ~ 2024-04-15 · 东京             │
│ 124 张 · [编辑] [添加照片] [导出] [删除]    │
└─────────────────────────────────────────────┘
┌─ PhotoGrid ────────────────────────────────┐
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐                  │
│  │  │ │  │ │  │ │  │ │  │                  │
│  └──┘ └──┘ └──┘ └──┘ └──┘                  │
│  ...                                       │
└────────────────────────────────────────────┘
```

- 与 RollDetail 对比:无 dev/scan/exposure-log 章节(那些是胶片专属)
- 共享 RollDetail 的:PhotoGrid、批量操作、过滤、排序、详情侧栏
- "添加照片"打开一个"从 Library 选照片"的模态(MVP 只能从已导入照片选;Phase 2 可直接从文件夹导入到此相册)
- 与 RollDetail 的关键差异:照片可被移除(不删除照片本身,只删 album_photos 行)

## 4.6 DigitalImport 导入向导

### `/digital/import` — 三步向导

#### Step 1: 选择文件
```
┌────────────────────────────────────────────┐
│ 1. 选择文件                                │
│ ┌────────────────────────────────────────┐ │
│ │                                        │ │
│ │   拖拽 JPEG/RAW 文件到此,或           │ │
│ │   [选择文件夹] [选择文件]              │ │
│ │                                        │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ 已选 124 张(去重后 89 张,跳过 35 张已存在)│
│   其中 12 张 RAW(将自动 demosaic 生成预览)│
│                                            │
│              [取消]  [下一步 →]            │
└────────────────────────────────────────────┘
```

- 拖拽或文件选择器
- 实时计算 content_hash,标记"已存在,将跳过"
- RAW 文件自动识别(libraw-native 支持 CR2/CR3/NEF/ARW/RW2/RAF/DNG),导入时 demosaic 生成 JPEG 预览(`positive_rel_path`),RAW 文件存为 `original_rel_path`(供 DigitalDevelop 重新渲染)
- JPEG 文件:原件既是 `original_rel_path` 也是 `positive_rel_path`

#### Step 2: 解析与组织
```
┌────────────────────────────────────────────┐
│ 2. 解析与组织                              │
│                                            │
│ EXIF 解析中... ▓▓▓▓▓▓▓▓░░ 80%              │
│                                            │
│ 检测到:                                   │
│   拍摄日期范围: 2024-04-10 ~ 2024-04-15   │
│   主要相机: Sony A7IV(112 张)            │
│   其他相机: iPhone 15 Pro(12 张)         │
│   位置: 东京(89 张有 GPS)                │
│                                            │
│ 自动分组:                                 │
│   ☑ 创建一个 session "东京 2024"          │
│     (按拍摄日期分组)                       │
│   ☐ 加入到现有相册: [选择相册 ▾]         │
│   ☐ 创建新相册 "东京 2024" 并全部加入    │
│                                            │
│              [上一步]  [下一步 →]          │
└────────────────────────────────────────────┘
```

- 解析 EXIF(复用 `server/services/exif-service.js` 已有的 piexifjs + exiftool-vendored)
- 按 EXIF 日期/相机/GPS 自动推断 session
- 让用户决定:只创建 session(不入相册) / 加入现有相册 / 创建新相册

#### Step 3: 导入
```
┌────────────────────────────────────────────┐
│ 3. 导入中                                  │
│                                            │
│ 复制文件... ▓▓▓▓▓▓░░░░ 60%                 │
│ 生成缩略图... ▓▓▓░░░░░░░ 30%               │
│ 写入数据库... ▓▓▓▓▓▓▓▓░░ 80%               │
│                                            │
│ 当前: DSC_0123.jpg                         │
│ 已完成: 53 / 89                            │
│                                            │
│ [暂停]  [取消]                             │
└────────────────────────────────────────────┘
```

- 后台 worker 池(复用 `server/services/render-worker-pool.js`)并行生成缩略图
- 进度通过 SSE 或轮询推送(复用现有 batch-render 进度机制)
- 完成后跳转到 AlbumDetail(如果创建了相册)或 Library

### 边界情况处理
- **RAW+JPEG 配对(MVP)**:若用户同时拖入配对,只入 JPEG,RAW 忽略并提示"RAW+JPEG 配对将在 Phase 2 支持,本次只导入 JPEG"
- **重复导入**:content_hash 命中已有照片,跳过 + 在向导显示"跳过 N 张已存在"
- **EXIF 缺失**:日期/相机/GPS 缺失时,用文件 mtime / "未知相机" / 无位置 兜底,不阻塞导入
- **大文件(>100MB RAW)**:不阻塞,但显示警告"大文件,demosaic 可能较慢"
- **中断恢复**:import_batch_id 持久化在 digital_sessions 表;若导入中断,重启后可查询"未完成的批次"并恢复
- **RAW demosaic 失败**(罕见,如损坏的 RAW 文件):跳过该文件并记录错误,不阻塞其他文件导入

## 4.7 PhotoDetailsSidebar 按模式分支

`client/src/components/PhotoDetailsSidebar.jsx` 现有结构按 source_type 分支显示:

```
┌─ 共享区(所有照片)────────────────────┐
│ [缩略图]                              │
│ 评分: ★★★★☆                          │
│ 拍摄日期: 2024-04-12 14:23           │
│ 摄影师: [输入框]                      │
│ 标签: [tag1] [tag2] [+ 添加]          │
│ 位置: 东京 · 涩谷(地图缩略)          │
│ 标题/描述: [输入框]                   │
│ 备注: [输入框]                        │
└───────────────────────────────────────┘

┌─ 胶片专属区(source_type=film)───────┐
│ 所属卷: Roll #123 · Portra 400       │
│ 帧号: 12A                            │
│ 冲洗: 2024-04-20 · Lab X · C-41      │
│ 扫描: Epson V850 · 4800 dpi          │
│ 负片: [显示负片] [在 FilmLab 调色]    │
└───────────────────────────────────────┘

┌─ 数码专属区(source_type=digital)────┐
│ 相机: Sony A7IV                       │
│ 镜头: FE 35mm f/1.4 GM                │
│ 光圈: f/2.8  快门: 1/250  ISO: 400    │
│ 焦距: 35mm(等效 35mm)               │
│ 白平衡: 自动                          │
│ 色彩空间: sRGB                        │
│ 所属 session: 东京 2024               │
│ 所在相册: 东京 2024, 街拍精选        │
│ 原始文件: DSC_0123.ARW                │
│         [在 Finder 中显示]            │
└───────────────────────────────────────┘
```

- 用 `source_type` 判断显示哪个区块,共享区始终显示
- 数码区有"调色"按钮(打开 DigitalDevelop),不是"在 Finder 中显示"那么简单
- 胶片区保持现有逻辑不变

## 4.7.5 DigitalDevelop — 轻量数码调色 UI

### 定位
复用 FilmLab 底层渲染模块(`packages/shared/filmLabWhiteBalance.js`/`filmLabHSL.js`/`filmLabToneLUT.js`/`filmLabCurves.js`/`filmLabSplitTone.js`)+ 新薄 UI(预估 ~25-30KB,远小于 FilmLab 主组件的 117KB)。

### 入口
- 不在侧栏做独立入口(类比 FilmLab,从 PhotoView 进入)
- PhotoView 的工具栏:数码照片显示"调色"按钮,胶片照片显示"在 FilmLab 调色"
- 路由:`/digital/develop/:photoId`(直接访问)或 PhotoView 内模态打开

### 布局(类比 FilmLab 但去掉胶片专属控件)
```
┌─ Header ─────────────────────────────────────┐
│ ← Back   DSC_0123.ARW                       │
│ Sony A7IV · 35mm · f/2.8 · 1/250 · ISO 400  │
│ [重置] [保存] [存为预设] [导出]              │
└──────────────────────────────────────────────┘
┌─ 主预览 ────────────────────┐  ┌─ 控件面板 ──────┐
│                            │  │ ▾ 白平衡         │
│                            │  │   色温 [─────]   │
│       渲染后的              │  │  色调 [──]      │
│       JPEG 预览            │  │ ▾ 光度          │
│       (实时更新)           │  │   曝光 [──]      │
│                            │  │   对比 [──]      │
│                            │  │   高光 [──]      │
│                            │  │   阴影 [──]      │
│                            │  │ ▾ HSL           │
│                            │  │   (色相/饱和/亮度)│
│                            │  │   每个颜色       │
│                            │  │ ▾ 色调曲线      │
│                            │  │   RGB/R/G/B     │
│                            │  │ ▾ 分色调         │
│                            │  │   高光/阴影      │
│                            │  │ ▾ LUT           │
│                            │  │   [选择 LUT ▾]   │
└────────────────────────────┘  └──────────────────┘
```

### 与 FilmLab 的对比

| 模块 | FilmLab(胶片) | DigitalDevelop(数码) |
|---|---|---|
| 负片反转(inversion) | ✅ 核心 | ❌ 不需要(数码无负片) |
| FILM_PROFILES(Portra/Ektar/...) | ✅ 胶片特性曲线 | ❌ 不需要 |
| H&D 密度曲线 | ✅ | ❌ |
| 白平衡 | ✅ | ✅ 复用 |
| HSL | ✅ | ✅ 复用 |
| 色调曲线(ToneLUT/Curves) | ✅ | ✅ 复用 |
| 分色调(SplitTone) | ✅ | ✅ 复用 |
| 曝光/对比/高光/阴影 | ✅ | ✅ 复用 |
| LUT 应用 | ✅ | ✅ 复用 |
| **裁剪/旋转/翻转** | ❌(胶片扫描固定画幅) | ✅ **新增**(数码需二次构图) |
| 镜头校正(LCP) | ❌ | ❌(不做,交给 Lightroom) |
| 相机配置文件(DCP) | ❌ | ❌(不做) |
| 编辑历史 | ❌ | ❌(不做) |

### 控件范围(用户 2026-07-23 决策:9 类核心 + 裁剪/旋转)

**做**(10 类):
1. 白平衡(色温/色调)
2. 曝光
3. 对比
4. 高光/阴影
5. 白色/黑色
6. HSL(8 色 × 色相/饱和/亮度)
7. 色调曲线(RGB/R/G/B)
8. 分色调(高光/阴影)
9. LUT 应用
10. **裁剪/旋转**(自由比例 + 预设比例 1:1/3:2/4:3/16:9 + 90° 旋转 + 水平/垂直翻转)

**不做**(范围边界):
- ❌ 局部调整(笔刷/渐变/径向滤镜)
- ❌ AI 自动调色
- ❌ 曲线拟合
- ❌ 污点修复/克隆
- ❌ HDR 合成 / 全景拼接
- ❌ 镜头校正(LCP)
- ❌ 相机配置文件(DCP)
- ❌ 编辑历史(撤销/重做栈)
- ❌ 虚拟副本

**裁剪/旋转的参数存储**:`develop_params_json` 内加 `crop` 子对象:
```json
{
  "crop": {
    "x": 0.1, "y": 0.05, "width": 0.8, "height": 0.9,
    "rotation": 0,
    "flip_h": false,
    "flip_v": false
  },
  ...其他 9 类参数
}
```
归一化坐标(0-1),与分辨率无关,便于不同显示尺寸复用。

### 关键技术点
- 渲染管线复用 `packages/shared/render/RenderCore.js` + `renderChunked.js`
- demosaic 后的 RGB buffer 直接喂给 FilmLab 底层模块(格式兼容)
- 实时预览:滑条改变 → 重新跑 RenderCore → Canvas 更新(throttle 50ms)
- "保存":参数写入 `photos.develop_params_json` + 渲染最终 JPEG 覆盖 `positive_rel_path` + 重新生成 `thumb_rel_path`(类比胶片 export-positive)
- "存为预设":`INSERT INTO presets (name, category='digital', params_json=?)`,可复用到其他数码照片
- "导出":渲染最终 JPEG 到本地下载目录(可选带 EXIF 写入,复用 `exif-service.js`)

### 不做的(D6/D7 边界)
- ❌ 负片反转控件(数码无负片)
- ❌ FILM_PROFILES 选择器
- ❌ H&D 密度曲线调整
- ❌ 镜头校正
- ❌ 相机配置文件(DCP)
- ❌ 编辑历史(撤销/重做栈)
- ❌ 虚拟副本
- ❌ 局部调整(笔刷/渐变/径向)
- ❌ AI 自动调色
- ❌ 污点修复/克隆
- ❌ HDR 合成 / 全景拼接

### 入口(用户 2026-07-23 决策:只从 PhotoView 进入)
- 不在侧栏做独立入口(类比 FilmLab,从 PhotoView 进入)
- PhotoView 的工具栏:数码照片显示"调色"按钮,胶片照片显示"在 FilmLab 调色"
- 路由:`/digital/develop/:photoId`(直接访问)或 PhotoView 内模态打开
- 不做批量预设应用入口(MVP 保持简单;Phase 2 视反馈再评估)

## 4.8 首次运行引导(Onboarding)

### 新用户首次启动
模态对话框,3 张卡片选一:

```
┌──────────────────────────────────────────┐
│ 你拍什么?                               │
│                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │  🎞️      │  │  📷      │  │ 🎞️📷  │ │
│  │  胶片    │  │  数码    │  │ 两者   │ │
│  │          │  │          │  │        │ │
│  │ 卷/胶片  │  │ 相册/    │  │ 全部   │ │
│  │ 冲洗/扫描│  │ 导入     │  │ 启用   │ │
│  └──────────┘  └──────────┘  └────────┘ │
│                                          │
│         [跳过,使用默认(胶片)]           │
└──────────────────────────────────────────┘
```

- 选"胶片":`app_config.default_source_filter='film'`, `digital_enabled=0`, `sidebar.show_digital_section=false`
- 选"数码":`default_source_filter='digital'`, `digital_enabled=1`, `sidebar.show_film_section=false`
- 选"两者":`default_source_filter='all'`, `digital_enabled=1`, 两个章节都显示
- 选"跳过":保持默认(`film`),`onboarding_completed=1`,之后不再弹
- 任何时候可在 Settings → General 重新设置

### 现有用户首次升级到含数码模式的版本
一次性迁移模态:

```
┌──────────────────────────────────────────┐
│ FilmGallery 现在支持数码照片管理 📷     │
│                                          │
│ 把你满意的数码照片也放进 FilmGallery,    │
│ 和胶片库共享日历、地图、标签、器材。     │
│                                          │
│ [设置我的数码库]    [以后再说]           │
└──────────────────────────────────────────┘
```

- "设置我的数码库"跳到 onboarding 选择卡片
- "以后再说"`digital_enabled=0`, `onboarding_completed=1`,不弹第二次
- 用户在 Settings → General 仍可随时启用

## 4.9 Settings 新增项

`client/src/components/Settings/GeneralSettings.jsx` 加:

- **默认浏览过滤**: 胶片 / 数码 / 全部(单选,设 `default_source_filter`)
- **侧边栏显示**: ☑ 胶片章节 ☑ 数码章节(勾选控制 `sidebar.show_*`)
- **数码模式**: [启用数码模式] [禁用](禁用后隐藏所有数码 UI,但已导入的数码数据保留)

## 4.10 主题与图标

- 数码章节用 📷 或胶片相机以外的图标(避免和胶片混淆),建议用相册堆叠图标
- 过滤芯片用三个圆点(胶片=红,数码=蓝,全部=灰),或文字标签
- 不引入新模式专属的主题色——保持现有主题一致

## 4.11 不做的 UX(明确排除)

- ❌ 顶部模式切换 dropdown(Notion workspace 式)——D1 已排除
- ❌ 数码模式独立的完整 FilmLab 对标模块——D6 已排除,只做轻量 DigitalDevelop
- ❌ "智能相册"创建界面——Phase 2
- ❌ 编辑历史/虚拟副本面板——Lightroom 领地
- ❌ DCP 相机配置文件选择器——Lightroom 领地
- ❌ 镜头校正(LCP)面板——Lightroom 领地
- ❌ RAW+JPEG 配对管理 UI——Phase 2
- ❌ 视频播放器——Phase 3
- ❌ 人脸识别面板——Phase 3
