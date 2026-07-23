# 01 — 目标与范围

## 1.1 用户原话

> 现有整个 FilmGallery 都是面向我本人的胶片拍摄工作流的。但我在考虑要不要将它也做成一个数码照片管理的 app,只用于存放我自己比较满意的数码照片。我希望能直接分为胶片和数码模式,能够直接切换,很多模块都可以复用,但也有本质区别,例如数码可以分为相册,但是没有 roll film 等的概念。

提取关键约束:
1. **单用户应用** — 用户即开发者本人,管理自己的照片
2. **数码侧只存"满意"照片** — 不是工作目录,不是 SD 卡全量导入
3. **明确分两种模式,要能直接切换** — 不要模糊化
4. **模块复用** — Calendar/Map/Equipment/Tags 等共享视图应能跨模式用
5. **本质区别** — 数码有相册、无 rolls;胶片有 rolls/FilmLab、无相册

## 1.2 设计目标

- **G1 不退化胶片流程**:现有胶片工作流零回归(D5 — JOIN 审计的核心动机)
- **G2 数码模式自我一致**:数码用户看到的所有 UI 都对数码有意义(无冲洗/扫描/FilmLab 噪音)
- **G3 跨模式浏览可用**:在 Calendar/Map/Favorites/Themes 上能看到"东京之行的胶片+数码照片合流"
- **G4 范围可控**:不滑向 Lightroom 替代品(用户明确说不)
- **G5 数据可逆**:迁移可回滚(恢复备份 = 完全回到胶片-only 状态)

## 1.3 范围边界

### ✅ 在范围内(MVP)

| 类别 | 能力 |
|---|---|
| 入库 | 拖拽 JPEG/RAW 批量导入;EXIF 自动提取(相机/镜头/光圈/快门/ISO/GPS/日期);RAW 用 libraw-native demosaic 生成预览,RAW 文件同时存档 |
| 组织 | 相册(M2M、嵌套);标签;评分;位置;摄影师 |
| 浏览 | Library 全量网格;Calendar;Map;Favorites;Themes;AlbumDetail |
| 查看 | PhotoView + PhotoDetailsSidebar(按 source_type 分支显示不同字段) |
| 调色 | **轻量 DigitalDevelop UI**(复用 FilmLab 底层 WB/HSL/ToneLUT/Curves/SplitTone 模块);参数入库 `develop_params_json`;支持保存为预设复用 |
| 统计 | 现有 ratings/locations/temporal/themes 端点加 `?mode=` 过滤;新增数码专属维度(相机/焦距/月度) |
| AI | 模式感知:数码模式隐藏 roll/film/shot-log/render 工具 |
| 设备 | 复用 equip_cameras/equip_lenses/equip_flashes;给 cameras 加 `is_digital` + 传感器字段 |

### ❌ 不在范围内(MVP 不做,推迟或永不)

| 类别 | 推迟原因 |
|---|---|
| **完整 RAW 管线**(DCP 相机配置文件 + 镜头校正 LCP + 色差校正) | Lightroom/DxO 核心领地;用户接受 FilmGallery 调色"非 Lightroom 级精度",否则在 Lightroom 调好导出 JPEG 再入库 |
| **编辑历史 / 虚拟副本 / XMP 侧车写入** | Lightroom 的核心领地,与"存档+轻调色"定位冲突 |
| **智能相册**(rule-based saved queries) | MVP 范围内的策展量(<5k 张)用人工相册足够,Phase 2 再做 |
| **FTS5 全文搜索** | 5k 张以内 LIKE 全表扫描可接受;Phase 2 视实际量级再上 |
| **RAW+JPEG 配对 / 连拍栈 / HDR 栈** | Phase 2;但 schema 预留 `stack_id`+`stack_role` 字段,避免二次迁移 |
| **视频片段 / Live Photos** | Phase 3;sharp 不能处理视频,是另一套管线;schema 预留 `media_type` 字段 |
| **人脸识别** | Phase 3;独立子系统,不预留 schema |
| **移动端数码 UI** | Phase 2 先做只读浏览;移动端目前定位是"现场胶片拍摄日志" |
| **多显示器全屏看片** | Phase 3 nice-to-have |

### ⚠️ 模糊地带(需用户决策)

| 议题 | 默认决策 | 备选 | 详见 |
|---|---|---|---|
| DSLR 翻拍胶片的归类 | 归**胶片**(作为胶片照片的衍生资产,类比 negative scan) | 归数码(因为来自数码相机) | [07 §1](./07-risks-and-open-questions.md) |
| 打印件扫描的归类 | 导入时让用户选 | 强制归数码 | [07 §1](./07-risks-and-open-questions.md) |
| 数码模式是否要"导入批次"概念 | MVP 用轻量 `digital_sessions` 表(只做 metadata,不做侧栏入口) | 完全不要,只靠 Calendar 时序浏览 | [02 D4](./02-architecture-decisions.md) |

## 1.4 设计张力与取舍

本方案在两位子 agent 评审中存在三处张力,记录如下:

### 张力 1: "模式开关" vs "过滤器"

- **架构师立场**:可以做硬切换 + mode-guard 中间件(数码模式 404 掉 `/api/rolls`)
- **设计师立场**:Film/Digital 是 filter 不是 workspace;全局开关会杀死跨模式视图(Calendar 看不到"东京之行全量")
- **本方案取舍**:采用设计师立场。模式作为**默认过滤器**(设置项)+ per-view 过滤芯片(每个共享视图独立记忆);侧边栏模式专属章节(Rolls/Films vs Albums/Import)始终可见,无 chrome 切换。详见 [04 §2](./04-product-ux.md)。

### 张力 2: DigitalDevelop 是否做

- **架构师立场**:Phase 2 做,作为 FilmLab 的对等模块(WB/DCP/镜头校正),否则数码模式"不完整"
- **设计师立场**:永远不做,数码已在 Lightroom 调好;做就滑向 Lightroom
- **用户决策(经两轮问答锁定)**:**复用 FilmLab 底层模块 + 新轻量 DigitalDevelop UI**。底层 `filmLabWhiteBalance`/`filmLabHSL`/`filmLabToneLUT`/`filmLabCurves`/`filmLabSplitTone` 已是无 UI 纯函数,新 UI 直接 import 复用。RAW 用 libraw-native 仅做 demosaic,WB/HSL/Tone 交给 DigitalDevelop。调色参数入库(`develop_params_json`)。**不做** DCP/镜头校正/编辑历史/虚拟副本(交给 Lightroom)。详见 [02 D6/D7/D9](./02-architecture-decisions.md)。

### 张力 2b: RAW 解码范围

- **架构师立场**:libraw 只做 demosaic,完整 RAW 管线(WB/DCP/镜头校正)是另一个 FilmLab 体量,不做
- **设计师立场**:只提取内嵌 JPEG 预览,RAW 作存档,不解码
- **用户决策**:**仅 demosaic**(用现有 libraw-native,零新依赖),不做 WB/DCP/镜头校正(交给 FilmLab 底层模块在 DigitalDevelop 内做)。详见 [02 D7](./02-architecture-decisions.md)。

### 张力 3: 是否要 `digital_sessions` 表

- **架构师立场**:做,作为 roll 的对等容器,保留"导入批次/拍摄日"概念,让"Previous Import"快速过滤可用
- **设计师立场**:不做,数码是策展存档不是工作目录,导入批次不需要侧栏入口
- **本方案取舍**:折中。**做轻量 `digital_sessions` 表**(只存 metadata:日期、相机、import_batch_id、备注),但不做侧栏入口。用途:导入去重(`content_hash` + `session_id` 双保险)、Calendar 时序浏览的隐式分组、"Previous Import"快速过滤按钮。详见 [03 §2.2](./03-data-model-and-migration.md)。

## 1.5 不做的产品定位对比

| 产品 | 定位 | FilmGallery 数码模式的差异 |
|---|---|---|
| Adobe Lightroom | 工作目录,RAW 开发,编辑历史,DCP/镜头校正 | 我们只做 demosaic + 轻调色(WB/HSL/Tone),不做 DCP/镜头校正/编辑历史 |
| Apple Photos | 全量相册,自动分类,Memories | 我们是用户主动挑选的"满意照片"集合,不是全量 |
| Google Photos | 云端全量,搜索为主,AI 强分类 | 我们是本地、单用户、低 AI |
| Mylio | 多设备同步,版本管理 | 我们是单桌面 + 只读移动,不做版本管理 |
| PhotoPrism | 自托管全量 + AI 分类 | 我们不做 AI 分类(MVP) |

**FilmGallery 数码模式的独特定位**:胶片摄影师的"数码补充存档 + 轻调色"——和胶片库共享 Calendar/Map/Equipment/Tags/FilmLab 底层渲染模块,不试图取代 Lightroom 的 RAW 完整开发能力。
