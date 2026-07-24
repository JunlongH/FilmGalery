# 迁移计划：5 阶段 Feature-Flag 双引擎共存

> 本计划基于 `DESIGN.md`。每阶段独立可发版，legacy 引擎始终可用作回退。Phase 0 不依赖 LangGraph 决策，可立即合并。

## 阶段总览

| 阶段 | 工期 | 交付物 | 风险 | 可回退 |
|---|---|---|---|---|
| Phase 0 — Prep & Legacy 修补 | ~1 周 | `ai_config.engine` flag、`ai_pending_writes` 表、SQL 注入修复、legacy 重启生存性 | 低 | N/A（独立改进） |
| Phase 1 — 检查点 + 图骨架（无工具） | ~3–4 天 | 自定义 `SqliteSaver`、`loadContext→agent→END` 图、provider 适配器、SSE transformer（仅 `text_delta`） | 中 | 切回 `engine='legacy'` |
| Phase 2 — 只读工具（L0，无中断） | ~2 天 | 24 个读工具桥接到 LangGraph、`tool_call`/`tool_result` SSE 事件 | 低 | 切回 `engine='legacy'` |
| Phase 3 — HITL 中断（写工具） | ~3 天 | `guardWrite`/`executeWrite` 节点、11 个写工具、`interrupt()`、`/confirm` 改 `Command({resume})` | 中 | 切回 `engine='legacy'` |
| Phase 4 — 默认切换 + 清理 | ~1 周浸泡 | 默认 `engine='langgraph'`、移除 flag、删 legacy 路径（或保留冷启动 fallback） | 低 | 保留 flag 一版本 |

**总工期**：~3–4 周（含 1 周浸泡）。若 Phase 0 后用户选择"修补路径"（见 `ALTERNATIVES.md`），则止于 Phase 0 + 额外 2 周修补，总 3 周。

---

## Phase 0 — Prep & Legacy 修补

**目标**：为双引擎共存铺路；立即修复 legacy 引擎的重启 bug 与 SQL 注入。**不引入 LangGraph**。

### 任务清单

1. **Schema 迁移**（`server/server.js` 或 `utils/schema-migration.js`）：
   - `ALTER TABLE ai_config ADD COLUMN engine TEXT DEFAULT 'legacy'`
   - `CREATE TABLE ai_pending_writes (confirmation_id TEXT PK, thread_id TEXT, conversation_id TEXT, tool_call_id TEXT, tool_name TEXT, args_json TEXT, status TEXT DEFAULT 'pending', created_at TEXT, resolved_at TEXT)`

2. **Legacy 引擎重启生存性**（`server/services/ai-orchestrator.js`）：
   - `waitForConfirmation` 入口：`INSERT INTO ai_pending_writes ...`
   - `resolveConfirmation`：`UPDATE ai_pending_writes SET status = ?, resolved_at = ?`
   - 服务器启动时：`SELECT * FROM ai_pending_writes WHERE status='pending' AND created_at < datetime('now', '-60 seconds')` → 标记 `rejected` + 日志警告
   - **效果**：legacy 引擎重启后不再丢失待确认写操作（虽然 60s 超时仍生效，但状态可见）

3. **SQL 注入修复**（`server/services/ai-tools/stats-tools.js`）：
   - 9 处 `year` 字符串插值改参数化查询
   - 涉及行：95-96, 138-159（8 处 group_by 分支）, 204, 216, 230, 242, 255, 290, 316
   - 约 20 行改动

4. **API key 加密**（`server/services/ai-config.js` + Electron main 进程）：
   - 写入前 `safeStorage.encryptString` → base64
   - 读取时 `safeStorage.decryptString`
   - Docker/NAS fallback：环境变量 `AI_API_KEY` 优先
   - **注意**：需在 Electron main 进程暴露 IPC 给 server（server 在 Electron 内运行时）

5. **预算强制**（`server/services/ai-orchestrator.js`）：
   - 每次 LLM 调用后 `UPDATE ai_config SET monthly_tokens_used = monthly_tokens_used + ?`
   - `handleMessage` 入口检查 `monthly_tokens_used >= monthly_budget_usd * tokensPerDollar` → 拒绝
   - janitor 每月 1 号重置

6. **`TOOL_LABELS` 更新**（`client/src/components/AIPanel/ToolCallIndicator.jsx` + `mobile/src/components/AIChatSheet.tsx`）：
   - 改为从 `getToolSchemas()` 动态生成，或直接更新静态 map 覆盖全部 35 工具

7. **`loadConversationMessages` 修复**（`client/src/hooks/useAIChat.js:194-203`）：
   - 包含 `tool_calls` 与 `tool_call_id` 字段
   - 重开含工具调用的会话不再只剩纯文本

### 验收

- [ ] 服务器重启后，`GET /api/ai/conversations/:id` 返回 `pending_confirmation`（若 legacy 引擎有未决写操作）
- [ ] `stats-tools.js` 全部 `year` 用 `?` 参数化
- [ ] `ai_config.api_key` 列存密文（base64）
- [ ] 超预算时 LLM 调用被拒绝
- [ ] 重开含工具调用的会话显示工具指示器

### 风险

- `safeStorage` 在 Linux NAS 无桌面环境时不可用 → fallback 环境变量，DB 不存 key
- `ai_pending_writes` 表的 `thread_id` 在 legacy 引擎中 = `conversation_id`（无独立 thread 概念）

---

## Phase 1 — 检查点 + 图骨架（无工具）

**目标**：LangGraph 引擎可处理纯聊天（无工具），真实 token 流式。**双引擎共存**。

### 任务清单

1. **安装依赖**（`server/package.json`）：
   ```
   npm install @langchain/core @langchain/langgraph
   # 不装 @langchain/openai（用适配器）
   # 不装 better-sqlite3（自定义 saver）
   ```

2. **自定义 `SqliteSaver`**（新文件 `server/services/ai-checkpoint-saver.js`，~150 LOC）：
   - 实现 `BaseCheckpointSaver` 的 `put`/`putWrites`/`getTuple`/`list`
   - 用现有 `sqlite3` 的 `runAsync`/`getAsync`/`allAsync`
   - 存独立文件 `ai_checkpoints.db`
   - Durability `"exit"`
   - **实施前**：对照 `@langchain/langgraph-checkpoint` typings 确认接口签名（见 DESIGN §15.2）

3. **Provider 适配器**（新文件 `server/services/ai-langchain-adapter.js`，~80 LOC）：
   - `LangChainModelAdapter extends BaseChatModel`
   - `_generate` 调 `aiGateway.chatCompletion`
   - `_streamResponseChunks` 调 `aiGateway.chatCompletionStream`
   - 保留 `setTemporaryOverride` 机制

4. **图定义**（新文件 `server/services/ai-langgraph-orchestrator.js`）：
   ```js
   const graph = new StateGraph(AgentState)
     .addNode('loadContext', loadContextNode)
     .addNode('agent', agentNode)
     .addEdge(START, 'loadContext')
     .addEdge('loadContext', 'agent')
     .addConditionalEdges('agent', (state) => {
       const last = state.messages[state.messages.length - 1];
       if (last.tool_calls?.length && state.tokensUsed < budget) return 'tools';
       return END;
     }, { tools: 'loadContext', [END]: END })  // Phase 1: 无 tools, 直接 END
     .compile({ checkpointer: sqliteSaver });
   ```
   - Phase 1：`agent` 节点不绑工具，LLM 直接产文本
   - `loadContext` 节点：构建 system prompt（复用 `ai-context-builder.js`）、加载历史、按需加载图片 base64

5. **SSE `StreamTransformer`**（同文件内）：
   - 注册 `StreamChannel("sse")`
   - `stream.messages` → `text_delta` 事件
   - `lifecycle` → `done` 事件
   - 运行开始 → `conversation_id` 事件

6. **路由分支**（`server/routes/ai-chat.js`）：
   ```js
   router.post('/chat', async (req, res) => {
     const config = await aiConfig.get();
     if (config.engine === 'langgraph') {
       yield* langgraphOrch.handleMessage(req.body, res);
     } else {
       yield* legacyOrch.handleMessage(req.body, res);  // 现有路径
     }
   });
   ```

7. **设置 UI**（`client/src/components/Settings/AISettings.jsx`）：
   - 加 "Agent 引擎" 选择器（legacy / langgraph）
   - 默认 `legacy`

### 验收

- [ ] `engine='langgraph'` 时，纯聊天（无工具调用）正常工作
- [ ] `text_delta` 以真实 token 速度到达（非逐字符）
- [ ] 服务器重启后，中断的会话可恢复（虽 Phase 1 无中断，但检查点已持久）
- [ ] `engine='legacy'` 时行为完全不变
- [ ] OpenAI/DeepSeek/Ollama 三 provider 回归测试通过

### 风险与回退

- **风险**：自定义 `SqliteSaver` 接口签名不符 → 检查点读写失败
- **缓解**：Phase 1 无工具无中断，检查点 round-trip 易测
- **回退**：`ai_config.engine='legacy'`，无数据迁移

---

## Phase 2 — 只读工具（L0，无中断）

**目标**：LangGraph 引擎支持 24 个读工具，功能达 legacy 引擎只读查询水平。

### 任务清单

1. **`LangGraphToolAdapter`**（新文件或 `ai-tools/index.js` 扩展）：
   - 桥接现有 `{schema, handler, type, securityLevel}` → LangGraph `tool()` 格式
   - 保留现有注册表为 source of truth
   - 35 工具的 schema 直接复用（OpenAI function schema 兼容 LangGraph）

2. **`agent` 节点绑定 24 个读工具**（securityLevel=0）：
   - `model.bindTools(readToolSchemas)`
   - LLM 返回 `tool_calls` → 路由到 `executeWrite` 节点（Phase 2 改名 `executeTools`，无 write 语义）

3. **`executeTools` 节点**：
   - 遍历 `tool_calls`，调 `getToolHandler(name)(args)`
   - 产 `ToolMessage` 追加到 `messages`
   - 入队 `auditQueue`（即使是读工具也记录，保持审计一致性）

4. **SSE transformer 扩展**：
   - `tools` 通道 `tool-started` → `tool_call` 事件
   - `tools` 通道 `tool-finished` → `tool_result` 事件

5. **图拓扑更新**：
   ```
   START → loadContext → agent
     agent:
       tool_calls && budget ok → executeTools → audit → agent  (循环)
       else → END
   ```

### 验收

- [ ] "搜索我 2024 年东京的 Portra 400 照片" → `search_photos` 工具调用正常
- [ ] "列出我的相机" → `search_equipment` 正常
- [ ] "分析我的拍摄模式" → `analyze_shooting_patterns` 正常
- [ ] 工具调用期间前端显示 `tool_call` 指示器
- [ ] 工具结果返回后 LLM 继续生成最终文本
- [ ] `engine='legacy'` 行为不变

### 风险与回退

- **风险**：工具 schema 在 LangGraph `bindTools` 格式下不兼容
- **缓解**：OpenAI function schema 与 LangGraph tool schema 高度兼容；Phase 2 先测 3 个工具再扩 24
- **回退**：`engine='legacy'`

---

## Phase 3 — HITL 中断（写工具）

**目标**：LangGraph 引擎支持 11 个写工具的 `interrupt()` 流程，功能达 legacy 引擎全水平。

### 任务清单

1. **`guardWrite` 节点**：
   - 检查 `tool_calls` 中每个工具的 `securityLevel`
   - 若任一 `>= 1`：调 `interrupt({tool, args, preview})`
   - `interrupt()` 返回 `{approved, reason}` 赋给 `pendingWriteDecision`

2. **`executeWrite` 节点**（替代 Phase 2 的 `executeTools`）：
   - L0 工具：直接执行
   - L1/L2 工具：据 `pendingWriteDecision.approved` 决定
   - 执行前 `SELECT` 旧值（L1/L2），执行后入队 `auditQueue` 含 `old_values`

3. **图拓扑更新**：
   ```
   agent:
     tool_calls && budget ok → guardWrite
     else → END
   guardWrite:
     any securityLevel >= 1 → interrupt()  [暂停]
     else → executeWrite
   executeWrite → audit → agent
   ```

4. **`/confirm/:confirmationId` 路由改造**（`server/routes/ai-chat.js`）：
   - 查 `ai_pending_writes.thread_id`
   - 调 `graph.invoke(new Command({ resume: {approved: decision==='confirmed'} }), {configurable:{thread_id}})`
   - **方案 A**：返回新 SSE 流，前端切换消费
   - 前端 `useAIChat.confirmAction` 改为开新 SSE 连接

5. **SSE transformer 扩展**：
   - `stream.interrupts` → `write_confirmation` 事件
   - `confirmation_id` = interrupt `id`

6. **前端 `useAIChat.js` 改造**：
   - `confirmAction` 后开新 SSE 流消费后续 `tool_result`/`text_delta`
   - 桌面 `AIPanel.jsx` 与移动 `AIChatSheet.tsx` 均改

7. **移动端 `write_confirmation` 处理**（P7 修复）：
   - `AIChatSheet.tsx` switch 加 case
   - UI 显示 Allow/Reject 按钮

8. **移动端 context 传递**（P8 修复）：
   - `HeaderButtons.tsx:85` 的 `context={null}` 改为 `useAIContext()` 推导

### 验收

- [ ] "把这张照片 rating 改为 5" → `update_photo_metadata` 触发 `write_confirmation`
- [ ] 用户点 Allow → 工具执行 → `tool_result` 事件 → LLM 生成确认文本
- [ ] 用户点 Reject → 工具跳过 → LLM 生成拒绝确认文本
- [ ] 服务器重启后，待确认写操作可恢复（检查点持久）
- [ ] 移动端可处理 `write_confirmation` 事件
- [ ] 移动端 AI 知道用户在哪个屏幕
- [ ] `engine='legacy'` 行为不变

### 风险与回退

- **风险**：`interrupt()` 节点重入产生重复审计 → `auditLog` 移到 `executeWrite`（中断后，仅跑一次）
- **风险**：`/confirm` 后续事件传递方案 A 前端改造复杂 → 可先实施方案 B（同步等待）作为过渡
- **风险**：`interrupt()` 在 try/catch 内被吞 → `executeWrite` 节点的 interrupt 调用在所有 try/catch 之外
- **回退**：`engine='legacy'`

---

## Phase 4 — 默认切换 + 清理

**目标**：LangGraph 引擎成为默认，legacy 引擎退役（或保留冷启动 fallback）。

### 任务清单

1. **浸泡**（1 周）：
   - 默认仍 `legacy`，但鼓励用户切换 `langgraph` 试用
   - 监控：检查点 DB 体积、token 消耗、错误率
   - 修复发现的问题

2. **默认切换**：
   - `ai_config.engine` 默认改 `langgraph`
   - 新会话默认用 LangGraph
   - 现有会话保持原 engine（避免中途切换）

3. **会话迁移**（可选）：
   - 由于双引擎共享 `ai_messages`/`ai_conversations`，会话可跨引擎继续
   - 加 "迁移到新引擎" 按钮（仅切换 `engine` flag，无数据迁移）

4. **legacy 引擎处置**：
   - **选项 A（推荐）**：保留 `ai-orchestrator.js` 作为冷启动 fallback（若 LangGraph 依赖加载失败）
   - **选项 B**：删除 legacy 路径，简化代码
   - **选项 C**：保留 1 版本后删除

5. **移除 feature flag**（若选 B/C）：
   - 删 `ai_config.engine` 列
   - 删 `ai-chat.js` 的分支逻辑

### 验收

- [ ] 默认 `engine='langgraph'`，新用户开箱即用 LangGraph
- [ ] 1 周浸泡无严重 bug
- [ ] 检查点 DB 体积合理（< 100 MB）
- [ ] token 消耗在预算内

---

## 跨阶段约束

### 数据兼容性

- `ai_messages`、`ai_conversations`、`ai_audit_log`、`ai_config`、`ai_models`、`ai_prompt_shortcuts`、`ai_prompt_templates` 全阶段保留
- LangGraph 引擎既写 `ai_messages`（保持兼容）又写检查点（运行时状态）
- 会话可跨引擎继续（共享 `ai_messages`）

### SSE 协议兼容性

- 全阶段保持现有 SSE 事件类型
- 唯一行为差异：`text_delta` 真实 token 速度（Phase 1 起）
- Phase 3 起 `write_confirmation` 的 `confirmation_id` = LangGraph interrupt `id`（格式可能变，但前端不依赖具体格式）

### Provider 兼容性

- 全阶段保留 `ai-gateway.js`
- 适配器调用网关，provider 矩阵不变
- Phase 1 需 OpenAI/DeepSeek/Ollama 三 provider 回归测试

### 回退路径

- 任何阶段失败：`ai_config.engine='legacy'`，立即回退
- Phase 0 的 legacy 修补永久保留（即使最终选 LangGraph，legacy 引擎也获重启生存性）

---

## 决策检查点

| 检查点 | 时机 | 决策 |
|---|---|---|
| **DC1** | Phase 0 完成后 | **已决策：先做 Phase 0 再决定**。Phase 0 完成后评估：legacy 引擎重启生存性是否满足？是否需要时间旅行调试？是否预期未来多代理扩展？若满足且无扩展需求可止步（方案 B），否则继续 LangGraph（方案 A） |
| **DC2** | Phase 1 完成后 | 自定义 `SqliteSaver` 是否稳定？是否需切换到官方 `better-sqlite3` 路径？ |
| **DC3** | Phase 2 完成后 | 弱本地模型（Ollama llama-class）工具选择是否退化？是否需启用确定性工具路由（DESIGN §10.4）？ |
| **DC4** | Phase 3 完成后 | `/confirm` 后续事件方案 A vs B 是否需调整？ |
| **DC5** | Phase 4 浸泡后 | legacy 引擎处置：A 保留 fallback / B 删除 / C 保留 1 版本后删除？ |

---

## 工时估算

| 阶段 | 估算 | 累计 |
|---|---|---|
| Phase 0 | 1 周 | 1 周 |
| Phase 1 | 3–4 天 | ~1.5 周 |
| Phase 2 | 2 天 | ~2 周 |
| Phase 3 | 3 天 | ~2.5 周 |
| Phase 4 | 1 周（含浸泡） | ~3.5 周 |

**总工期**：~3–4 周（含 1 周浸泡）。单人开发，不含 code review 与测试自动化时间。

**对比修补路径**（`ALTERNATIVES.md`）：~2–3 周，但无架构升级，无时间旅行调试，无未来扩展性。

---

## 测试策略

### 单元测试

- `SqliteSaver`：round-trip（put → getTuple → list）、并发写、大状态
- `LangChainModelAdapter`：消息转换、流式 chunk 转换、临时 override
- `StreamTransformer`：各 LangGraph 事件 → SSE 事件映射
- 工具适配器：35 工具 schema 兼容性

### 集成测试

- Phase 1：纯聊天 SSE 流，三 provider
- Phase 2：24 读工具，覆盖每工具至少一例
- Phase 3：11 写工具的 interrupt/resume 流程，含重启恢复
- 跨引擎：同会话 legacy → langgraph 切换继续

### E2E 测试

- 参考 `.opencode/skills/browser-e2e-testing/SKILL.md`
- 桌面端：puppeteer-core + chromium snap
- 关键场景：发消息 → 工具调用 → 写确认 → 重启 → 恢复

### 回归

- 每 phase 合并前：`engine='legacy'` 全流程回归
- 每 phase 合并前：`engine='langgraph'` 新功能验收
