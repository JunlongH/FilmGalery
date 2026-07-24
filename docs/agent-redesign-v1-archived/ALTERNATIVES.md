# 备选方案对比

> 本文档对比 LangGraph 路径与修补路径及其他框架，供 Phase 0 前的最终决策（DC1）参考。

## 方案矩阵

| 方案 | 工期 | 依赖增量 | 修复 15 痛点 | 架构升级 | 时间旅行 | 未来扩展 | 推荐度 |
|---|---|---|---|---|---|---|---|
| **A. LangGraph 单代理（本方案）** | 3–4 周 | ~15 MB JS, 0 原生 | ✅ 全部，架构式 | ✅ | ✅ | ✅ | ⭐⭐⭐⭐ |
| **B. 修补现有 orchestrator** | 2–3 周 | 0 | ✅ 全部，补丁式 | ❌ | ❌ | ❌ | ⭐⭐⭐ |
| **C. Vercel AI SDK** | 2–3 周 | ~5 MB | ⚠️ 部分（无 HITL 原语） | ⚠️ 半架构 | ❌ | ⚠️ | ⭐⭐ |
| **D. 自研最小状态机** | 2–3 周 | ~0 | ✅ 全部，补丁式 | ⚠️ 半架构 | ❌ | ⚠️ | ⭐⭐ |
| **E. Mastra** | 3–4 周 | ~10 MB | ⚠️ 部分（HITL 不成熟） | ✅ | ❌ | ✅ | ⭐⭐ |
| **F. Pydantic AI（Python sidecar）** | 4–6 周 | +Python 运行时 ~40 MB | ✅ | ✅ | ✅ | ✅ | ⭐（破坏单进程） |

---

## 方案 A：LangGraph 单代理（本方案，推荐）

详见 `DESIGN.md` 与 `MIGRATION.md`。

### 优势

- `interrupt()` + 检查点是修复重启 bug 的**正确原语**，非补丁
- `stream.messages` 是真实 token 流式的**正确原语**
- 时间旅行调试（检查点历史回放）补丁无法提供
- 图拓扑天然支持未来扩展（多代理、并行分支、复杂工作流）
- 双引擎 feature flag 共存，迁移风险可控
- 保留全部 35 工具、SSE 协议、多 provider 支持

### 劣势

- +15 MB JS 依赖（Electron 已数百 MB，非问题）
- 框架锁定（LangChain 生态）
- 自定义 `SqliteSaver` 需维护（~150 LOC）
- LangGraph.js 多代理参考实现少于 Python 版（本方案单代理，非问题）

### 何时选

- 用户明确想要 LangGraph（你的情况）
- 重视架构正确性而非短期速度
- 预期未来扩展（多代理、复杂工作流、视觉模型人格）
- 愿意为时间旅行调试付费

---

## 方案 B：修补现有 orchestrator（review 子代理推荐）

**不引入任何框架**，直接在 `ai-orchestrator.js` 修 15 痛点。

### 修补清单（含工时）

| 痛点 | 修复 | 工时 |
|---|---|---|
| P1 假流式 | 用 `aiGateway.chatCompletionStream` 全程，解析流式 tool-call delta（OpenAI 2024 起支持） | 2 天 |
| P2 工具阶段不流式 | 同上，流式 tool-call | 含 P1 |
| P3 30 条窗口无摘要 | 加 token 估算（字符近似）+ 后台 LLM 摘要 + `ai_messages.summary` 列 | 1 天 |
| P4 内存 Map 重启丢 | 新 `ai_pending_writes` 表 + 轮询/回调 | 2 小时 |
| P5 SQL 注入 | `stats-tools.js` 9 处参数化 | 20 分钟 |
| P6 API key 明文 | Electron `safeStorage` 加密 | 半天 |
| P7 移动无 write_confirmation | `AIChatSheet.tsx` switch 加 case + UI | 1 天 |
| P8 移动 context=null | `useAIContext` hook 从 navigation 推导 | 半天 |
| P9 移动无图片/模板/历史 | 加图片选择、模板选择、历史列表 | 2 天 |
| P10 loadConversationMessages 丢 tool_calls | 包含 tool_calls 字段 | 20 分钟 |
| P11 TOOL_LABELS 过时 | 动态生成或更新静态 map | 20 分钟 |
| P12 预算不强制 | 每次 LLM 调用后累加 + 入口检查 | 半天 |
| P13 60s 超时太短 | 改 5 分钟 | 5 分钟 |
| P14 桌面无 AbortSignal | `fetch` 传 `signal` | 20 分钟 |
| P15 listModels 吞错 | 返回错误信息 | 20 分钟 |

**总工时**：~2–3 周（含测试）。

### 优势

- 零依赖增量
- 零迁移风险
- 立即见效
- 现有 orchestrator 357 行，改动可控
- 不引入框架锁定

### 劣势

- 无架构升级——仍是手工 async generator
- 无时间旅行调试
- 无检查点持久化（`ai_pending_writes` 是补丁，非 LangGraph 检查点）
- 无真实 token 流式原语（需手写 OpenAI 流式 tool-call 解析）
- 未来扩展（多代理、复杂工作流）需重写

### 何时选

- 重视短期速度与低风险
- 不预期未来多代理扩展
- 不在意时间旅行调试
- 想立即修复全部痛点

### 与方案 A 的关系

**方案 A 的 Phase 0 = 方案 B 的核心子集**。Phase 0 修补 P4/P5/P6/P11/P12/P15（legacy 引擎立即获重启生存性 + 安全修复），不阻塞 LangGraph 决策。**DC1 检查点**：Phase 0 完成后，若决定止步，继续 P1/P2/P3/P7/P8/P9/P10/P13/P14 即方案 B；若继续 LangGraph，进入 Phase 1。

---

## 方案 C：Vercel AI SDK

`ai` 包（`streamText`/`generateText` + `step` 循环 + `onStepFinish`）。

### 优势

- 真实流式原生支持
- 工具调用原生支持
- provider 抽象（`@ai-sdk/openai`、`@ai-sdk/anthropic` 等）
- 依赖较轻（~5 MB）
- 无图/状态机抽象，简单

### 劣势

- **无 HITL 中断原语**——`interrupt()` 等价物需手写（外部存储 + 轮询）
- **无 SQLite 检查点**——状态持久化需自建
- 无时间旅行调试
- 无图拓扑，复杂工作流难表达
- 重启生存性仍需自建（同方案 B 的 `ai_pending_writes`）

### 何时选

- 重视流式但不需要 HITL 持久化
- 愿意自建状态管理
- 已用 Vercel 生态

### 结论

**不推荐**。HITL 写确认 + 重启生存是核心需求，Vercel AI SDK 无原语支持，需自建——等于方案 B + 流式改进，但多一层框架。

---

## 方案 D：自研最小状态机

不引入框架，自写 ~100 LOC 的 `StateGraph` 类（节点、边、`run()` 方法）+ 简单 JSON 列存状态。

### 优势

- 零依赖
- 完全控制
- 可定制 HITL（自建 `ai_pending_writes` + 状态序列化）
- 学习成本低

### 劣势

- 需自实现：检查点、时间旅行、流式投影、工具适配
- 等于方案 B + 部分架构升级，但无 LangGraph 的成熟度
- 未来扩展仍需重写
- 无社区支持

### 何时选

- 想要架构升级但拒绝框架锁定
- 愿意长期维护自研代码
- 团队有状态机经验

### 结论

**不推荐**。捕获 ~60% 的 LangGraph 收益但需自实现检查点/时间旅行/流式投影，维护成本高于直接用 LangGraph。

---

## 方案 E：Mastra

TS 原生 agent 框架，有 workflow + memory + agent network。

### 优势

- TS 原生，DX 好
- workflow + memory 内置
- agent network 支持
- 较新，设计现代

### 劣势

- 生态较年轻
- **HITL/检查点持久化不如 LangGraph 成熟**（LangGraph 的 `BaseCheckpointSaver` + `interrupt()` 是验证过的原语）
- 多代理导向，单用户场景过度
- 社区小于 LangChain

### 何时选

- 重视 TS 原生 DX
- 不在意 HITL 持久化的成熟度
- 想要较新设计

### 结论

**不推荐**。HITL 写确认 + 重启生存是核心需求，LangGraph 的检查点 + interrupt 是更验证过的原语。

---

## 方案 F：Pydantic AI（Python sidecar）

Python 原生 agent 框架，需 Python sidecar 服务。

### 优势

- Python 生态丰富
- Pydantic 类型 DX 极好
- LangGraph Python 版本更成熟

### 劣势

- **破坏单进程 Electron 模型**——需 Python 运行时 sidecar
- Electron `extraResources` + Python 运行时 ~40 MB
- SSE 需跨进程（Python sidecar → Node 路由 → 前端）
- 部署复杂度大幅上升
- Docker NAS 模式需双容器

### 何时选

- 已有 Python sidecar 基础设施
- 愿意接受部署复杂度
- 团队 Python 强于 JS

### 结论

**强烈不推荐**。破坏 FilmGallery 的单进程 Electron 核心设计，部署复杂度不可接受。

---

## 决策建议

### 推荐路径

**方案 A（LangGraph 单代理）**，原因：
1. 用户明确表达 LangGraph 意向
2. `interrupt()` + 检查点是修复重启 bug 的正确原语
3. `stream.messages` 是真实流式的正确原语
4. 时间旅行调试是补丁无法提供的架构能力
5. 双引擎 feature flag 共存使迁移风险可控
6. 自定义 `SqliteSaver` 避免 `better-sqlite3` 第二原生模块

### 决策流程

```
Phase 0（1 周，独立改进，不依赖 LangGraph 决策）
    │
    ├─ 修补 P4/P5/P6/P11/P12/P15（legacy 引擎立即获重启生存性 + 安全修复）
    │
    ▼
DC1 决策检查点
    │
    ├─ 选方案 B（止步）→ 继续修补 P1/P2/P3/P7/P8/P9/P10/P13/P14（+2 周）
    │   总：3 周，无架构升级
    │
    └─ 选方案 A（继续）→ Phase 1/2/3/4（+2.5 周）
        总：3.5 周，含架构升级 + 时间旅行 + 未来扩展性
```

### 关键判断

- **若你重视架构正确性、未来扩展性、时间旅行调试** → 选方案 A
- **若你重视短期速度、低风险、立即见效** → 选方案 B
- **Phase 0 是无成本决策点**——修补 legacy 引擎的 P4/P5/P6/P11/P12/P15 无论如何都该做

---

## 附录：方案 A vs B 的 15 痛点修复方式对比

| 痛点 | 方案 A 修复 | 方案 B 修复 |
|---|---|---|
| P1 假流式 | `stream.messages` 投影 → `text_delta` | 手写 OpenAI 流式 tool-call 解析 |
| P2 工具不流式 | `tools` 通道 → `tool_call` 事件 | 同 P1 |
| P3 30 条窗口 | LangGraph 状态 + token 计数 + 摘要 | 字符估算 + 后台 LLM 摘要 + `summary` 列 |
| P4 内存 Map | `interrupt()` + 检查点持久 | `ai_pending_writes` 表 + 轮询 |
| P5 SQL 注入 | 参数化（Phase 0） | 参数化 |
| P6 API key 明文 | `safeStorage`（Phase 0） | `safeStorage` |
| P7 移动无 write_confirmation | Phase 3 修复 | 修补 |
| P8 移动 context=null | Phase 3 修复 | 修补 |
| P9 移动功能缺失 | Phase 3 部分修复 | 修补 |
| P10 丢 tool_calls | Phase 0 修复 | 修补 |
| P11 TOOL_LABELS 过时 | Phase 0 修复 | 修补 |
| P12 预算不强制 | Phase 0 修复（legacy）+ Phase 1 起 LangGraph 节点检查 | 修补 |
| P13 60s 超时 | LangGraph 无内置超时，路由层 setTimeout 5 分钟 | 改 5 分钟 |
| P14 桌面无 AbortSignal | 不涉及（LangGraph 流式） | `fetch` 传 signal |
| P15 listModels 吞错 | Phase 0 修复 | 修补 |

**关键差异**：P1/P2/P4 在方案 A 中用框架原语（架构式），在方案 B 中用手写代码（补丁式）。P3 在两方案中实现相似。其余痛点两方案修复方式相同。
