# FilmGallery Agent 系统全面重构方案

> 基于对现有 35 个工具 + 编排层的深度代码审计，以及 LangGraph/LangChain/OpenAI function-calling 最佳实践研究制定。旧版架构文档已归档至 `../agent-redesign-v1-archived/`。

## 文档结构

| 文件 | 内容 |
|---|---|
| `README.md`（本文件） | 现状诊断、根因分析、方案概览、文档导航 |
| `DIAGNOSIS.md` | 完整审计报告：6 个致命 bug + 22 个架构缺陷 + 逐工具发现 |
| `TOOL-FRAMEWORK.md` | 标准化工具框架规范：接口定义、验证、错误、事务、幂等 |
| `TOOLS.md` | 按域工具清单与重构方案（8 域、~38 工具的完整规范） |
| `ARCHITECTURE.md` | LangGraph 单代理架构：状态图、检查点、流式、中断恢复 |
| `MIGRATION.md` | 4 阶段迁移计划（双引擎共存 → 全量切换） |

## 一句话结论

**现有 agent tools 几乎不可用是因为工具层存在 6 个致命 bug（3 个工具 100% 失败）和系统性的架构缺陷（无验证、无事务、无错误恢复、死代码、跨请求状态泄漏）。不是"修补"能解决的，需要基于 LangGraph 全面重构工具框架与编排层。**

## 现状诊断

### 致命 bug（导致工具 100% 失败）

| # | 工具 | 问题 | 影响 |
|---|---|---|---|
| C1 | `set_roll_cover` | SQL 写入不存在的列 `cover_photo_id`/`cover_path`（实际是 `cover_photo`/`coverPath`） | **100% 失败** |
| C2 | `add_equipment`/`update_equipment` | 用统一的 `COMMON_ALLOWED` 字段列表覆盖所有设备类型，但 flash/scanner/film_back 表没有 `type`/`mount` 列 | **flash/scanner/film_back 100% 失败** |
| C3 | `record_film_purchase` | INSERT 不设 `updated_at`，但 `list_film_items` 按 `updated_at DESC` 排序 → 新项排在最后不可见 | **LLM 误判为失败→重复创建** |
| C4 | `suggest_render_params` | 从 `{}` 开始叠加参数，写入残缺 preset_json（缺 30+ 必需字段）→ 渲染器 NaN/黑屏 | **破坏渲染管线** |
| C5 | `attach_tags` | `catch {}` 吞掉所有错误（含 FK 违规），返回 `ok:true` | **假成功** |
| C6 | 5 个批量工具 | 无事务，中途失败产生不一致状态 | **部分写入无法回滚** |

### 架构级缺陷（22 项，详见 DIAGNOSIS.md）

最关键的 8 项：

1. **跨请求 API 凭证泄漏** — `ai-gateway.js` 的 `_tempOverride` 是模块级单例，写确认暂停期间其他请求会使用错误的 API key
2. **30 条消息窗口截断工具调用序列** — 在 assistant(tool_calls) 和 tool(result) 之间截断 → API 400 错误
3. **`response.choices[0]` 无防御性解析** — 空响应直接崩溃
4. **`sanitizeToolResult` 可被注入突破** — 不转义 `</database_result>` 标签
5. **3 个 helper 函数是死代码** — `buildWhere`/`pickAllowed`/`buildUpdateSet` 从未被调用
6. **`max_tokens=2048` 对工具阶段太小** — 复杂工具 schema 消耗 token，截断后 JSON.parse 静默变 `{}`
7. **系统提示与工具冲突** — 提示说"绝不删除"，但 `delete_photo` 是注册的可调用工具
8. **DB 统计不一致** — context-builder 不过滤 `deleted_at`，stats-tools 过滤 → 同一数据两个数字

### 根因分析

| 根因 | 占比 | 说明 |
|---|---|---|
| Schema 列名不匹配 | ~40% | 工具 SQL 写入不存在的列 |
| 静默吞错 + 假成功 | ~20% | `catch {}` + `ok:true` + 错误计数 |
| 写后读可见性缺口 | ~15% | `updated_at` NULL → 排序不可见 → 误判失败 → 重复创建 |
| 无事务 → 部分写入 | ~10% | 中途失败无法回滚 |
| 原始 SQLite 错误不可操作 | ~10% | LLM 无法从 `"no such column"` 自我恢复 |
| 读写竞争 → 丢失更新 | ~5% | 无乐观锁/版本号 |

## 方案概览

### 架构：LangGraph 单代理 + 标准化工具框架

```
┌─────────────────────────────────────────────────────────────┐
│  LangGraph StateGraph                                       │
│                                                             │
│  START → loadContext → agent ──────┐                        │
│                     ↑              │                        │
│                     │         guardWrite                     │
│                     │              │                        │
│                     │         interrupt()  ← 持久化检查点    │
│                     │              │                        │
│                     │         executeTools                   │
│                     │         ├─ input validation (Zod)      │
│                     │         ├─ semantic validation         │
│                     │         ├─ transaction wrapper         │
│                     │         └─ structured result/error     │
│                     └──────────────┘                        │
│                     │                                       │
│                     ▼ (无 tool_calls)                       │
│                    END                                      │
│                                                             │
│  检查点: 自定义 SqliteSaver (现有 sqlite3, 不引入依赖)      │
│  Provider: ai-gateway.js → LangChainModelAdapter            │
│  工具: 8 域模块, 每域独立 schema + handler + 验证           │
│  错误: 结构化错误信封 {ok, error:{type,retryable,hint}}     │
│  事务: db.transaction() 包裹所有多步写入                    │
│  幂等: idempotency_key + 去重表                             │
└─────────────────────────────────────────────────────────────┘
```

### 工具框架标准化

每个工具必须遵循统一规范（详见 `TOOL-FRAMEWORK.md`）：

```js
{
  name: 'photo_update_metadata',        // snake_case, 域前缀
  domain: 'photo',                       // 所属域
  type: 'write',                         // read | write
  securityLevel: 1,                      // 0=auto, 1=confirm, 2=confirm+preview
  description: '...',                    // 含"何时使用"+"参数说明"+"副作用"
  inputSchema: z.object({...}),          // Zod schema, 自动生成 OpenAI JSON Schema
  handler: async (args, runtime) => {    // 验证→语义检查→事务→结构化结果
    // Layer 1: Zod 已验证类型/格式
    // Layer 2: 语义验证（存在性、FK、权限）
    // Layer 3: 参数化 SQL + 事务
    return toolOk({ ... }) or toolError('not_found', '...', { hint: '...' })
  }
}
```

### 工具清单重构

8 域 ~38 工具（详见 `TOOLS.md`），关键变化：

| 域 | 现有 | 重构后 | 关键改进 |
|---|---|---|---|
| photo | 9 | 8 | 修 `set_roll_cover` 列名；`delete_photo` 改软删除；加输入验证 |
| roll | 5 | 5 | 修 `set_roll_cover`；`update_roll` 加 `updated_at` 列 |
| film | 4 | 4 | `record_film_purchase` 设 `updated_at` + 事务 + 幂等 |
| equipment | 3 | 4 | 按设备类型分异 schema（不再统一 COMMON_ALLOWED） |
| tag | 4 | 5 | `attach_tags` 不再吞错；加 `tag_rename`/`tag_merge` |
| shot-log | 3 | 3 | 加乐观锁防丢失更新 |
| stats | 4 | 4 | 已修复 SQL 注入（Phase 0） |
| render | 3 | 5 | `suggest_render_params` 从完整模板叠加；加 `render_status`/`render_cancel` |

### 迁移策略

4 阶段，双引擎共存（详见 `MIGRATION.md`）：

1. **Phase 1**（1 周）：工具框架 + Zod 验证 + 结构化错误 + 事务 — 修复所有致命 bug
2. **Phase 2**（3-4 天）：LangGraph 图骨架 + 自定义检查点 + provider 适配
3. **Phase 3**（3 天）：HITL 中断 + 流式协议映射
4. **Phase 4**（1 周浸泡）：默认切换 + 清理

## 设计原则

| 原则 | 实现 |
|---|---|
| **系统** | 统一工具接口、统一错误信封、统一验证三层防线 |
| **优雅** | Zod schema 自动生成 OpenAI JSON Schema；helper 函数实际被使用 |
| **完善** | 38 工具覆盖全部 CRUD；事务/幂等/乐观锁/审计全覆盖 |
| **鲁棒** | 防御性解析、错误可恢复、sanitizeToolResult 转义、跨请求隔离 |
| **高效** | 真实 token 流式、工具动态选择（≤12/turn）、stats 缓存 |
| **模块化** | 8 域独立文件；每域自含 schema + handler + 验证 |

## 下一步

1. 阅读 `DIAGNOSIS.md` 了解全部问题细节
2. 阅读 `TOOL-FRAMEWORK.md` 了解标准化规范
3. 从 `MIGRATION.md` Phase 1 开始（修复致命 bug，1 周内见效）
