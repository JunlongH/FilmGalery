# 06 — 移动端策略与路线图

## 6.1 移动端策略

### MVP:移动端保持纯胶片

**理由**:
- 移动端目前定位是"现场胶片拍摄日志"(ShotLog/Inventory/FilmItemDetail),与数码整理无交集
- 数码整理(拖拽/批量/EXIF 审阅)是桌面活动,移动端做不了
- 50k+ 数码照片同步到手机存储不现实
- 移动端不应承担"完整数码库浏览"职责,做薄客户端即可

**MVP 移动端改动**:
- 仅在 `mobile/src/api/client.ts` 的 `/api/discover` 响应处理中,识别 `capabilities.digitalEnabled=true` 时,在 Settings 显示"数码模式已在桌面端启用"提示
- 不增加任何数码 UI

### Phase 2:移动端只读数码浏览

**新增移动端数码屏幕**(`mobile/src/screens/digital/`):
- `DigitalLibraryScreen.tsx` — 数码照片时序网格(只读,薄客户端,缩略图按需拉取)
- `DigitalAlbumListScreen.tsx` — 相册列表
- `DigitalAlbumDetailScreen.tsx` — 相册详情
- `DigitalPhotoViewScreen.tsx` — 数码照片详情(复用现有 `PhotoViewScreen` 加 source_type 分支)

**导航**:
- Library tab 加一个二级切换"胶片 / 数码"(类似顶部 segmented control),默认胶片
- 或:在 Library tab 顶部加一个"数码相册"入口

**数据流**:
- 不做本地缓存,所有数码照片从桌面端 server 流式拉取
- 缩略图按需拉取(类似现有胶片网格的实现)
- 长按照片显示操作菜单(加入相册、加标签、删除)

> **已知局限**:移动端不具备数码调色/冲扫面板(曝光/白平衡/HSL/曲线/裁剪/导出编辑)。`DigitalDevelop.jsx`仅限桌面端。移动端数码支持范围:浏览、标签、备注、EXIF、相册、收藏、删除、下载。

### Phase 3:手机照片直接导入

**最强的移动端数码动机**:用户的"满意数码照片"很大一部分来自手机,跳过 AirDrop 桌面中转直接导入到 FilmGallery,降低摩擦。

- 移动端"导入"按钮:多选手机相册照片 → 上传到桌面端 server 的 `/api/digital/import/execute`
- 复用手机端 EXIF(手机照片 EXIF 完整,有 GPS/日期/相机)
- 后台传输,支持断点续传
- 完成后桌面端弹通知

## 6.2 路线图

### MVP(Phase 1)— "能导入并浏览数码 JPEG/RAW + 轻量调色"

**目标**:用户能在桌面端导入满意数码 JPEG/RAW,浏览、组织、和胶片库共享视图;可在轻量 DigitalDevelop 内调色,参数入库。

**必做工作项**(顺序大致是依赖顺序):

| # | 工作项 | 文件/模块 | 依赖 | 工作量(人天) |
|---|---|---|---|---|
| 1 | Schema 迁移:`app_config` / `digital_sessions` / `albums` / `album_photos` / photos 加列(含 `develop_params_json`) / cameras 加列 | `server/utils/digital-mode-migration.js`(新);`server/utils/run-all-migrations.js` 注册 | — | 1 |
| 2 | JOIN 审计:13 处 INNER JOIN → LEFT JOIN + source_type 过滤 | `server/routes/photos.js`、`tags.js`、`stats.js`、`server/services/render-service.js`、`download-service.js` | 1 | 2 |
| 3 | 共享模式辅助:`packages/shared/photographyMode.js` | 新文件 | — | 0.5 |
| 4 | `/api/app-config` CRUD | `server/routes/app-config.js`(新);`server/server.js` 挂载 | 1 | 0.5 |
| 5 | `/api/albums` CRUD | `server/routes/albums.js`(新);`server/server.js` 挂载 | 1 | 2 |
| 6 | `/api/digital-sessions` 查询 | `server/routes/digital-sessions.js`(新) | 1 | 1 |
| 7 | `/api/digital/import/*` 导入管线(含 RAW demosaic) | `server/routes/digital-import.js`(新);复用 thumb-service / render-worker-pool / exif-service / libraw-native | 1 | 4 |
| 7b | `/api/digital-develop/*` 调色管线(复用 FilmLab 底层 + RenderCore) | `server/routes/digital-develop.js`(新);复用 libraw-native + RenderCore + filmLab* 底层模块 | 1 | 3 |
| 8 | `/api/photos` 加 mode/album_id/session_id 过滤 | `server/routes/photos.js` | 2 | 1 |
| 9 | `/api/stats/*` 加 `?mode=` + 新增 `/api/stats/digital/*` | `server/routes/stats.js` | 2 | 2 |
| 10 | `/api/equipment/cameras` 加 is_digital + sensor 字段 + 校验 | `server/routes/equipment.js` | 1 | 1 |
| 11 | `/api/discover` 暴露 active_mode | `server/server.js:293-316` | 4 | 0.2 |
| 12 | `/api/health/database` 加数码计数 | `server/routes/health.js` | 1 | 0.2 |
| 13 | AI 工具按模式过滤 | `server/services/ai-tools/index.js`、`ai-context-builder.js` | 4 | 0.5 |
| 14 | API 客户端:`@filmgallery/api-client/albums.js`、`digital-sessions.js`、`digital-import.js`、`digital-develop.js`、`app-config.js`;photos/stats 加 mode | `packages/@filmgallery/api-client/*` | 5,6,7,7b,8,9 | 1.5 |
| 15 | 类型包更新:`Album`、`DigitalSession`、`AppConfig`、`Photo` 加字段、`Camera` 加字段、`DevelopParams` 接口 | `packages/@filmgallery/types/index.d.ts` | 1 | 0.5 |
| 16 | 客户端 API 模块:`client/src/api/albums.js`、`digital-import.js`、`digital-develop.js`、`app-config.js`;`client/src/api/index.js` | 14 | 0.5 |
| 17 | 侧边栏重构:章节分组(Film/Digital/Library/Browse/Tools);`show_film_section`/`show_digital_section` 折叠 | `client/src/components/Sidebar/Sidebar.jsx` | 4 | 1 |
| 18 | 共享视图过滤芯片:`ModeFilterChip` 组件 + Calendar/Map/Favorites/Themes/Overview 集成 | `client/src/components/common/ModeFilterChip.jsx`(新) | 8,16 | 2 |
| 19 | LibraryView 新建 | `client/src/pages/LibraryView.jsx`(新);路由 `/library` | 8,16,17 | 3 |
| 20 | AlbumLibrary + AlbumDetail + NewAlbumForm | `client/src/components/digital/`(新目录) | 5,16,17 | 4 |
| 21 | DigitalImportWizard(三步向导,含 RAW demosaic 进度) | `client/src/components/digital/DigitalImportWizard.jsx`(新) | 7,16 | 3 |
| 21b | DigitalDevelop 轻量 UI(复用 FilmLab 底层 + 新薄 UI ~32KB;含裁剪/旋转/翻转) | `client/src/components/digital/DigitalDevelop.jsx`(新);路由 `/digital/develop/:photoId` | 7b,16 | 9 |
| 22 | PhotoDetailsSidebar 按 source_type 分支 + 数码"调色"按钮入口 | `client/src/components/PhotoDetailsSidebar.jsx` | 8,21b | 1 |
| 23 | Statistics 加 mode tab + 数码专属图表 | `client/src/components/Statistics/` | 9 | 2 |
| 24 | EquipmentManager 加数码相机表单字段 + 校验 | `client/src/components/EquipmentManager/EquipmentEditModal.jsx` | 10 | 1 |
| 25 | Onboarding 模态 + 升级迁移模态 | `client/src/components/Onboarding.jsx`(新);`client/src/App.jsx` 启动检查 | 4,17 | 1 |
| 26 | Settings → General 加数码模式配置 | `client/src/components/Settings/GeneralSettings.jsx` | 4 | 0.5 |
| 27 | 静态服务:数码文件路由 + 缓存策略 | `server/server.js:179-198` | 1 | 0.2 |
| 28 | 集成测试:导入数码照片 → 验证出现在所有共享视图;调色 → 验证参数入库 + 预览正确 | `tests/digital-mode.test.js`(新) | 全部 | 2.5 |
| 29 | Lint 规则:禁 `JOIN rolls r ON p.roll_id`(必须 LEFT JOIN) | `eslint.config.mjs` 自定义规则 | 2 | 0.5 |
| 30 | 文档:DEVELOPER-MANUAL 加数码模式 + DigitalDevelop 章节 | `docs/DEVELOPER-MANUAL.md` | 全部 | 0.5 |

**MVP 总工作量预估**:~52 人天(单人全时约 10-11 周)

**与原方案(~40 人天)的差异**:
- `+3` 人天:DigitalDevelop 后端管线(7b)
- `+9` 人天:DigitalDevelop 前端 UI(21b,含裁剪/旋转/翻转;原 6 → 9)
- `+1` 人天:RAW demosaic 集成(7 从 3 → 4)
- `+0.5` 人天:API 客户端 + 类型包(D9 字段 + scene_id)
- `+0.5` 人天:集成测试覆盖调色 + 裁剪
- `-1` 人天:简化某些边界(无"RAW+JPEG 配对"UI 提示)
- scene_id 字段 schema 预留(零成本,UI Phase 2)

净增 ~13 人天。裁剪/旋转比原方案 +3 人天(用户追加决策)。

### Phase 2 — "智能组织 + RAW 配对 + 移动只读"

**前提**:MVP 上线后用 1-2 个月观察用户反馈,确认以下需求真实存在:
- 用户想要智能相册(规则化自动归类)
- 用户导入 RAW+JPEG 配对,希望正确处理
- 用户想在移动端浏览数码照片

**工作项**:

| # | 工作项 | 文件/模块 | 工作量(人天) |
|---|---|---|---|
| 1 | 智能相册:`is_smart=1` 的 albums 按 `criteria_json` 自动维护成员 | `server/services/album-service.js`、`server/routes/albums.js` | 4 |
| 2 | `auto_album` AI 工具(纯启发式:EXIF 日期邻近度 + GPS 聚类 + 相机) | `server/services/ai-tools/digital-tools.js`(新) | 3 |
| 3 | `duplicate_detect` AI 工具(按 content_hash) | 同上 | 1 |
| 4 | FTS5 全文搜索:`photos_fts` 虚拟表(caption/notes/camera/lens);`/api/search` 改用 FTS5 | `server/utils/fts-migration.js`(新);`server/routes/search.js` | 3 |
| 5 | 回收站 UI:Trash 视图(列出 deleted_at 非空的照片);恢复 / 永久删除 | `client/src/pages/TrashView.jsx`(新) | 2 |
| 6 | RAW+JPEG 配对识别 + 栈组(stack_id/stack_role) | `server/routes/digital-import.js`;`client/src/components/digital/DigitalImportWizard.jsx` | 3 |
| 7 | 连拍栈 / HDR 栈识别(按 EXIF 时间戳邻近 + 包围曝光标记) | 同上 | 2 |
| 8 | XMP 侧车读取(exiftool-vendored 已有) | `server/services/exif-service.js` | 1 |
| 9 | 移动端数码只读浏览:`DigitalLibraryScreen` / `DigitalAlbumListScreen` / `DigitalAlbumDetailScreen` / `DigitalPhotoViewScreen` | `mobile/src/screens/digital/`(新目录) | 5 |
| 10 | 移动端 Library tab 加胶片/数码切换 | `mobile/src/navigation/`、`mobile/src/screens/timeline/HomeScreen.tsx` | 1 |
| 11 | 数码专属统计仪表盘(月度趋势、相机分布、传感器分布) | `client/src/components/Statistics/DigitalStatsPanel.jsx`(新) | 2 |
| 12 | "Previous Import" 快速过滤按钮(在 Library header) | `client/src/pages/LibraryView.jsx` | 0.5 |
| 13 | 性能:服务端 keyset 分页(`WHERE date_taken < ? ORDER BY date_taken DESC LIMIT 100`) | `server/routes/photos.js`、`client/src/components/VirtualPhotoGrid.jsx` | 3 |
| 14 | 数码照片批量操作(批量加标签/评分/移入相册) | `client/src/components/digital/` | 2 |

**Phase 2 总工作量预估**:~32 人天(约 6-7 周)

### Phase 3 — "高级特性 + 规模化"

**前提**:Phase 2 上线后用户反馈是否真的需要以下能力。多数可能永远不做。

**可选工作项**(独立选择,非全部必做):

| # | 工作项 | 触发条件 | 工作量(人天) |
|---|---|---|---|
| 1 | 手机照片直接导入(Phase 3 移动最强动机) | 用户大量手机照片,嫌 AirDrop 麻烦 | 5 |
| 2 | 视频片段 / Live Photos 支持(`media_type='video'`) | 用户有视频归档需求 | 8(全新管线) |
| 3 | 人脸识别 | 用户照片量大到无法靠标签管理 | 10+(独立子系统) |
| 4 | 只读查看调整(亮度/对比度,非破坏不入库) | 用户反馈想在 app 内微调 | 3 |
| 5 | 多显示器全屏看片 | 用户用 FilmGallery 做展示 | 2 |
| 6 | 大库备份策略(增量、文件级去重) | 库 > 100GB | 5 |
| 7 | 自动 Memories(类似 Apple Photos,按地点+日期聚类) | 用户喜欢惊喜发现 | 5 |
| 8 | DigitalDevelop 完整调色面板(对标 FilmLab) | **用户明确要求且 Phase 2 反馈强烈** | 30+(等于再造一个 FilmLab) |

**Phase 3 决策原则**:每个工作项独立决策,基于实际用户反馈,而非"完整产品"的想象。Phase 3 #8(DigitalDevelop)只在用户反复要求时才做,且要明确接受"等于再造一个 FilmLab"的工作量。

## 6.3 风险驱动的迭代节奏

```
MVP 上线(7-8 周)
  ↓
观察期(4-8 周)— 收集反馈,看用户实际怎么用
  ↓
Phase 2 决策点
  ├─ 用户用得多 → 全力推进 Phase 2
  ├─ 用户偶尔用 → 只做最常被请求的 2-3 项(智能相册/移动浏览/keyset 分页)
  └─ 用户不用 → 暂停,不投入 Phase 2 资源
  ↓
Phase 3 — 永远基于反馈,不主动规划
```

**关键指标**(MVP 上线后跟踪):
- 数码照片导入量(每周)
- 共享视图的 mode 过滤使用分布(film/digital/all 各占多少)
- 相册创建数
- Library 视图访问频率
- 用户是否反复尝试在数码照片上找"调色"按钮(若是 → Phase 2 评估 DigitalDevelop)
