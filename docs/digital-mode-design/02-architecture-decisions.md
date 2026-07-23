# 02 — 架构决策记录 (ADR)

每条决策记录:背景、备选方案、决策、后果。

---

## D1. 模式 UX 原语:filter 而非 workspace

### 背景
用户说"直接分为胶片和数码模式,能够直接切换"。最直白的实现是 Notion/Linear 式的 workspace switcher——顶部一个下拉,切到"数码 workspace"后整个侧边栏/路由都变。

### 备选
- **A. Workspace switcher**:film 和数码是完全独立的 workspace,共享视图(Calendar/Map)在两个 workspace 里各有一份,数据按 workspace 隔离
- **B. 全局模式开关 + mode-guard 中间件**:单一库,但顶部一个 toggle 切换"当前模式",数码模式下 `/api/rolls` 直接 404
- **C. 过滤器**:无全局开关;侧边栏模式专属章节始终可见;共享视图有 per-view 过滤芯片(胶片/数码/全部);全局默认过滤在 Settings 里设

### 决策:**C**

### 理由
- A 否决:用户明确要"模块复用"。Workspace 隔离 = 共享视图要在两边各实现一份,违背复用初衷。而且单用户个人应用不需要 workspace 隔离的多租户语义
- B 否决:硬开关会杀死跨模式视图——"东京之行的胶片+数码合流"在 Calendar 上看不到。用户既要清晰区分,又要跨模式浏览,这是 filter 的语义而非 workspace
- C 当选:per-view 过滤芯片让用户在 Calendar 上选"全部"看合流、在 Stats 上选"胶片"看成本;模式专属章节(Rolls/Films vs Albums/Import)始终可见,无切换 chrome

### 后果
- 不需要 mode-guard 中间件(`/api/rolls` 在数码模式下也响应,只是前端不调用)
- 需要在所有共享视图(Calendar/Map/Favorites/Themes/Overview/Stats)的 header 加 3-state 过滤芯片
- 需要一个全局默认过滤设置(控制新打开视图的初始状态)
- 首次运行引导让用户选默认过滤(胶片/数码/两者)

---

## D2. 数码范围:策展存档,非工作目录

### 背景
用户原话"只用于存放我自己比较满意的数码照片"。这是关键的范围锚点。

### 决策:MVP 范围 = 策展存档

### 范围内
- JPEG 批量导入 + EXIF 提取
- 相册(M2M、嵌套)+ 标签 + 评分 + 位置 + 摄影师
- 浏览:Library / Calendar / Map / Favorites / Themes / AlbumDetail
- 查看:PhotoView + 按模式分支的元数据侧栏
- 可选"同时归档 RAW 原件"(RAW 不解码,只存盘 + 用内嵌 JPEG 预览浏览)

### 范围外(MVP 不做)
- DigitalDevelop 调色面板(见 D6)
- 完整 RAW 解码(见 D7)
- 编辑历史 / 虚拟副本 / XMP 写入
- 智能相册
- FTS5 全文搜索

### 后果
- 数码模式没有"杀手级功能"对标 FilmLab——这是**有意的范围控制**,不是缺失
- 数码模式的核心价值是"和胶片库共享 Calendar/Map/Equipment/Tags 的统一浏览",而非"在 FilmGallery 里调数码照片"
- MVP 完成后用 1-2 个月观察用户是否真的需要 DigitalDevelop,再决定 Phase 2 范围

---

## D3. photos 表:统一表 + source_type 字段

### 背景
数码照片是否复用现有 `photos` 表,还是新建 `digital_photos` 表?

### 备选
- **A. 统一表**:photos 加 `source_type` 字段(film | digital),`roll_id` 改 nullable,数码照片用 `roll_id=NULL` + `album_id`(M2M)关联
- **B. 分离表**:新建 `digital_photos` 表,共享视图用 `UNION ALL` 视图合并
- **C. 多态容器**:新建 `containers` 表,rolls 和 digital_albums 都指向 container,photos 用 `container_id` 统一引用

### 决策:**A(统一表)**

### 理由
- B 否决:SQLite 视图不可索引,`UNION ALL` 视图在 50k+ 行时性能差;`photo_tags` 和 `locations` 的多对多关系需要指向两个表(多态外键,SQLite 不原生支持,丑陋)
- C 否决:多态容器抽象过度,迁移面广;rolls 有大量胶片专属字段(develop/scan/cost),硬塞进 containers 表会变成稀疏列
- A 当选:统一表让共享视图一句 `WHERE source_type=?` 就能跨模式过滤;tags/locations 多对多关系零改动;移动端 timeline 单一数据流的假设成立

### 后果(代价)
- **必须做 JOIN 审计**(D5):13 处 `INNER JOIN rolls` 要改成 `LEFT JOIN`,否则数码照片被静默排除
- photos 表会变宽(新增 source_type / album_id / sensor_format / content_hash / stack_id / deleted_at 等列)
- 现有胶片查询必须保持向后兼容(新列默认值 = 胶片语义,如 `source_type DEFAULT 'film'`)
- 索引调整:新增 `idx_photos_source_type`、`idx_photos_album_id`、`idx_photos_content_hash`

### 检验性问题
- Q: photos 表会过宽吗?A: 当前 ~50 列,新增 ~8 列,共 ~58 列,SQLite 单表无硬上限,可接受
- Q: 数码照片的 scan_* 字段会一直 NULL 吗?A: 是,这是合理的稀疏(NULL = 该字段不适用于此 source_type),比拆表简单
- Q: 将来如果数码照片数量远超胶片(50k vs 2k),会不会拖累胶片查询?A: 不会,只要 `WHERE source_type='film'` 配合 `idx_photos_source_type` 索引,胶片查询只扫描 2k 行

---

## D4. rolls vs albums:不同概念,不要强行对称

### 背景
最自然的初判是"数码的相册 = 胶片的 rolls 的对等物"。但深入分析后发现这是错误类比。

### 概念对比

| 维度 | Roll(胶片卷) | Album(相册) |
|---|---|---|
| 性质 | 物理实体(一卷胶卷) | 虚拟集合(用户策展) |
| 时序 | 按拍摄顺序,不可重排 | 任意排序,可重排 |
| 不可变 | 是(拍完即定) | 否(随时加/删) |
| 关系 | 1:多(一张照片只属于一卷) | 多:多(一张照片可在多个相册) |
| 元数据 | 冲洗/扫描/成本/胶片型号/帧号 | 标题/描述/封面/排序 |
| 数码对应物 | 无 | 无(rolls 是胶片独有) |

### 决策:**rolls 和 albums 各自独立存在,互不对等**

- rolls 保持 film-only,语义不变
- albums 是数码侧的策展单元(也允许胶片照片加入相册,见下)
- 新增 `digital_sessions` 表作为数码侧的"导入批次/拍摄日"轻量容器(类比 rolls 的物理批次概念,但不做侧栏入口)

### 后果
- 数码侧有两个组织维度:
  - **digital_sessions**(隐式,按导入批次/EXIF 日期自动分组)—— 提供时序浏览和去重,不做侧栏入口
  - **albums**(显式,用户策展)—— 侧栏入口,类似 Apple Photos 的 Albums
- 胶片照片也能加入 albums(M2M)——例如"东京 2024"相册可以包含胶片卷里的照片和数码照片,这是跨模式策展的真实需求
- 命名:`albums` 而非 `digital_albums`(胶片侧不需要 albums 概念,无命名冲突)

### 检验性问题
- Q: 用户既然说"数码可以分为相册",那相册是不是数码独有?A: 不强制。允许胶片照片加入相册是免费的功能扩展(只是 album_photos M2M 加一行),而且对"东京之行"这种跨模式策展真实有用。如果用户想严格数码独有,加个 UI 限制即可(schema 不限制)
- Q: digital_sessions 会不会让数码侧变复杂?A: 不会进入侧栏,只在导入时自动创建一条记录,用户基本无感。它的价值是"Previous Import"快速过滤和去重(content_hash + session_id 双保险)

---

## D5. roll_id 改 nullable:必须先做 JOIN 审计

### 背景
统一表方案下,数码照片的 `roll_id` 必须为 NULL。但现有代码中有大量 `INNER JOIN rolls r ON p.roll_id = r.id`,这些查询在 `roll_id IS NULL` 时会**静默丢弃数码照片行**——查询不报错,但数码照片在列表/搜索/统计/地图/标签视图中"消失"。

### 审计清单(经 grep 验证)

**必须改 INNER JOIN → LEFT JOIN 的站点(13 处):**

| 文件 | 行号 | 函数/路由 | 影响视图 |
|---|---|---|---|
| `server/routes/photos.js` | 159 | `GET /` 列表 | Library / AlbumDetail |
| `server/routes/photos.js` | 183 | `GET /` 计数 | Library |
| `server/routes/photos.js` | 343 | `GET /single/:id` | PhotoView |
| `server/routes/photos.js` | 366 | `GET /random` | Overview |
| `server/routes/photos.js` | 387 | `GET /favorites` | Favorites |
| `server/routes/photos.js` | 414 | `GET /geo` | Map |
| `server/routes/photos.js` | 1191 | `GET /negatives` | (数码模式无负片,可保留 INNER 但加 source_type 过滤) |
| `server/routes/tags.js` | 29 | `GET /:tagId/photos` | Themes |
| `server/routes/stats.js` | 47 | `GET /gear` | Statistics |
| `server/routes/stats.js` | 84 | `GET /activity` | Statistics |
| `server/routes/stats.js` | 94 | `GET /costs` | (数码模式无成本,可保留 INNER 但加 source_type 过滤) |
| `server/services/render-service.js` | 32 | 渲染服务 | (FilmLab 专用,保留 INNER) |
| `server/services/download-service.js` | 75, 126 | 下载服务 | 跨模式下载 |

**已经是 LEFT JOIN 的站点(无需改):**
- `server/routes/photos.js:1501` — 某查询已用 LEFT JOIN
- `server/services/ai-tools/photo-tools.js:45, 93` — AI 工具已用 LEFT JOIN
- `server/services/ai-tools/stats-tools.js` 多处 — 已用 LEFT JOIN
- `server/services/ai-tools/roll-tools.js` — 已用 LEFT JOIN
- `server/services/export-history-service.js:158` — 已用 LEFT JOIN

**保持 INNER JOIN 但加 source_type 过滤的站点:**
- `server/services/render-service.js:32` — FilmLab 专用,数码模式不调用
- `server/routes/photos.js:1191` — `/negatives` 端点,数码照片无负片,加 `WHERE source_type='film'`
- `server/routes/stats.js:94` — `/costs` 端点,数码照片无成本,加 `WHERE source_type='film'`

**`WHERE roll_id = ?` 类查询(无需改,胶片专属操作):**
- `server/routes/rolls.js:800`、`server/services/roll-service.js` 多处、`server/services/photo-service.js:64`、`server/routes/raw.js:308`、`server/routes/batch-render.js:51, 56`、`server/routes/batch-download.js:48`、`server/routes/edge-detection.js:262`、`server/services/export-queue.js:160`、`server/services/import-service.js:136`、`server/services/ai-tools/photo-tools.js:128, 164, 169` —— 这些都是"在指定 roll 内操作"的胶片专属查询,数码照片不会进入这些路径

### 决策
1. 上述 13 处 INNER JOIN 在 MVP 迁移中全部改为 LEFT JOIN
2. 改造后,在共享视图查询里加 `WHERE p.source_type = ?` 过滤(由前端传 mode 参数)
3. 新增 lint 规则 / CI grep:禁止 `JOIN rolls r ON p.roll_id`(必须 `LEFT JOIN`),防止未来回归
4. 写一个集成测试:导入一张数码照片后,验证它出现在 `/api/photos`、`/api/photos/geo`、`/api/photos/favorites`、`/api/tags/:id/photos`、`/api/stats/temporal` 中

### 后果
- 一次性改 13 处 SQL,工作量可控(预估 1-2 天)
- LEFT JOIN 性能:在 SQLite 上,只要 rolls.id 有主键索引(必有),LEFT JOIN 与 INNER JOIN 性能差异可忽略
- 数码照片在列表查询中会 JOIN 出 NULL 的 roll 字段(如 `roll_title`),前端列表组件需要容忍 NULL
- 这一条是整个方案的**成败点**:不做或做不彻底,数码照片在共享视图中"消失",用户会以为导入失败

---

## D6. 调色 UI:复用 FilmLab 底层 + 新轻量 DigitalDevelop UI

### 背景
FilmLab 是胶片模式的杀手级功能(117KB 主组件),核心管线包含:负片反转(`filmLabInversion`)、白平衡(`filmLabWhiteBalance`)、HSL(`filmLabHSL`)、色调曲线(`filmLabToneLUT`/`filmLabCurves`)、分色调(`filmLabSplitTone`)。其中除"负片反转"外,其他模块对数码照片同样适用。

用户原话:"RAW 解码和调色可以直接复用 FilmLab 或者微调接口"。这意味着不需要从零做新面板,而是**复用 FilmLab 已有的底层渲染模块**。

### 备选
- **A. 复用 FilmLab 主组件加分支**:在现有 117KB `FilmLab.jsx` 内加 `source_type` 判断,数码模式跳过反转控件,只显示 WB/HSL/Tone/Curves。零新组件
- **B. 复用底层模块 + 新轻量 UI**:FilmLab 主组件保持胶片专属;新组件 `DigitalDevelop.jsx` 通过 import 复用 `packages/shared/filmLabWhiteBalance.js`/`filmLabHSL.js`/`filmLabToneLUT.js`/`filmLabCurves.js`/`filmLabSplitTone.js` 等底层模块,UI 重新设计(更轻量,数码语境)
- **C. MVP 不做调色**:Phase 2 再评估
- **D. 完整对标 FilmLab 做新面板**:从零做独立 DigitalDevelop,不复用底层

### 决策:**B(复用底层 + 新轻量 UI)**

### 理由
- A 否决:117KB 的 FilmLab 主组件耦合了胶片语境(负片/反转/FILM_PROFILES/冲洗工艺),强行加分支会让组件更复杂,数码用户看到胶片残留控件困惑
- C 否决:用户明确说要复用 FilmLab 调色能力
- D 否决:从零做等于再造一个 FilmLab(117KB 量级),违背"复用"初衷
- B 当选:底层模块(`packages/shared/filmLab*.js`)**已经是无 UI 纯函数**,可独立 import;新 UI 只包薄薄一层(预估 < 30KB),聚焦数码语境(WB/曝光/对比/HSL/Tone,无反转控件)

### 后果
- 新增 `client/src/components/digital/DigitalDevelop.jsx`(预估 ~25-30KB,远小于 FilmLab 的 117KB)
- 底层模块零改动(已是纯函数)
- 渲染管线复用 `packages/shared/render/RenderCore.js` + `renderChunked.js`
- 数码照片调色参数入库(见 D9),类比胶片 `photos.params_json` 机制
- MVP 工作量增加约 10 人天(UI + 入库 + 与胶片 presets 共享机制)
- 调色能力范围:**WB / 曝光 / 对比 / HSL / Tone Curve / SplitTone / LUT 应用**
- 不做:**负片反转**、**FILM_PROFILES 胶片特性曲线**、**DCP 相机配置文件**、**镜头校正(LCP)**、**编辑历史/虚拟副本**

### 检验性问题
- Q: FilmLab 底层模块对数码照片真的适用吗?A: 适用。`filmLabWhiteBalance`/`filmLabHSL`/`filmLabToneLUT`/`filmLabCurves`/`filmLabSplitTone` 都是通用的像素级调整,不依赖胶片语义。只有 `filmLabInversion` 和 `filmLabCurve`(H&D 密度曲线)是胶片专属,DigitalDevelop 不引入这两个
- Q: 数码 RAW 的 demosaic 后像素能否直接喂给这些模块?A: 可以。libraw-native 输出的 RGB 数据格式与 FilmLab 处理的正片数据相同
- Q: 数码照片需要"负片反转"吗?A: 不需要。数码 RAW demosaic 后就是正片,直接进入 WB/HSL 环节

---

## D7. RAW 解码:仅 demosaic(用现有 libraw-native)

### 背景
`@filmgallery/libraw-native` 已有 RAW 解码能力(CR2/CR3/NEF/ARW/RW2/RAF/DNG),但目前只用于胶片 DSLR 扫描流程。数码模式启用 RAW 解码的范围如何?

### 备选
- **A. 完整 RAW 解码**:libraw demosaic + WB + DCP 相机配置文件 + 镜头校正(LCP)
- **B. 仅 demosaic**:libraw 只做 demosaic(彩色马赛克→RGB),WB/HSL/Tone 等交给 DigitalDevelop 后续环节
- **C. 不做完整解码,只提取内嵌 JPEG**:exiftool 提取 RAW 内嵌 JPEG,RAW 文件只作存档

### 决策:**B(仅 demosaic)**

### 理由
- A 否决:WB/DCP/镜头校正是 Lightroom/DxO 的核心领地,完整 RAW 管线是另一个 FilmLab 体量(已被 D6 排除)
- C 否决:用户明确选择"完整 RAW 解码",意图是能在 FilmGallery 内调色 RAW
- B 当选:libraw-native **只做 demosaic**(它本来就是干这个的),输出 RGB 数据后交给 D6 决定的 DigitalDevelop(WB/HSL/Tone)处理。WB/DCP/镜头校正不做——这些需要时用户在 Lightroom 里调,然后导出成品 JPEG 再导入 FilmGallery;或接受 FilmGallery 调色后的"非 Lightroom 级精度"

### 后果
- 数码模式启用现有 libraw-native,**零新依赖**
- 导入流程:RAW 文件 → libraw demosaic → 生成 JPEG 预览(`positive_rel_path`)+ 保留 RAW 作为原件(`original_rel_path`)
- DigitalDevelop 调色基于 demosaic 后的 RGB 数据,参数入库(D9)
- 不能在 FilmGallery 内做 DCP/镜头校正——这是有意的范围控制
- 若用户拖入 RAW + JPEG 配对:Phase 2 处理,MVP 只用 JPEG(忽略 RAW 并提示);用户拖入纯 RAW:自动 demosaic 生成预览

### 检验性问题
- Q: 没有 DCP,RAW 调色后色彩准确吗?A: 不如 Lightroom 准,但 WB/HSL 仍能调整。用户接受这个精度才能在 FilmGallery 内调色,否则应在 Lightroom 调好导出 JPEG 再入库
- Q: libraw demosaic 性能如何?A: 现有 libraw-native 已在胶片 DSLR 扫描流程使用,性能可接受;批量导入用 `render-worker-pool` 并行处理
- Q: 内嵌 JPEG 预览方案(C)完全放弃吗?A: 是。用户选 B,demosaic 后的 JPEG 质量高于内嵌预览,且可调色

---

## D8. 移动端数码:桌面优先,Phase 2 再上

### 背景
移动端目前定位是"现场胶片拍摄日志"(ShotLog/Inventory/FilmItemDetail)。数码模式是否同步上移动?

### 决策:**MVP 桌面优先,Phase 2 上移动只读浏览**

### 理由
- 数码整理(拖拽/批量/EXIF 审阅/调色)是桌面活动,移动端做不了
- 50k+ 数码照片同步到手机存储不现实
- 移动端目前的核心价值(现场拍胶片时记日志)和数码模式无交集

### 后果
- MVP 移动端保持纯胶片,数码模式 UI 不出现
- Phase 2 移动端数码模式 = 只读流式客户端(thumbnails on demand):
  - Library 网格(浏览所有数码照片)
  - AlbumDetail
  - PhotoView with EXIF
  - 可能加:手机照片直接导入(跳过 AirDrop 桌面中转,这是手机导入的最强动机)
- watch-app 完全跳过数码模式(界面太复杂)

---

## D9. 调色参数入库:photos 加 `develop_params_json`

### 背景
D6 决定做轻量 DigitalDevelop UI。调色后参数是否持久化?

### 备选
- **A. 入库**:photos 表加 `develop_params_json` 字段(类比胶片 `photos.params_json`),下次打开可恢复;也可保存为预设到 `presets` 表
- **B. 调后导出覆盖**:调色后导出新 JPEG 覆盖 `positive_rel_path`,参数丢弃
- **C. 推迟**:MVP 不调色

### 决策:**A(入库)**

### 理由
- A 当选:类比胶片现有机制(`photos.params_json` + `presets` 表),设计模式一致;非破坏性编辑,可随时回退到原 RAW;参数可保存为预设复用到其他数码照片
- B 否决:破坏性编辑,不可回退;违背"调色参数化"的初衷
- C 否决:用户已选 D6 做调色

### 后果
- photos 表加 `develop_params_json` TEXT 字段(JSON 字符串)
- JSON 结构(与胶片 `params_json` 共享 schema,便于复用 RenderCore):
  ```json
  {
    "white_balance": { "temp": 5500, "tint": 5 },
    "exposure": 0.3,
    "contrast": 12,
    "highlights": -20,
    "shadows": 15,
    "whites": 0,
    "blacks": -5,
    "hsl": { "red": { "hue": 0, "sat": 5, "lum": 0 }, ... },
    "tone_curve": { "rgb": [...], "red": [...], "green": [...], "blue": [...] },
    "split_tone": { "highlights": { "color": "#fff5e6", "balance": 50 }, "shadows": {...} },
    "lut": "Kodak_2383.cube"
  }
  ```
- 复用现有 `presets` 表(加 `category='digital'` 区分),数码预设独立
- 复用现有 `packages/shared/render/RenderCore.js` 渲染管线(它已支持参数化渲染)
- 浏览时优先显示调色后的 `positive_rel_path`;DigitalDevelop 打开时从 RAW demosaic 重新渲染并应用 `develop_params_json`
- "导出"功能:渲染调色后 JPEG 覆盖 `positive_rel_path`(类似胶片 export-positive 机制)

### 检验性问题
- Q: 数码调色参数和胶片 `params_json` 共用 schema 吗?A: 大部分字段共用(WB/HSL/Tone/Curves),数码不含 `inverted`/`inversionMode`/`filmProfile` 等胶片专属字段。JSON schema 用 `source_type` 区分
- Q: 同一照片的 RAW 和调色后 JPEG 如何关联?A: `original_rel_path`=RAW,`positive_rel_path`=调色后 JPEG,`develop_params_json`=调色参数。三者通过同一 photo 行关联
- Q: 调色预设能跨模式复用吗?A: WB/HSL/Tone 预设可以(纯像素调整);胶片反转类预设不行(数码无反转)。`presets.category` 字段区分

---

## 决策汇总表

| ID | 决策 | 备选方案 | 选择 | 主要代价 |
|---|---|---|---|---|
| D1 | 模式 UX 原语 | workspace / 全局开关 / filter | **filter** | 每个共享视图要加过滤芯片 |
| D2 | 数码范围 | Lightroom 替代 / 策展存档 / 存档+轻调色 | **存档+轻调色** | 范围比纯存档大 ~13 人天,远小于 Lightroom 对标 |
| D3 | photos 表 | 统一 / 分离 / 多态容器 | **统一 + source_type** | 必须 JOIN 审计(D5) |
| D4 | rolls vs albums | 对等映射 / 独立概念 | **独立概念** | 数码侧双维度(sessions + albums) |
| D5 | roll_id nullable | 不改 / 改 + 审计 / 分离表 | **改 + 13 处审计** | 一次性工作量,关键路径 |
| D6 | 调色 UI | 复用主组件 / 复用底层+新轻 UI / 不做 / 完整对标 | **复用底层+新轻 UI** | 新增 ~12 人天(后端3+前端9) |
| D7 | RAW 解码 | 完整 / 仅 demosaic / 内嵌 JPEG | **仅 demosaic** | 不做 DCP/镜头校正(交给 Lightroom) |
| D8 | 移动端数码 | MVP 同步 / 桌面优先 | **桌面优先** | 移动端 MVP 仍是纯胶片 |
| D9 | 调色参数入库 | 入库 / 覆盖导出 / 推迟 | **入库** | photos 加 `develop_params_json` 字段 |
| D10 | DigitalDevelop 控件范围 | 极简4类 / 9类核心 / 9类+裁剪 / 接近Lightroom | **9 类 + 裁剪/旋转** | UI ~32KB;裁剪参数入 develop_params_json |
| D11 | DigitalDevelop 入口 | PhotoView / 侧栏独立 / PhotoView+批量 | **只从 PhotoView 进入** | 与 FilmLab 一致(无侧栏入口) |
| Q5 | 胶片-数码场景关联 | 不做 / companion_id / scene_id / scenes表 | **scene_id 字段(schema预留, UI Phase 2)** | MVP 零成本;Phase 2 才做关联 UI |
