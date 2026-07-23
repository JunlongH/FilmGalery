# FilmGallery 数码模式设计文档

> **状态**: 设计提案 (Draft) — 等待决策
> **日期**: 2026-07-23
> **作者**: 经 explore + 两位独立子 agent (架构师 / 产品设计师) 评审后综合产出

## 一句话定位

**把 FilmGallery 从「胶片工作流」扩展为「胶片工作流 + 数码策展存档」的双模式应用**,胶片侧保持现有的拍摄—冲洗—扫描—调色完整链路不变,数码侧只做"满意照片的归档与浏览",不试图取代 Lightroom。

## 核心决策摘要

| # | 决策点 | 结论 | 关键理由 |
|---|---|---|---|
| D1 | 模式 UX 原语 | **filter(过滤器),不是 workspace(工作区)** | 用户既要清晰区分,又要在 Calendar/Map 上跨模式看到"东京之行的所有照片"——硬切换会杀死跨模式视图 |
| D2 | 数码范围 | **存档为主 + 轻量调色**(复用 FilmLab 底层) | 用户原话"主要做存档,RAW 解码和调色可复用 FilmLab 或微调接口";不做完整 Lightroom 对标 |
| D3 | photos 表 | **统一表 + source_type 字段** | 让 Calendar/Map/Tags/Stats 一句 `WHERE source_type=?` 就能跨模式;分离表会迫使所有共享视图 UNION ALL,SQLite 视图不可索引 |
| D4 | rolls vs albums | **不同概念,不要强行对称** | rolls = 物理/时序/不可变/1:多;albums = 策展/虚拟/可变/多:多。Apple Photos 用 Moments vs Albums 分开,我们也分开 |
| D5 | roll_id 改 nullable | **必要,但必须先做 JOIN 审计** | 13 处 `INNER JOIN rolls` 会静默把数码照片排除出列表/搜索/统计/地图——这是整个方案的成败点 |
| D6 | 调色 UI | **复用 FilmLab 底层模块 + 新轻量 DigitalDevelop UI** | 不做完整对标 FilmLab(117KB),只做轻 UI 复用 WB/HSL/ToneLUT/Curves 底层 |
| D7 | RAW 解码 | **仅 demosaic**(用现有 libraw-native) | WB/HSL/Tone/Curves 交给 DigitalDevelop 后续环节;DCP/镜头校正不做(交给 Lightroom) |
| D9 | 调色参数入库 | **入库**,photos 加 `develop_params_json` 字段 | 下次打开可恢复,类比胶片 photos 的 params_json 机制 |
| D8 | 移动端数码 | **桌面优先,Phase 2 再上移动** | 移动端目前是"现场拍摄日志"工具(ShotLog/Inventory),数码整理是"桌面活动" |

## 文档索引

1. [01-goals-and-scope.md](./01-goals-and-scope.md) — 目标、范围边界、设计张力与取舍
2. [02-architecture-decisions.md](./02-architecture-decisions.md) — 8 条 ADR(架构决策记录)与备选方案对比
3. [03-data-model-and-migration.md](./03-data-model-and-migration.md) — Schema 变更、新表、迁移脚本、JOIN 审计清单
4. [04-product-ux.md](./04-product-ux.md) — 侧边栏、路由、过滤器 UX、Library 视图、Albums、导入向导、首次运行引导
5. [05-backend-api-stats-ai.md](./05-backend-api-stats-ai.md) — 新增/修改的 API、统计 `?mode=`、AI 工具过滤
6. [06-mobile-and-phasing.md](./06-mobile-and-phasing.md) — 移动端策略 + MVP / Phase 2 / Phase 3 路线图
7. [07-risks-and-open-questions.md](./07-risks-and-open-questions.md) — 风险登记、DSLR 扫描歧义、性能、未决问题

## MVP 范围速览(详细见 06)

**做**:
- Schema 迁移 + 13 处 JOIN 审计(D5 — 必做)
- 侧边栏分组(Film: Rolls/Films;Digital: Albums/Import/Develop;共享: Library/Calendar/Map/Favorites/Themes/Stats)
- 共享视图上的 per-view 过滤芯片(胶片 / 数码 / 全部)
- 新增 Library 视图(所有照片按时序,可过滤模式)
- Albums CRUD + AlbumDetail(M2M、嵌套、封面、计数)
- JPEG/RAW 导入向导(拖拽 → EXIF 解析 → libraw demosaic → 批量入库 → 后台缩略图)
- **轻量 DigitalDevelop UI**(复用 FilmLab 底层 WB/HSL/ToneLUT/Curves 模块 + 新 UI;调色参数入库 `develop_params_json`)
- PhotoDetailsSidebar 按 `source_type` 分支显示
- 统计端点加 `?mode=film|digital|all` 参数
- AI 工具按模式过滤(数码模式隐藏 roll/film/shot-log/render 工具)
- 首次运行引导:"你拍什么?"(胶片 / 数码 / 两者)

**不做**(推迟):
- 完整 Lightroom 对标(DCP/镜头校正/编辑历史/虚拟副本)
- 智能相册(Phase 2)
- FTS5 全文搜索(Phase 2)
- RAW+JPEG 配对 / 连拍栈 / HDR 栈(Phase 2,但 schema 预留 `stack_id`)
- 视频片段 / Live Photos / 人脸识别(Phase 3)
- 移动端数码 UI(Phase 2,先只读浏览)

## 关键风险(详细见 07)

1. **JOIN 审计执行不彻底** → 数码照片在共享视图中"消失",用户以为导入失败(致命)
2. **范围爬升到 Lightroom 领域** → DCP/镜头校正/编辑历史一旦启动,工作量等于再造一个 FilmLab(高)
3. **DSLR 扫描归类歧义** → 用数码相机翻拍胶片,source_type 归胶片还是数码?(已决策: 归胶片,作为胶片照片的衍生资产,详见 07)
4. **50k+ 照片性能** → 现有 VirtualPhotoGrid 只虚拟化渲染,不虚拟化数据获取;需要服务端 keyset 分页(中,Phase 2)
5. **DigitalDevelop UI 范围控制** → 复用底层易,但 UI 容易膨胀;需守住"不做编辑历史/虚拟副本/DCP"边界(中)

## 评审来源

本方案经以下子 agent 评审:
- **架构师子 agent** (DeepSeek V4 Pro via `general`): 执行风险、Schema、JOIN 审计、迁移安全
- **设计师子 agent** (DeepSeek V4 Pro via `general`): 产品定位、UX 原语、范围控制、Apple Photos/Lightroom 模式对比

本方案经与用户两轮问答确认锁定:
- **第一轮**:定位=存档+复用 FilmLab 调色;UX=过滤器芯片;RAW=完整解码;DigitalDevelop=MVP 不做(后被第二轮修正);移动=桌面优先
- **第二轮(关键修正)**:FilmLab 复用方式=复用底层+新轻 UI;调色参数=入库;RAW 解码范围=仅 demosaic(不做 WB/DCP/镜头校正,交给 FilmLab 底层模块)

第二轮修正后,D6/D7 与第一轮回答一致化:用户原话"RAW 解码和调色可复用 FilmLab 或微调接口"=复用 FilmLab 底层渲染模块(filmLabWhiteBalance/HSL/ToneLUT/Curves)+ 新轻量 UI 包装;RAW 用现有 libraw-native 仅做 demosaic,WB/色调等交给 DigitalDevelop 后续环节。详见 [02 D6/D7/D9](./02-architecture-decisions.md)。
