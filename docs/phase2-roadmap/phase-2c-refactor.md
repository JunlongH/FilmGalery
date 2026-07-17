# Phase 2C · 重构层

> **范围**: #4 错误处理统一 · #5 像素管线下沉 · #6 DB schema 收敛
> **定位**: 大规模机械/性能重构。三项均以 **2A #10 测试护栏为硬前置**——无测试不重构。
> **前置**: 2A（#10 必需；#9 shared 包让 DB 错误码/类型可共享，建议先行）
> **状态**: ⬜ 未开始

---

## 工程一 · #4 错误处理统一

### 背景
`routes/*` 中 100+ 处 `res.status(500).json({error: err.message})` 散落。Phase 0–1 仅处理安全敏感路由；全量替换需测试兜底防止语义漂移。直接 `err.message` 透传还存在信息泄露隐患。

### 目标
机械替换为 `next(err)`，汇入集中 `errorHandler`；统一错误响应结构、状态码、日志。

### 任务拆解

**集中 errorHandler**
- 在路由挂载末端注册（注意：在 `/api/*` 404 兜底之前，吸取 Phase 1 shutdown 教训）。
- 规范响应体：`{ error: <safe message>, code?: <stable code>, requestId? }`。
- 区分：OperationalError（4xx，可向客户端暴露）vs ProgrammerError（5xx，对外脱敏，日志全量）。
- 不向远端透传 `err.message` / 堆栈（与 2B #1 远端场景呼应）。

**替换规则（机械、可脚本辅助）**
- `res.status(500).json({error: err.message})` → `next(err)`。
- 已知业务错误（如「文件不存在」「配额超限」）改 throw 带 status 的自定义 Error，由 errorHandler 映射。

**验证**
- 路由测试（依赖 #10）：每个改动路由至少一个错误路径用例。
- 响应体 diff：捕获替换前后响应结构变化，确认非破坏性（对前端 `jsonFetch` 已是抛错语义，兼容）。

### 验收标准
- [ ] `routes/*` 内 `res.status(500).json` 模式 grep 计数显著下降（目标：仅 errorHandler 内保留）。
- [ ] 统一错误响应结构文档化；前端/移动端 `api-client` 适配。
- [ ] 远端响应不再含 `err.message` / 堆栈。
- [ ] 改动路由错误路径测试覆盖。

### 风险
- **语义漂移**：个别路由可能依赖原 500 + message 的客户端行为——需逐路由确认前端消费方式。
- **顺序陷阱**：errorHandler 必须在 404 兜底前注册，否则再次踩 Phase 1 同类 bug。

---

## 工程二 · #5 像素管线下沉

### 背景
`routes/photos.js:886-986` 存在 per-pixel JS 循环，性能差且阻塞事件循环；请求路径混用 `fs.*Sync`。

### 目标
per-pixel 循环移入 worker thread 或全交 Sharp/LibRaw；请求路径去 `fs.*Sync`。

### 任务拆解

**下沉重构**
- 评估两条路径：
  - A：Sharp 原生 pipeline（若处理为标准像素操作）。
  - B：worker thread 复用现有 `RenderCore.processPixelFloat`（见 `docs/RENDERING-PIPELINE-REFACTOR-PLAN.md` 的 Float 管线）。
- 默认倾向 B，保持 CPU/GPU 管线算法一致。

**去同步 IO**
- `fs.*Sync` → 异步 `fs/promises`，或下沉到 worker 内（不阻塞主事件循环）。
- 大文件流式处理，避免一次性 buffer。

**性能基线**
- 建立代表性 RAW 样本集（含 RW2 170MP，见 `docs/RW2-170MP-IMPORT-DIAGNOSIS.md`）。
- 重构前后耗时/内存对比，写入 `docs/`。

### 验收标准
- [ ] 主事件循环在像素处理期间不阻塞（可压测验证并发响应）。
- [ ] `routes/photos.js` 请求路径无 `fs.*Sync`。
- [ ] 像素输出与重构前位等价（PSNR/SSIM 测试，依赖 #10）。
- [ ] 性能报告归档，至少不劣化。

### 风险
- **像素不一致**：必须位等价测试，否则破坏 FilmLab 画质（与渲染管线审计联动）。
- **worker 通信开销**：小图可能反而变慢——保留阈值策略（小图主线程、大图 worker）。

---

## 工程三 · #6 DB schema 收敛

### 背景
迁移机制散乱（Phase 0–1 才补 `ensureStartDateColumn` 幂等修复首次安装崩溃）；缺索引导致查询变慢；多步写无事务；`recomputeRollSequence` 用逐行 JS 而非 SQL 窗口函数。

### 目标
单一迁移 runner + 索引 + 事务 + 窗口函数化。

### 任务拆解

**迁移 runner**
- 启用单一 source of truth 迁移入口（幂等、版本化、可回滚）。
- 收编现有散落 `ensureXxxColumn` 为正式迁移步骤。
- Phase 0–1 的 `ensureStartDateColumn` 作为既有数据兼容的迁移样例。

**索引**
- 补 `CREATE INDEX`：
  - `photos(roll_id)`
  - `photos(location_id)`
  - `photos(date_taken)`
  - `photos(photo_tags)`（若是 JSON，评估表达式索引或关联表）

**事务**
- 多步写操作（如导入、批量删除、roll 重算）包 `BEGIN/COMMIT`，失败 `ROLLBACK`。

**窗口函数化**
- `recomputeRollSequence` 改用 SQL 窗口函数（`ROW_NUMBER() OVER (PARTITION BY roll_id ORDER BY date_taken)` 等），消除 N+1 JS 循环。

### 验收标准
- [ ] 单一迁移 runner，新装/升级路径均有测试（依赖 #10，尤其覆盖 Phase 0–1 的崩溃场景）。
- [ ] 目标索引存在，`EXPLAIN QUERY PLAN` 验证被命中。
- [ ] 多步写在中间失败可回滚（注入故障测试）。
- [ ] `recomputeRollSequence` 改窗口函数后，大 roll 性能不劣化且序列值等价。

### 风险
- **schema 变更破坏现有库**：迁移必须有备份 + 回滚脚本 + 测试库演练。
- **SQLite 版本差异**：窗口函数需 SQLite ≥ 3.25，确认目标平台（Electron bundled sqlite3）版本。

---

## 阶段出口条件
1. 三项各自的验收标准达成。
2. 全部改动有测试兜底（2A #10 的承诺兑现）。
3. `FOLLOWUPS.md` 中 #4、#5、#6 标记 ✅。
4. 无新增性能回退（基线对比归档）。
