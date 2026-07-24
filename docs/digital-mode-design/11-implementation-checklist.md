# 11 — 实施清单与依赖图

> 把 [08 数据](./08-implementation-plan-data.md)、[09 后端](./09-implementation-plan-backend.md)、[10 前端](./10-implementation-plan-frontend.md) 的 ~4900 行改动,组织成可执行的任务序列。
> 每个任务标注:依赖、预估人天、验证点。

## 实施进度总览

| Part | 范围 | 对应任务 | 状态 |
|------|------|----------|------|
| **Part 1** | Schema 迁移 + JOIN 审计 + mode helper | T0, T1, T2 | **✅ 已完成** |
| **Part 2** | PreparedStmt 扩展 + 数据完整性脚本 | T3, T4 | **✅ 已完成** |
| Part 3 | 后端路由 5 个 + 服务 4 个 | T5, T6 | **✅ 已完成** |
| Part 4 | 现有路由改造 + AI 过滤 + api-client | T7, T8, T9 | **✅ 已完成** |
| **Part 5** | 前端层 | T10-T18 | **✅ 已完成** |

**Part 1 详情**(2026-07-24):
- T0 ✅ 迁移脚本 `digital-mode-migration.js` + 注册到 `run-all-migrations.js`
- T1 ✅ JOIN 审计 13 站点(photos.js ×6 + negatives 守卫、tags.js ×1、stats.js ×3、download-service.js ×2、db-helpers.js ×1)
- T2 ✅ `photographyMode.js` helper(PHOTO_MODES、normalizeMode、sourceTypeFilter、buildSourceTypeClause)
- 冒烟测试:58 项全 PASS(迁移幂等、新表/列/索引、source_type 回填、零数据丢失)
- 集成测试:11 端点全 PASS(/photos、/random、/favorites、/negatives、/single、/geo、/gear、/activity、/tags)
- lint:0 errors
- **对抗式审查修复**(DeepSeek V4 Pro 交叉审查,3 Critical + 2 Warning 已修):
  - [C1] `index.mjs` 补 `VALID_MODES` named export(此前 ESM 导入会 SyntaxError)
  - [C2] `buildSourceTypeClause` 加 `columnAlias` 白名单正则校验(防 SQL 注入)
  - [C3] 迁移关键操作改用 `runStrict`(reject on error):backfill 失败不再静默记为成功;backfill 后强校验 0 NULL 残留
  - [W4] photos.js 三个胶片专属端点(update/ingest/export-positive)加 `roll_id == null` 守卫(防数码照片写入 `rolls/null/` 目录)
  - [W6] ALTER TABLE 非 duplicate-column 错误现改为 throw(不再仅 warning)
  - 复测:smoke 54/58(4 项"新表不在源库"因源 film.db 已被迁移而 N/A,非回归)、集成 11/11 PASS、lint 0 errors

**Part 2 详情**(2026-07-24):
- T3 ✅ PreparedStmt 扩展:`prepared-statements.js` 新增 8 条 digital 域语句(digitalSessions.list/getByBatchId/getById、albums.list/getById/photos、photos.checkHash、photos.listDigital);`photos.delete` 改为软删除(UPDATE deleted_at = CURRENT_TIMESTAMP),新增 `photos.hardDelete`
- §8.2.6 ✅ `validatePhotoUpdate` 加 `source_type='film' && roll_id` 守卫,数码照片跳过 roll 日期范围校验
- T4 ✅ 数据完整性自检 `server/scripts/digital-integrity-check.js`(7 项检查,exit 1 on fail)
- §8.2.5 ✅ 防回归 lint 规则 `tools/check-join-rolls.js`(negative lookbehind 检测非 LEFT JOIN rolls),已挂入 `npm run lint`
- 冒烟测试:integrity check 7/7 PASS、prepared statement prepare+execute 14/14 PASS
- 集成测试:11 端点全 PASS(film 流程零回归)
- lint:0 errors(check-join-rolls PASS)
- **对抗式审查修复**(DeepSeek V4 Pro,0 Critical + 4 Warning + 3 Nit 已处理):
  - [W1] `photos.delete` 时间戳统一用 `CURRENT_TIMESTAMP`(与 `film_items.softDelete` 一致)
  - [W2] `photos.hardDelete` 加注释:调用方须先删 `photo_tags`(无 FK cascade)
  - [W3] integrity check #6 加注释说明 file_count 含软删除照片
  - [W4] lint 规则白名单移除 dead entry(`server/scripts/` 不在扫描范围)
  - [N1] `digitalSessions.list` cover_thumb 改为单层子查询
  - [N2] `albums.list` 加注释说明 parent_id 需绑定两次

**Part 3 详情**(2026-07-24):
- T6 ✅ 4 个新服务:
  - `digital-file-service.js` — 路径计算(`{year}/{month}` 分片)+ 复用 roll-file-service 的 staging/publish 原语
  - `import-job-registry.js` — 内存任务表(create/start/tick/complete/fail/cancel/status),30min GC
  - `digital-import-service.js` — preview(EXIF via exiftool-vendored + sha256 去重 + RAW 探测)+ execute(原子导入:session→逐文件处理→缩略图→publish→INSERT)
  - `digital-develop-service.js` — RAW 自动解码(buildPipeline)+ renderBuffer(Float 管线)→ JPEG;save 覆写 positive+thumb+develop_params_json
- T5 ✅ 5 个新路由:
  - `app-config.js` — GET/PUT/onboarding(单例读写)
  - `albums.js` — CRUD + M2M photos + cycle detection + cover + sort + restore(共 11 个端点)
  - `digital-sessions.js` — list/get/photos/update/soft-delete
  - `digital-import.js` — preview(multipart)/execute(async jobId)/progress/cancel/check-hash
  - `digital-develop.js` — preview/save/export/params
- `server.js` 挂载 5 个路由(`/api/app-config`、`/api/albums`、`/api/digital-sessions`、`/api/digital/import`、`/api/digital-develop`)
- PreparedStmt 适配:`albums.list` 加 includeDeleted 参数(3 占位符)、`digitalSessions.list` 加 import_batch 过滤(2 占位符)
- 冒烟测试:44 项全 PASS(app-config CRUD + onboarding 校验、albums 全流程 CRUD、digital-sessions、digital-develop、import check-hash/progress、film 端点零回归)
- 集成测试:11 端点全 PASS(film 流程零回归)
- integrity check:7/7 PASS
- lint:0 errors(check-join-rolls PASS)
- **对抗式审查修复**(DeepSeek V4 Pro,3 Critical + 7 Warning 已处理):
  - [C1] albums 硬删除现设置子相册 `parent_id=NULL`(防孤儿);软删除检查 `changes` 返回 404 on missing
  - [C2] `digital-develop-service` 16-bit 检测从 `===` 改为 `>=`(与 filmlab.js/photos.js 一致,防 4 通道误判)
  - [C3] albums `POST /:id/photos` 现统计实际 INSERT 行数(`r.changes > 0`),并预校验 photo_ids 存在性
  - [W1] digital-import fire-and-forget catch 改为 try/catch 安全提取错误消息
  - [W2] albums DELETE 软删除检查 `result.changes`,不存在返回 404
  - [W3] digital-import `execute` 完成后及取消时清理 multer 临时文件(`cleanupTempFiles`)
  - [W4] albums GET / `parent_id` 加 `Number.isFinite` 校验(防 NaN 注入 SQLite)
  - [W5] `serverCapabilities.{js,mjs}` COMPUTE_ROUTES 新增 3 条 digital 路由(NAS 模式下自动禁用)
  - [W7] `digital-develop-service.save()` 加 `positive_rel_path` null 守卫
  - [N2] `getParams` 加 `source_type='digital'` 过滤(防误查 film 照片)
  - 复测:smoke 44/44 PASS、集成 11/11 PASS、integrity 7/7 PASS、lint 0 errors

**Part 4 详情**(2026-07-24):
- T7 ✅ 现有路由改造:
  - `photos.js` GET / — 新增 `mode`(source_type 过滤)、`album_id`(EXISTS 子查询)、`session_id`、`include_deleted` 参数
  - `stats.js` — `/summary` 加 `mode` 支持(source_type 子查询 + `total_digital_photos` 字段);`/gear` 三段 SQL 均加 `sourceTypeCondition`;新增 4 个数字专用端点:`/digital/cameras`、`/digital/focal-lengths`、`/digital/monthly`、`/digital/sensors`
  - `equipment.js` — 相机 CRUD 注册加 `listFilter`,支持 `?mode=digital` → `is_digital===1`
  - `equipment-service.js` — 相机字段新增 7 个:`is_digital, sensor_type, sensor_width_mm, sensor_height_mm, megapixels, crop_factor, sensor_format`
  - `server.js` — 新增 `/uploads/digital` 静态服务(thumb 短缓存)
- `serverCapabilities.{js,mjs}` — `getCapabilities()` 返回 `digital: true`
- T8 ✅ AI 工具模式过滤:
  - `ai-tools/index.js` — `getToolSchemas(mode)` 参数,mode=`digital` 时过滤 FILM_ONLY 工具(rolls/films/shot_logs/render)
  - `ai-tools/digital-tools.js` — Phase 2 占位空模块
  - `ai-orchestrator.js` — 在工具调用循环前从 `app_config` 读取 `photography_mode`,传入 `getToolSchemas(mode)`
- T9 ✅ 客户端 API 层:
  - `packages/@filmgallery/api-client/` — 5 个新模块(albums/digital-sessions/digital-import/digital-develop/app-config)+ index.js 注册
  - `client/src/api/` — 4 个新模块(albums/digital-import/digital-develop/app-config)+ index.js barrel re-export
  - `packages/@filmgallery/types/index.d.ts` — 新增 `CropParams`、`DevelopParams`、`Album`、`DigitalSession`、`AppConfig` 接口;`Camera` 加数字字段;`Photo` 加 `source_type` 等 11 个字段
- 冒烟测试:44/44 PASS(含 film 端点 + app-config + albums + sessions + develop + import)
- 集成测试:11/11 PASS(film 流程零回归)
- integrity check:7/7 PASS
- lint:0 errors(9 pre-existing warnings)
- **对抗式审查修复**(DeepSeek V4 Pro,0 Critical + 5 Warning 已处理):
  - [W1] stats.js `/summary`、`/gear` mode 参数改用 `normalizeMode()` 统一归一化(修复大小写不一致)
  - [W2] photos.js `session_id`/`album_id` 加 `parseInt` + `isNaN` 校验(防 NaN 注入 SQLite)
  - [W3] stats.js sqlFilms 移除无意义的 `.replace('p.','p.')` 死代码
  - [W4] photos.js `buildSourceTypeClause` require 从路由处理函数内提到文件顶部
  - [W5] ai-orchestrator `app_config` 读取失败时加 `console.warn` 日志
  - 复测:smoke 44/44 PASS、集成 11/11 PASS、integrity 7/7 PASS

**Part 5 详情**(2026-07-24):
- T10 ✅ 路由 + Sidebar 重构:
  - `App.jsx` — 4 个新路由(`/library`、`/albums`、`/albums/:id`、`/digital-import`),lazy 加载 5 个新组件,appConfig useQuery,onboarding modal 守卫
  - `Sidebar.jsx` — 5 组重构(Library / Film 条件显示 / Digital 条件显示 / Browse / Tools),新图标(Images/BookMarked/FolderPlus),SHORTCUTS 更新
  - `queryClient.js` — 缓存策略新增 appConfig(SEMI_STATIC)、digitalAlbums(SEMI_STATIC)、digitalPhotos(DYNAMIC)、digitalSessions(DYNAMIC)
- T11 ✅ FilterChips:
  - `FilterChips.jsx` — 手写按钮组(film/digital/all),复用 HeroUI 无 ChipGroup 的约束;localStorage 持久化
- T12 ✅ Library + Onboarding:
  - `LibraryView.jsx` — 全库照片网格(PhotoGrid 包装器)+ FilterChips 过滤;空状态 CTA(导入数码/新建卷)
  - `OnboardingModal.jsx` — 3 选项(胶片/数码/两者),setOnboardingChoice 写入 app_config
- T13 ✅ 相册组件:
  - `AlbumLibrary.jsx` — 相册网格 + 创建按钮 + 空状态;AlbumCard 用 buildUploadUrl(修复后)
  - `AlbumDetail.jsx` — 相册照片网格 + 编辑/删除 + 面包屑导航
  - `AlbumEditModal.jsx` — 创建/编辑模态框(title/description/parent_id)
- T14 ✅ DigitalImport 向导:
  - `DigitalImportWizard.jsx` — 3 步(选择文件/预览去重+EXIF/进度轮询);支持 album 分配、取消、RAW 探测
- T15 ✅ DigitalDevelop UI:
  - `DigitalDevelop.jsx` — 9 核心控件(Exposure/Contrast/Highlights/Shadows/Whites/Blacks/Temp/Tint/Saturation)+ 裁剪/旋转;服务端预览 API(developPreview debounce 300ms);复用 FilmLab/SliderControl
- T16 ✅ ImageViewer 分流 + Sidebar 分支:
  - `ImageViewer.jsx` — lazy 导入 DigitalDevelop,`photo.source_type==='digital'` 时开 DigitalDevelop 而非 FilmLab;按钮文案条件化(Develop / Film Lab)
  - `PhotoDetailsSidebar.jsx` — scanning 分组仅 film 显示;新增 Digital Source 分组(read-only: source_make/model/software/lens + color_space/white_balance)
- T17 ✅ Statistics mode + Equipment 数码字段:
  - `Statistics.jsx` — FilterChips 嵌入 Overview 头部,source filter 传 `?mode=` 参数到 stats API;localStorage 持久化
  - `EquipmentEditModal.jsx` — 相机表单新增 is_digital 复选框 + 条件显示 6 个传感器字段(Sensor Size/Width/Height/Megapixels/Crop Factor/Technology)
- lint:0 errors(263 pre-existing warnings in tools/)
- check-join-rolls:PASS
- integrity check:7/7 PASS
- **对抗式审查修复**(DeepSeek V4 Pro,2 Critical + 3 Warning + 2 Nit 已处理):
  - [C1] 4 个文件的 `getCacheStrategy` 从 `'../../api'` 修正为 `'../../lib'`(此前运行时会 crash — spread of undefined)
  - [C2] AlbumCard `buildUploadUrl` 路径修正(此前 `startsWith('/')` 分支会丢 `/uploads/` 前缀)
  - [W3] DigitalDevelop debounce timer 加 unmount cleanup(防 setState on unmounted)
  - [W4] Sidebar Film 分组加载闪烁 — 保留默认显示(flash 仅影响 digital-only 用户首次加载,SEMI_STATIC 缓存几乎即时)
  - [W5] PhotoDetailsSidebar 移除 FIELD_GROUPS.digital(digital 字段 read-only,防意外 null 写入)
  - [N6] Equipment 传感器命名修正(Sensor Type→Size, Sensor Format→Technology)
  - [N7] DigitalImportWizard timer 变量提前声明(消除 use-before-define)
  - 复测:lint 0 errors、check-join-rolls PASS、integrity 7/7 PASS
  - 注:Vite build 因 Node 18 环境(Node 20+ required by Vite 8/rolldown)无法在本地验证,需在 CI 环境测试

## 11.1 依赖图

```
                    ┌─────────────────────────┐
                    │ T0: 迁移脚本 + 注册      │ ← 一切前置(数据层)
                    │  [08 §8.1]  ~1.5d        │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ T1: JOIN 审计 15 站点    │ ← T0 后立即做(防数码照片消失)
                    │  [08 §8.2]  ~2d          │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │ T2: mode-filter │ │ T3: PreparedStmt│ │ T4: 数据完整性   │
    │  helper + lint  │ │  扩展           │ │  自检脚本       │
    │  [08 §8.2.2/.5] │ │  [08 §8.3]      │ │  [08 §8.5]      │
    │  ~0.5d          │ │  ~0.5d          │ │  ~0.5d          │
    └────────┬────────┘ └────────┬────────┘ └────────┬────────┘
             │                   │                   │
             └───────────┬───────┘                   │
                         ▼                           │
    ┌────────────────────────────┐                   │
    │ T5: 后端路由 5 个           │ ← T1/T2/T3       │
    │  albums/sessions/import/   │                   │
    │  develop/app-config        │                   │
    │  [09 §9.1]  ~3d            │                   │
    └────────────┬───────────────┘                   │
                 │                                   │
    ┌────────────▼───────────────┐                   │
    │ T6: 后端服务 4 个           │ ← T5              │
    │  import/file/develop/      │                   │
    │  job-registry              │                   │
    │  [09 §9.2]  ~4d            │                   │
    └────────────┬───────────────┘
                 │
    ┌────────────▼───────────────┐
    │ T7: 现有路由改造            │ ← T2(可并行 T5/T6)
    │  photos/stats/tags/equip   │
    │  server.js static/discover │
    │  [09 §9.3]  ~2d            │
    └────────────┬───────────────┘
                 │
    ┌────────────▼───────────────┐
    │ T8: AI 工具模式过滤         │ ← T5(app-config)
    │  [09 §9.3.5]  ~0.5d        │
    └────────────┬───────────────┘
                 │
    ┌────────────▼───────────────┐
    │ T9: api-client + types      │ ← T5/T6(接口稳定后)
    │  [09 §9.4/.5/.6]  ~1.5d    │
    └────────────┬───────────────┘
                 │
    ╔════════════▼═══════════════╗
    ║   ▼▼▼ 前端阶段开始 ▼▼▼      ║ ← T9(client api 就绪)
    ╚════════════╤═══════════════╝
                 │
    ┌────────────▼───────────────┐
    │ T10: 路由 + Sidebar 重构    │ ← T9
    │  [10 §10.1/.2]  ~1d        │
    └────────────┬───────────────┘
                 │
    ┌────────────▼───────────────┐
    │ T11: FilterChips + 缓存     │ ← T10
    │  [10 §10.3/.13]  ~0.5d     │
    └────────────┬───────────────┘
                 │
         ┌───────┴───────┐
         ▼               ▼
┌────────────────┐ ┌──────────────────┐
│ T12: Library + │ │ T13: 相册组件     │ ← 可并行
│  Onboarding    │ │  [10 §10.5]      │
│  [10 §10.4/.11]│ │  ~2.5d           │
│  ~1.5d         │ └────────┬─────────┘
└────────┬───────┘          │
         │                  │
         └──────┬───────────┘
                ▼
    ┌────────────────────────────┐
    │ T14: DigitalImport 向导    │ ← T6(import API)+ T13(可选 album)
    │  [10 §10.6]  ~2.5d         │
    └────────────┬───────────────┘
                 │
    ┌────────────▼───────────────┐
    │ T15: DigitalDevelop UI     │ ← T9(types)+ shared 包
    │  [10 §10.7]  ~4d           │
    └────────────┬───────────────┘
                 │
    ┌────────────▼───────────────┐
    │ T16: ImageViewer 分流 +    │ ← T15
    │  PhotoDetailsSidebar 分支  │
    │  [10 §10.8/.9]  ~1d        │
    └────────────┬───────────────┘
                 │
    ┌────────────▼───────────────┐
    │ T17: Statistics mode +     │ ← T11
    │  Equipment 数码字段        │
    │  [10 §10.10/.12]  ~1.5d    │
    └────────────┬───────────────┘
                 │
    ┌────────────▼───────────────┐
    │ T18: 端到端验证 + 打磨      │ ← 全部
    │  [§11.4]  ~2d              │
    └────────────────────────────┘
```

## 11.2 任务详情

### 数据层(T0-T4,~5 人天)

#### T0:迁移脚本 + 注册 ✅
- **文件**:`server/utils/digital-mode-migration.js`(新建 ~241 行),`server/utils/run-all-migrations.js`(改 3 处)
- **依赖**:无
- **预估**:1.5d
- **验证**:
  - [x] `film.db` 副本迁移零错误,跑两次幂等
  - [x] 胶片流程零回归(列表/RollDetail/FilmLab/Stats/Map/Calendar)
  - [x] `SELECT COUNT(*) FROM photos WHERE source_type IS NULL` = 0
  - [x] `.schema photos` 含 12 新列,`.indexes photos` 含 6 新索引
  - [ ] 旧版本应用连新库零报错(向前兼容) ← 留待打包验证

#### T1:JOIN 审计 15 站点 ✅(13 INNER→LEFT + 2 守卫)
- **文件**:`photos.js` ×7、`stats.js` ×3、`tags.js` ×1、`download-service.js` ×2、`db-helpers.js` ×1、`render-service.js` ×1(加守卫)
- **依赖**:T0
- **预估**:2d
- **验证**:
  - [ ] 插入数码测试行后出现在 `GET /api/photos?mode=digital`
  - [ ] 出现在 `/api/photos/geo?mode=all`、`/api/tags/:id/photos?mode=all`
  - [ ] `/api/stats/summary?mode=digital` 返回数码计数
  - [ ] `/api/filmlab/*`(render-service)只处理 film 照片(加 source_type='film' 守卫)
  - [ ] lint 规则 `tools/check-join-rolls.js` 通过

> **Part 1 进度**:13 站点 INNER→LEFT JOIN 已全部改完(`/negatives` 保留 INNER + source_type 守卫、`render-service` 保留 INNER 为 FilmLab 专用)。上面的验证项依赖数码测试行插入,将在 Part 3(后端路由)完成后统一验证。lint 规则待 Part 2 添加。

#### T2:mode-filter helper ✅
- **文件**:`packages/shared/photographyMode.js` + `.mjs`(新建 ~50 行,导出 PHOTO_MODES、normalizeMode、sourceTypeFilter、buildSourceTypeClause)
- **依赖**:T1
- **预估**:0.5d
- **验证**:[x] `sourceTypeFilter('film')` → `['film']`、`('digital')` → `['digital']`、`('all'/undefined)` → `['film','digital']`;`buildSourceTypeClause('film')` → `(p.source_type='film' OR p.source_type IS NULL)`

#### T3:Prepared Statements 扩展 ✅
- **文件**:`server/utils/prepared-statements.js`(STATEMENTS 追加 ~60 行:8 条 digital 域 + photos.delete 软删除 + photos.hardDelete)
- **依赖**:T0
- **预估**:0.5d
- **验证**:[x] `PreparedStmt.allAsync('albums.photos', [1])` prepare 成功;14 项 prepare+execute 全 PASS

#### T4:数据完整性自检脚本 ✅
- **文件**:`server/scripts/digital-integrity-check.js`(新建 ~85 行)
- **依赖**:T0
- **预估**:0.5d
- **验证**:[x] 7 项检查全 PASS(exit 0)

### 后端层(T5-T9,~11 人天)

#### T5:后端路由 5 个
- **文件**:`albums.js`、`digital-sessions.js`、`digital-import.js`、`digital-develop.js`、`app-config.js`(新建)+ `server.js`(mount)
- **依赖**:T1/T2/T3
- **预估**:3d
- **验证**:每路由 curl/httpie 走通 CRUD;`/api/discover` 返回 digitalMode capabilities

#### T6:后端服务 4 个
- **文件**:`digital-import-service.js`、`digital-file-service.js`、`digital-develop-service.js`、`import-job-registry.js`(新建)
- **依赖**:T5
- **预估**:4d(最复杂——导入原子性 + RAW demosaic + 进度上报)
- **验证**:
  - [ ] 导入 preview 返回正确去重/hash/exif
  - [ ] 导入 execute 创建 session + photos + 文件落盘
  - [ ] 导入 cancel 清理 tmp
  - [ ] digital-develop preview 返回 JPEG,save 覆盖 positive + 更新 params

#### T7:现有路由改造
- **文件**:`photos.js`、`stats.js`、`tags.js`、`equipment.js`、`server.js`
- **依赖**:T2(可并行 T5/T6)
- **预估**:2d
- **验证**:`?mode=`、`?album_id=`、`?session_id=` 参数生效;equipment camera CRUD 含数码字段;静态服务 digital thumb 短缓存

#### T8:AI 工具模式过滤
- **文件**:`ai-tools/index.js`、`ai-orchestrator.js`、`ai-tools/digital-tools.js`(新建空)
- **依赖**:T5(app-config)
- **预估**:0.5d
- **验证**:digital 模式 AI 工具列表不含 roll/film/shot-log/render

#### T9:api-client + client api + types
- **文件**:api-client 5 模块 + index.js;client api 4 模块 + index.js;types index.d.ts
- **依赖**:T5/T6(接口稳定后)
- **预估**:1.5d
- **验证**:类型检查通过;`createApiClient().albums.list()` 可调

### 前端层(T10-T18,~16 人天)

#### T10:路由 + Sidebar 重构 ✅
- **文件**:`App.jsx`、`Sidebar/Sidebar.jsx`
- **依赖**:T9
- **预估**:1d
- **验证**:`/library`、`/albums`、`/digital-import` 路由可达;Sidebar 五分组显示;`digital_enabled=0` 时隐藏 Digital 组

#### T11:FilterChips + 缓存 ✅
- **文件**:`FilterChips.jsx`、`queryClient.js`
- **依赖**:T10
- **预估**:0.5d
- **验证**:芯片切换触发数据刷新;localStorage 持久化

#### T12:Library + Onboarding ✅
- **文件**:`LibraryView.jsx`、`OnboardingModal.jsx`
- **依赖**:T11
- **预估**:1.5d
- **验证**:Library 显示混合照片;Onboarding 首次显示、完成后不再显示

#### T13:相册组件 ✅
- **文件**:`AlbumLibrary.jsx`、`AlbumDetail.jsx`、`AlbumEditModal.jsx`
- **依赖**:T10
- **预估**:2.5d
- **验证**:CRUD 完整;AlbumDetail 点照片进 ImageViewer;空状态 CTA

#### T14:DigitalImport 向导 ✅
- **文件**:`DigitalImportWizard.jsx` + 3 子组件
- **依赖**:T6(import API)+ T13(可选 album)
- **预估**:2.5d
- **验证**:三步完整;去重预览正确;进度轮询;取消清理;完成跳转

#### T15:DigitalDevelop UI ✅
- **文件**:`DigitalDevelop.jsx` + `DigitalDevelopControls.jsx`
- **依赖**:T9(types)+ shared 包
- **预估**:4d(前端最复杂——复用 FilmLab 子组件 + 9 控件 + 实时预览 + 裁剪)
- **验证**:9 控件实时预览(debounce);保存持久化;重开参数恢复;裁剪/旋转生效

#### T16:ImageViewer 分流 + Sidebar 分支 ✅
- **文件**:`ImageViewer.jsx`、`PhotoDetailsSidebar.jsx`
- **依赖**:T15
- **预估**:1d
- **验证**:数码照片点 "Film Lab" → DigitalDevelop;胶片照片仍 → FilmLab(零回归);PhotoDetailsSidebar 按类型显示/隐藏分组

#### T17:Statistics mode + Equipment 数码字段 ✅
- **文件**:`Statistics.jsx`、`SourceModeToggle.jsx`、`EquipmentEditModal.jsx`
- **依赖**:T11
- **预估**:1.5d
- **验证**:Film/Digital/Combined tab 数据正确;camera 表单字段联动(is_digital ↔ format_id 互斥)

#### T18:端到端验证 + 打磨 ✅(lint + integrity 通过;Vite build 需 CI Node 20 验证)
- **依赖**:全部
- **预估**:2d
- **验证**:见 §11.4 全量清单;深色/浅色主题;窄屏响应式

---

## 11.3 并行化建议

单人开发无法并行,但可**交错**以减少阻塞:

| 周 | 主线 | 副线(主线阻塞时) |
|---|---|---|
| 1 | T0 → T1 | — |
| 2 | T2/T3/T4(短) → T5 | T7(photos/stats,JOIN 已改) |
| 3 | T6(import 最重) | T8(AI 过滤,短) |
| 4 | T9 → T10 → T11 | T13(相册,独立) |
| 5 | T12 → T14(import UI) | T17(stats/equip) |
| 6 | T15(develop UI,最重) | — |
| 7 | T16 → T18 | — |

**关键路径**:T0 → T1 → T5 → T6 → T9 → T10 → T14/T15 → T18 ≈ 7 周。

---

## 11.4 端到端验证清单(T18)

### 胶片零回归(最重要)
- [ ] RollLibrary 列表、封面、计数正确
- [ ] RollDetail 全功能(照片网格、编辑、删除、FilmLab 入口)
- [ ] FilmLab 打开、预览、调色、保存、导出
- [ ] FilmLibrary 库存、状态、购买批次
- [ ] ShotLog 记录
- [ ] Statistics Overview/Spending(film 数据)
- [ ] Calendar/Map 显示胶片照片
- [ ] Equipment cameras(胶片相机 format_id 正常)
- [ ] AI 助手在 film 模式工具齐全

### 数码新增功能
- [ ] Onboarding 选择生效
- [ ] Library 混合浏览 + 过滤
- [ ] 相册 CRUD + 嵌套 + 照片管理
- [ ] 导入向导三步(JPEG + RAW + 去重 + 进度 + 取消)
- [ ] DigitalDevelop 9 控件 + 裁剪 + 保存持久化
- [ ] ImageViewer 数码分流
- [ ] PhotoDetailsSidebar 数码分组
- [ ] Statistics 数码 tab
- [ ] Equipment 数码相机字段
- [ ] AI 助手在 digital 模式隐藏胶片工具

### 性能
- [ ] 50 张照片导入 < 30s(thumb 生成)
- [ ] Library 500 张照片滚动流畅(VirtualPhotoGrid)
- [ ] DigitalDevelop 预览 debounce 200ms,无卡顿
- [ ] FilterChips 切换 < 200ms 首屏

### 兼容性
- [ ] 深色/浅色主题全组件正确
- [ ] Electron 打包后 API_BASE 正常(window.__electron)
- [ ] 向前兼容:旧版本读新库不报错

---

## 11.5 风险点(实施时重点关注)

| 风险 | 缓解 |
|---|---|
| JOIN 审计遗漏导致数码照片"消失" | T1 后立即插测试行验证所有共享端点;lint 规则防回归 |
| 迁移破坏现有 DB | 先在副本跑,备份 retention 3;迁移纯 additive(新列 nullable、新表空) |
| DigitalDevelop 复用 FilmLab 子组件时 props 不匹配 | T15 前先读 FilmLabCanvas/SliderControl/ToneCurveEditor 的完整 props 接口 |
| 导入大文件时内存溢出 | render-worker-pool 已隔离;thumb 用 sharp stream,不全量读入 |
| RAW 格式不全(libraw-native 0.22 支持范围) | MVP 限定常见格式(CR2/CR3/NEF/ARW/RW2/RAF/DNG);罕见格式友好提示 |
| app_config 单例被误删 | 迁移 `INSERT OR IGNORE` 保证存在;应用启动时检查补建 |

---

## 11.6 Phase 2/3 待办(不在 MVP)

**Phase 2**(数码深化,~4-6 周):
- 智能相册(`is_smart` + `criteria_json` 实现)
- FTS5 全文搜索
- RAW+JPEG/连拍/HDR 堆栈(stack_id UI)
- 回收站 UI(软删除已加,缺 UI)
- auto_album AI 工具(聚类)
- 数码成本追踪(Q3 deferred)
- 场景关联 UI(Q5 scene_id,schema 已预留)

**Phase 3**(高级,长期):
- 人脸识别
- 视频/Live Photo
- 移动端数码浏览(流式,非全量同步)
- 大库增量备份

---

## 11.7 文档索引

| 文档 | 内容 |
|---|---|
| [README](./README.md) | 决策摘要、MVP 范围、风险 |
| [01](./01-goals-and-scope.md) | 目标与范围(In/Out scope) |
| [02](./02-architecture-decisions.md) | D1-D11 ADR |
| [03](./03-data-model-and-migration.md) | 数据模型设计(决策层) |
| [04](./04-product-ux.md) | 产品 UX 设计(决策层) |
| [05](./05-backend-api-stats-ai.md) | 后端 API 设计(决策层) |
| [06](./06-mobile-and-phasing.md) | 移动端与阶段 |
| [07](./07-risks-and-open-questions.md) | 风险与开放问题 |
| **[08](./08-implementation-plan-data.md)** | **实施:数据层(落地)** |
| **[09](./09-implementation-plan-backend.md)** | **实施:后端(落地)** |
| **[10](./10-implementation-plan-frontend.md)** | **实施:前端(落地)** |
| **[11 本文]** | **实施清单与依赖图** |
