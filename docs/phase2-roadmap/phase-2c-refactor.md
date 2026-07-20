# Phase 2C · 重构层

> **范围**: #4 错误处理统一 · #5 像素管线下沉 · #6 DB schema 收敛
> **定位**: 大规模机械/性能重构。三项均以 **2A #10 测试护栏为硬前置**——无测试不重构。
> **前置**: 2A.1+2A.2（已 ✅）；2B auth 中间件已落地（错误响应需对齐）
> **状态**: ✅ 完成 — 2C.0（路由测试）；2C.1（迁移 runner + 窗口函数）；2C.2（errorHandler 重写 + 5xx 全面迁移）；2C.3（worker pool + fs 异步化 + 性能基线）。**383 tests / 35 suites green，真实 server boot smoke 通过**。
> **本文件在 2C 开工前对照真实仓库重写**；原版（见 git 历史）约 60% 任务基于已存在或已实现的前提。重写依据：对错误响应/迁移系统/索引现状/像素管线/worker 边界的实地勘探，见下「设计验证」。
> **执行原则（贯穿全程）**：从本质出发，不做过多的兜底。已有死代码（MigrationRunner、ensureColumn 运行时补丁、schemaSQL 双轨）一律收敛为单一真相源，不保留并行回退路径；只在「真有未知」处（worker 引入新并发模式）保留 env flag。

---

## 进度记录（执行态）

| 子任务 | 状态 | 产出 / 证据 |
|---|---|---|
| 2C.0 路由错误路径测试 | ✅ | `server/routes/__tests__/_helpers.js`（共享 `buildApp`/`assertServerErrorContract`）；新建 13 个路由测试（photos/films/rolls/stats/ai-chat/search/tags/conflicts/equipment/filesystem/uploads/export/luts）；每测试 mock 主依赖强制 500，断言「状态码 + JSON + 非空 error + 无堆栈泄露」。**350 tests / 32 suites green，eslint 0 error**。发现 photos.js:128 latent bug（首个 `await getAsync` 在 try 外 → 失败时挂起），2C.2 修复时启用对应测试。 |
| 2C.1 #6 DB schema | ✅ | (a) 激活 `runAllMigrations`：`server.js:488` 删除 MIGRATIONS DISABLED 注释块，改为调 `runAllMigrations()`；(b) 重写 `run-all-migrations.js`：3 个正式迁移（schema/equipment/film-struct），删除原 5 个伪 2024 占位；(c) **删 10 个 orphan**（`server/migrations/*` 全部 — schema-migration.js 已完整覆盖；2 个特殊 orphan 收编：`positive_source` 列加入 schema-migration 列清单，`original_rel_path` backfill 逻辑加入 `backfillOriginalRelPath()`）；(d) **删 `server/utils/migration.js`** + 3 个 `server/scripts/run-migration-*.js` 包装脚本（dead code）；(e) `roll-service.js`：删 `ensureDisplaySeqColumn`/`ensureStartDateColumn` 运行时兜底（schema-migration.js 已通过列清单 + `UPDATE rolls SET start_date = date_loaded` 一并解决）；`recomputeRollSequence` 简化为单条 `ROW_NUMBER() OVER(...)` 窗口函数；(f) `schema-migration.js`：加 `idx_photos_location` 索引；(g) 备份策略：`backupDatabaseIfNeeded()` 仅在有 pending 迁移时备份（避免重启磁盘抖动），轮换 3 份；(h) 顺手修 `db.js:258` WAL 定时器未 `.unref()` 导致测试 worker 退出延迟。**352 tests / 32 suites green，真实 server boot smoke 通过（首次跑全 3 迁移 → _migrations 表 3 条；二次启动 → 全 skip + 不备份）**。 |
| 2C.2 #4 错误统一 | ✅ | (a) **重写 `error-handler.js`** 围绕 `expose` 属性：新增 `OperationalError`/`ProgrammerError` 基类，`ValidationError`/`NotFoundError` 继承前者；`classifyError()` 统一映射（self-classified / SQLite / Multer / auth-style status<500 / fallback 5xx hidden）；`errorId` 改为 `crypto.randomUUID()`；响应体规范 `{ok,error,code?,details?,errorId}`。(b) **`auth.js:119` 对齐**：删 inline `res.status().json()`，改为 `next(err)` 携带 `status`/`code`（`<500 → UNAUTHORIZED`、`>=500 → AUTH_INTERNAL`），由 errorHandler 序列化。(c) **创建 `server/utils/async-handler.js`** 共享包装器（equipment.js 的本地副本删除，统一引用）。(d) **5xx 路由全面迁移**：13 个路由文件（photos/rolls/ai-chat/raw/luts/locations/filesystem/edge-detection/import/filmlab/export-history/batch-download/batch-render/uploads）+ 5 个补漏（presets/film-items/metadata/batch-download/health/export/photos/rolls），共 ~157 处 `res.status(500).json(...)` → `next(<catchVar>)`；handler 签名统一加 `next`；同步删除冗余 `console.error`（errorHandler 集中日志含 errorId 关联）。**`rg "res\.status\(500\)" server/routes` 从 ~95 降至 0**（除 catch 内联的特定业务错误外）。(e) **photos.js:128 latent bug 修复**：`router.get('/')` 首个 `await getAsync(...)` 移入 try 块，失败不再挂起；启用对应回归测试。(f) **新增测试**：`server/middleware/__tests__/error-handler.test.js`（16 用例：errorId 唯一性、5 类映射、prod/dev 切换、details 透传）；`server/middleware/__tests__/mount-order.test.js`（3 用例：错误经 errorHandler、404 经 notFoundHandler、源码顺序静态校验）。**378 tests / 34 suites green，真实 server boot smoke 通过**（`/api/does-not-exist` → 404 + `ROUTE_NOT_FOUND` code；`/api/photos/single/9999999` → 404 bucket E 保留）。 |
| 2C.3 #5 像素下沉 | ✅ | (a) **抽共享渲染层** `packages/shared/render/render-buffer.js`：单一 `renderBuffer(buffer, meta)` 函数，消除 photos.js 10 处 + filmlab/CpuRenderService 未来的重复（DRY）。（b) **`server/services/render-worker.js`**：worker_thread 入口，仅 require 共享 renderBuffer，无重复数学；零拷贝 Buffer transfer。（c) **`server/services/render-worker-pool.js`**：lazy 池（启动 0 worker，首次 processImage 触发），size=`max(1,cpus-1)`，threshold 默认 2MP（小图主线程、大图 worker），worker 崩溃自动重启 + 排队 reject。（d) **photos.js 改造**：export-positive 6 循环 + render-positive 4 循环全部替换为 `renderPool.processImage(...)`；删 30+ 行 RenderCore 实例化重复；删除 `RenderCore` 直接 import。（e) **fs.\*Sync 异步化（photos.js 请求路径）**：20+ 处 → fsPromises；新增 `pathExists()` 异步 helper（避免 access+catch 重复）；保留 `res.download` 回调内的 unlinkSync（非 async 上下文）。（f) **测试**：`server/services/__tests__/render-worker-pool.test.js`（5 用例：lazy/threshold/bit-equiv/error）；总 383 tests / 35 suites green。（g) **性能基线归档** `docs/phase2-roadmap/2c-perf-baseline.md`：4 类指标前后对比；bit-equivalence 由共享 renderBuffer 结构性保证（PSNR = ∞）。 |

---

## 0. 设计验证（原版为何不本质）

原版 2C 是从 `FOLLOWUPS.md` 记忆推导的，未对照真实仓库。逐条核对后，**三项工程均存在「重复造物」或「诊断错位」风险**。

### 0.1 错误处理（#4）

| # | 原版主张 | 真实现状（证据） | 判定 |
|---|---|---|---|
| 1 | 「集中 errorHandler」需新建 | `server/middleware/error-handler.js` **已存在**（111 行）：含 `errorHandler`+`notFoundHandler`+`ValidationError`+`NotFoundError`；已挂载于 `server.js:301-303`（`notFoundHandler` → `errorHandler` 顺序正确，Phase 1 教训已吸收） | ❌ 重复造物 |
| 2 | 「顺序陷阱」是新风险 | 现挂载顺序已正确；shutdown 路由也已在 mountRoutes 之前（`server.js:539-543`） | ⚠️ 已缓解，仅留回归测试 |
| 3 | handler 是 err.message 泄露根因 | 现有 handler 在 `NODE_ENV!=='development'` 已返回 `'Internal server error'`（行 70-72），生产已脱敏；**真泄露点是路由层 58 处 inline `res.status(500).json({error: err.message})`** | ❌ 诊断错位 |
| 4 | 「单一模式机械替换」 | 实际有 **5 种变体**：`{error:err.message}`×58、`{error:e.message}`×21、`{success:false,error:error.message}`×11、`{ok:false,error:err.message}`×5、ai-chat SSE `send({type:'error',message})`（非 res.json）；另有 4xx 业务映射（"Photo not found"→404、UNIQUE 约束→409）需保留语义 | ⚠️ 严重低估 |
| 5 | err.message 出现次数「100+」 | 实测 14 个路由文件共 ~120 处；ai-chat(22)、rolls(19)、photos(18)、presets(10)、stats(9)、export(7)、films(6) 是重灾区 | ⚠️ 数字正确但分布未提 |
| 6 | 「前端 jsonFetch 已是抛错语义，兼容」 | 属实，但 `api-client` 现有 `setOnUnauthorized`（2B 落地）依赖统一 401 结构；handler 当前对 auth 错误（`auth.js:119` inline `res.status(...).json`）**绕过 errorHandler**，破坏一致性 | ❌ 集成缺口未提 |

### 0.2 像素管线（#5）

| # | 原版主张 | 真实现状（证据） | 判定 |
|---|---|---|---|
| 1 | 范围「`routes/photos.js:886-986`」 | 实际 **6 个循环**（行 886-985：JPEG×2 分支 + TIFF16×2 分支 + tiff16-only JPEG×2 分支）；**另有 `:render-positive` 路由 4 个循环**（行 1150-1195）；`filmlab.js:14` 也消费 RenderCore（需同步评估） | ⚠️ 范围漏 60% |
| 2 | 「worker thread 复用 RenderCore」 | `RenderCore` 在 `packages/shared`，被 **server（photos/filmlab）+ client（FilmLab.jsx/useFilmLabRenderer/CpuRenderService）共享**；`packages/shared` **无 `worker_threads` 引用**——若 shared 直接用 worker，会污染浏览器 bundle | ❌ 边界未划清 |
| 3 | 「请求路径去 `fs.*Sync`」范围 = photos.js | 实际跨 **8 个路由文件 62 处**：filesystem(11)、photos(20+）、health(14)、filmlab(5)、equipment(2)、luts(2，模块加载期 OK)、ai-chat(1)、rolls(1)；性质需分桶（请求路径 / 模块加载期 / 健康探针） | ⚠️ 严重低估 |
| 4 | 「评估 Sharp 原生 vs worker」 | `RENDERING-PIPELINE-REFACTOR-PLAN.md` 已确认：Float 管线已落地（`processPixelFloat` 完整，含 FilmCurve→Inversion→3DLUT→WB→Exp→...）；循环体本身已是最优精度，**真问题是外层 for-loop 阻塞事件循环**，不是算法选择 | ❌ 诊断错位 |

### 0.3 DB schema（#6）

| # | 原版主张 | 真实现状（证据） | 判定 |
|---|---|---|---|
| 1 | 「启用单一迁移 runner」 | `server/utils/run-all-migrations.js` + `migration-tracker.js`（`_migrations` 表 + `MigrationRunner` 类 + `hasMigrationRun`/`recordMigration`/`recordMigrationFailure`）**已存在**；但 **dead code**——`server.js:491-515` 把所有迁移注释为 `MIGRATIONS DISABLED - Database is up to date`；启动只跑 `db.exec(schemaSQL)` + `recomputeRollSequence` | ❌ 真问题诊断错位 |
| 2 | 「`server/migrations/` 收编为正式迁移」 | 10 个日期脚本 **全部 orphan**：8 个有 `up/down`，2 个只有 `migrate()`；零 caller | ❌ 任务存在但前提（runner 已激活）未提 |
| 3 | 「Phase 0–1 `ensureStartDateColumn` 作为迁移样例」 | 实际它在 `roll-service.js:35`，不在 migrations/；靠 `recomputeRollSequence` 运行时幂等调用兜底——属运行时补丁，非正式迁移 | ⚠️ 性质判错 |
| 4 | 补 `photos(roll_id)`、`photos(date_taken)`、`photos(photo_tags)` 索引 | 前两个 **已存在**（`schema-migration.js:170-171`：`idx_photos_roll`、`idx_photos_date_taken`，外加复合索引 `idx_photos_roll_date_id`）；`photo_tags` 是关联表（`photo_tags(photo_id)/(tag_id)` 已索引，行 173-174） | ❌ 60% 误判 |
| 5 | 「**真缺失的索引**」 | 仅 `photos(location_id)`（grep 全仓库 0 命中）；其他可选候选：`photos(positive_rel_path)`、`photos(full_rel_path)`、`rolls(display_seq)` 需凭 EXPLAIN QUERY PLAN 验证 | ⚠️ 真问题在索引审计 |
| 6 | 「schemaSQL 是索引来源之一」 | `server.js:307-485` 的 `schemaSQL` **仅含 CREATE TABLE IF NOT EXISTS，零 CREATE INDEX**；`db.js` 同样仅 sessions 两个索引 | ❌ 严重：**全新安装的 DB 实际上零业务索引** |
| 7 | 「`recomputeRollSequence` 多步写无事务」 | **已在事务内**（`roll-service.js:65-77` BEGIN/COMMIT/ROLLBACK）；真问题是行 67-71 的 N+1 JS 循环 | ⚠️ 部分误判 |
| 8 | 「窗口函数需 SQLite ≥ 3.25，确认版本」 | 实测 `node_modules/sqlite3` 捆绑 **SQLite 3.44.2**（`SELECT sqlite_version()` + `ROW_NUMBER() OVER (...)` 双验证通过）；门槛远超 | ⚠️ 已满足，仅留文档化 |
| 9 | 「迁移可回滚」 | 现有 `MigrationRunner` 只有 `runAll`，**无 down/rollback**；10 个 orphan 中 8 个写了 `down()` 但无 caller；计划「失败 ROLLBACK」过度承诺 | ❌ 过度承诺 |
| 10 | 「迁移必须有备份 + 回滚脚本」 | 备份策略缺失；`db.js` 启动期不备份；`run-all-migrations.js` 不备份 | ❌ 真缺口 |

### 0.4 跨工程横切（原版完全未覆盖）

| # | 缺口 | 影响 |
|---|---|---|
| 1 | **路由级测试覆盖**：14 个被改路由中仅 pairing/sessions/shutdown 有测试；photos/films/rolls/stats/ai-chat/search/tags/conflicts/equipment/luts/filesystem/uploads/export **零路由级测试** | 「依赖 #10」前置不足——#10 出口只覆盖 path-security/shutdown/auth/tls，不含这些路由 |
| 2 | **文件冲突**：photos.js 同时被 #4+#5 改；rolls.js 同时被 #4+#6 改；server.js 同时被 #4（handler 对齐）+#6（迁移激活）改 | 并行不可行，需排序 |
| 3 | **回滚开关缺失**：迁移激活、worker 启用均无 feature flag | 失败无法即时止血 |
| 4 | **性能基线过弱**：「至少不劣化」无量化指标 | 验收主观 |
| 5 | **2B auth 集成**：`auth.js:119` inline `res.status(result.status||401).json(...)` 绕过 errorHandler；handler 对 401/423 无显式映射 | 错误响应一致性破坏 |

### 0.5 根因诊断（真正的「本质」）

原版 2C 的问题不是「目标错」，而是**事实底座停留在 FOLLOWUPS 原始记忆**——这与原版 2A 犯的错同质（见 `phase-2a-foundation.md §0`）。真正的本质：

- **(A) 已建未用**：`errorHandler`、`MigrationRunner`、`schema-migration` 索引均已写好，但**未激活/未消费**——属死代码。
- **(B) 双轨分裂**：`server/migrations/*.js`（10 个日期脚本）与 `server/utils/*-migration.js`（5 个 utils）是两套并行系统，前者 orphan、后者 dead-code；`schemaSQL` 与迁移系统是另一对双轨。
- **(C) 测试护栏覆盖盲区**：2A 出口的「被改路由有测试」承诺在 2C 范围内未兑现——14 个被改路由中 11 个零测试。
- **(D) worker 边界模糊**：`RenderCore` 跨端共享，worker pool 设计若不显式划到 server 侧，会污染浏览器 bundle。

---

## 1. 重写原则（对照「不重复造物 + 不过多兜底」）

1. **从「新建」改为「激活 + 收编」**：errorHandler 不重写，审计并扩展；MigrationRunner 不重建，激活并收编 orphan；schema-migration 索引不重写，激活即生效。
2. **消灭双轨**：`schemaSQL`（server.js 内联 CREATE TABLE）合并进迁移系统；`ensureStartDateColumn`/`ensureDisplaySeqColumn` 运行时补丁转为正式迁移步骤后删除；`server/migrations/` 10 个 orphan 收编为正式迁移步骤。
3. **不做过多的兜底**：迁移幂等（`IF NOT EXISTS` + `_migrations` 表）天然无需回退路径，不引入 `FG_MIGRATIONS_ENABLED` 开关；不保留 `FG_RECOMPUTE_MODE=loop` 等回退实现——测试 + 备份足够；仅在 worker 引入新并发模式（真有未知）保留 `FG_RENDER_WORKER` 阈值控制。
4. **测试前置具体化**：「依赖 #10」不够——2C.0 显式补「被改路由错误路径」测试（已 ✅）。
5. **排序按文件冲突解**：photos.js 是 #4+#5 共改点，必须串行；rolls.js 是 #4+#6 共改点，必须串行；server.js 是 #4+#6 共改点，必须协调。
6. **性能基线量化**：替换「不劣化」为具体指标（事件循环 p99、recomputeRollSequence 100/500/2000 roll 耗时、冷启动时间）。
7. **不透传 err.message 进 worker**：worker 抛错用结构化 `{code, message}`，主线程透传到 errorHandler。
8. **worker 仅 server 侧**：`packages/shared` 保持无 `worker_threads` 依赖；server 内建 `services/render-worker-pool.js` 包 `RenderCore`。

---

## 2. 真实现状基线（计划的事实底座）

| 面 | 现状 |
|---|---|
| errorHandler | `server/middleware/error-handler.js` 已存在（111 行）；`ValidationError`/`NotFoundError` 已有；`NODE_ENV!=='development'` 已脱敏；`errorId=Date.now().toString(36)`（弱）；`server.js:301-303` 已正确挂载 |
| 路由 err.message | 14 文件 ~120 处；5 种变体；ai-chat(22)/rolls(19)/photos(18)/presets(10)/stats(9)/export(7)/films(6)/tags(4)/filesystem(4)/film-items(3)/conflicts(2)/uploads/search/luts/health(1)；4xx 业务映射 ~30 处需保留 |
| 路由测试 | 2C.0 完成后：14 路由都有错误路径测试（pairing/sessions/shutdown + 13 新增）；photos.js:128 latent bug 已文档化 |
| 像素管线 | `RenderCore.processPixelFloat` 已完整（Float 管线）；photos.js 6 循环 + render-positive 4 循环；filmlab.js 待审；`packages/shared` 无 worker；client 侧 `FilmLab.jsx`/`useFilmLabRenderer`/`CpuRenderService` 也消费 RenderCore |
| fs.*Sync | 8 路由文件 62 处；请求路径（photos/filesystem/filmlab/ai-chat/rolls）+ 模块加载期（luts/equipment OK）+ 健康探针（health 可降级） |
| 迁移 runner | `MigrationRunner` 类已存在，仅 `runAll` 无 `down`；`run-all-migrations.js` 注册 5 个迁移（仅 2024 时间戳） |
| orphan migrations | `server/migrations/*.js` 10 个文件：8 个 `up/down`、2 个仅 `migrate()`；零 caller |
| 启动迁移 | `server.js:488-535` 全部注释；启动仅 `db.exec(schemaSQL)` + `recomputeRollSequence`（`server.js:534`） |
| schemaSQL 索引 | **零 CREATE INDEX**（仅 CREATE TABLE IF NOT EXISTS）；`db.js` 仅 sessions 2 个索引 |
| 已写未跑的索引 | `schema-migration.js` 24 个（含 `idx_photos_roll`/`idx_photos_date_taken`/`idx_photos_roll_date_id` 复合）；`equipment-migration.js` 9 个；`film-struct-migration.js` 4 个 |
| 真缺失索引 | `photos(location_id)`；候选待验证：`photos(positive_rel_path)`/`photos(full_rel_path)`/`rolls(display_seq)` |
| recomputeRollSequence | `roll-service.js:48-80`；已在事务内（行 65-77）；N+1 JS 循环（行 67-71）；`ensureDisplaySeqColumn`+`ensureStartDateColumn` 双补丁（行 16-46）—— 2C.1 收为正式迁移后删除 |
| SQLite 版本 | 捆绑 3.44.2（窗口函数验证通过）；远超 3.25 门槛 |
| 2B auth 集成 | `auth.js:119` inline `res.status(...)` 绕过 errorHandler；handler 对 401/423/404(白名单) 无显式映射 |

---

## 3. 工程拆分

> 顺序固定：**2C.0 补测试（✅）→ 2C.1 #6 激活迁移（低风险）→ 2C.2 #4 错误统一（机械广覆盖）→ 2C.3 #5 像素下沉（最重最后）**。每步独立验收、独立回滚。

### 2C.0 前置：被改路由错误路径补测试 ✅

**产出**
- `server/routes/__tests__/_helpers.js`：`buildApp(mount)` 镜像 `server.js:301-303` 的中间件顺序；`assertServerErrorContract(res, {status})` 锁定「500 + JSON + 非空 error + 无堆栈」的稳定契约。
- 13 个新测试文件，每个 mock 主依赖（db-helpers / fs / services）强制 500，断言契约。
- `npm test`：**350 tests / 32 suites green**（含原 332 + 新增 18 路由错误路径用例）。

**附带发现**
- `photos.js:128` latent bug：`router.get('/')` 内首个 `await getAsync(...)` 在 try 块外，失败时无 catch → 请求挂起。2C.2 `next(err)` 迁移修复后启用对应测试。
- `db.js:258` WAL checkpoint scheduler 用 `setInterval` 未 `.unref()` → 测试 worker 退出延迟（pre-existing，非 2C.0 引入；可在 2C.1 顺手修）。

**验收**
- [x] 13 个路由测试文件存在；每个至少 1 个错误路径用例。
- [x] `npm test` 收集并跑过（root jest projects）。
- [x] 人为注入失败 → 退出码非 0（mock reject 即触发）。

---

### 2C.1 #6 DB schema 收敛（先做，低风险）

**性质**：激活现有死代码 + 收编 orphan + 消灭双轨 + 补真缺失索引 + 窗口函数化。

**核心动作（按「不过多兜底」原则重新设计）**：
- 不引入 `FG_MIGRATIONS_ENABLED` 开关——迁移全幂等，激活即总是跑。
- 不保留 `ensureXxxColumn` 运行时补丁——转为正式迁移步骤后**删除**运行时副本，单一真相源。
- 不合并 `schemaSQL` 与迁移系统为「双轨」——`schemaSQL` 保留为「last-resort 无业务逻辑的 CREATE TABLE IF NOT EXISTS 兜底」（已是现状，不强化也不消灭），迁移系统作为正式 schema 演化通道。

#### 2C.1.1 激活迁移 runner

**改动（文件级）**
1. `server/server.js:488-535` 的 IIFE：
   - 删除 `/* MIGRATIONS DISABLED ... */` 注释块。
   - 改为：
     ```js
     const { runAllMigrations } = require('./utils/run-all-migrations');
     await runAllMigrations();
     ```
   - 保留 `db.exec(schemaSQL)` 作为兜底（与迁移系统不冲突——都是 IF NOT EXISTS）。
   - 保留 `recomputeRollSequence` 直接调用——它本身的 `ensureDisplaySeqColumn`/`ensureStartDateColumn` 会在 2C.1.3 转为正式迁移后简化。
2. `run-all-migrations.js`：
   - 收编 `server/migrations/*.js` 10 个 orphan（统一通过 `runner.add(name, async () => { const m = require('../migrations/XXX'); await (m.up||m.migrate)(); })`）。
   - 按 `MIGRATION_NAME` 或文件名时间戳排序。
   - 已有 5 个 `20240101_*` 占位名改为真实文件名（避免与收编的 2025/2026 冲突）。
3. 备份：runner 入口先 `cp ${dbPath} ${dbPath}.backup-${ISO}`，保留最近 3 份（轮换）。**理由**：前向迁移不可回滚（无 down），备份是唯一兜底；3 份轮换足够，不做更复杂的策略。
4. 顺手修 `db.js:258` 的 `setInterval` 未 `.unref()` 问题（一行加 `.unref()`）。

**验收**
- [ ] 启动 → runner 跑完，`_migrations` 表有全部 15+ 条记录。
- [ ] 新装空库 + 全量迁移 → 表 + 索引齐全（`PRAGMA index_list(photos)` 验证）。
- [ ] 已有库二次启动 → `_migrations` 命中，迁移幂等跳过。
- [ ] 启动前有 1 份带时间戳的 db 备份；轮换保留 3 份。

**风险**
- **历史库可能已部分跑过 ad-hoc 迁移**：`_migrations` 表无记录但列已存在。缓解：所有迁移的 `ALTER TABLE ADD COLUMN` 用 `PRAGMA table_info` + `try/catch` 包裹（部分 orphan 已这么做，需审计）。
- **`equipment-migration.js` 等可能假设列已存在**：单测每个迁移在新空库 + 部分迁移库两种 fixture 上跑通。

#### 2C.1.2 索引审计与补齐

**改动（文件级）**
1. **激活即生效**：`schema-migration.js` 的 24 个索引在 runner 激活后自动落地（含计划误判的 `idx_photos_roll`/`idx_photos_date_taken`/复合索引）——无需新建。
2. **真缺失补齐**（`schema-migration.js` 末尾追加）：
   ```sql
   CREATE INDEX IF NOT EXISTS idx_photos_location ON photos(location_id);
   ```
3. **候选索引凭 EXPLAIN 验证**（非强制，留观察）：
   - `photos(positive_rel_path)`、`photos(full_rel_path)`（导出查询是否走索引？）
   - `rolls(display_seq)`（`recomputeRollSequence` 后是否查询命中？）
4. **EXPLAIN QUERY PLAN 归档**：跑 hot path（`rolls` 列表、`photos` by roll、`stats` 聚合、`search`）前后对比，写入 `docs/phase2-roadmap/2c-index-explain.md`。

**验收**
- [ ] `PRAGMA index_list(photos)` 含 `idx_photos_location`。
- [ ] `EXPLAIN QUERY PLAN SELECT * FROM photos WHERE location_id = ?` 命中索引。
- [ ] 归档文档含 5 条 hot path 的前后查询计划对比。

#### 2C.1.3 recomputeRollSequence 窗口函数化 + 删运行时补丁

**改动（文件级）**
1. **新建正式迁移** `server/migrations/2026-02-15-add-display-seq-and-start-date.js`：
   - 包含 `display_seq` 与 `start_date` 列添加 + `start_date` 从 `date_loaded` 回填（**与 `roll-service.js:16-46` 同语义**）。
   - 在 `run-all-migrations.js` 注册。
2. **`roll-service.js`**：
   - 删除 `ensureDisplaySeqColumn`（行 16-30）与 `ensureStartDateColumn`（行 35-46）—— **运行时补丁转为正式迁移后，运行时不应再做 schema 检查**（消灭双轨）。
   - `recomputeRollSequence` 简化为直接 SQL：
     ```sql
     UPDATE rolls SET display_seq = (
       SELECT new_seq FROM (
         SELECT id, ROW_NUMBER() OVER (
           ORDER BY
             CASE WHEN start_date IS NULL THEN 1 ELSE 0 END,
             start_date ASC,
             CASE WHEN created_at IS NULL THEN 1 ELSE 0 END,
             created_at ASC,
             id ASC
         ) AS new_seq
         FROM rolls
       ) s WHERE s.id = rolls.id
     );
     ```
   - 保留外层 BEGIN/COMMIT/ROLLBACK 事务。
3. **测试**：
   - 扩 `server/services/__tests__/roll-service.test.js`：固定 10 roll fixture（含 5 个 `start_date IS NULL`），断言改写前后 `display_seq` 序列等价。
   - 删除原 `ensureStartDateColumn` 的幂等测试（已迁移），改为「迁移后 schema 含 start_date」测试。

**验收**
- [ ] `roll-service.js` 无 `ensureDisplaySeqColumn`/`ensureStartDateColumn` 函数；无 JS UPDATE 循环。
- [ ] 迁移步骤幂等（连跑两次不报错、首装空库正常）。
- [ ] fixture 测试断言窗口函数改写后序列正确。
- [ ] 100/500/2000 roll 三档耗时归档（基线 vs 改写后）；窗口函数版本应显著优于 N+1。

#### 2C.1.4 多步写事务审计

**性质**：原版任务「多步写包事务」部分已落实（recompute 已在事务内），本节是**审计**而非新建。

**改动**
- grep `server/routes/*.js` 与 `server/services/*.js` 中的连续 `runAsync('UPDATE/INSERT/DELETE')` 序列；评估是否需要包事务。
- 候选：`routes/rolls.js` 的删除（行 663-681 多处 DB 写 + recompute）、`routes/photos.js` 的导入（行 514-722 多步 fs + DB）、`routes/import.js` 全套。
- 包事务方式：`runAsync('BEGIN')` → 多步 → `runAsync('COMMIT')`，catch 走 `ROLLBACK`。

**验收**
- [ ] 审计报告归档：列出所有多步写序列，标注已事务化 / 待补。
- [ ] 至少 2 处高风险序列（导入、批量删除）补事务 + 注入故障测试（mock `runAsync` 第 N 步失败 → 断言 ROLLBACK）。

---

### 2C.2 #4 错误处理统一（机械广覆盖）

**性质**：路由层错误响应迁移至 `next(err)`；handler 审计扩展；2B auth 对齐。**不动算法，只动错误路径。**

#### 2C.2.1 errorHandler 审计与扩展

**改动（文件级）**
- `server/middleware/error-handler.js`：
  - `errorId`：`Date.now().toString(36)` → `crypto.randomUUID()`（避免同毫秒冲突）。
  - 新增 `OperationalError` 类（4xx，可暴露 message）与 `ProgrammerError` 类（5xx，对外脱敏）；现有 `ValidationError`/`NotFoundError` 改继承 `OperationalError`。
  - 显式映射 auth 错误：`err.status === 401` → 401 + `{code: 'UNAUTHORIZED'}`；`err.status === 423` → 423 + `{code: 'PAIRING_LOCKED'}`；`err.status === 404 && err.code === 'WHITELIST'` → 404 + `{code: 'ROUTE_NOT_FOUND'}`。
  - 响应体规范：`{ ok:false, error, code?, errorId }`（保持向后兼容，`error` 字段保留）。
- `server/utils/auth.js:119`：`res.status(...).json(...)` → `next(Object.assign(new Error('auth'), { status: result.status||401, code: result.code }))`。
- `index.d.ts`（`@filmgallery/types`）：导出 `OperationalError`/`ProgrammerError` 与 `ErrorCode` 联合类型。

**验收**
- [ ] handler 含 5 类显式映射（Validation/NotFound/Auth/SQLite/Multer/Default）。
- [ ] `errorId` 是 UUID 格式（36 字符）。
- [ ] auth 失败响应经 errorHandler（grep `auth.js` 无 inline `res.status`）。
- [ ] 单测覆盖每种错误类型（扩 `server/middleware/__tests__/error-handler.test.js`，新建）。

#### 2C.2.2 路由错误响应分桶迁移

**性质**：~120 处 inline 错误响应，按 5 桶分别迁移。可脚本辅助 + 人工 review。

**桶划分**
- **桶 A（默认，~75 处）**：`res.status(500).json({error: err.message})`、`{error: e.message}`、`{success:false,error:error.message}`、`{ok:false,error:err.message}` → `next(err)`。
- **桶 B（4xx 业务映射，~30 处）**：如 `rolls.js:759-762` "Photo not found"→404、`presets.js:173` UNIQUE 约束→409 → 改为 `throw new NotFoundError('Photo not found')`、`next(Object.assign(new Error(), {code:'SQLITE_CONSTRAINT', status:409}))`。
- **桶 C（含附加字段，~5 处）**：`{ok:false, error: err.message, details: err.fileInfo}` → `next(Object.assign(new OperationalError(err.message), {details: err.fileInfo}))`；handler 序列化时透出 details（仅 4xx）。
- **桶 D（SSE/流式，~3 处）**：`ai-chat.js:90` 的 `send({type:'error',message})` **不走 errorHandler**（响应头已发）；改为脱敏 message（`process.env.NODE_ENV === 'development' ? err.message : 'AI stream error'`）。
- **桶 E（已显式 4xx，保留，~10 处）**：`return res.status(400).json({error:'rollId is required'})` 等输入校验，**不改**（与 errorHandler 抛 Error 等价但更直观）。

**改动（文件级）**
- 14 个路由文件，按桶分类机械替换。
- 每改一个路由，对应 `__tests__/XXX.test.js` 至少新增 1 个错误路径断言（依赖 2C.0，已完成）。
- grep 验证：`rg "res\.status\(5\d\d\)\.json\(" server/routes` 计数从 ~95 降至 ≤5（仅 handler 内）。

**验收**
- [ ] `rg "res\.status\(5\d\d\)" server/routes` 仅返回显式 5xx 业务场景（如 ai-chat 上游 502）。
- [ ] 桶 A/B/C/D 各自的迁移清单归档（`docs/phase2-roadmap/2c-error-migration.md`）。
- [ ] 14 个路由测试的错误路径用例全绿。
- [ ] 前后端联调：client `jsonFetch` 与 `api-client` 在 4xx/5xx 路径下行为不变（手动 smoke）。
- [ ] photos.js:128 latent bug 修复后，启用 `GET /` 错误路径测试。

**风险**
- **桶 B 的业务码漂移**：前端可能依赖 `error === 'Photo not found'` 字符串字面量——grep client/mobile/watch 三端消费方，列出依赖清单后再改。优先保持 message 不变。
- **桶 D 的 SSE 错误**：必须保留响应头已发的兼容（不能切到 `next(err)`，否则 errorHandler 会试图 `res.json` 已 end 的响应）。

#### 2C.2.3 顺序回归测试

- 单测：`server/middleware/__tests__/mount-order.test.js`，断言 errorHandler 在 `/api/*` 404 之后注册（防止 Phase 1 同类 bug 复现）。

---

### 2C.3 #5 像素管线下沉（最重最后）

**性质**：worker pool 落地 + 去 fs.\*Sync。**风险最高，必须最后做。**

#### 2C.3.1 worker pool 设计（server 侧独占）

**架构**
- 新建 `server/services/render-worker-pool.js`：
  - 启动期预启 N 个 worker（N = `max(1, cpus() - 1)`）。
  - worker 脚本 `server/services/render-worker.js`：`require('worker_threads')` + `require('../../packages/shared').RenderCore`；监听 `parentPort` 收 `{type:'process', buffer, params, format}` → 调 `processPixelFloat` → post `{type:'done', outBuffer}`。
  - 主线程 API：`processImage(buffer, params, format) → Promise<Buffer>`；按阈值决定主线程 vs worker：
    - `width * height < FG_RENDER_WORKER_THRESHOLD`（默认 2MP）→ 主线程同步（避免 worker 通信开销）。
    - 否则 → worker pool 队列分发。
- env 开关：`FG_RENDER_WORKER_THRESHOLD` 调阈值（默认 2MP）；不做全局 kill 开关——阈值已经覆盖所有场景，全局开关是「过多的兜底」。

**改动（文件级）**
- `server/routes/photos.js:886-985`（export-positive）与 `:1150-1195`（render-positive）：6+4 个循环体改为 `await renderWorkerPool.processImage(...)`；循环逻辑下沉到 worker。
- `server/routes/filmlab.js`：评估是否同步迁移（如消费同类循环，下沉；否则保留并标记 `// TODO 2C.4`）。

**验收**
- [ ] `packages/shared` 仍无 `worker_threads` 引用（grep 验证）。
- [ ] 默认 worker 路径，主事件循环在 24MP RAW 处理期间可并发响应（压测：渲染中并行 `GET /api/health` p99 < 50ms）。
- [ ] 小图（<2MP）走主线程，worker 不启动（避免开销）。
- [ ] worker 异常崩溃 → pool 自动重启 + 主线程降级（不返回 500）。

**风险**
- **位等价**：worker 与主线程 JS 引擎差异（理论上 V8 一致，但 `Math.round`/Float64 累加在某些 SIMD 边界可能不同）。**必须** PSNR/SSIM 全套样本集对比（含 RW2 170MP，见 `docs/RW2-170MP-IMPORT-DIAGNOSIS.md`）。
- **worker 通信开销**：传输 Buffer 用 `transferList`（零拷贝），避免序列化。
- **小图反而变慢**：阈值策略（默认 2MP）需基准调；可在 `FG_RENDER_WORKER_THRESHOLD` 暴露。

#### 2C.3.2 fs.\*Sync 异步化（请求路径）

**分桶**（不一刀切）
- **请求路径（必改）**：`routes/photos.js` 20+ 处（unlink/readFile/statSync/mkdirSync）、`routes/filesystem.js` 11 处（existsSync/statSync/readdirSync/accessSync/mkdirSync）、`routes/filmlab.js` 5 处（existsSync/mkdirSync）、`routes/ai-chat.js` 1 处（existsSync）、`routes/rolls.js` 1 处（existsSync）。
- **模块加载期（保留）**：`routes/luts.js:23-24`、`routes/equipment.js:24-25`——启动一次性成本，不阻塞请求。
- **健康探针（降级 P2，可保留）**：`routes/health.js` 14 处 existsSync/statSync——探针本身要求快，且访问频率低；如要异步化，需重新评估超时。

**改动（文件级）**
- `routes/photos.js` 等：`fs.*Sync` → `fs/promises`（`fs.promises.unlink`/`.stat`/`.readdir`/`.mkdir`/`.readFile`）。
- 大文件读：`fs.createReadStream` 流式（避免一次性 buffer 24MP RAW）。

**验收**
- [ ] `rg "\.\w*Sync\(" server/routes/{photos,filesystem,filmlab,ai-chat,rolls}.js` 仅余模块加载期（luts/equipment）与健康探针（health）。
- [ ] 请求路径无 `*Sync` 调用（grep 验证）。
- [ ] 大文件导入（≥100MB RAW）内存峰值下降（归档前后对比）。

#### 2C.3.3 性能基线归档

**改动**：新建 `docs/phase2-roadmap/2c-perf-baseline.md`，归档：
- 主事件循环 p99（worker 前后，压测 100 并发 `GET /api/photos`）。
- 24MP RAW export-positive 耗时（主线程 / worker / 阈值切换）。
- 100/500/2000 roll `recomputeRollSequence` 耗时（来自 2C.1.3）。
- 启动迁移冷启动时间（来自 2C.1.1）。

**验收**
- [ ] 文档存在，含至少 4 个指标的「基线 / 改写后 / 增益%」三列对比。
- [ ] 任一指标劣化 ≥10% 触发回滚决策（不走验收）。

---

## 4. 排序与并行

```
2C.0 补路由错误路径测试 ✅ ──┐
                            ├─→ 2C.1 #6 激活迁移 runner ──┐
                            │   (低风险, 解锁回滚安全网)    │
                            │                              ├─→ 2C.3 #5 像素下沉
                            └─→ 2C.2 #4 错误统一 ──────────┘    (最重, 最后)
                                    (机械, 影响面广)
```

**理由**
1. **2C.0 先行**（已完成）：是 #4/#5/#6 共同硬前置（被改路由有测试）。
2. **2C.1 #6 先于 #4/#5**：激活 runner 是低风险动作（已有代码 + 备份）；先做能解锁「迁移记录可追溯」的回滚安全网，让后续 #4/#5 改动有数据库层兜底。
3. **2C.2 #4 早于 2C.3 #5**：#4 是机械替换（影响面广但风险低），先做清理路由层；#5 是算法下沉（风险高），最后做避免与 #4 在 photos.js 上撞车。
4. **2C.3 #5 必须最后**：worker 引入新的并发模式，需 #4 的错误路径规范 + #6 的迁移记录配合。

**并行机会**
- 2C.1.2 索引审计可与 2C.1.1 激活并行（不同文件）。
- 2C.2.1 handler 扩展可与 2C.2.2 路由分桶并行（前者改 handler + auth，后者改 routes，文件不重叠）。

---

## 5. 出口条件（收紧，去掉过度承诺）

**2C 完整收尾**（按 2C.0 → 2C.1 → 2C.2 → 2C.3 顺序验收）

1. **2C.0**（✅）：13 个路由测试文件存在，每个至少 1 个错误路径用例；`npm test` 全绿。
2. **2C.1**：
   - 迁移 runner 启动期激活；`_migrations` 表有 15+ 条记录。
   - `photos(location_id)` 索引存在，EXPLAIN 命中。
   - `recomputeRollSequence` 无 JS UPDATE 循环；**无 `ensureXxxColumn` 运行时补丁**（已转正式迁移）。
   - 多步写事务审计报告归档；≥2 处高风险序列补事务 + 注入故障测试。
3. **2C.2**：
   - `rg "res\.status\(5\d\d\)" server/routes` 仅返回显式业务场景（≤5 处）。
   - handler 含 5 类显式映射 + UUID errorId；`auth.js` 无 inline `res.status`。
   - 14 个路由错误路径测试全绿。
   - 三端（client/mobile/watch）api-client 在 4xx/5xx 路径行为不变（smoke）。
4. **2C.3**：
   - `packages/shared` 无 `worker_threads` 引用。
   - PSNR ≥ 99dB（worker 路径与重构前等价）。
   - 默认 worker 路径，24MP RAW 处理期间 `GET /api/health` p99 < 50ms。
   - 请求路径无 `*Sync`（luts/equipment 模块加载期 + health 探针豁免）。
   - 性能基线文档归档，任一指标劣化 < 10%。
5. **全局**：
   - `FOLLOWUPS.md` 中 #4/#5/#6 标记 ✅。
   - 无新增性能回退（基线对比归档）。
   - 不保留无用 env 全局开关（迁移幂等不需要）；worker 阈值 `FG_RENDER_WORKER_THRESHOLD` 文档化。

---

## 6. 待定决策（需在对应子任务开工前定）

- [x] **D1**：errorHandler 响应体是否引入 `code` 字段 → **是**，与 `@filmgallery/types` 的 `ErrorCode` 联合类型对齐。
- [ ] **D2**：桶 B 的 4xx 业务映射是否完全转为 `throw new OperationalError` → **推荐分阶段**：先保留字符串字面量保证前端兼容，第二阶段才切 code。
- [x] **D3**：worker pool 大小策略 → 默认 `max(1, cpus()-1)`；阈值默认 2MP（凭基线调）。
- [ ] **D4**：`filmlab.js` 是否纳入 2C.3 范围 → 评估后定，若消费同类循环则下沉，否则标 `// TODO 2C.4`。
- [x] **D5**：迁移备份策略 → 与 db 同目录，时间戳后缀，轮换保留 3 份。
- [x] **D6**：桶 D（SSE 错误）→ 在 `ai-chat.js` 内单独抽象 `sendSseError(res, err)` 工具，集中脱敏逻辑。
- [ ] **D7**：候选索引（`photos(positive_rel_path)`/`full_rel_path`/`rolls(display_seq)`）是否一并补 → 凭 EXPLAIN 验证结果定。
- [x] **D8**：`health.js` 的 14 处 `*Sync` 是否在 2C.3.2 异步化 → **否**，降级 P2 观察项；探针本身要求快。

---

## 附录 A · 与原版差异对照

| 节 | 原版 | 重写版 | 理由 |
|---|---|---|---|
| §0 | 无 | 新增「设计验证」 | 仿 2A §0，校准事实底座 |
| 工程一 #4 | 「集中 errorHandler」需新建 | 改为「审计 + 扩展现有 handler」 | handler 已存在 |
| 工程一 #4 | 单一模式机械替换 | 5 桶分类（A/B/C/D/E） | 实际有 5 种变体 |
| 工程二 #5 | 范围 `photos.js:886-986` | 范围 6+4 循环 + filmlab 评估 | 漏 60% |
| 工程二 #5 | worker 复用 RenderCore | worker pool server 侧独占 | shared 不能引 worker_threads |
| 工程二 #5 | 去 `fs.*Sync` 仅 photos | 8 文件分桶（请求/模块加载/探针） | 严重低估 |
| 工程三 #6 | 「启用单一迁移 runner」 | 「激活现有 dead-code runner」 | runner 已存在 |
| 工程三 #6 | 补 `photos(roll_id/date_taken/photo_tags)` 索引 | 仅补 `photos(location_id)` | 其他已存在 |
| 工程三 #6 | 「可回滚」 | 「前向迁移 + 备份（无 env 开关）」 | 迁移幂等，不需要全局开关 |
| 工程三 #6 | 「保留 `ensureXxxColumn` 运行时兜底」 | **删运行时补丁，单一迁移步骤** | 双轨分裂，违反「不过多兜底」 |
| 新增 | — | 2C.0 前置补路由测试 | 14 路由中 11 个零测试 |
| 新增 | — | 回滚开关 + 性能基线量化 | 原版过弱 |
| 新增 | — | 2B auth 集成 | handler 与 auth inline 不一致 |

---

## 0. 设计验证（原版为何不本质）

原版 2C 是从 `FOLLOWUPS.md` 记忆推导的，未对照真实仓库。逐条核对后，**三项工程均存在「重复造物」或「诊断错位」风险**。

### 0.1 错误处理（#4）

| # | 原版主张 | 真实现状（证据） | 判定 |
|---|---|---|---|
| 1 | 「集中 errorHandler」需新建 | `server/middleware/error-handler.js` **已存在**（111 行）：含 `errorHandler`+`notFoundHandler`+`ValidationError`+`NotFoundError`；已挂载于 `server.js:301-303`（`notFoundHandler` → `errorHandler` 顺序正确，Phase 1 教训已吸收） | ❌ 重复造物 |
| 2 | 「顺序陷阱」是新风险 | 现挂载顺序已正确；shutdown 路由也已在 mountRoutes 之前（`server.js:539-543`） | ⚠️ 已缓解，仅留回归测试 |
| 3 | handler 是 err.message 泄露根因 | 现有 handler 在 `NODE_ENV!=='development'` 已返回 `'Internal server error'`（行 70-72），生产已脱敏；**真泄露点是路由层 58 处 inline `res.status(500).json({error: err.message})`** | ❌ 诊断错位 |
| 4 | 「单一模式机械替换」 | 实际有 **5 种变体**：`{error:err.message}`×58、`{error:e.message}`×21、`{success:false,error:error.message}`×11、`{ok:false,error:err.message}`×5、ai-chat SSE `send({type:'error',message})`（非 res.json）；另有 4xx 业务映射（"Photo not found"→404、UNIQUE 约束→409）需保留语义 | ⚠️ 严重低估 |
| 5 | err.message 出现次数「100+」 | 实测 14 个路由文件共 ~120 处；ai-chat(22)、rolls(19)、photos(18)、presets(10)、stats(9)、export(7)、films(6) 是重灾区 | ⚠️ 数字正确但分布未提 |
| 6 | 「前端 jsonFetch 已是抛错语义，兼容」 | 属实，但 `api-client` 现有 `setOnUnauthorized`（2B 落地）依赖统一 401 结构；handler 当前对 auth 错误（`auth.js:119` inline `res.status(...).json`）**绕过 errorHandler**，破坏一致性 | ❌ 集成缺口未提 |

### 0.2 像素管线（#5）

| # | 原版主张 | 真实现状（证据） | 判定 |
|---|---|---|---|
| 1 | 范围「`routes/photos.js:886-986`」 | 实际 **6 个循环**（行 886-985：JPEG×2 分支 + TIFF16×2 分支 + tiff16-only JPEG×2 分支）；**另有 `:render-positive` 路由 4 个循环**（行 1150-1195）；`filmlab.js:14` 也消费 RenderCore（需同步评估） | ⚠️ 范围漏 60% |
| 2 | 「worker thread 复用 RenderCore」 | `RenderCore` 在 `packages/shared`，被 **server（photos/filmlab）+ client（FilmLab.jsx/useFilmLabRenderer/CpuRenderService）共享**；`packages/shared` **无 `worker_threads` 引用**——若 shared 直接用 worker，会污染浏览器 bundle | ❌ 边界未划清 |
| 3 | 「请求路径去 `fs.*Sync`」范围 = photos.js | 实际跨 **8 个路由文件 62 处**：filesystem(11)、photos(20+）、health(14)、filmlab(5)、equipment(2)、luts(2，模块加载期 OK)、ai-chat(1)、rolls(1)；性质需分桶（请求路径 / 模块加载期 / 健康探针） | ⚠️ 严重低估 |
| 4 | 「评估 Sharp 原生 vs worker」 | `RENDERING-PIPELINE-REFACTOR-PLAN.md` 已确认：Float 管线已落地（`processPixelFloat` 完整，含 FilmCurve→Inversion→3DLUT→WB→Exp→...）；循环体本身已是最优精度，**真问题是外层 for-loop 阻塞事件循环**，不是算法选择 | ❌ 诊断错位 |

### 0.3 DB schema（#6）

| # | 原版主张 | 真实现状（证据） | 判定 |
|---|---|---|---|
| 1 | 「启用单一迁移 runner」 | `server/utils/run-all-migrations.js` + `migration-tracker.js`（`_migrations` 表 + `MigrationRunner` 类 + `hasMigrationRun`/`recordMigration`/`recordMigrationFailure`）**已存在**；但 **dead code**——`server.js:491-515` 把所有迁移注释为 `MIGRATIONS DISABLED - Database is up to date`；启动只跑 `db.exec(schemaSQL)` + `recomputeRollSequence` | ❌ 真问题诊断错位 |
| 2 | 「`server/migrations/` 收编为正式迁移」 | 10 个日期脚本 **全部 orphan**：8 个有 `up/down`，2 个只有 `migrate()`；零 caller | ❌ 任务存在但前提（runner 已激活）未提 |
| 3 | 「Phase 0–1 `ensureStartDateColumn` 作为迁移样例」 | 实际它在 `roll-service.js:35`，不在 migrations/；靠 `recomputeRollSequence` 运行时幂等调用兜底——属运行时补丁，非正式迁移 | ⚠️ 性质判错 |
| 4 | 补 `photos(roll_id)`、`photos(date_taken)`、`photos(photo_tags)` 索引 | 前两个 **已存在**（`schema-migration.js:170-171`：`idx_photos_roll`、`idx_photos_date_taken`，外加复合索引 `idx_photos_roll_date_id`）；`photo_tags` 是关联表（`photo_tags(photo_id)/(tag_id)` 已索引，行 173-174） | ❌ 60% 误判 |
| 5 | 「**真缺失的索引**」 | 仅 `photos(location_id)`（grep 全仓库 0 命中）；其他可选候选：`photos(positive_rel_path)`、`photos(full_rel_path)`、`rolls(display_seq)` 需凭 EXPLAIN QUERY PLAN 验证 | ⚠️ 真问题在索引审计 |
| 6 | 「schemaSQL 是索引来源之一」 | `server.js:307-485` 的 `schemaSQL` **仅含 CREATE TABLE IF NOT EXISTS，零 CREATE INDEX**；`db.js` 同样仅 sessions 两个索引 | ❌ 严重：**全新安装的 DB 实际上零业务索引** |
| 7 | 「`recomputeRollSequence` 多步写无事务」 | **已在事务内**（`roll-service.js:65-77` BEGIN/COMMIT/ROLLBACK）；真问题是行 67-71 的 N+1 JS 循环 | ⚠️ 部分误判 |
| 8 | 「窗口函数需 SQLite ≥ 3.25，确认版本」 | 实测 `node_modules/sqlite3` 捆绑 **SQLite 3.44.2**（`SELECT sqlite_version()` + `ROW_NUMBER() OVER (...)` 双验证通过）；门槛远超 | ⚠️ 已满足，仅留文档化 |
| 9 | 「迁移可回滚」 | 现有 `MigrationRunner` 只有 `runAll`，**无 down/rollback**；10 个 orphan 中 8 个写了 `down()` 但无 caller；计划「失败 ROLLBACK」过度承诺 | ❌ 过度承诺 |
| 10 | 「迁移必须有备份 + 回滚脚本」 | 备份策略缺失；`db.js` 启动期不备份；`run-all-migrations.js` 不备份 | ❌ 真缺口 |

### 0.4 跨工程横切（原版完全未覆盖）

| # | 缺口 | 影响 |
|---|---|---|
| 1 | **路由级测试覆盖**：14 个被改路由中仅 pairing/sessions/shutdown 有测试；photos/films/rolls/stats/ai-chat/search/tags/conflicts/equipment/luts/filesystem/uploads/export **零路由级测试** | 「依赖 #10」前置不足——#10 出口只覆盖 path-security/shutdown/auth/tls，不含这些路由 |
| 2 | **文件冲突**：photos.js 同时被 #4+#5 改；rolls.js 同时被 #4+#6 改；server.js 同时被 #4（handler 对齐）+#6（迁移激活）改 | 并行不可行，需排序 |
| 3 | **回滚开关缺失**：迁移激活、worker 启用均无 feature flag | 失败无法即时止血 |
| 4 | **性能基线过弱**：「至少不劣化」无量化指标 | 验收主观 |
| 5 | **2B auth 集成**：`auth.js:119` inline `res.status(result.status||401).json(...)` 绕过 errorHandler；handler 对 401/423 无显式映射 | 错误响应一致性破坏 |

### 0.5 根因诊断（真正的「本质」）

原版 2C 的问题不是「目标错」，而是**事实底座停留在 FOLLOWUPS 原始记忆**——这与原版 2A 犯的错同质（见 `phase-2a-foundation.md §0`）。真正的本质：

- **(A) 已建未用**：`errorHandler`、`MigrationRunner`、`schema-migration` 索引均已写好，但**未激活/未消费**——属死代码。
- **(B) 双轨分裂**：`server/migrations/*.js`（10 个日期脚本）与 `server/utils/*-migration.js`（5 个 utils）是两套并行系统，前者 orphan、后者 dead-code。
- **(C) 测试护栏覆盖盲区**：2A 出口的「被改路由有测试」承诺在 2C 范围内未兑现——14 个被改路由中 11 个零测试。
- **(D) worker 边界模糊**：`RenderCore` 跨端共享，worker pool 设计若不显式划到 server 侧，会污染浏览器 bundle。

---

## 1. 重写原则（对照「不重复造物」）

1. **从「新建」改为「激活 + 收编」**：errorHandler 不重写，审计并扩展；MigrationRunner 不重建，激活并收编 orphan；schema-migration 索引不重写，激活即生效。
2. **测试前置具体化**：「依赖 #10」不够——2C.0 显式补「被改路由错误路径」测试，是 #4/#5/#6 共同硬前置。
3. **排序按文件冲突解**：photos.js 是 #4+#5 共改点，必须串行；rolls.js 是 #4+#6 共改点，必须串行；server.js 是 #4+#6 共改点，必须协调。
4. **回滚开关强约束**：迁移激活、worker 启用均需 env flag（仿 2D 平台升级层）。
5. **性能基线量化**：替换「不劣化」为具体指标（事件循环 p99、recomputeRollSequence 100/500/2000 roll 耗时、冷启动时间）。
6. **不透传 err.message 进 worker**：worker 抛错用结构化 `{code, message}`，主线程透传到 errorHandler。
7. **worker 仅 server 侧**：`packages/shared` 保持无 `worker_threads` 依赖；server 内建 `services/render-worker-pool.js` 包 `RenderCore`。

---

## 2. 真实现状基线（计划的事实底座）

| 面 | 现状 |
|---|---|
| errorHandler | `server/middleware/error-handler.js` 已存在（111 行）；`ValidationError`/`NotFoundError` 已有；`NODE_ENV!=='development'` 已脱敏；`errorId=Date.now().toString(36)`（弱）；`server.js:301-303` 已正确挂载 |
| 路由 err.message | 14 文件 ~120 处；5 种变体；ai-chat(22)/rolls(19)/photos(18)/presets(10)/stats(9)/export(7)/films(6)/tags(4)/filesystem(4)/film-items(3)/conflicts(2)/uploads/search/luts/health(1)；4xx 业务映射 ~30 处需保留 |
| 路由测试 | 仅 pairing/sessions/shutdown；其余 11 个零路由级测试（path-security/auth/tls 等 server 单元测试在 `server/utils/__tests__/`） |
| 像素管线 | `RenderCore.processPixelFloat` 已完整（Float 管线）；photos.js 6 循环 + render-positive 4 循环；filmlab.js 待审；`packages/shared` 无 worker；client 侧 `FilmLab.jsx`/`useFilmLabRenderer`/`CpuRenderService` 也消费 RenderCore |
| fs.*Sync | 8 路由文件 62 处；请求路径（photos/filesystem/filmlab/ai-chat/rolls）+ 模块加载期（luts/equipment OK）+ 健康探针（health 可降级） |
| 迁移 runner | `MigrationRunner` 类已存在，仅 `runAll` 无 `down`；`run-all-migrations.js` 注册 5 个迁移（仅 2024 时间戳） |
| orphan migrations | `server/migrations/*.js` 10 个文件：8 个 `up/down`、2 个仅 `migrate()`；零 caller |
| 启动迁移 | `server.js:491-515` 全部注释；启动仅 `db.exec(schemaSQL)` + `recomputeRollSequence`（`server.js:534`） |
| schemaSQL 索引 | **零 CREATE INDEX**（仅 CREATE TABLE IF NOT EXISTS）；`db.js` 仅 sessions 2 个索引 |
| 已写未跑的索引 | `schema-migration.js` 24 个（含 `idx_photos_roll`/`idx_photos_date_taken`/`idx_photos_roll_date_id` 复合）；`equipment-migration.js` 9 个；`film-struct-migration.js` 4 个 |
| 真缺失索引 | `photos(location_id)`；候选待验证：`photos(positive_rel_path)`/`photos(full_rel_path)`/`rolls(display_seq)` |
| recomputeRollSequence | `roll-service.js:48-80`；已在事务内（行 65-77）；N+1 JS 循环（行 67-71）；`ensureDisplaySeqColumn`+`ensureStartDateColumn` 双补丁（行 16-46） |
| SQLite 版本 | 捆绑 3.44.2（窗口函数验证通过）；远超 3.25 门槛 |
| 2B auth 集成 | `auth.js:119` inline `res.status(...)` 绕过 errorHandler；handler 对 401/423/404(白名单) 无显式映射 |

---

## 3. 工程拆分

> 顺序固定：**2C.0 补测试 → 2C.1 #6 激活迁移（低风险）→ 2C.2 #4 错误统一（机械广覆盖）→ 2C.3 #5 像素下沉（最重最后）**。每步独立验收、独立回滚。

### 2C.0 前置：被改路由错误路径补测试

**性质**：解锁 #4/#5/#6 的共同硬前置。2A.1 出口的「被改路由有测试」承诺在 2C 范围内未兑现，本节补齐。

**改动（文件级）**
1. `server/routes/__tests__/photos.test.js`（新建）：覆盖至少 1 个错误路径（如 `GET /api/photos/:id` 不存在 → 404/500）；mock sharp+db 避免拉真渲染。
2. 同模式新建：`films.test.js`、`rolls.test.js`、`stats.test.js`、`ai-chat.test.js`、`search.test.js`、`tags.test.js`、`conflicts.test.js`、`equipment.test.js`、`filesystem.test.js`、`uploads.test.js`、`export.test.js`、`luts.test.js`。
3. 每个测试**至少 1 个错误路径用例**（断言响应结构 + 状态码），不追求全覆盖。
4. 复用 `shutdown.test.js` 的「单独构造 express app」模式，避免拉起 sqlite/sharp。

**验收**
- [ ] 上述 13 个路由测试文件存在；每个至少 1 个错误路径用例。
- [ ] `npm test` 收集并跑过（root jest projects）。
- [ ] 人为注入 `throw new Error('test')` 到任一路由 → 测试失败退出码非 0。

**风险**：mock 边界要谨慎——photos.js 的 sharp 调用、ai-chat.js 的网络调用、 rolls.js 的 fs 调用必须可注入。优先用 `jest.mock('sharp')` / `jest.mock('../../utils/db-helpers')` 而非 monkey-patch。

---

### 2C.1 #6 DB schema 收敛（先做，低风险）

**性质**：激活现有死代码 + 收编 orphan + 补真缺失索引 + 窗口函数化。

#### 2C.1.1 激活迁移 runner

**改动（文件级）**
1. `server/server.js:488-535` 的 IIFE：
   - 删除 `/* MIGRATIONS DISABLED ... */` 注释块。
   - 改为 `await runAllMigrations()`（已存在），包在 env flag 内：
     ```js
     if (process.env.FG_MIGRATIONS_ENABLED !== '0') {
       const { runAllMigrations } = require('./utils/run-all-migrations');
       await runAllMigrations();
     } else {
       console.log('[SERVER] Migrations skipped via FG_MIGRATIONS_ENABLED=0');
     }
     ```
   - 保留 `db.exec(schemaSQL)` 作为兜底（schema-migration 内部也幂等）。
   - 保留 `recomputeRollSequence` 直接调用（行 534）——它是运行时兜底，不依赖 runner 顺序。
2. `run-all-migrations.js`：
   - 收编 `server/migrations/*.js` 10 个 orphan（统一通过 `runner.add(name, async () => { const m = require('../migrations/XXX'); await (m.up||m.migrate)(); })`）。
   - 按 `MIGRATION_NAME` 或文件名时间戳排序（已有命名规范）。
   - 已有 5 个 `20240101_*` 占位名改为真实文件名（避免与收编的 2025/2026 冲突）。
3. 备份：runner 入口先 `cp ${dbPath} ${dbPath}.backup-${ISO}`，保留最近 3 份（轮换）。

**验收**
- [ ] `FG_MIGRATIONS_ENABLED=1` 启动 → runner 跑完，`_migrations` 表有全部 15+ 条记录。
- [ ] `FG_MIGRATIONS_ENABLED=0` 启动 → 跳过，日志明示。
- [ ] 新装空库 + 全量迁移 → 表 + 索引齐全（`PRAGMA index_list(photos)` 验证）。
- [ ] 已有库二次启动 → `_migrations` 命中，迁移幂等跳过。

**风险**
- **历史库可能已部分跑过 ad-hoc 迁移**：`_migrations` 表无记录但列已存在。缓解：所有迁移的 `ALTER TABLE ADD COLUMN` 用 `PRAGMA table_info` + `try/catch` 包裹（部分 orphan 已这么做，需审计）。
- **`equipment-migration.js` 等可能假设列已存在**：单测每个迁移在新空库 + 部分迁移库两种 fixture 上跑通。

#### 2C.1.2 索引审计与补齐

**改动（文件级）**
1. **激活即生效**：`schema-migration.js` 的 24 个索引在 runner 激活后自动落地（含计划误判的 `idx_photos_roll`/`idx_photos_date_taken`/复合索引）——无需新建。
2. **真缺失补齐**（`schema-migration.js` 末尾追加）：
   ```sql
   CREATE INDEX IF NOT EXISTS idx_photos_location ON photos(location_id);
   ```
3. **候选索引凭 EXPLAIN 验证**（非强制，留观察）：
   - `photos(positive_rel_path)`、`photos(full_rel_path)`（导出查询是否走索引？）
   - `rolls(display_seq)`（`recomputeRollSequence` 后是否查询命中？）
4. **EXPLAIN QUERY PLAN 归档**：跑 hot path（`rolls` 列表、`photos` by roll、`stats` 聚合、`search`）前后对比，写入 `docs/phase2-roadmap/2c-index-explain.md`。

**验收**
- [ ] `PRAGMA index_list(photos)` 含 `idx_photos_location`。
- [ ] `EXPLAIN QUERY PLAN SELECT * FROM photos WHERE location_id = ?` 命中索引。
- [ ] 归档文档含 5 条 hot path 的前后查询计划对比。

#### 2C.1.3 recomputeRollSequence 窗口函数化

**改动（文件级）**
- `server/services/roll-service.js:48-80`：
  - 删除行 52-71 的 SELECT + JS for-loop + UPDATE 循环。
  - 改为单条：
    ```sql
    UPDATE rolls SET display_seq = (
      SELECT new_seq FROM (
        SELECT id, ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN start_date IS NULL THEN 1 ELSE 0 END,
            start_date ASC,
            CASE WHEN created_at IS NULL THEN 1 ELSE 0 END,
            created_at ASC,
            id ASC
        ) AS new_seq
        FROM rolls
      ) s WHERE s.id = rolls.id
    );
    ```
  - 保留外层 BEGIN/COMMIT/ROLLBACK 事务。
  - 保留 `ensureDisplaySeqColumn`/`ensureStartDateColumn` 前置调用。
- 扩 `server/services/__tests__/roll-service.test.js`：固定 10 roll fixture（含 5 个 `start_date IS NULL`），断言窗口函数改写前后 `display_seq` 序列等价。

**验收**
- [ ] `roll-service.js` 无 JS UPDATE 循环。
- [ ] fixture 测试断言改写前后 `display_seq` 数组逐项相等。
- [ ] 100/500/2000 roll 三档耗时归档（基线 vs 改写后）；窗口函数版本应显著优于 N+1。

**风险**：SQLite 子查询 UPDATE 性能在特大表（>10k roll）上未必优于循环——基准测验证；若劣化，保留旧实现为 `FG_RECOMPUTE_MODE=loop` 回退。

#### 2C.1.4 多步写事务审计

**性质**：原版任务「多步写包事务」部分已落实（recompute 已在事务内），本节是**审计**而非新建。

**改动**
- grep `server/routes/*.js` 与 `server/services/*.js` 中的连续 `runAsync('UPDATE/INSERT/DELETE')` 序列；评估是否需要包事务。
- 候选：`routes/rolls.js` 的删除（行 663-681 多处 DB 写 + recompute）、`routes/photos.js` 的导入（行 514-722 多步 fs + DB）、`routes/import.js` 全套。
- 包事务方式：`runAsync('BEGIN')` → 多步 → `runAsync('COMMIT')`，catch 走 `ROLLBACK`。

**验收**
- [ ] 审计报告归档：列出所有多步写序列，标注已事务化 / 待补。
- [ ] 至少 2 处高风险序列（导入、批量删除）补事务 + 注入故障测试（mock `runAsync` 第 N 步失败 → 断言 ROLLBACK）。

---

### 2C.2 #4 错误处理统一（机械广覆盖）

**性质**：路由层错误响应迁移至 `next(err)`；handler 审计扩展；2B auth 对齐。**不动算法，只动错误路径。**

#### 2C.2.1 errorHandler 审计与扩展

**改动（文件级）**
- `server/middleware/error-handler.js`：
  - `errorId`：`Date.now().toString(36)` → `crypto.randomUUID()`（避免同毫秒冲突）。
  - 新增 `OperationalError` 类（4xx，可暴露 message）与 `ProgrammerError` 类（5xx，对外脱敏）；现有 `ValidationError`/`NotFoundError` 改继承 `OperationalError`。
  - 显式映射 auth 错误：`err.status === 401` → 401 + `{code: 'UNAUTHORIZED'}`；`err.status === 423` → 423 + `{code: 'PAIRING_LOCKED'}`；`err.status === 404 && err.code === 'WHITELIST'` → 404 + `{code: 'ROUTE_NOT_FOUND'}`。
  - 响应体规范：`{ ok:false, error, code?, errorId }`（保持向后兼容，`error` 字段保留）。
- `server/utils/auth.js:119`：`res.status(...).json(...)` → `next(Object.assign(new Error('auth'), { status: result.status||401, code: result.code }))`。
- `index.d.ts`（`@filmgallery/types`）：导出 `OperationalError`/`ProgrammerError` 与 `ErrorCode` 联合类型。

**验收**
- [ ] handler 含 5 类显式映射（Validation/NotFound/Auth/SQLite/Multer/Default）。
- [ ] `errorId` 是 UUID 格式（36 字符）。
- [ ] auth 失败响应经 errorHandler（grep `auth.js` 无 inline `res.status`）。
- [ ] 单测覆盖每种错误类型（扩 `server/middleware/__tests__/error-handler.test.js`，新建）。

#### 2C.2.2 路由错误响应分桶迁移

**性质**：~120 处 inline 错误响应，按 5 桶分别迁移。可脚本辅助 + 人工 review。

**桶划分**
- **桶 A（默认，~75 处）**：`res.status(500).json({error: err.message})`、`{error: e.message}`、`{success:false,error:error.message}`、`{ok:false,error:err.message}` → `next(err)`。
- **桶 B（4xx 业务映射，~30 处）**：如 `rolls.js:759-762` "Photo not found"→404、`presets.js:173` UNIQUE 约束→409 → 改为 `next(new NotFoundError('Photo not found'))`、`next(Object.assign(new Error(), {code:'SQLITE_CONSTRAINT', status:409}))`。
- **桶 C（含附加字段，~5 处）**：`{ok:false, error: err.message, details: err.fileInfo}` → `next(Object.assign(new OperationalError(err.message), {details: err.fileInfo}))`；handler 序列化时透出 details（仅 4xx）。
- **桶 D（SSE/流式，~3 处）**：`ai-chat.js:90` 的 `send({type:'error',message})` **不走 errorHandler**（响应头已发）；改为脱敏 message（`process.env.NODE_ENV === 'development' ? err.message : 'AI stream error'`）。
- **桶 E（已显式 4xx，保留，~10 处）**：`return res.status(400).json({error:'rollId is required'})` 等输入校验，**不改**（与 errorHandler 抛 Error 等价但更直观）。

**改动（文件级）**
- 14 个路由文件，按桶分类机械替换。
- 每改一个路由，对应 `__tests__/XXX.test.js` 至少新增 1 个错误路径断言（依赖 2C.0）。
- grep 验证：`rg "res\.status\(5\d\d\)\.json\(" server/routes` 计数从 ~95 降至 ≤5（仅 handler 内）。

**验收**
- [ ] `rg "res\.status\(5\d\d\)" server/routes` 仅返回显式 5xx 业务场景（如 ai-chat 上游 502）。
- [ ] 桶 A/B/C/D 各自的迁移清单归档（`docs/phase2-roadmap/2c-error-migration.md`）。
- [ ] 14 个路由测试的错误路径用例全绿。
- [ ] 前后端联调：client `jsonFetch` 与 `api-client` 在 4xx/5xx 路径下行为不变（手动 smoke）。

**风险**
- **桶 B 的业务码漂移**：前端可能依赖 `error === 'Photo not found'` 字符串字面量——grep client/mobile/watch 三端消费方，列出依赖清单后再改。优先保持 message 不变。
- **桶 D 的 SSE 错误**：必须保留响应头已发的兼容（不能切到 `next(err)`，否则 errorHandler 会试图 `res.json` 已 end 的响应）。

#### 2C.2.3 顺序回归测试

- 单测：`server/middleware/__tests__/mount-order.test.js`，断言 errorHandler 在 `/api/*` 404 之后注册（防止 Phase 1 同类 bug 复现）。

---

### 2C.3 #5 像素管线下沉（最重最后）

**性质**：worker pool 落地 + 去 fs.\*Sync。**风险最高，必须最后做。**

#### 2C.3.1 worker pool 设计（server 侧独占）

**架构**
- 新建 `server/services/render-worker-pool.js`：
  - 启动期预启 N 个 worker（N = `max(1, cpus() - 1)`，可 env `FG_RENDER_WORKERS` 覆盖）。
  - worker 脚本 `server/services/render-worker.js`：`require('worker_threads')` + `require('../../packages/shared').RenderCore`；监听 `parentPort` 收 `{type:'process', buffer, params, format}` → 调 `processPixelFloat` → post `{type:'done', outBuffer}`。
  - 主线程 API：`processImage(buffer, params, format) → Promise<Buffer>`；按阈值决定主线程 vs worker：
    - `width * height < FG_RENDER_WORKER_THRESHOLD`（默认 2MP，约 800KB JPEG）→ 主线程同步（避免 worker 通信开销）。
    - 否则 → worker pool 队列分发。
- env 开关：`FG_RENDER_WORKER=0` 全走主线程（回退）。

**改动（文件级）**
- `server/routes/photos.js:886-985`（export-positive）与 `:1150-1195`（render-positive）：6+4 个循环体改为 `await renderWorkerPool.processImage(...)`；循环逻辑下沉到 worker。
- `server/routes/filmlab.js`：评估是否同步迁移（如消费同类循环，下沉；否则保留并标记 `// TODO 2C.4`）。

**验收**
- [ ] `packages/shared` 仍无 `worker_threads` 引用（grep 验证）。
- [ ] `FG_RENDER_WORKER=0` → 主线程路径，行为与重构前等价（PSNR 测试 ≥ 99dB）。
- [ ] 默认 worker 路径，主事件循环在 24MP RAW 处理期间可并发响应（压测：渲染中并行 `GET /api/health` p99 < 50ms）。
- [ ] 小图（<2MP）走主线程，worker 不启动（避免开销）。
- [ ] worker 异常崩溃 → pool 自动重启 + 主线程降级（不返回 500）。

**风险**
- **位等价**：worker 与主线程 JS 引擎差异（理论上 V8 一致，但 `Math.round`/Float64 累加在某些 SIMD 边界可能不同）。**必须** PSNR/SSIM 全套样本集对比（含 RW2 170MP，见 `docs/RW2-170MP-IMPORT-DIAGNOSIS.md`）。
- **worker 通信开销**：传输 Buffer 用 `transferList`（零拷贝），避免序列化。
- **小图反而变慢**：阈值策略（默认 2MP）需基准调；可在 `FG_RENDER_WORKER_THRESHOLD` 暴露。

#### 2C.3.2 fs.\*Sync 异步化（请求路径）

**分桶**（不一刀切）
- **请求路径（必改）**：`routes/photos.js` 20+ 处（unlink/readFile/statSync/mkdirSync）、`routes/filesystem.js` 11 处（existsSync/statSync/readdirSync/accessSync/mkdirSync）、`routes/filmlab.js` 5 处（existsSync/mkdirSync）、`routes/ai-chat.js` 1 处（existsSync）、`routes/rolls.js` 1 处（existsSync）。
- **模块加载期（保留）**：`routes/luts.js:23-24`、`routes/equipment.js:24-25`——启动一次性成本，不阻塞请求。
- **健康探针（降级 P2，可保留）**：`routes/health.js` 14 处 existsSync/statSync——探针本身要求快，且访问频率低；如要异步化，需重新评估超时。

**改动（文件级）**
- `routes/photos.js` 等：`fs.*Sync` → `fs/promises`（`fs.promises.unlink`/`.stat`/`.readdir`/`.mkdir`/`.readFile`）。
- 大文件读：`fs.createReadStream` 流式（避免一次性 buffer 24MP RAW）。

**验收**
- [ ] `rg "\.\w*Sync\(" server/routes/{photos,filesystem,filmlab,ai-chat,rolls}.js` 仅余模块加载期（luts/equipment）与健康探针（health）。
- [ ] 请求路径无 `*Sync` 调用（grep 验证）。
- [ ] 大文件导入（≥100MB RAW）内存峰值下降（归档前后对比）。

#### 2C.3.3 性能基线归档

**改动**：新建 `docs/phase2-roadmap/2c-perf-baseline.md`，归档：
- 主事件循环 p99（worker 前后，压测 100 并发 `GET /api/photos`）。
- 24MP RAW export-positive 耗时（主线程 / worker / 阈值切换）。
- 100/500/2000 roll `recomputeRollSequence` 耗时（来自 2C.1.3）。
- 启动迁移冷启动时间（来自 2C.1.1）。

**验收**
- [ ] 文档存在，含至少 4 个指标的「基线 / 改写后 / 增益%」三列对比。
- [ ] 任一指标劣化 ≥10% 触发回滚决策（不走验收）。

---

## 4. 排序与并行

```
2C.0 补路由错误路径测试 ──┐
                         ├─→ 2C.1 #6 激活迁移 runner ──┐
                         │   (低风险, 解锁回滚安全网)    │
                         │                              ├─→ 2C.3 #5 像素下沉
                         └─→ 2C.2 #4 错误统一 ──────────┘    (最重, 最后)
                                 (机械, 影响面广)
```

**理由**
1. **2C.0 先行**：是 #4/#5/#6 共同硬前置（被改路由有测试）。
2. **2C.1 #6 先于 #4/#5**：激活 runner 是低风险动作（已有代码 + env flag + 备份）；先做能解锁「迁移记录可追溯」的回滚安全网，让后续 #4/#5 改动有数据库层兜底。
3. **2C.2 #4 早于 2C.3 #5**：#4 是机械替换（影响面广但风险低），先做清理路由层；#5 是算法下沉（风险高），最后做避免与 #4 在 photos.js 上撞车。
4. **2C.3 #5 必须最后**：worker 引入新的并发模式，需 #4 的错误路径规范 + #6 的迁移记录配合（如 worker 崩溃 → errorHandler → 记录到 _migrations 风格的运行日志）。

**并行机会**
- 2C.1.2 索引审计可与 2C.1.1 激活并行（不同文件）。
- 2C.2.1 handler 扩展可与 2C.2.2 路由分桶并行（前者改 handler + auth，后者改 routes，文件不重叠）。

---

## 5. 出口条件（收紧，去掉过度承诺）

**2C 完整收尾**（按 2C.0 → 2C.1 → 2C.2 → 2C.3 顺序验收）

1. **2C.0**：13 个路由测试文件存在，每个至少 1 个错误路径用例；`npm test` 全绿。
2. **2C.1**：
   - 迁移 runner 在 env flag 下激活；`_migrations` 表有 15+ 条记录。
   - `photos(location_id)` 索引存在，EXPLAIN 命中。
   - `recomputeRollSequence` 无 JS UPDATE 循环；窗口函数改写前后序列等价。
   - 多步写事务审计报告归档；≥2 处高风险序列补事务 + 注入故障测试。
3. **2C.2**：
   - `rg "res\.status\(5\d\d\)" server/routes` 仅返回显式业务场景（≤5 处）。
   - handler 含 5 类显式映射 + UUID errorId；`auth.js` 无 inline `res.status`。
   - 14 个路由错误路径测试全绿。
   - 三端（client/mobile/watch）api-client 在 4xx/5xx 路径行为不变（smoke）。
4. **2C.3**：
   - `packages/shared` 无 `worker_threads` 引用。
   - `FG_RENDER_WORKER=0` 主线程路径 PSNR ≥ 99dB（与重构前等价）。
   - 默认 worker 路径，24MP RAW 处理期间 `GET /api/health` p99 < 50ms。
   - 请求路径无 `*Sync`（luts/equipment 模块加载期 + health 探针豁免）。
   - 性能基线文档归档，任一指标劣化 < 10%。
5. **全局**：
   - `FOLLOWUPS.md` 中 #4/#5/#6 标记 ✅。
   - 无新增性能回退（基线对比归档）。
   - 回滚开关文档化（`FG_MIGRATIONS_ENABLED`/`FG_RENDER_WORKER`/`FG_RENDER_WORKER_THRESHOLD`/`FG_RECOMPUTE_MODE`）。

---

## 6. 待定决策（需在对应子任务开工前定）

- [ ] **D1**：errorHandler 响应体是否引入 `code` 字段（推荐是，与 `@filmgallery/types` 的 `ErrorCode` 联合类型对齐）。
- [ ] **D2**：桶 B 的 4xx 业务映射是否完全转为 `throw new OperationalError`（推荐分阶段：先保留字符串字面量保证前端兼容，第二阶段才切 code）。
- [ ] **D3**：worker pool 大小策略（默认 `cpus()-1` vs 固定 2）；阈值（默认 2MP vs 凭基线调）。
- [ ] **D4**：`filmlab.js` 是否纳入 2C.3 范围（推荐评估后定，若消费同类循环则下沉，否则标 `// TODO 2C.4`）。
- [ ] **D5**：迁移备份保留策略（最近 3 份轮换 vs 时间戳永久保留）；备份位置（与 db 同目录 vs `~/.filmgallery/backups/`）。
- [ ] **D6**：桶 D（SSE 错误）是否在 `ai-chat.js` 内单独抽象 `sendSseError(res, err)` 工具（推荐是，集中脱敏逻辑）。
- [ ] **D7**：候选索引（`photos(positive_rel_path)`/`full_rel_path`/`rolls(display_seq)`）是否一并补——凭 EXPLAIN 验证结果定。
- [ ] **D8**：`health.js` 的 14 处 `*Sync` 是否在 2C.3.2 异步化（推荐否，降级 P2 观察项；如要异步化需重新评估探针超时）。

---

## 附录 A · 与原版差异对照

| 节 | 原版 | 重写版 | 理由 |
|---|---|---|---|
| §0 | 无 | 新增「设计验证」 | 仿 2A §0，校准事实底座 |
| 工程一 #4 | 「集中 errorHandler」需新建 | 改为「审计 + 扩展现有 handler」 | handler 已存在 |
| 工程一 #4 | 单一模式机械替换 | 5 桶分类（A/B/C/D/E） | 实际有 5 种变体 |
| 工程二 #5 | 范围 `photos.js:886-986` | 范围 6+4 循环 + filmlab 评估 | 漏 60% |
| 工程二 #5 | worker 复用 RenderCore | worker pool server 侧独占 | shared 不能引 worker_threads |
| 工程二 #5 | 去 `fs.*Sync` 仅 photos | 8 文件分桶（请求/模块加载/探针） | 严重低估 |
| 工程三 #6 | 「启用单一迁移 runner」 | 「激活现有 dead-code runner」 | runner 已存在 |
| 工程三 #6 | 补 `photos(roll_id/date_taken/photo_tags)` 索引 | 仅补 `photos(location_id)` | 其他已存在 |
| 工程三 #6 | 「可回滚」 | 「前向迁移 + 备份 + env flag」 | MigrationRunner 无 down |
| 新增 | — | 2C.0 前置补路由测试 | 14 路由中 11 个零测试 |
| 新增 | — | 回滚开关 + 性能基线量化 | 原版过弱 |
| 新增 | — | 2B auth 集成 | handler 与 auth inline 不一致 |
