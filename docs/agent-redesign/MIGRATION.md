# 迁移计划

> 4 阶段迁移。每阶段独立可发版。Phase 0（已完成）的 legacy 修补 + 新增 feature flag 为基础。双引擎共存可回退。

## 阶段总览

| 阶段 | 工期 | 交付物 | 修复的问题 |
|---|---|---|---|
| **Phase 0** ✅ | 1 周 | legacy 引擎重启生存性 + SQL 注入修复 + 预算强制 + TOOL_LABELS | P4, P5, P11, P12, P13 |
| **Phase 1** | 1 周 | 标准化工具框架 + Zod 验证 + 结构化错误 + 事务 + 幂等 | **C1-C6 全部致命 bug**, F1-F10, D1-D7 |
| **Phase 2** | 3-4 天 | LangGraph 图骨架 + 检查点 + provider 适配 + 流式 | O1-O3, O5-O6, O9-O11, O15-O16, O21 |
| **Phase 3** | 3 天 | HITL 中断 + 流式协议映射 + 确认恢复 | O4(已修), 真实中断持久化 |
| **Phase 4** | 1 周浸泡 | 默认切换 + 清理 | 全部 |

**总工期**：~3-4 周（含 1 周浸泡）。

---

## Phase 1 — 标准化工具框架（修复全部致命 bug）

**目标**：不引入 LangGraph，仅重构工具层。修复 6 个致命 bug + 10 个脆弱性 + 7 个设计缺陷。这是最高优先级——无论是否用 LangGraph，工具层必须修复。

### 任务清单

#### 1.1 安装 Zod

```bash
cd server && npm install zod
```

#### 1.2 创建工具框架基础设施

新文件：
- `server/agent/tools/result.js` — `toolOk`/`toolError` 辅助函数
- `server/agent/tools/with-transaction.js` — `withTransaction(fn)` 事务包裹
- `server/agent/tools/safe-execute.js` — `safeExecute(tool, args, runtime)` 框架层安全网

修改 `server/services/ai-tools/helpers.js`：
- `sanitizeToolResult` 加转义 + 截断（修复 O5）

#### 1.3 Schema 迁移

```sql
-- photos 加 version + 确认 deleted_at 存在
ALTER TABLE photos ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- rolls 加 version + updated_at
ALTER TABLE rolls ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rolls ADD COLUMN updated_at DATETIME;

-- equipment 表加 version
ALTER TABLE equip_cameras ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE equip_lenses ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE equip_flashes ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE equip_scanners ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE equip_film_backs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- 幂等去重表
CREATE TABLE IF NOT EXISTS tool_idempotency (
  key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  result_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (key, tool_name)
);
```

#### 1.4 按域重构工具（8 域 38 工具）

按 `TOOLS.md` 规范，逐域重构。每域独立文件：

| 文件 | 工具数 | 关键修复 |
|---|---|---|
| `server/agent/tools/photo.js` | 8 | 修 `set_roll_cover` 列名；`delete_photo` 改软删除；加验证+乐观锁 |
| `server/agent/tools/roll.js` | 5 | 修 `set_roll_cover`；`update_roll` 加 `updated_at` |
| `server/agent/tools/film.js` | 4 | `record_film_purchase` 设 `updated_at` + 事务 + 幂等 |
| `server/agent/tools/equipment.js` | 4 | 按设备类型分异 schema（修复 C2） |
| `server/agent/tools/tag.js` | 5 | `attach_tags` 不再吞错（修复 C5） |
| `server/agent/tools/shot-log.js` | 3 | 加乐观锁（修复 F1） |
| `server/agent/tools/stats.js` | 4 | Phase 0 已修复 SQL 注入，加 Zod schema |
| `server/agent/tools/render.js` | 5 | `suggest_render_params` 从完整模板叠加（修复 C4） |

#### 1.5 修改 orchestrator 调用新工具

`server/services/ai-orchestrator.js` 的工具执行部分改为调用 `safeExecute`：

```js
// 修复前（ai-orchestrator.js:332-333）
try { resultStr = await handler(toolArgs); }
catch (err) { resultStr = JSON.stringify({ error: err.message }); }

// 修复后
const result = await safeExecute(tool, toolArgs, runtime);
resultStr = JSON.stringify(result); // 统一 {ok, data/error} 格式
```

#### 1.6 修复编排层关键问题（不依赖 LangGraph）

| 问题 | 修复 |
|---|---|
| O1 凭证泄漏 | `_tempOverride` 改为 per-request 参数传递 |
| O2 窗口截断 | `safeTruncateHistory` 不在 tool 消息前截断 |
| O3 无防御解析 | 加 `response?.choices?.[0]?.message` 守卫 |
| O5 注入突破 | `sanitizeToolResult` 转义 `<`/`>` |
| O6 max_tokens | 工具阶段 4096 |
| O7 提示冲突 | 移除"绝不删除" |
| O8 统计不一致 | 统一 `deleted_at` 过滤 |
| O16 畸形参数 | 不静默变 `{}`，返回 `validation_error` |
| O21 排序 tiebreaker | `ORDER BY created_at ASC, id ASC` |

### 验收

- [ ] `set_roll_cover` 写入正确列名（`cover_photo`/`coverPath`）
- [ ] `add_equipment` flash/scanner/film_back 不再报 "no such column"
- [ ] `record_film_purchase` 新项在 `list_film_items` 可见
- [ ] `suggest_render_params` 从完整模板叠加
- [ ] `attach_tags` 失败时返回 `ok:false`
- [ ] 所有批量工具用 `withTransaction` 包裹
- [ ] 所有工具有 Zod schema
- [ ] 工具错误返回结构化 `{ok:false, error:{type, retryable, hint}}`
- [ ] LLM 响应空 choices 不崩溃
- [ ] `sanitizeToolResult` 转义 `<`/`>`
- [ ] 38 工具全部通过单元测试

### 风险与回退

- **风险**：工具接口变化可能影响现有对话历史中的 tool_calls
- **缓解**：新旧工具名兼容映射（旧名 → 新 handler）
- **回退**：`ai_config.engine='legacy'` + 旧工具文件保留

---

## Phase 2 — LangGraph 图骨架

**目标**：LangGraph 引擎可处理纯聊天 + 工具调用，真实 token 流式。双引擎共存。

### 任务清单

#### 2.1 安装 LangGraph

```bash
cd server && npm install @langchain/core @langchain/langgraph
```

#### 2.2 自定义 SqliteSaver

`server/agent/checkpoint-saver.js` — 实现 `BaseCheckpointSaver` 4 方法，基于现有 `sqlite3`。

#### 2.3 Provider 适配器

`server/agent/model-adapter.js` — `LangChainModelAdapter` 包裹 `ai-gateway.js`。

#### 2.4 图定义

`server/agent/graph.js`：
- `loadContext` → `agent` → `guardWrite` → `executeTools` → `audit` → `agent`（循环）
- 检查点：`SqliteSaver`
- 流式：`streamEvents(v3)` + `StreamTransformer`

#### 2.5 路由分支

`server/routes/ai-chat.js` 加 `engine` 分支。

### 验收

- [ ] `engine='langgraph'` 时纯聊天正常
- [ ] `text_delta` 以真实 token 速度到达
- [ ] 38 工具全部可调用
- [ ] 检查点持久化（重启后可恢复）
- [ ] `engine='legacy'` 行为不变

---

## Phase 3 — HITL 中断与流式协议

**目标**：LangGraph 引擎支持写确认 interrupt 流程，功能达 legacy 全水平。

### 任务清单

- `guardWrite` 节点 + `interrupt()`
- `executeTools` 节点读 `pendingDecision`
- `/confirm/:id` 改用 `Command({resume})`
- SSE transformer 映射 `stream.interrupts` → `write_confirmation`
- 前端 `useAIChat.confirmAction` 后开新 SSE 流（方案 A）

### 验收

- [ ] 写工具触发 `write_confirmation`
- [ ] Allow → 执行 → `tool_result`
- [ ] Reject → 跳过 → LLM 生成拒绝确认
- [ ] 重启后待确认可恢复
- [ ] 移动端可处理 `write_confirmation`

---

## Phase 4 — 默认切换 + 清理

- 1 周浸泡，默认 `engine='langgraph'`
- 监控：检查点 DB 体积、token 消耗、错误率
- 浸泡后移除 legacy 路径（或保留冷启动 fallback）

---

## 测试策略

### 单元测试（Phase 1 重点）

每个工具独立测试：
- 正常路径（正确参数 → 成功）
- 验证失败（非法参数 → `validation_error`）
- 语义失败（不存在 ID → `not_found`）
- 并发冲突（版本不匹配 → `conflict`）
- 事务回滚（中途失败 → 全回滚）
- 幂等重试（相同 idempotency_key → 返回缓存）

### 集成测试

- 双引擎 A/B 对比（同消息 → 同结果）
- 三 provider 回归（OpenAI/DeepSeek/Ollama）
- 中断恢复（重启后恢复）

### E2E

- 桌面 puppeteer + 移动端手动
- 关键场景：发消息 → 工具调用 → 写确认 → 重启 → 恢复
