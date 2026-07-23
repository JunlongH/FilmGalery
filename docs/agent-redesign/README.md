# FilmGallery Agent 系统重构方案

> 子目录入口文档。本方案基于对现有 AI 助手代码的深度审计 + 两个独立子代理（adversarial reviewer / architecture researcher）的交叉论证得出。所有引用的代码位置均经过实际验证。

## 文档结构

| 文件 | 内容 | 读者 |
|---|---|---|
| `README.md`（本文件） | 执行摘要 + 决策门 + 文档导航 | 决策者、快速浏览 |
| `DESIGN.md` | 完整架构设计：状态图、节点、检查点、流式协议、中断恢复、工具组织、记忆、安全 | 实施工程师 |
| `MIGRATION.md` | 5 阶段迁移计划（feature flag 双引擎共存）、每阶段交付物、风险与回滚 | 实施工程师、运维 |
| `ALTERNATIVES.md` | LangGraph vs 修补现有 orchestrator vs Vercel AI SDK vs 自研最小状态机 vs Mastra 的横向对比 | 决策者、架构评审 |

## 一句话结论

**采用 LangGraph.js 单代理架构（非 supervisor 多代理），自定义基于现有 `sqlite3` 的 `BaseCheckpointSaver`（避免引入 `better-sqlite3` 第二个原生模块），完整保留现有 35 个工具与 SSE 事件协议，通过 feature flag 与 legacy orchestrator 共存，分 5 阶段迁移。**

## 核心设计决策（一句话各一条）

1. **单代理，非多代理 supervisor** —— 35 个工具远低于"需要路由 LLM"的阈值（~50+）；单用户场景下 supervisor 的额外 LLM 调用是纯开销。两个子代理在此点完全一致。
2. **自定义 `SqliteSaver`，不引入 `better-sqlite3`** —— 官方 `@langchain/langgraph-checkpoint-sqlite` 硬依赖 `better-sqlite3`，会与现有 `sqlite3` ^5.1.7 共存，加倍 Electron 原生模块重建负担。自写 ~150 LOC 的 `BaseCheckpointSaver` 实现可避免此问题。
3. **保留 `ai-gateway.js`，包一层 `BaseChatModel` 适配器** —— 现有网关已支持 OpenAI/Azure/DeepSeek/Ollama/Groq/vLLM/GLM，且带 configHash 客户端缓存与 per-request 临时 override。重写会丢失这些能力。
4. **保留 SSE 事件协议不变** —— 通过自定义 `StreamTransformer` 把 LangGraph 的 `messages`/`tools`/`interrupts` 通道投影到现有 `{conversation_id, tool_call, write_confirmation, tool_result, text_delta, done}` 事件。移动端零改动。
5. **保留全部 35 个工具与 3 级安全模型** —— 现有工具架构（`{schema, handler, type, securityLevel}` + `<database_result>` 注入防护 + 审计日志）是资产，不是负债。仅做 SQL 注入修复与命名空间分组。
6. **不引入 RAG / 向量检索 / CLIP 嵌入** —— 单用户几千张照片的场景下，结构化搜索（EXIF/标签/日期/地点）已足够；"找相似照片"用 LLM 视觉直接看图即可。`sqlite-vec` 在 Electron 里的跨平台原生扩展维护成本远超收益。两个子代理均强烈反对。
7. **不引入 supervisor / 子代理 / 规划节点** —— 单用户、单领域、35 工具，多代理只会放大成本与延迟。如未来工具数突破 ~60 或需要独立视觉模型人格，再评估。
8. **服务端保持 JavaScript（ESM/CJS），不迁移 TypeScript** —— `AGENTS.md` 明确客户端用 JSX；服务端无 `.ts` 文件。LangGraph.js 提供 CJS 构建，`require()` 即可用。`Annotation.Root` / `StateGraph` 是运行时构造，非类型专用。
9. **`interrupt()` + 持久检查点替代内存 `Map`** —— 这是修复"重启丢失待确认写操作"bug 的正确原语，而非补丁。检查点在 `ai_checkpoints.db`（独立文件，避免污染主库）。
10. **真实 token 级流式替代字符级假流式** —— LangGraph `stream.messages` 投影直接给出 `text-delta`，替代 `ai-orchestrator.js:317-320` 的逐字符 emit。

## 决策门（已与用户确认 2026-07-23）

两个子代理在"是否采用 LangGraph"上存在分歧。经与用户讨论优缺点后，**DC1 决策为"先做 Phase 0 再决定"**——Phase 0 修补 legacy 引擎（1 周，独立可合并）后，根据实际效果再评估是否继续 LangGraph 路径。Phase 0 无论如何都该做，是零成本决策点。

其余 4 个议题已确认：

| 议题 | 决策 |
|---|---|
| DC1 整体路径 | **先做 Phase 0 再决定**（Phase 0 完成后评估是否继续 LangGraph） |
| DC4 `/confirm` 后续事件 | **方案 A：新 SSE 流**（前端 `confirmAction` 后开新连接） |
| 预算 token 单价 | **按 provider 分别配置** `ai_models.tokens_per_dollar` 列 |
| safeStorage fallback | **强制环境变量**（keychain 不可用时 DB 不存 key） |
| 检查点保留 | **每会话 N=20 + 30 天清理** |

### LangGraph vs 修补路径权衡（供 DC1 后续评估）

| 维度 | 修补现有 orchestrator（review 子代理推荐） | LangGraph 单代理（本方案） |
|---|---|---|
| 工期 | 2–3 周 | 2–3 月 |
| 修复 15 个痛点 | ✅ 全部，但为补丁式 | ✅ 全部，且为架构式 |
| 重启后保留待确认写操作 | ⚠️ 需自建 `ai_pending_writes` 表 + 轮询 | ✅ 检查点原生支持 |
| 真实 token 流式 | ⚠️ 需手写 OpenAI 流式 tool-call 解析 | ✅ `stream.messages` 原生 |
| 时间旅行调试 | ❌ 无 | ✅ 检查点历史回放 |
| 未来扩展（多代理、复杂工作流） | ❌ 需重写 | ✅ 图拓扑天然支持 |
| 依赖体积增量 | ~0 | ~15 MB JS + 0 原生（自定义 saver） |
| 迁移风险 | 低 | 中（双引擎共存可回退） |
| 框架锁定 | 无 | LangChain 生态 |

**Phase 0 完成后，DC1 重新评估标准**：
- legacy 引擎重启生存性是否满足（若满足且无扩展需求，可止步）
- 是否需要时间旅行调试（复杂工具链问题排查）
- 是否预期未来多代理/复杂工作流扩展
- 团队对 LangGraph 学习曲线的接受度

## 关键文件索引（实施时参考）

| 现有文件 | 角色 | 重构动作 |
|---|---|---|
| `server/services/ai-orchestrator.js` | legacy 引擎主循环 | 保留为 fallback；Phase 4 删除 |
| `server/services/ai-gateway.js` | OpenAI 兼容网关 | 保留，包一层 `LangChainModelAdapter` |
| `server/services/ai-tools/index.js` | 35 工具注册表 | 保留，加 `LangGraphToolAdapter` 桥接 `tool()` |
| `server/services/ai-context-builder.js` | 系统提示构建 | 迁移为 `loadContext` 节点 |
| `server/routes/ai-chat.js` | SSE 路由 | 加 `engine` 分支 + `/confirm` 改用 `Command({resume})` |
| `server/server.js:388-498` | AI 表 schema | 加 `ai_config.engine` 列 + 新 `ai_pending_writes` 表 |
| `client/src/components/AIPanel/` | 桌面 UI | Phase 3 后可选增强（无需改动即可工作） |
| `mobile/src/components/AIChatSheet.tsx` | 移动 UI | 独立修复 write_confirmation 处理 + context 传递 |
| `docs/AI-AGENT-PLAN.md` | 既有路线图 | 本方案为其后继， supersede 工具矩阵与安全模型部分 |

## 下一步

1. **立即开始 Phase 0**（`MIGRATION.md`）：修补 legacy 引擎的 P4/P5/P6/P11/P12/P15，使其获得重启生存性与安全修复。1 周，独立可合并。
2. Phase 0 完成后，按 DC1 评估标准重新决策是否继续 LangGraph 路径（Phase 1–4）。
3. 若选继续 LangGraph，4 个已决策议题（DC4 方案 A、预算按 provider、safeStorage 强制 env、检查点 N=20+30天）将在 Phase 1–3 实施时落地。
