# LangGraph 架构设计

> 本文档定义基于 LangGraph.js 的单代理架构。核心目标：修复编排层的 22 个问题（见 DIAGNOSIS.md §4-5），建立检查点/中断/流式/状态管理的正确原语。

## 目录

1. [架构总览](#1-架构总览)
2. [状态模式](#2-状态模式)
3. [图拓扑与节点](#3-图拓扑与节点)
4. [检查点持久化](#4-检查点持久化)
5. [Provider 适配层](#5-provider-适配层)
6. [流式协议映射](#6-流式协议映射)
7. [中断与写确认](#7-中断与写确认)
8. [工具执行节点](#8-工具执行节点)
9. [防御性编程](#9-防御性编程)
10. [上下文构建](#10-上下文构建)

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│  客户端（桌面 AIPanel / 移动 AIChatSheet）                       │
│    ↓ POST /api/ai/chat (SSE)                                    │
│    ↑ SSE 事件流（协议不变）                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  server/routes/ai-chat.js                                       │
│    engine = config.engine                                       │
│    if 'langgraph': langgraphOrch.handleMessage()                │
│    if 'legacy':   legacyOrch.handleMessage()  ← 保留回退        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  LangGraph StateGraph                                           │
│                                                                 │
│  START → loadContext → agent ──────┐                            │
│                     ↑              │                            │
│                     │         guardWrite                        │
│                     │              │                            │
│                     │         interrupt() ← 检查点持久化         │
│                     │              │                            │
│                     │         executeTools                       │
│                     │         ├─ Zod 验证                        │
│                     │         ├─ 语义验证                        │
│                     │         ├─ 事务执行                        │
│                     │         └─ 结构化结果                      │
│                     └──────────────┘                            │
│                     │                                          │
│                     ▼ (无 tool_calls)                          │
│                    END                                         │
│                                                                 │
│  检查点: SqliteSaver (自定义, 基于现有 sqlite3)                 │
│  Provider: LangChainModelAdapter (包裹 ai-gateway.js)          │
│  工具: 8 域模块, 38 工具, 统一接口                              │
│  错误: {ok, error:{type, retryable, hint}} 结构化信封          │
└─────────────────────────────────────────────────────────────────┘
```

### 关键设计选择

| 选择 | 理由 |
|---|---|
| **单代理，非 supervisor** | 38 工具 < 50 阈值；单用户场景 supervisor 路由 LLM 调用是纯开销 |
| **自定义 SqliteSaver** | 官方 `@langchain/langgraph-checkpoint-sqlite` 硬依赖 `better-sqlite3`，避免引入第二个原生模块 |
| **保留 ai-gateway.js** | 多 provider 支持 + configHash 缓存 + per-request override 是资产 |
| **保留 SSE 协议** | 桌面与移动客户端零改动 |
| **工具框架标准化** | 修复 6 个致命 bug + 22 个架构缺陷的根因 |

---

## 2. 状态模式

```js
const { Annotation } = require('@langchain/langgraph');

const AgentState = Annotation.Root({
  // 消息列表（LangGraph 自动管理 reducer: 追加）
  messages: Annotation({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  conversationId: Annotation.number,
  context: Annotation.object,           // 前端上下文快照
  modelOverride: Annotation.object,     // per-request 模型配置
  template: Annotation.object,          // 提示词模板
  imageRefs: Annotation.array,          // photo_id 列表（非 base64，保持状态小）

  // 工具执行结果
  toolResults: Annotation.array,        // [{tool_call_id, result, status}]

  // 写确认
  pendingDecision: Annotation.object,   // {approved: boolean, reason?: string}

  // 审计队列
  auditQueue: Annotation.array,         // [{tool_name, args, result, old_values}]

  // 预算
  tokensUsed: Annotation.number,        // 本次会话累计 token
});
```

### 设计要点

- **`messages` 不含 base64 图片**：图片以 `photo_id` 引用存于 `imageRefs`，`loadContext` 节点按需加载并 base64 编码注入最后一条 user 消息。检查点保持 KB 级。
- **`pendingDecision`**：`interrupt()` 返回值赋给此字段，`executeTools` 节点读取。
- **`auditQueue`**：工具执行产生的审计条目入队，`audit` 节点批量写入 `ai_audit_log`。
- **`tokensUsed`**：每次 LLM 调用后累加；`agent` 节点入口检查预算。

---

## 3. 图拓扑与节点

### 3.1 节点

| 节点 | 职责 | 修复的问题 |
|---|---|---|
| `loadContext` | 构建 system prompt、加载历史（token 感知截断）、按需加载图片 | O2(窗口截断), O8(统计不一致), O13(stats缓存) |
| `agent` | 调用 LLM（绑定工具 schema）；检查预算；防御性解析响应 | O3(无防御解析), O6(max_tokens), O9(并行限制) |
| `guardWrite` | 对 `securityLevel >= 1` 的工具调用 `interrupt()`；生成预览 | O7(提示冲突) |
| `executeTools` | Zod 验证 → 语义验证 → 事务执行 → 结构化结果 | C1-C6(全部致命bug), F1-F10, D1-D7 |
| `audit` | 批量写 `ai_audit_log`，清空 `auditQueue` | — |

### 3.2 边与条件路由

```
START → loadContext → agent

agent:
  if (response解析失败 or 空choices):
    → END (yield error)
  if (lastMessage.tool_calls && tokensUsed < budget):
    → guardWrite
  else:
    → END (yield final text)

guardWrite:
  if (any tool securityLevel >= 1):
    → interrupt()  [暂停, 检查点持久化]
  else:
    → executeWrite  [L0 工具直接执行]

executeTools → audit → agent  [循环回 agent]
```

### 3.3 agent 节点的防御性实现

```js
async function agentNode(state) {
  // 预算检查
  const budget = await checkBudget();
  if (!budget.ok) {
    return { messages: [{ role: 'assistant', content: budget.reason }] };
  }

  // 调用 LLM（try/catch 包裹，修复 O1 凭证泄漏）
  let response;
  try {
    const model = getModelAdapter(state.modelOverride);
    const tools = selectTools(state); // 动态选择 ≤15 工具
    response = await model.invoke(state.messages, { tools, tool_choice: 'auto' });
  } catch (err) {
    // 分类错误（修复 O11: 无错误分类）
    const errorType = classifyError(err); // 'rate_limit' | 'auth' | 'timeout' | 'unknown'
    return { messages: [{ role: 'assistant', content: `[错误: ${errorType}] ${err.message}` }] };
  }

  // 防御性解析（修复 O3: 无防御解析）
  if (!response?.choices?.[0]?.message) {
    return { messages: [{ role: 'assistant', content: '[错误: LLM 返回空响应]' }] };
  }

  const msg = response.choices[0].message;

  // 清理 SDK 对象（修复 O15: 原始对象 push）
  const cleanMsg = { role: msg.role, content: msg.content || '' };
  if (msg.tool_calls) {
    cleanMsg.tool_calls = msg.tool_calls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));
  }

  // token 计费（修复 O10: 流式 fallback 丢计费）
  if (response.usage) {
    await updateTokenUsage(response.usage);
  }

  return { messages: [cleanMsg] };
}
```

---

## 4. 检查点持久化

### 4.1 自定义 SqliteSaver

实现 `BaseCheckpointSaver` 接口，基于现有 `sqlite3`（不引入 `better-sqlite3`）：

```js
// server/agent/checkpoint-saver.js
const { runAsync, getAsync, allAsync } = require('../utils/db-helpers');

class SqliteSaver {
  constructor() {
    this._init();
  }

  async _init() {
    // 存独立文件 ai_checkpoints.db（避免污染主库）
    // 或在主库内建表（简化部署）
    await runAsync(`
      CREATE TABLE IF NOT EXISTS ai_checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type TEXT,
        metadata TEXT,
        checkpoint TEXT,
        created_at TEXT,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      )
    `);
    await runAsync(`
      CREATE TABLE IF NOT EXISTS ai_checkpoint_writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        type TEXT,
        blob TEXT,
        created_at TEXT,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, channel, idx)
      )
    `);
  }

  async put(config, checkpoint, metadata, newVersions) { ... }
  async putWrites(config, writes, taskId) { ... }
  async getTuple(config) { ... }
  async list(config, options) { ... }
}
```

### 4.2 检查点清理

- 每会话保留最近 20 个检查点
- janitor 每小时清理 30 天前的已完成会话检查点
- 会话删除时级联清理

---

## 5. Provider 适配层

### 5.1 保留 ai-gateway.js

现有网关支持 OpenAI/Azure/DeepSeek/Ollama/Groq/vLLM/GLM。重写会丢失。

### 5.2 LangChainModelAdapter

```js
// server/agent/model-adapter.js
const { BaseChatModel } = require('@langchain/core/language_models/chat_models');

class LangChainModelAdapter extends BaseChatModel {
  constructor(aiGateway, modelConfig) {
    super({});
    this.gateway = aiGateway;
    this.modelConfig = modelConfig;
  }

  async _generate(messages, options) {
    const openaiMessages = messages.map(m => this.toOpenAI(m));
    const response = await this.gateway.chatCompletion({
      messages: openaiMessages,
      model: this.modelConfig.model_id,
      tools: options.tools,
      temperature: this.modelConfig.temperature,
      max_tokens: this.modelConfig.max_tokens || 4096, // 修复 O6: 默认提高
    });
    return this.toLangChainResult(response);
  }

  async *_streamResponseChunks(messages, options) {
    for await (const chunk of this.gateway.chatCompletionStream({
      messages: messages.map(m => this.toOpenAI(m)),
      model: this.modelConfig.model_id,
    })) {
      yield this.toLangChainChunk(chunk);
    }
  }
}
```

### 5.3 修复跨请求凭证泄漏（O1）

**不再用模块级 `_tempOverride` 单例。** 改为 per-request 参数传递：

```js
// 修复前（ai-gateway.js:24）
let _tempOverride = null; // 模块级单例 ← 泄漏源

// 修复后
async chatCompletion({ messages, model, tools, apiConfig }) {
  // apiConfig 从调用方传入，不存模块级状态
  const client = this.getClient(apiConfig);
  return client.chat.completions.create({ ... });
}
```

orchestrator/agent 节点将 `modelOverride` 的 apiConfig 显式传入每次调用。

---

## 6. 流式协议映射

### 6.1 现有 SSE 事件（保持不变）

| 事件 | 字段 |
|---|---|
| `conversation_id` | `id` |
| `tool_call` | `tool_call_id, tool_name, args, security_level` |
| `write_confirmation` | `confirmation_id, tool_call_id, tool_name, args, security_level` |
| `tool_result` | `tool_call_id, tool_name, result, status` |
| `text_delta` | `delta` |
| `done` | `conversation_id` |
| `error` | `message` |

### 6.2 LangGraph → SSE 映射

| LangGraph 流式源 | → SSE 事件 |
|---|---|
| 运行开始（首个 values 快照） | `conversation_id` |
| `stream.messages` → `text-delta` | `text_delta`（**真实 token 级**，替代逐字符） |
| `tools` 通道 → `tool-started` | `tool_call` |
| `tools` 通道 → `tool-finished` | `tool_result` |
| `stream.interrupts` | `write_confirmation` |
| 运行结束 | `done` |
| 节点抛错 | `error` |

### 6.3 StreamTransformer 实现

```js
// 注册自定义 StreamChannel("sse")
// 消费 tools/messages/interrupts 通道，投影到 sse 通道
// Express 路由迭代 stream.extensions.sse，写 data: JSON\n\n
```

前端零改动。

---

## 7. 中断与写确认

### 7.1 流程

1. `agent` 节点 → LLM 返回 `tool_calls`
2. `guardWrite` 节点检查 `securityLevel`
3. 若 `>= 1`：`interrupt({ tool, args, preview })`
4. 检查点持久化（durability `"exit"`）
5. Transformer emit `write_confirmation` SSE
6. 前端显示 Allow/Reject
7. `POST /api/ai/confirm/:id` → `graph.invoke(new Command({ resume: { approved: decision } }))`
8. `guardWrite` 重跑 → `interrupt()` 返回 decision → 路由到 `executeTools`

### 7.2 修复 O1（凭证泄漏）

`interrupt()` 暂停期间，`agent` 节点的 LLM 调用已完成。`executeTools` 节点不调用 LLM，只执行 DB 操作。**无凭证状态需要跨中断保持。**

解决方案：`modelOverride` 存入 LangGraph state（检查点持久化），`executeTools` 不需要它。下次 `agent` 节点调用从 state 读取。

### 7.3 /confirm 路由改造

```js
router.post('/confirm/:confirmationId', async (req, res) => {
  const { confirmationId } = req.params;
  const { decision } = req.body;

  // 方案 A: 返回新 SSE 流（用户已确认）
  res.setHeader('Content-Type', 'text/event-stream');
  const stream = await graph.streamEvents(
    new Command({ resume: { approved: decision === 'confirmed' } }),
    { configurable: { thread_id: getThreadId(confirmationId) }, version: 'v3' }
  );
  for await (const event of stream) {
    const sseEvent = transformer.toSSE(event);
    if (sseEvent) res.write(`data: ${JSON.stringify(sseEvent)}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
});
```

### 7.4 边界情况

| 情况 | 处理 |
|---|---|
| 超时 | 路由层 setTimeout 5 分钟 → `Command({resume:{approved:false}})` |
| 重启 | 检查点持久化 → `getState()` 返回 pending interrupt → 前端恢复 UI |
| 并发消息 | 路由层返 409 Conflict |
| 错误 thread_id | 校验 `getState().tasks[].interrupts.length > 0` |

---

## 8. 工具执行节点

### 8.1 executeTools 节点实现

```js
async function executeToolsNode(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  const toolCalls = lastMessage.tool_calls || [];
  const decision = state.pendingDecision;

  const toolMessages = [];
  const auditEntries = [];

  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name;
    const tool = getTool(toolName);
    if (!tool) {
      toolMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: sanitizeToolResult(JSON.stringify(
          toolError('not_found', `未知工具: ${toolName}`, { retryable: false })
        )),
      });
      continue;
    }

    // 检查写确认决定
    if (tool.type === 'write' && tool.securityLevel >= 1) {
      if (!decision?.approved) {
        toolMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: sanitizeToolResult(JSON.stringify(
            toolOk({ skipped: true, reason: '用户拒绝了此操作' })
          )),
        });
        continue;
      }
    }

    // 解析参数（修复 O16: 畸形参数不静默变 {}）
    let args;
    try {
      args = JSON.parse(toolCall.function.arguments || '{}');
    } catch {
      toolMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: sanitizeToolResult(JSON.stringify(
          toolError('validation_error', '工具参数 JSON 格式错误', {
            retryable: true, hint: '检查参数 JSON 格式',
          })
        )),
      });
      continue;
    }

    // 框架层安全网（修复 D2: 错误格式统一）
    const result = await safeExecute(tool, args, {
      conversationId: state.conversationId,
      context: state.context,
      toolCallId: toolCall.id,
    });

    // 审计入队
    auditEntries.push({
      tool_name: toolName,
      args,
      result: result.ok ? JSON.stringify(result.data).substring(0, 500) : result.error.message,
    });

    // 工具结果消息（统一包裹，修复 D2）
    toolMessages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: sanitizeToolResult(JSON.stringify(result)),
    });
  }

  return { messages: toolMessages, auditQueue: auditEntries };
}
```

### 8.2 safeExecute — 框架层安全网

```js
async function safeExecute(tool, args, runtime) {
  try {
    // Layer 1: Zod 验证
    const validated = tool.inputSchema.parse(args);
    // Layer 2+3: handler（语义验证 + 事务 + 参数化 SQL）
    return await tool.handler(validated, runtime);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return toolError('validation_error', err.errors[0]?.message || '参数验证失败', {
        fields: err.errors.map(e => e.path.join('.')),
        retryable: true,
      });
    }
    return toolError('internal_error', err.message, { retryable: true });
  }
}
```

---

## 9. 防御性编程

### 9.1 LLM 响应防御（修复 O3）

```js
if (!response?.choices?.length) {
  // 空响应（内容过滤、拒绝、Azure content_filter）
  return { messages: [{ role: 'assistant', content: '[LLM 返回空响应，可能被内容过滤]' }] };
}
const msg = response.choices[0].message;
if (!msg) {
  return { messages: [{ role: 'assistant', content: '[LLM 响应格式异常]' }] };
}
```

### 9.2 工具参数防御（修复 O16）

```js
let args;
try { args = JSON.parse(toolCall.function.arguments || '{}'); }
catch { return toolError('validation_error', '参数 JSON 格式错误', { retryable: true }); }
```

### 9.3 sanitizeToolResult 转义（修复 O5）

```js
function sanitizeToolResult(jsonStr) {
  const maxLen = 4000;
  let content = jsonStr.length > maxLen
    ? jsonStr.substring(0, maxLen) + '\n... (结果已截断)'
    : jsonStr;
  const escaped = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<database_result>\n${escaped}\n</database_result>`;
}
```

### 9.4 历史截断安全（修复 O2）

```js
function safeTruncateHistory(messages, maxRows = 30) {
  let truncated = messages.slice(-maxRows);
  // 确保不在 assistant(tool_calls) 和 tool(result) 之间截断
  while (truncated.length > 0 && truncated[0].role === 'tool') {
    truncated = truncated.slice(1);
  }
  return truncated;
}
```

### 9.5 排序 tiebreaker（修复 O21）

```sql
SELECT ... FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC
```

---

## 10. 上下文构建

### 10.1 修复统计不一致（O8）

```js
// 统一过滤 deleted_at IS NULL
const statsQuery = `
  SELECT
    (SELECT COUNT(*) FROM rolls) AS total_rolls,
    (SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL) AS total_photos,
    (SELECT COUNT(*) FROM film_items WHERE status = 'in_stock' AND deleted_at IS NULL) AS in_stock,
    ...
`;
```

### 10.2 stats 缓存（修复 O13）

```js
let statsCache = { value: null, expiresAt: 0 };

async function getStats() {
  if (statsCache.expiresAt > Date.now()) return statsCache.value;
  const result = await getAsync(statsQuery);
  statsCache = { value: result, expiresAt: Date.now() + 30000 }; // 30s TTL
  return result;
}
```

### 10.3 修复系统提示冲突（O7）

移除"绝不执行删除操作"，改为：
```
删除操作需要用户确认，且会被审计记录。执行前先用 search 确认目标。
删除是软删除（标记 deleted_at），可恢复。
```

### 10.4 max_tokens 调整（修复 O6）

```js
// 工具调用阶段用更大 max_tokens
const maxTokens = options.tools?.length ? 4096 : 2048;
```

---

## 依赖

| 包 | 版本 | 体积 | 必要性 |
|---|---|---|---|
| `@langchain/core` | ^1.2.3 | 7.3 MB | 必需 |
| `@langchain/langgraph` | ^1.4.8 | 4.1 MB | 必需 |
| `zod` | ^3.x | ~600 KB | 必需（工具验证） |
| `better-sqlite3` | — | — | **不引入**（自定义 saver） |

总计 ~12 MB JS，0 原生模块新增。
