# 11 — 实施清单与依赖图

> 把 [08 数据](./08-implementation-plan-data.md)、[09 后端](./09-implementation-plan-backend.md)、[10 前端](./10-implementation-plan-frontend.md) 的 ~4900 行改动,组织成可执行的任务序列。
> 每个任务标注:依赖、预估人天、验证点。

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

#### T0:迁移脚本 + 注册
- **文件**:`server/utils/digital-mode-migration.js`(新建 ~180 行),`server/utils/run-all-migrations.js`(改 3 处)
- **依赖**:无
- **预估**:1.5d
- **验证**:
  - [ ] `film.db` 副本迁移零错误,跑两次幂等
  - [ ] 胶片流程零回归(列表/RollDetail/FilmLab/Stats/Map/Calendar)
  - [ ] `SELECT COUNT(*) FROM photos WHERE source_type IS NULL` = 0
  - [ ] `.schema photos` 含 12 新列,`.indexes photos` 含 6 新索引
  - [ ] 旧版本应用连新库零报错(向前兼容)

#### T1:JOIN 审计 15 站点
- **文件**:`photos.js` ×7、`stats.js` ×3、`tags.js` ×1、`download-service.js` ×2、`db-helpers.js` ×1、`render-service.js` ×1(加守卫)
- **依赖**:T0
- **预估**:2d
- **验证**:
  - [ ] 插入数码测试行后出现在 `GET /api/photos?mode=digital`
  - [ ] 出现在 `/api/photos/geo?mode=all`、`/api/tags/:id/photos?mode=all`
  - [ ] `/api/stats/summary?mode=digital` 返回数码计数
  - [ ] `/api/filmlab/*`(render-service)只处理 film 照片(加 source_type='film' 守卫)
  - [ ] lint 规则 `tools/check-join-rolls.js` 通过

#### T2:mode-filter helper
- **文件**:`server/utils/mode-filter.js`(新建 ~25 行)
- **依赖**:T1
- **预估**:0.5d
- **验证**:`resolveModeFilter('film')` → `['film']`、`('digital')` → `['digital']`、`('all'/undefined)` → `['film','digital']`

#### T3:Prepared Statements 扩展
- **文件**:`server/utils/prepared-statements.js`(STATEMENTS 追加 ~60 行)
- **依赖**:T0
- **预估**:0.5d
- **验证**:`PreparedStmt.allAsync('albums.photos', [1])` 返回正确行

#### T4:数据完整性自检脚本
- **文件**:`server/scripts/digital-integrity-check.js`(新建 ~80 行)
- **依赖**:T0
- **预估**:0.5d
- **验证**:7 项检查全 PASS

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

#### T10:路由 + Sidebar 重构
- **文件**:`App.jsx`、`Sidebar/Sidebar.jsx`
- **依赖**:T9
- **预估**:1d
- **验证**:`/library`、`/albums`、`/digital-import` 路由可达;Sidebar 五分组显示;`digital_enabled=0` 时隐藏 Digital 组

#### T11:FilterChips + 缓存
- **文件**:`FilterChips.jsx`、`queryClient.js`
- **依赖**:T10
- **预估**:0.5d
- **验证**:芯片切换触发数据刷新;localStorage 持久化

#### T12:Library + Onboarding
- **文件**:`LibraryView.jsx`、`OnboardingModal.jsx`
- **依赖**:T11
- **预估**:1.5d
- **验证**:Library 显示混合照片;Onboarding 首次显示、完成后不再显示

#### T13:相册组件
- **文件**:`AlbumLibrary.jsx`、`AlbumDetail.jsx`、`AlbumEditModal.jsx`
- **依赖**:T10
- **预估**:2.5d
- **验证**:CRUD 完整;AlbumDetail 点照片进 ImageViewer;空状态 CTA

#### T14:DigitalImport 向导
- **文件**:`DigitalImportWizard.jsx` + 3 子组件
- **依赖**:T6(import API)+ T13(可选 album)
- **预估**:2.5d
- **验证**:三步完整;去重预览正确;进度轮询;取消清理;完成跳转

#### T15:DigitalDevelop UI
- **文件**:`DigitalDevelop.jsx` + `DigitalDevelopControls.jsx`
- **依赖**:T9(types)+ shared 包
- **预估**:4d(前端最复杂——复用 FilmLab 子组件 + 9 控件 + 实时预览 + 裁剪)
- **验证**:9 控件实时预览(debounce);保存持久化;重开参数恢复;裁剪/旋转生效

#### T16:ImageViewer 分流 + Sidebar 分支
- **文件**:`ImageViewer.jsx`、`PhotoDetailsSidebar.jsx`
- **依赖**:T15
- **预估**:1d
- **验证**:数码照片点 "Film Lab" → DigitalDevelop;胶片照片仍 → FilmLab(零回归);PhotoDetailsSidebar 按类型显示/隐藏分组

#### T17:Statistics mode + Equipment 数码字段
- **文件**:`Statistics.jsx`、`SourceModeToggle.jsx`、`EquipmentEditModal.jsx`
- **依赖**:T11
- **预估**:1.5d
- **验证**:Film/Digital/Combined tab 数据正确;camera 表单字段联动(is_digital ↔ format_id 互斥)

#### T18:端到端验证 + 打磨
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
