# FilmGallery Agent 系统架构设计

> 本文档是 `README.md` 的实施细节展开。所有 API、包名、文件路径均经实际验证（npm registry / 项目源码）。无法验证的项明确标注 **(unverified)**。

## 目录

1. [现状审计](#1-现状审计)
2. [设计目标与非目标](#2-设计目标与非目标)
3. [整体架构](#3-整体架构)
4. [状态模式（State Schema）](#4-状态模式state-schema)
5. [图拓扑与节点](#5-图拓扑与节点)
6. [检查点持久化（自定义 SqliteSaver）](#6-检查点持久化自定义-sqlitesaver)
7. [Provider 适配层](#7-provider-适配层)
8. [流式协议映射（LangGraph → SSE）](#8-流式协议映射langgraph--sse)
9. [中断与写确认恢复流程](#9-中断与写确认恢复流程)
10. [工具组织与命名空间](#10-工具组织与命名空间)
11. [记忆系统](#11-记忆系统)
12. [安全修复](#12-安全修复)
13. [移动端对齐](#13-移动端对齐)
14. [依赖与体积分析](#14-依赖与体积分析)
15. [未解决问题与开放议题](#15-未解决问题与开放议题)

---

## 1. 现状审计

### 1.1 现有架构（保留部分）

现有 AI 助手是手工实现的 OpenAI 兼容 Chat Completions 客户端，分层清晰：

```
ai-orchestrator.js  (async generator, SSE 事件源)
        │
        ▼
ai-gateway.js       (OpenAI SDK 封装, 多 provider, configHash 缓存)
        │
        ▼
ai-tools/           (8 模块, 35 工具, 3 级安全模型)
```

**资产（应保留）：**
- `ai-gateway.js` 的多 provider 支持（OpenAI/Azure/DeepSeek/Ollama/Groq/vLLM/GLM，通过 `api_base_url` + `api_key` 切换），以及 per-request 临时 override 机制（`ai-gateway.js:23-38`）
- 35 个工具的 `{schema, handler, type, securityLevel}` 注册表（`ai-tools/index.js`）
- 3 级安全模型：L0 自动执行 / L1 确认 / L2 确认+预览
- `sanitizeToolResult` 的 `<database_result>` XML 包裹防注入（`ai-tools/helpers.js:9-11`）
- `ai_audit_log` 审计表
- 7 张 `ai_*` 表的结构与数据
- SSE 事件协议（`conversation_id`/`tool_call`/`write_confirmation`/`tool_result`/`text_delta`/`done`）
- 桌面端 `AIPanel.jsx` 的可调宽度面板、模板/模型选择器、历史列表
- 移动端 `AIChatSheet.tsx` 的 bottom-sheet UI 与 `AbortController` 支持

### 1.2 痛点清单（本方案需修复）

| # | 痛点 | 位置 | 严重度 |
|---|---|---|---|
| P1 | 假流式：最终回复逐字符 emit 已完成内容 | `ai-orchestrator.js:317-320` | 高 |
| P2 | 工具阶段完全不流式 | `ai-orchestrator.js:190-282` | 中 |
| P3 | 30 条消息硬编码滑动窗口，无摘要、无 token 计数 | `ai-orchestrator.js:73` | 中 |
| P4 | 待确认写操作存内存 `Map`，重启即丢，多进程不可用 | `ai-orchestrator.js:18, 24-47` | **高** |
| P5 | `stats-tools.js` 的 `year` 参数字符串插值 SQL 注入 | `stats-tools.js:95-96, 138-159, 204, 216, 230, 242, 255, 290, 316` | **高（安全）** |
| P6 | API key 明文存 SQLite | `ai_config.api_key`, `ai_models.api_key` | 中（安全） |
| P7 | 移动端无 `write_confirmation` 处理（工具永远显示 running 直到 60s 超时） | `AIChatSheet.tsx` switch 缺 case | 高 |
| P8 | 移动端 `context` 硬编码 `null`，AI 完全不知用户在哪个屏幕 | `HeaderButtons.tsx:85` | 高 |
| P9 | 移动端无图片附件、无模板、无模型选择、无历史 | `AIChatSheet.tsx` | 中 |
| P10 | `loadConversationMessages` 丢弃 `tool_calls`，历史会话只剩纯文本 | `useAIChat.js:194-203` | 中 |
| P11 | `TOOL_LABELS` 在桌面与移动端均过时（引用不存在的 `manage_tags`/`update_roll_info`） | `ToolCallIndicator.jsx:5-19`, `AIChatSheet.tsx:13-23` | 低 |
| P12 | `monthly_budget_usd` 字段存在但从不强制 | `ai-config.js:37`, 全代码无检查 | 中 |
| P13 | 确认 60s 超时对人类审阅批量改动太短 | `ai-orchestrator.js:24, 256` | 中 |
| P14 | 桌面 SSE `fetch` 无 `AbortSignal`（移动端有） | `api/ai.js:57-95` | 低 |
| P15 | `listModels()` 吞掉所有错误返回 `null` | `ai-gateway.js:138-140` | 低 |

### 1.3 不在本方案范围内（明确排除）

- **RAG / 向量检索 / CLIP 嵌入 / sqlite-vec** —— 单用户几千张照片，结构化搜索已足够；"找相似照片"用 LLM 视觉直接看图。`sqlite-vec` 在 Electron 跨平台原生扩展维护成本远超收益。两个子代理均强烈反对引入。
- **多代理 supervisor / 子代理 / 规划节点** —— 35 工具远低于路由阈值；单用户场景多代理只增成本不增价值。若未来工具数突破 ~60 或需独立视觉模型人格，再评估。
- **服务端 TypeScript 迁移** —— `AGENTS.md` 明确客户端 JSX；服务端无 `.ts`。LangGraph.js 提供 CJS 构建，`require()` 即可用。
- **多用户 / 多租户** —— FilmGallery 是单用户产品，本方案不引入租户隔离。
- **本地视觉模型 / 自动标注流水线** —— 视觉能力继续委托外部 LLM（gpt-4o 等）。

---

## 2. 设计目标与非目标

### 目标

| ID | 目标 | 验收标准 |
|---|---|---|
| G1 | 重启后保留待确认写操作 | 服务器重启后，`GET /api/ai/conversations/:id` 返回 `pending_confirmation`，前端可恢复确认 UI |
| G2 | 真实 token 级流式 | `text_delta` 事件以 LLM 实际生成速度到达，非逐字符 |
| G3 | 工具执行期间有进度反馈 | `tool_call` 事件在 LLM 决定调用工具的瞬间发出，非等工具返回 |
| G4 | 双引擎共存可回退 | `ai_config.engine` 切换 `legacy`/`langgraph`，同一会话可跨引擎继续 |
| G5 | 移动端功能对齐桌面 | write_confirmation 处理、context 传递、图片附件 |
| G6 | 修复全部安全痛点 | SQL 参数化、API key 加密、预算强制 |
| G7 | 保留现有 SSE 协议 | 桌面与移动客户端零协议改动 |
| G8 | 保留现有 35 工具与 3 级安全模型 | 工具行为不变，仅修复 SQL 注入 |
| G9 | 保留多 provider 支持 | OpenAI/Azure/DeepSeek/Ollama/Groq/vLLM/GLM 全部继续工作 |
| G10 | 时间旅行调试能力 | 可加载任意历史检查点查看状态快照 |

### 非目标

- 不追求多代理编排能力（supervisor/swarm）
- 不追求 RAG/向量检索
- 不追求服务端 TS 迁移
- 不追求多用户隔离
- 不追求本地视觉模型

---

## 3. 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│  客户端（桌面 AIPanel.jsx / 移动 AIChatSheet.tsx）              │
│    ↓ POST /api/ai/chat  (SSE)                                    │
│    ↑ SSE 事件流（协议不变）                                       │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│  server/routes/ai-chat.js                                        │
│    if (config.engine === 'langgraph')                           │
│      yield* langgraphOrch.handleMessage(...)                     │
│    else                                                          │
│      yield* legacyOrch.handleMessage(...)        ← 保留 fallback │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│  LangGraph 单代理图（StateGraph）                                │
│                                                                  │
│  START → loadContext → agent ──┐                                 │
│                          ↑     │                                 │
│                          │     ▼                                 │
│                          │  guardWrite  (securityLevel>=1)      │
│                          │     │                                 │
│                          │     ▼                                 │
│                          │  interrupt()  ← 暂停, 检查点持久化   │
│                          │     │                                 │
│                          │     ▼ (Command({resume}) 恢复)        │
│                          │  executeWrite → audit                │
│                          └─────┘                                 │
│                          │                                       │
│                          ▼ (无 tool_calls)                       │
│                         END                                       │
│                                                                  │
│  检查点: 自定义 SqliteSaver → ai_checkpoints.db                  │
│  Provider: ai-gateway.js → LangChainModelAdapter                 │
│  工具: ai-tools/index.js → LangGraphToolAdapter (35 工具)        │
│  流式: StreamTransformer → 现有 SSE 事件                         │
└──────────────────────────────────────────────────────────────────┘
```

### 关键设计选择

| 选择 | 理由 |
|---|---|
| **单代理，非 supervisor** | 35 工具 < ~50 阈值；单用户场景 supervisor 路由 LLM 调用是纯开销；两个子代理一致同意 |
| **自定义 SqliteSaver，非官方 checkpoint-sqlite** | 官方包硬依赖 `better-sqlite3`，会与现有 `sqlite3` 共存，加倍 Electron 原生重建负担；自写 ~150 LOC 避免此问题 |
| **保留 ai-gateway.js + 适配器** | 现有网关的 configHash 缓存、临时 override、多 provider 支持是资产；重写会丢失 |
| **保留 SSE 协议 + StreamTransformer** | 桌面与移动客户端零改动；LangGraph 流式事件投影到现有形状 |
| **保留 35 工具 + 3 级安全** | 工具架构是资产；仅修复 SQL 注入与命名空间分组 |
| **interrupt() 替代内存 Map** | 检查点原生持久化，重启后可恢复；正确原语而非补丁 |
| **stream.messages 替代字符 emit** | 真实 token 速度；LangGraph 原生支持 |

---

## 4. 状态模式（State Schema）

LangGraph 状态用 `Annotation.Root` 定义。本方案状态精简，避免检查点膨胀（review 子代理警告：含 base64 图片的状态可达 1MB+，每次节点转移都序列化）。

```js
const AgentState = Annotation.Root({
  // 消息列表（LangGraph 自动管理 reducer: 追加）
  messages: Annotation({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  // 当前会话 ID（= ai_conversations.id, = thread_id）
  conversationId: Annotation<string>,

  // 前端上下文快照（路由、实体类型、实体 ID、过滤器）
  context: Annotation<ContextSnapshot>,

  // 附件图片引用（photo_id 列表，非 base64；loadContext 节点按需加载）
  imageRefs: Annotation<string[]>,

  // 当前使用的模型 override（来自前端模型选择器）
  modelOverride: Annotation<ModelConfig | null>,

  // 模板 ID（系统提示人格）
  templateId: Annotation<string | null>,

  // 待确认写操作（interrupt 恢复时填充）
  pendingWriteDecision: Annotation<{ approved: boolean; reason?: string } | null>,

  // 审计队列（executeWrite 节点消费后清空）
  auditQueue: Annotation<AuditEntry[]>,

  // 累计 token 消耗（用于预算强制）
  tokensUsed: Annotation<number>,
});
```

### 设计要点

- **`messages` 不含 base64 图片**：图片以 `photo_id` 引用存于 `imageRefs`，`loadContext` 节点在每次 LLM 调用前按需从 DB 加载并 base64 编码注入最后一条 user 消息。这样检查点状态保持小（KB 级而非 MB 级）。
- **`pendingWriteDecision`**：`interrupt()` 返回值赋给此字段，`executeWrite` 节点读取它决定是否执行。
- **`auditQueue`**：工具执行产生的审计条目入队，`audit` 节点批量写入 `ai_audit_log`，避免每次工具调用都写 DB。
- **`tokensUsed`**：每次 LLM 调用后累加；`agent` 节点入口检查是否超 `monthly_budget_usd` 对应的 token 上限。

---

## 5. 图拓扑与节点

### 5.1 节点定义

| 节点 | 职责 | 输入 | 输出（state 更新） |
|---|---|---|---|
| `loadContext` | 构建 system prompt、加载历史、按需加载图片 base64 | `conversationId, context, imageRefs, templateId` | `messages: [systemMsg, ...history, userMsgWithImages]` |
| `agent` | 调用 LLM，绑定工具 schema；检查预算 | `messages, modelOverride, tokensUsed` | `messages: [aiResponseWithToolCallsOrContent]`, `tokensUsed: += usage` |
| `guardWrite` | 对 `securityLevel >= 1` 的工具调用 `interrupt()` | `messages` 末尾的 `tool_calls` | `pendingWriteDecision`（来自 interrupt 返回值） |
| `executeWrite` | 执行工具 handler，L0 工具直接执行，L1/L2 据 `pendingWriteDecision` 决定 | `messages, pendingWriteDecision` | `messages: [toolMessages...]`, `auditQueue: [entries...]` |
| `audit` | 批量写 `ai_audit_log`，清空 `auditQueue` | `auditQueue` | `auditQueue: []` |

### 5.2 边与条件路由

```
START → loadContext → agent

agent:
  if (lastMessage.tool_calls && tokensUsed < budget):
    → guardWrite
  else:
    → END

guardWrite:
  if (any tool securityLevel >= 1):
    → interrupt()  [暂停, 等待 Command({resume})]
  else:
    → executeWrite  [L0 工具直接执行]

executeWrite → audit → agent  [循环回 agent 让 LLM 看到工具结果]
```

### 5.3 关键实现细节

**`agent` 节点不包 try/catch 包 `interrupt()`**：LangGraph 的 `interrupt()` 通过抛出 sentinel 异常暂停；`executeWrite` 节点内的 `interrupt()` 调用必须在任何 try/catch 之外。现有 `ai-orchestrator.js:271-274` 的 `try { resultStr = await handler(toolArgs); } catch {}` 模式需重构。

**`guardWrite` 节点重入幂等性**：`interrupt()` 恢复时节点从头重跑。`loadContext` 的 DB 读取是幂等的（安全）；`audit` 节点的 INSERT 必须在 `executeWrite` 之后（已是如此），避免重跑产生重复审计。

**预算强制**：`agent` 节点入口检查 `tokensUsed >= monthlyBudgetTokens`，超限则不调用 LLM，直接返回固定错误消息。`monthlyBudgetTokens` 由 `monthly_budget_usd` × 估算 token 单价计算（粗略：$10 ≈ 2M tokens for gpt-4o-mini）。

---

## 6. 检查点持久化（自定义 SqliteSaver）

### 6.1 为什么不用官方 `@langchain/langgraph-checkpoint-sqlite`

官方包 `@langchain/langgraph-checkpoint-sqlite@1.0.3` 的 `dependencies` 硬依赖 `better-sqlite3 ^12.10.0`（同步 API）。FilmGallery 用 `sqlite3 ^5.1.7`（异步 API）。两者是**不同的原生模块**，共存意味着：

- Electron `@electron/rebuild` 需重建两个 C++ 模块（`desktop-ci-build` skill 已记录 libraw/sharp 重建之痛）
- CI 复杂度翻倍（Windows VS、macOS libraw 链接路径、Linux ABI）
- 安装包体积 +~1.5 MB/平台（`better-sqlite3` 单平台 `.node`）
- 两个 SQLite 实现并存，行为差异（WAL 模式、并发）易引入难调 bug

### 6.2 自定义 `SqliteSaver` 实现

实现 `BaseCheckpointSaver` 接口的 4 个方法：`put`、`putWrites`、`getTuple`、`list`。使用现有 `sqlite3` 的 `runAsync`/`getAsync`/`allAsync`。

**存储位置**：独立文件 `ai_checkpoints.db`（与主 `film.db` 分离），避免检查点 churn 碎片化主库。

**Schema**（在 `ai_checkpoints.db` 内）：

```sql
CREATE TABLE checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  metadata TEXT,        -- JSON
  checkpoint TEXT,      -- JSON (serialized checkpoint blob)
  created_at TEXT,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  blob TEXT,            -- JSON
  created_at TEXT,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, channel, idx)
);

CREATE INDEX idx_checkpoints_thread ON checkpoints(thread_id, checkpoint_id);
CREATE INDEX idx_writes_lookup ON checkpoint_writes(thread_id, checkpoint_ns, checkpoint_id);
```

**Durability 模式**：`"exit"`（在 interrupt/error/finish 时刷盘）—— 足够 HITL；如需更强可用 `"sync"`。

**实现规模**：~150 LOC，参考 `@langchain/langgraph-checkpoint-sqlite` 源码改写为 async + `sqlite3` API。**(BaseCheckpointSaver 的 TS 接口签名未完全验证，实施前需对照 `@langchain/langgraph-checkpoint` 的 typings 确认。)**

### 6.3 检查点清理

单用户低体积，但需防止无限增长：

- 每会话保留最近 N=20 个检查点（可配）
- 会话删除时级联清理其检查点（`DELETE FROM checkpoints WHERE thread_id = ?`）
- 后台 janitor（每小时）：清理 > 30 天的已完成会话检查点

---

## 7. Provider 适配层

### 7.1 保留 `ai-gateway.js`

现有网关已支持 OpenAI/Azure/DeepSeek/Ollama/Groq/vLLM/GLM，通过 `api_base_url` + `api_key` 切换；带 configHash 客户端缓存（`ai-gateway.js:19-69`）与 per-request 临时 override（`ai-gateway.js:23-38`）。重写会丢失这些能力。

### 7.2 `LangChainModelAdapter`

LangGraph 节点期望模型有 `.invoke()` / `.stream()` 返回 `BaseMessage[]`。现有网关返回原始 OpenAI 形状。适配器 ~80 LOC 翻译：

```js
class LangChainModelAdapter extends BaseChatModel {
  constructor(aiGateway, modelConfig) {
    super();
    this.gateway = aiGateway;
    this.modelConfig = modelConfig;  // {model_id, api_base_url?, api_key?, temperature, max_tokens}
  }

  async _generate(messages, options) {
    // BaseMessage[] → OpenAI messages
    const openaiMessages = messages.map(m => this.toOpenAIMessage(m));
    // 调用现有网关
    const response = await this.gateway.chatCompletion({
      messages: openaiMessages,
      model: this.modelConfig.model_id,
      tools: options.tools,
      temperature: this.modelConfig.temperature,
      max_tokens: this.modelConfig.max_tokens,
    });
    // OpenAI response → BaseMessage
    return this.toLangChainResult(response);
  }

  async *_streamResponseChunks(messages, options) {
    // 同上但调用 gateway.chatCompletionStream
    for await (const chunk of this.gateway.chatCompletionStream({...})) {
      yield this.toLangChainChunk(chunk);
    }
  }
}
```

**关键**：适配器内部调用 `aiGateway.chatCompletion` / `chatCompletionStream`，保留 `setTemporaryOverride` 机制（`ai-orchestrator.js:196-204` 的 per-request 模型 override 继续工作）。

### 7.3 备选方案（不推荐）

直接用 `@langchain/openai` 的 `ChatOpenAI({baseURL, apiKey})` 替代网关。**会丢失** configHash 客户端缓存与临时 override。仅在适配器维护成本过高时考虑。

---

## 8. 流式协议映射（LangGraph → SSE）

### 8.1 现有 SSE 事件（保持不变）

| 事件类型 | 字段 | 来源 |
|---|---|---|
| `conversation_id` | `conversation_id` | 会话创建/加载 |
| `tool_call` | `tool_call_id, tool_name, args, security_level` | LLM 决定调用工具 |
| `write_confirmation` | `confirmation_id, tool_call_id, tool_name, args, security_level` | 待用户确认的写操作 |
| `tool_result` | `tool_call_id, tool_name, result, status` | 工具执行完成 |
| `text_delta` | `delta` | LLM 文本流 |
| `stream_start` | （无字段） | 流式开始（可选） |
| `done` | `conversation_id` | 完成 |
| `error` | `message` | 错误 |

### 8.2 LangGraph 流式源 → SSE 事件映射

使用 `graph.streamEvents(input, {version: "v3"})`，注册自定义 `StreamTransformer` 消费 `tools`/`messages`/`interrupts` 通道，投影到命名 `StreamChannel("sse")`。

| LangGraph 流式源 | → SSE 事件 | 备注 |
|---|---|---|
| 运行开始（首个 `stream.values` 快照, `thread_id` 已知） | `conversation_id` | 开始时发一次；`thread_id` = `ai_conversations.id`（字符串化） |
| `lifecycle` `started` for agent 节点 | `stream_start` | 可选；现有客户端容忍其缺失 |
| `tools` 通道 → `tool-started` | `tool_call` `{tool_call_id, tool_name, args, security_level}` | 1:1 映射；`security_level` 来自 `getToolSecurityLevel(name)` |
| `stream.interrupts`（或 state 中 `__interrupt__`） | `write_confirmation` `{confirmation_id, tool_call_id, tool_name, args, security_level}` | `confirmation_id` = LangGraph interrupt `id`（跨恢复稳定） |
| `tools` 通道 → `tool-finished` | `tool_result` `{tool_call_id, tool_name, result, status}` | `status` = `confirmed`/`rejected`/`auto`；结果截断 200 字符（现有行为） |
| `messages` 通道 → `content-block-delta`（`text-delta`） | `text_delta` `{delta}` | **真实 token 级流式**，替代 `ai-orchestrator.js:318-320` 逐字符 |
| `messages` `reasoning-delta`（若模型发出） | （新）`reasoning_delta` | 可选新事件；前端可忽略 |
| 运行结束（`stream.output` resolve） | `done` `{conversation_id}` | |
| 节点抛错 / `lifecycle` `failed` | `error` `{message}` | |

### 8.3 实现要点

- Express 路由迭代 `stream.extensions.sse`，写 `data: ${JSON.stringify}\n\n`，与现有 `ai-chat.js:61` 完全一致
- **前端零改动**：桌面 `useAIChat.js` 与移动 `aiApi.ts` 的 SSE 解析逻辑不变
- 唯一行为差异：`text_delta` 以真实 token 速度到达，而非逐字符

---

## 9. 中断与写确认恢复流程

### 9.1 正常路径

1. 用户发消息 → `POST /api/ai/chat` → 路由开 SSE，调 `graph.streamEvents({messages:[...]}, {configurable:{thread_id: convId}})`
2. `agent` 节点调 LLM → LLM 返回 `tool_calls: [update_photo_metadata(...)]`
3. `guardWrite` 节点见 `securityLevel=1` → 调 `interrupt({tool, args, preview})`
4. LangGraph **抛 sentinel 异常** → 检查点写 `checkpoints`/`checkpoint_writes`（durability `"exit"` 在 interrupt 时刷盘）→ `stream.interrupted=true`, `stream.interrupts=[{id, payload}]`
5. Transformer emit `write_confirmation` SSE 事件，`confirmation_id = interrupt.id`。SSE 流结束（运行暂停，非结束）
6. 前端显示 Allow/Reject → `POST /api/ai/confirm/:confirmationId` 带 `{decision:'confirmed'}`
7. 后端查 `thread_id`（存 `ai_pending_writes` 表，或从 `graph.getState` 推导），调 `graph.invoke(new Command({ resume: {approved:true} }), {configurable:{thread_id}})`
8. `guardWrite` 节点**从头重跑** → `interrupt()` 返回 resume 值 → 路由到 `executeWrite`
9. `executeWrite` 执行 handler，入队审计 → `tools` 通道 emit `tool-finished` → Transformer emit `tool_result` SSE
10. 控制回 `agent` 节点 → LLM 产最终文本 → `messages` 通道 emit `text-delta`s → `done`

### 9.2 检查点状态（中断线程）

- `checkpoints` 表一行：`thread_id`, `checkpoint_id`, `next=['guardWrite']`, `metadata.source='interrupt'`
- `checkpoint_writes` 存同 super-step 已完成节点的待写（`agent` 节点输出已持久，**恢复时不重跑 LLM**）
- interrupt payload 本身存于任务的 `interrupts` 数组

### 9.3 边界情况处理

| 边界情况 | 处理 |
|---|---|
| **超时（现有 60s 行为）** | LangGraph 无内置超时。路由层 `setTimeout` 调 `graph.invoke(new Command({resume:{approved:false}}), config)` 注入拒绝。中断状态持久，SSE socket 关闭后仍可工作。**建议超时改为 5 分钟**（P13） |
| **陈旧中断**（用户从不确认，服务器持续运行） | 检查点无限留存。janitor 每 N 分钟找 > X 小时的中断，resume `{approved:false}`（或留置——单用户低体积） |
| **服务器重启中断中** | **这正是要修的 bug——LangGraph 免费修复。** 重启后 `graph.getState({configurable:{thread_id}})` 读持久检查点；`next` 非空 → 会话"暂停中"。`GET /api/ai/conversations/:id` 返回 `pending_confirmation`（若 `getState().tasks[].interrupts.length > 0`）。前端重渲染确认 UI；用户确认；恢复继续 |
| **并发中断**（并行分支） | LangGraph 支持同 super-step 多 `interrupt()`；resume 用 `{interrupt_id: value}` map。本图为顺序（无 fan-out），不会发生，除非未来并行化 |
| **中断待定时用户发新消息** | LangGraph "double-texting" 问题。路由层拒绝新消息，返 `409 Conflict {error: 'pending confirmation'}` 直到中断解决。**勿用 `Command({update})` 注入新消息**——文档明确禁止 |
| **错误 thread_id 恢复** | `graph.invoke(Command({resume}), {configurable:{thread_id:'X'}})` 若 X 无待中断 → LangGraph 视为正常 invoke，resume 值静默丢弃。服务端校验：仅当 `getState().tasks[].interrupts.length > 0` 才调 resume |
| **中断前非幂等副作用** | 文档警告：副作用移到中断后，或做幂等。现有 `auditLog()` 在写后——安全。但 `loadContext` 的 `getAsync('SELECT...')` 是读——重跑安全 |
| **中断 payload 过大** | 文档警告：仅 JSON 可序列化值。`args`（工具参数）安全；**勿塞完整 photo blob**——前端按 `photo_id` 重取 |

### 9.4 `/confirm/:id` 路由改造

```js
// server/routes/ai-chat.js
router.post('/confirm/:confirmationId', async (req, res) => {
  const { confirmationId } = req.params;
  const { decision } = req.body;  // 'confirmed' | 'rejected'

  // 查 thread_id
  const pending = await db.getAsync(
    'SELECT thread_id FROM ai_pending_writes WHERE confirmation_id = ?',
    [confirmationId]
  );
  if (!pending) return res.status(404).json({ error: 'unknown confirmation' });

  // 恢复图
  await graph.invoke(
    new Command({ resume: { approved: decision === 'confirmed' } }),
    { configurable: { thread_id: pending.thread_id } }
  );

  // 标记已处理
  await db.runAsync(
    'UPDATE ai_pending_writes SET status = ?, resolved_at = ? WHERE confirmation_id = ?',
    [decision, new Date().toISOString(), confirmationId]
  );

  res.json({ ok: true });
});
```

**注意**：恢复后的图执行产生新的 SSE 事件流，需通过另一通道（WebSocket 或前端轮询 `GET /api/ai/conversations/:id` 获取后续 `tool_result`/`text_delta`）。**这是与现有架构的差异点**：现有架构在同一 `handleMessage` async generator 内暂停等待，SSE 流不断开。LangGraph 的中断会结束当前流。

**两种处理方案**：
- **方案 A（推荐）**：`/confirm/:id` 返回新 SSE 流，前端切换到该流消费后续事件。需前端小改：`confirmAction` 后开新 SSE 连接。
- **方案 B**：`/confirm/:id` 同步等待图完成，返回最终结果。前端不显示中间事件，仅显示最终消息。简单但 UX 退化。

**实施时选 A**，前端改动小（`useAIChat.confirmAction` 后重连 SSE）。

---

## 10. 工具组织与命名空间

### 10.1 现状：35 工具，8 模块

| 模块 | 工具数 | 工具名 |
|---|---|---|
| `photo-tools.js` | 9 | search_photos, get_photo_detail, get_roll_photos, get_photo_neighbors, update_photo_metadata, batch_update_photos, set_photo_rating, toggle_photo_favorite, delete_photo |
| `roll-tools.js` | 5 | list_rolls, get_roll_detail, update_roll, set_roll_cover, set_roll_preset |
| `film-tools.js` | 4 | get_film_info, list_film_items, update_inventory_item, record_film_purchase |
| `equipment-tools.js` | 3 | search_equipment, add_equipment, update_equipment |
| `tag-tools.js` | 4 | list_tags, create_tag, attach_tags, detach_tags |
| `shot-log-tools.js` | 3 | get_shot_log, update_shot_log, add_shot_log_entry |
| `stats-tools.js` | 4 | get_stats, analyze_shooting_patterns, cost_analysis, equipment_usage_stats |
| `render-tools.js` | 3 | get_render_params, suggest_render_params, batch_apply_preset |

### 10.2 设计决策：保留 35 工具，单代理绑定全部

**不引入 supervisor，不引入 LLM 路由**。理由：
- 35 工具 schema ≈ 6–8 KB，现代工具调用模型（GPT-4o-class、DeepSeek-V3、GLM-4.6）可无困惑处理
- 单用户查询几乎总跨单一领域，路由 LLM 调用是纯开销
- LangGraph 最佳实践：确定性步骤 + 代理步骤混合，而非多代理 LLM

### 10.3 命名空间分组（代码组织，非运行时）

`ai-tools/index.js` 重构为导出分组 map，便于维护与未来按上下文过滤：

```js
const TOOL_GROUPS = {
  photo:    { tools: [...9], domain: 'photo' },
  roll:     { tools: [...5], domain: 'roll' },
  film:     { tools: [...4], domain: 'film' },
  equipment:{ tools: [...3], domain: 'equipment' },
  tag:      { tools: [...4], domain: 'tag' },
  shot_log: { tools: [...3], domain: 'shot_log' },
  stats:    { tools: [...4], domain: 'stats' },
  render:   { tools: [...3], domain: 'render' },
};
```

### 10.4 可选：确定性工具路由（仅弱模型需要）

若观察到弱本地模型（Ollama llama-class）工具选择退化，在 `loadContext` 节点加**确定性**（非 LLM）路由，按 `context.route` 过滤 schema：

| 路由前缀 | 暴露工具组 |
|---|---|
| `/rolls` | photo + roll + tag |
| `/filmlab` | render + photo |
| `/films` | film + stats |
| `/equipment` | equipment + stats |
| `/photos` | photo + tag |
| 默认/全暴露 | 全部 35 |

**默认不启用**，仅作为弱模型降级路径。

### 10.5 语义重叠工具的审视（review 子代理指出）

`set_photo_rating`、`toggle_photo_favorite`、`update_photo_metadata` 三者在 rating 字段语义重叠。**不合并**（会破坏现有用户习惯与审计日志），但在工具 description 中明确指引："批量改 rating 用 batch_update_photos；单张改用 set_photo_rating；改其他字段用 update_photo_metadata"。

---

## 11. 记忆系统

### 11.1 短期记忆

LangGraph 状态 `messages` 数组即短期记忆。**不硬编码 30 条窗口**（P3），改用 token 计数：

- `loadContext` 节点入口计算 `messages` 总 token（字符近似：英文 1 token ≈ 3.5 字符，中文 ≈ 1.5）
- 超过阈值（如 8K tokens）触发摘要

### 11.2 长期记忆（摘要）

新增 `ai_messages.summary` 列（TEXT, nullable）。当 `messages` 超阈值：

1. 取最旧 N 条消息
2. 后台 LLM 调用生成摘要（注入 `summary` 列）
3. 从 `messages` 数组移除已摘要消息，替换为单条 `{role:'system', content:'Earlier conversation summary: ...'}`
4. 检查点自动持久化新状态

**不引入实体记忆**（per-photo/roll 事实库）——单用户场景过度工程。若未来需要，再评估。

### 11.3 图片引用恢复（P10 修复）

`ai_messages.image_refs` 列已存在但 `loadConversationMessages` 不重注入。修复：`loadContext` 节点从 DB 读 `image_refs`，按需 base64 编码注入最后一条 user 消息。这样重开含图片分析的会话不丢图。

---

## 12. 安全修复

### 12.1 SQL 注入（P5，最高优先级）

`stats-tools.js` 的 `year` 参数在 9 处字符串插值。**修复**：全部改参数化查询。

```js
// Before (stats-tools.js:95)
sql += ` AND strftime('%Y', r.date_loaded) = '${String(year)}'`;

// After
sql += ` AND strftime('%Y', r.date_loaded) = ?`;
params.push(String(year));
```

涉及行：`stats-tools.js:95-96, 138-159（8 处 group_by 分支）, 204, 216, 230, 242, 255, 290, 316`。约 20 行改动。**Phase 0 即修复**，不依赖 LangGraph 迁移。

### 12.2 API key 加密（P6）

用 Electron `safeStorage`（Electron 43 已可用）加密存储：

- 写入前：`safeStorage.encryptString(apiKey)` → base64
- 读取时：`safeStorage.decryptString(Buffer.from(b64, 'base64'))` → 明文
- Docker/NAS 模式无 Electron：fallback 到环境变量 `AI_API_KEY`，DB 不存明文也不存密文

**注意**：`safeStorage` 依赖 OS keychain（macOS Keychain、Windows DPAPI、Linux Secret Service）。Linux NAS 无桌面环境时可能不可用——此时强制走环境变量。

### 12.3 预算强制（P12）

- `ai_config.monthly_budget_usd` 已存在
- 新增 `ai_config.monthly_tokens_used`（已存在但未维护）+ `ai_config.budget_reset_at`
- 每次 LLM 调用后：`UPDATE ai_config SET monthly_tokens_used = monthly_tokens_used + ?`
- `agent` 节点入口：若 `monthly_tokens_used >= monthly_budget_usd * tokensPerDollar`，拒绝调用，返回预算超限消息
- 每月 1 号 janitor 重置 `monthly_tokens_used = 0`

### 12.4 per-request 模型 override 安全（review 子代理指出）

`ai-gateway.js:47-54` 将 DB 中任意 `api_base_url` 传给 OpenAI SDK。恶意/误配的 model 行可将 API key 外泄到攻击者端点。**修复**：

- `ai_models` 表加 `api_base_url_allowlist` 列（JSON 数组）
- `setTemporaryOverride` 校验 `api_base_url` 在 allowlist 内
- 默认 allowlist 为空（仅允许主 `ai_config.api_base_url`）

### 12.5 审计日志 `old_values` 填充

`ai_audit_log.old_values` 列已存在但从不填充（`ai-orchestrator.js:112-120` 仅存 `result_summary`）。修复：`executeWrite` 节点对 L1/L2 工具，执行前先 `SELECT` 旧值，执行后写入 `old_values`。

---

## 13. 移动端对齐

### 13.1 `write_confirmation` 处理（P7）

`AIChatSheet.tsx` 的 SSE 事件 switch 加 case：

```ts
case 'write_confirmation':
  setUpcomingConfirmation({
    confirmationId: data.confirmation_id,
    toolName: data.tool_name,
    args: data.args,
    securityLevel: data.security_level,
  });
  break;
```

UI 显示 Allow/Reject 按钮（复用桌面 `ToolCallIndicator.jsx` 逻辑）。

### 13.2 context 传递（P8）

`HeaderButtons.tsx:85` 的 `context={null}` 改为从 React Navigation route params 推导：

```ts
const context = useAIContext();  // 新 hook, 类比桌面 useAIContext.jsx
// 返回 { route, entityType, entityId, filters } 基于当前 navigation state
```

### 13.3 图片附件（P9 部分）

`AIChatSheet.tsx` 加图片选择按钮（`expo-image-picker`），base64 编码后随消息发送。复用桌面 `prepareImageAttachments` 逻辑（`ai-chat.js:243-252` 的 sharp resize 改为移动端 `expo-image-manipulator`）。

### 13.4 历史与模板（P9 部分）

- 加历史列表 bottom-sheet（复用桌面 `useAIChat.loadConversationMessages`）
- 模板选择器复用桌面 API（`GET /api/ai/templates`）

### 13.5 `TOOL_LABELS` 更新（P11）

桌面 `ToolCallIndicator.jsx:5-19` 与移动 `AIChatSheet.tsx:13-23` 的 `TOOL_LABELS` 改为从 `getToolSchemas()` 动态生成，或直接更新静态 map 覆盖全部 35 工具。

---

## 14. 依赖与体积分析

### 14.1 新增依赖

| 包 | 版本 | 体积（单平台） | 必要性 |
|---|---|---|---|
| `@langchain/core` | ^1.2.3 | 7.3 MB | 必需（peer） |
| `@langchain/langgraph` | ^1.4.8 | 4.1 MB | 必需 |
| `@langchain/openai` | ^1.5.5 | 1.9 MB | 可选（若不用适配器，直接用） |
| `better-sqlite3` | — | — | **不引入**（自定义 saver） |
| `@langchain/langgraph-supervisor` | — | — | **不引入**（单代理） |
| `zod` | — | ~600 KB | peer，可能已存在 |

**总计**：~13–15 MB JS，**0 原生模块新增**（自定义 saver 用现有 `sqlite3`）。

### 14.2 体积对比

现有 Electron 安装包已含 Electron（~90 MB）+ sharp + exiftool-vendored + libraw-native，达数百 MB。**+15 MB JS 是非问题**。真正成本是 CI 复杂度——但自定义 saver 避免了 `better-sqlite3` 的原生重建，CI 影响为零。

### 14.3 Node 版本

- `@langchain/langgraph` 需 Node >=18
- `@langchain/core` 与 `@langchain/openai` 需 Node >=20
- 项目 `package.json:10` pin `>=22.12.0` → 满足

---

## 15. 未解决问题与开放议题

### 15.1 已决策（2026-07-23 与用户确认）

1. **DC1 整体路径**：**先做 Phase 0 再决定**。Phase 0 修补 legacy 引擎（重启生存性 + 安全修复，1 周）后，根据实际效果再决定是否继续 LangGraph。Phase 0 无论如何都该做，是零成本决策点。
2. **`/confirm/:id` 后续事件传递方案**（§9.4）：**方案 A（新 SSE 流）**。`/confirm/:id` 返回新 SSE 流，前端 `confirmAction` 后开新连接消费后续 `tool_result`/`text_delta`。UX 保持，前端改动小。
3. **预算 token 单价估算**（§12.3）：**按 provider 分别配置**。`ai_models` 表加 `tokens_per_dollar` 列，每 provider 独立配置。提供常见 provider 预设（gpt-4o-mini ~200K/$、DeepSeek ~1M/$、Ollama ∞）。
4. **`safeStorage` 在 Linux NAS 不可用时的 fallback**（§12.2）：**强制环境变量**。keychain 不可用时强制走 `AI_API_KEY` 环境变量，DB 不存 key（明文/密文都不存）。NAS 用户需在 docker-compose 配 env。
5. **检查点保留策略**（§6.3）：**每会话 N=20 + 30 天清理**。每会话保留最近 20 个检查点；janitor 每小时清理 30 天前的已完成会话检查点。平衡调试需求与体积。

### 15.2 需实施前验证

1. **`BaseCheckpointSaver` 的 TS 接口签名**（§6.2）：文档描述 4 方法（`put`/`putWrites`/`getTuple`/`list`）但 TS 接口参考未完全验证。实施 Phase 1 前对照 `@langchain/langgraph-checkpoint` typings 确认。
2. **`@langchain/langgraph-supervisor` 的 `createSupervisor` API**（本方案不采用，但若未来评估需读包源码 via `scout` agent）。
3. **35 工具的参数是否全部 JSON 可序列化**（§9.3 边界）：抽查 schema 均为基本类型/数组，安全；Phase 3 前全量审计。
4. **`streamEvents(v3)` 在 `@langchain/langgraph` 1.4.x 的稳定性**：v3 是当前推荐，v1/v2 是 legacy；需在 Phase 1 集成测试验证。

### 15.3 已知限制

1. **离线模式未解决**（review 子代理指出）：Electron 捆绑服务器，用户无网时 LLM 不可用。本方案不引入本地模型。**未来可考虑 Ollama 本地模型作为 fallback provider**（现有 `ai-gateway.js` 已支持 Ollama）。
2. **多进程部署不可用**：LangGraph 检查点在单进程内协调；多进程需换 Postgres checkpointer。FilmGallery 单进程 Electron，非问题；Docker NAS 模式也是单进程。
3. **`ai_messages` 与检查点双写**：legacy 引擎写 `ai_messages`；LangGraph 引擎既写 `ai_messages`（保持兼容）又写检查点。这是有意为之（双引擎共存），但意味着 LangGraph 引擎有"DB 写 `ai_messages` + 检查点写状态"两次持久化。**优化**：LangGraph 引擎的 `audit` 节点同时写 `ai_messages`（assistant 消息）与 `ai_audit_log`，检查点仅存运行时状态。

---

## 附录 A：与 `docs/AI-AGENT-PLAN.md` 的关系

`docs/AI-AGENT-PLAN.md` 是 617 行的既有路线图，编目了工具矩阵、安全架构、回滚设计、6 阶段实施计划。本方案**supersede** 其工具矩阵（35 工具，非其早期 12 或投影的 36）与安全模型部分（3 级保留），但**继承**其回滚设计与审计思路。实施时应以本方案为准，`AI-AGENT-PLAN.md` 作为历史参考。

## 附录 B：子代理论证摘要

本方案经两个独立子代理交叉论证：

- **adversarial reviewer（DeepSeek V4 Pro）**：主张"不采用 LangGraph，直接修补现有 orchestrator 的 15 痛点，2–3 周 vs 6–12 月"。核心论据：现有 orchestrator 357 行且工作正常；LangGraph 是企业级方案，单用户桌面应用过度工程；多代理放大成本 10–30x；`better-sqlite3` 第二原生模块是 Electron 重建噩梦。
- **architecture researcher（GLM-5.2）**：主张"采用 LangGraph.js 单代理（非 supervisor），自定义 `SqliteSaver` 避免第二原生模块，保留 35 工具与 SSE 协议，5 阶段 feature flag 迁移"。核心论据：`interrupt()` + 检查点是修复重启 bug 的正确原语；`stream.messages` 是真实流式的正确原语；时间旅行调试是补丁无法提供的架构能力。

**两子代理一致点**：单代理非 supervisor、保留 35 工具、保留 SSE 协议、修复内存 Map 为持久化、不引入 RAG/嵌入、不引入多代理、保持 JS 不迁 TS。

**本方案综合**：采用 researcher 的 LangGraph 路径（因用户明确意向），但吸收 reviewer 的批评——自定义 saver 避免 `better-sslite3`、不引入 supervisor、Phase 0 同时修补 legacy 引擎使其立即获得重启生存性（reviewer 的"先修补"思路作为双引擎共存的桥梁）。完整 `ALTERNATIVES.md` 给出修补路径工时清单供决策回退。
