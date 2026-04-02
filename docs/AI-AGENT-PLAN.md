# FilmGallery Agentic AI 功能规划

> 本文档系统分析 FilmGallery 全平台功能，规划 AI Agent 能力矩阵、安全架构与实施路径。

---

## 目录

1. [现状分析](#1-现状分析)
2. [Agent 能力矩阵](#2-agent-能力矩阵)
3. [安全与权限架构](#3-安全与权限架构)
4. [回滚机制](#4-回滚机制)
5. [客户端 UI 设计](#5-客户端-ui-设计)
6. [实施路线图](#6-实施路线图)

---

## 1. 现状分析

### 1.1 当前 AI 架构

| 组件 | 文件 | 职责 |
|------|------|------|
| Orchestrator | `server/services/ai-orchestrator.js` | 对话管理、工具调用循环（max 15 轮）、SSE 流式输出 |
| Tool Registry | `server/services/ai-tools.js` | 工具 schema + handler + type 注册 |
| Context Builder | `server/services/ai-context-builder.js` | 系统提示词、实体上下文注入 |
| Gateway | `server/services/ai-gateway.js` | 多 Provider 适配（OpenAI/Azure/DeepSeek/Ollama/Groq/vLLM） |
| Audit Log | `ai_audit_log` 表 | 记录每次工具调用：tool_name, tool_args, result_summary, old_values |

### 1.2 现有工具清单（11 个）

| 工具 | 类型 | 功能 |
|------|------|------|
| `search_photos` | read | 多条件照片搜索（关键词/设备/时间/评分） |
| `get_photo_detail` | read | 单张照片完整元数据 + 标签 |
| `get_roll_photos` | read | 胶卷内全部照片 |
| `list_rolls` | read | 列出胶卷（支持筛选） |
| `get_roll_detail` | read | 单卷详情 |
| `get_stats` | read | 统计概览 |
| `search_equipment` | read | 设备搜索 |
| `get_film_info` | read | 胶片信息查询 |
| `list_tags` | read | 标签列表 |
| `get_shot_log` | read | 拍摄日志 |
| `update_shot_log` | **write** | 更新拍摄日志条目 |

**问题**：当前 11 个工具中仅 1 个写入工具，且无写入确认机制——orchestrator 收到 tool_call 后立即执行。

### 1.3 应用功能全景

#### 桌面端（15 个页面）

| 页面 | 功能 | Agent 可介入程度 |
|------|------|-----------------|
| Overview | 仪表盘总览 | ★ 低 — 纯展示 |
| RollLibrary | 胶卷列表管理 | ★★★ 高 — 批量操作 |
| RollDetail | 单卷详情/照片 | ★★★ 高 — 元数据编辑 |
| NewRollForm | 创建胶卷 | ★★ 中 — 辅助填写 |
| FilmLibrary | 胶片库/库存 | ★★★ 高 — 库存管理 |
| CalendarView | 日历浏览 | ★ 低 — 纯展示 |
| MapPage | 地图浏览 | ★ 低 — 纯展示 |
| Statistics | 统计分析 | ★★★ 高 — 数据分析 |
| Favorites | 收藏照片 | ★★ 中 — 批量收藏 |
| TagGallery | 标签/主题 | ★★★ 高 — 标签管理 |
| EquipmentManager | 设备管理 | ★★ 中 — CRUD |
| LutLibrary | LUT 管理 | ★ 低 — 文件操作 |
| Settings | 设置 | ★ 低 — 用户操作 |
| ImageViewer | 全屏查看器 | ★ 低 — 交互式 |
| FilmLab | 胶片冲扫/调色 | ★★ 中 — 参数建议 |

#### 移动端（17 个屏幕）

移动端功能与桌面端对应，Agent 工具共享同一套 Server API，无需为移动端单独开发工具。

---

## 2. Agent 能力矩阵

### 2.1 工具分类总览

按功能域划分为 8 类，共规划 **35+ 个工具**：

| 域 | 现有 Read | 现有 Write | 新增 Read | 新增 Write | 合计 |
|----|-----------|------------|-----------|------------|------|
| 照片管理 | 3 | 0 | 1 | 5 | 9 |
| 胶卷管理 | 3 | 0 | 0 | 3 | 6 |
| 胶片/库存 | 1 | 0 | 1 | 2 | 4 |
| 设备管理 | 1 | 0 | 0 | 2 | 3 |
| 标签系统 | 1 | 0 | 0 | 3 | 4 |
| 拍摄日志 | 1 | 1 | 0 | 1 | 3 |
| 数据分析 | 1 | 0 | 3 | 0 | 4 |
| FilmLab/渲染 | 0 | 0 | 1 | 2 | 3 |
| **合计** | **11** | **1** | **6** | **18** | **36** |

### 2.2 照片管理工具

#### 现有
- `search_photos` (read) — 多条件搜索
- `get_photo_detail` (read) — 完整元数据
- `get_roll_photos` (read) — 卷内照片

#### 新增

| 工具 | 类型 | 功能 | 安全等级 |
|------|------|------|----------|
| `get_photo_neighbors` | read | 获取某张照片前后 N 张（上下文感知） | 无需确认 |
| `update_photo_metadata` | write | 修改 caption / rating / location_name / date_taken | 需确认 |
| `batch_update_photos` | write | 批量修改照片元数据（同一字段） | 需确认 + 预览 |
| `set_photo_rating` | write | 设置单张评分（高频操作，简化路径） | 自动执行 |
| `toggle_photo_favorite` | write | 切换收藏状态 | 自动执行 |
| `delete_photo` | write | 删除照片（移至回收站，非物理删除） | 需确认 |

**典型对话**：
```
用户：把这卷里所有在东京拍的照片评分设为 4
Agent：search_photos(roll_id=42, query="东京") → 找到 8 张
       → 请确认：将以下 8 张照片评分设为 4？[列表]
用户：确认
Agent：batch_update_photos(ids=[...], field="rating", value=4) → 完成
```

### 2.3 胶卷管理工具

#### 现有
- `list_rolls` (read) — 胶卷列表
- `get_roll_detail` (read) — 单卷详情
- `get_roll_photos` (read) — 卷内照片

#### 新增

| 工具 | 类型 | 功能 | 安全等级 |
|------|------|------|----------|
| `update_roll` | write | 修改标题 / 日期 / 备注 / 相机 / 镜头 | 需确认 |
| `set_roll_cover` | write | 设置封面照片 | 自动执行 |
| `set_roll_preset` | write | 为整卷设置渲染预设 | 需确认 |

### 2.4 胶片与库存工具

#### 现有
- `get_film_info` (read) — 胶片信息

#### 新增

| 工具 | 类型 | 功能 | 安全等级 |
|------|------|------|----------|
| `search_film_inventory` | read | 库存搜索（按品牌/类型/过期日/状态） | 无需确认 |
| `update_inventory_item` | write | 修改库存条目（状态/价格/备注） | 需确认 |
| `record_film_purchase` | write | 记录胶片购入批次 | 需确认 |

**典型对话**：
```
用户：我还剩多少卷没过期的 Portra 400？
Agent：search_film_inventory(brand="Kodak", name="Portra 400", expired=false)
       → 冷藏 3 卷，室温 1 卷，共 4 卷
```

### 2.5 设备管理工具

#### 现有
- `search_equipment` (read)

#### 新增

| 工具 | 类型 | 功能 | 安全等级 |
|------|------|------|----------|
| `update_equipment` | write | 修改设备信息 | 需确认 |
| `add_equipment` | write | 新增设备 | 需确认 |

### 2.6 标签系统工具

#### 现有
- `list_tags` (read)

#### 新增

| 工具 | 类型 | 功能 | 安全等级 |
|------|------|------|----------|
| `create_tag` | write | 创建新标签 | 自动执行 |
| `attach_tags` | write | 为照片添加标签（支持批量） | 需确认 |
| `detach_tags` | write | 移除照片标签（支持批量） | 需确认 |

**典型对话**：
```
用户：帮我把所有带樱花的照片打上"春天"标签
Agent：search_photos(query="樱花") → 找到 12 张
       → AI视觉确认（可选）
       create_tag(name="春天") → 创建成功（或已存在）
       → 请确认：为以下 12 张照片添加"春天"标签？
用户：确认
Agent：attach_tags(photo_ids=[...], tag_name="春天") → 完成
```

### 2.7 拍摄日志工具

#### 现有
- `get_shot_log` (read)
- `update_shot_log` (write) — 已有

#### 新增

| 工具 | 类型 | 功能 | 安全等级 |
|------|------|------|----------|
| `add_shot_log_entry` | write | 为胶卷新增拍摄日志条目 | 自动执行 |

### 2.8 数据分析工具

#### 现有
- `get_stats` (read)

#### 新增

| 工具 | 类型 | 功能 | 安全等级 |
|------|------|------|----------|
| `analyze_shooting_patterns` | read | 分析拍摄习惯（常用设备/胶片/焦段/时间分布） | 无需确认 |
| `cost_analysis` | read | 胶片花费分析（按时间/品牌/类型） | 无需确认 |
| `equipment_usage_stats` | read | 设备使用频率统计 | 无需确认 |

**典型对话**：
```
用户：分析一下我去年用得最多的相机和镜头组合
Agent：analyze_shooting_patterns(year=2025, group_by="camera_lens")
       → Nikon FM2 + 50/1.4: 18卷 (45%)
         Pentax 67 + 105/2.4: 12卷 (30%)
         Leica M6 + 35/2: 10卷 (25%)
```

### 2.9 FilmLab / 渲染工具

#### 新增

| 工具 | 类型 | 功能 | 安全等级 |
|------|------|------|----------|
| `get_render_params` | read | 获取照片当前渲染参数 | 无需确认 |
| `suggest_render_params` | write | 基于场景分析建议渲染参数 | 需确认 |
| `batch_apply_preset` | write | 批量应用预设到照片组 | 需确认 + 预览 |

---

## 3. 安全与权限架构

### 3.1 三级权限模型

```
┌─────────────────────────────────────────────┐
│  Level 0: 自动执行 (Auto-Execute)           │
│  - 所有 read 工具                            │
│  - 低风险 write: set_rating, toggle_fav,    │
│    create_tag, add_shot_log_entry,           │
│    set_roll_cover                            │
├─────────────────────────────────────────────┤
│  Level 1: 需用户确认 (Confirm Required)      │
│  - 单条 write: update_photo_metadata,       │
│    update_roll, update_inventory_item,       │
│    attach/detach_tags, update_equipment,     │
│    record_film_purchase, set_roll_preset,    │
│    suggest_render_params                     │
├─────────────────────────────────────────────┤
│  Level 2: 需确认 + 预览 (Confirm + Preview)  │
│  - 批量 write: batch_update_photos,         │
│    batch_apply_preset                        │
│  - 删除操作: delete_photo                    │
│  - 不可逆操作                                │
└─────────────────────────────────────────────┘
```

### 3.2 确认流程

```
Client                    Server (Orchestrator)
  │                           │
  │  user message             │
  ├──────────────────────────>│
  │                           │── AI 决定调用 write 工具
  │                           │── 检查工具安全等级
  │                           │
  │  SSE: write_confirmation  │   (Level ≥ 1)
  │<──────────────────────────│
  │                           │   (暂停等待，设超时 60s)
  │  确认/拒绝                │
  ├──────────────────────────>│
  │                           │── 确认 → 执行 + audit log
  │                           │── 拒绝 → 告知 AI 用户拒绝
  │  SSE: tool_result         │
  │<──────────────────────────│
```

#### 实现要点

**Server 端**（ai-orchestrator.js 修改）：

```javascript
// 工具调用前检查安全等级
const level = getToolSecurityLevel(toolName);
if (level >= 1) {
  // 生成预览摘要
  const preview = await generateToolPreview(toolName, toolArgs);
  // yield 确认事件，暂停执行
  yield {
    type: 'write_confirmation',
    data: { toolName, toolArgs, preview, confirmationId: uuid() }
  };
  // 等待用户通过 /api/ai/confirm/:confirmationId 响应
  const decision = await waitForConfirmation(confirmationId, 60000);
  if (decision === 'rejected') {
    // 注入拒绝消息让 AI 知道
    messages.push({ role: 'tool', content: '用户拒绝了此操作' });
    continue;
  }
}
```

**Client 端**（AIPanel 修改）：
- 收到 `write_confirmation` 事件 → 显示确认 Modal
- Modal 包含：操作描述、影响范围、预览数据、确认/拒绝按钮
- 用户点击后 POST `/api/ai/confirm/:id`

### 3.3 审计日志增强

当前 `ai_audit_log` 表已有基础字段，建议增强：

```sql
ALTER TABLE ai_audit_log ADD COLUMN security_level INTEGER DEFAULT 0;
ALTER TABLE ai_audit_log ADD COLUMN user_confirmed BOOLEAN;
ALTER TABLE ai_audit_log ADD COLUMN rollback_status TEXT DEFAULT 'available';
-- rollback_status: 'available' | 'rolled_back' | 'expired'
```

每次 write 操作必须记录 `old_values`（当前已有字段），用于回滚。

---

## 4. 回滚机制

### 4.1 设计原则

- **只回滚数据变更**，不回滚文件操作（照片物理删除用回收站替代）
- **基于 old_values 逆向**——每个 write 工具在执行前查询当前值，存入 audit log
- **时间窗口**——30 天内可回滚，超期标记为 expired
- **链式回滚**——批量操作拆分为多条 audit 记录，按 batch_id 关联

### 4.2 回滚 API

```
POST /api/ai/rollback/:auditId
GET  /api/ai/audit-log?conversation_id=xxx&tool_type=write
```

### 4.3 回滚执行流程

```javascript
async function rollbackAction(auditId) {
  const record = await getAsync(
    'SELECT * FROM ai_audit_log WHERE id = ?', [auditId]
  );
  if (!record || record.rollback_status !== 'available') {
    throw new Error('该操作不可回滚');
  }

  const oldValues = JSON.parse(record.old_values);
  // 根据 tool_name 执行逆向操作
  switch (record.tool_name) {
    case 'update_photo_metadata':
      await runAsync(
        'UPDATE photos SET caption=?, rating=?, location_name=? WHERE id=?',
        [oldValues.caption, oldValues.rating, oldValues.location_name, oldValues.id]
      );
      break;
    case 'attach_tags':
      // 删除新增的 photo_tags 记录
      for (const pt of oldValues.added_relations) {
        await runAsync('DELETE FROM photo_tags WHERE photo_id=? AND tag_id=?',
          [pt.photo_id, pt.tag_id]);
      }
      break;
    // ... 其他工具的回滚逻辑
  }

  await runAsync(
    'UPDATE ai_audit_log SET rollback_status=? WHERE id=?',
    ['rolled_back', auditId]
  );
}
```

### 4.4 工具 Handler 标准模板

所有 write 工具必须遵循此模板：

```javascript
handler: async (args) => {
  // 1. 查询当前值（用于回滚）
  const oldValues = await getAsync('SELECT * FROM xxx WHERE id = ?', [args.id]);
  if (!oldValues) return sanitizeToolResult(JSON.stringify({ error: 'not found' }));

  // 2. 执行写入
  await runAsync('UPDATE xxx SET field = ? WHERE id = ?', [args.value, args.id]);

  // 3. 返回结果（audit log 由 orchestrator 统一记录）
  return sanitizeToolResult(JSON.stringify({
    success: true,
    changes: { field: { old: oldValues.field, new: args.value } },
    _oldValues: oldValues  // orchestrator 提取后存入 audit log
  }));
}
```

---

## 5. 客户端 UI 设计

### 5.1 工具执行状态指示

当前 `ToolCallIndicator` 组件已显示工具调用，需增强：

| 状态 | 图标 | 说明 |
|------|------|------|
| Calling | ⏳ 旋转 | 工具执行中 |
| Waiting | ⚠️ 黄色 | 等待用户确认 |
| Confirmed | ✅ 绿色 | 已确认执行 |
| Rejected | ❌ 红色 | 用户拒绝 |
| Rolled Back | ↩️ 灰色 | 已回滚 |

### 5.2 确认 Modal 设计

```
┌──────────────────────────────────────┐
│  🔧 AI 请求执行操作                  │
│                                      │
│  操作：更新照片元数据                  │
│  影响：5 张照片                       │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ #142 DSC001.jpg              │    │
│  │   caption: "" → "东京塔夜景"  │    │
│  │ #143 DSC002.jpg              │    │
│  │   caption: "" → "涩谷十字路口" │    │
│  └──────────────────────────────┘    │
│                                      │
│  [ 拒绝 ]              [ ✓ 确认执行 ]│
└──────────────────────────────────────┘
```

### 5.3 操作历史面板

在 AIPanel 的 Settings 或独立 Tab 中添加操作历史：

- 列表展示所有 write 操作（时间、工具、摘要）
- 每条记录右侧有"回滚"按钮（仅 rollback_status = available 时可用）
- 支持按对话 / 时间 / 操作类型筛选
- 点击可展开查看详细变更

### 5.4 工具能力选择器（Settings）

在 AI 设置中添加工具权限开关：

```
┌─ AI 工具权限 ──────────────────────────┐
│                                        │
│  照片管理                               │
│    ☑ 搜索照片          (read)          │
│    ☑ 修改照片元数据     (write, L1)     │
│    ☐ 批量修改           (write, L2)     │
│    ☑ 设置评分          (write, L0)      │
│                                        │
│  胶卷管理                               │
│    ☑ 修改胶卷信息       (write, L1)     │
│    ...                                 │
│                                        │
│  ⚙️ 全局设置                            │
│    ☑ 启用写入操作                       │
│    ☑ 所有写入需确认（覆盖安全等级）       │
│    回滚窗口: [30] 天                    │
└────────────────────────────────────────┘
```

---

## 6. 实施路线图

### Phase 1: 安全基础设施（优先级最高）

**目标**：建立写入确认 + 回滚机制，为后续工具开发提供安全基础。

| 任务 | 涉及文件 | 工作量 |
|------|---------|--------|
| 实现 `getToolSecurityLevel()` | ai-tools.js | 小 |
| Orchestrator 确认暂停/恢复机制 | ai-orchestrator.js | 中 |
| 确认 API (`/api/ai/confirm/:id`) | ai 路由 | 小 |
| 回滚 API (`/api/ai/rollback/:id`) | ai 路由 + 新 service | 中 |
| `ai_audit_log` 表增强 | migration.js | 小 |
| Write 工具 old_values 标准化 | ai-tools.js | 小 |
| 前端 ConfirmationModal 组件 | AIPanel/ | 中 |
| 前端确认 SSE 事件处理 | AIPanel.jsx | 中 |

### Phase 2: 核心写入工具

**目标**：覆盖最高频的写入场景。

| 优先级 | 工具 | 理由 |
|--------|------|------|
| P0 | `update_photo_metadata` | 最常用写入操作 |
| P0 | `set_photo_rating` | 高频、低风险 |
| P0 | `attach_tags` / `detach_tags` | AI 标签管理核心价值 |
| P1 | `update_roll` | 常用 |
| P1 | `batch_update_photos` | 效率关键 |
| P1 | `toggle_photo_favorite` | 快捷操作 |
| P2 | `create_tag` | 标签系统补全 |
| P2 | `delete_photo` | 需回收站机制 |

### Phase 3: 数据分析增强

**目标**：充分发挥 AI 分析能力。

| 优先级 | 工具 | 理由 |
|--------|------|------|
| P0 | `analyze_shooting_patterns` | 核心分析能力 |
| P0 | `cost_analysis` | 用户强需求 |
| P1 | `equipment_usage_stats` | 设备决策辅助 |
| P1 | `get_photo_neighbors` | 上下文感知 |

### Phase 4: 库存与设备管理

| 优先级 | 工具 |
|--------|------|
| P1 | `search_film_inventory` |
| P1 | `update_inventory_item` |
| P2 | `record_film_purchase` |
| P2 | `add_equipment` / `update_equipment` |

### Phase 5: FilmLab 智能化

| 优先级 | 工具 |
|--------|------|
| P1 | `get_render_params` |
| P2 | `suggest_render_params` |
| P2 | `batch_apply_preset` |

### Phase 6: 前端体验完善

| 任务 | 优先级 |
|------|--------|
| 操作历史面板 | P1 |
| 工具权限选择器 | P1 |
| 回滚 UI | P1 |
| 批量操作进度显示 | P2 |

---

## 附录 A: 现有 Server API 可复用端点

以下已有 API 端点可直接在工具 handler 中复用其 service 层逻辑：

| Agent 工具 | 可复用的现有 API | Service 文件 |
|-----------|-----------------|-------------|
| `update_photo_metadata` | `PUT /api/photos/:id` | photo-service.js |
| `batch_update_photos` | `PUT /api/photos/:id` (循环) | photo-service.js |
| `set_photo_rating` | `PUT /api/photos/:id` | photo-service.js |
| `toggle_photo_favorite` | `PUT /api/photos/:id` | photo-service.js |
| `delete_photo` | `DELETE /api/photos/:id` | photo-service.js |
| `update_roll` | `PUT /api/rolls/:id` | roll-service.js |
| `set_roll_cover` | `PUT /api/rolls/:id/cover` | roll-service.js |
| `set_roll_preset` | `PUT /api/rolls/:id/preset` | preset-service.js |
| `attach_tags` | `POST /api/photos/:id/tags` | tag-service.js |
| `detach_tags` | `DELETE /api/photos/:id/tags/:tagId` | tag-service.js |
| `create_tag` | `POST /api/tags` | tag-service.js |
| `update_equipment` | `PUT /api/equipment/:type/:id` | equipment-service.js |
| `add_equipment` | `POST /api/equipment/:type` | equipment-service.js |
| `update_inventory_item` | `PUT /api/film-items/:id` | film-item-service.js |
| `record_film_purchase` | `POST /api/film-items/purchase-batch` | film-item-service.js |
| `get_render_params` | `GET /api/filmlab/params/:photoId` | filmlab-service.js |
| `batch_apply_preset` | `POST /api/batch-render` | batch-render-service.js |

> 原则：工具 handler 不应直接操作 DB，而应调用已有 service 函数。若 service 函数不存在，先补充 service 层再注册工具。

---

## 附录 B: 数据库表与工具映射

| 表 | 对应工具 |
|----|---------|
| photos | search_photos, get_photo_detail, update_photo_metadata, batch_update, set_rating, toggle_fav, delete |
| rolls | list_rolls, get_roll_detail, update_roll, set_roll_cover |
| films | get_film_info |
| film_items | search_film_inventory, update_inventory_item, record_film_purchase |
| tags | list_tags, create_tag |
| photo_tags | attach_tags, detach_tags |
| equipment_cameras/lenses/flashes/scanners/film_backs | search_equipment, update_equipment, add_equipment |
| shot_logs | get_shot_log, update_shot_log, add_shot_log_entry |
| presets | get_render_params, suggest_render_params |
| ai_audit_log | 回滚机制、操作历史 |
| ai_conversations / ai_messages | 对话管理（已有） |

---

## 附录 C: Agent 安全等级快查表

| 工具 | Level | 行为 |
|------|-------|------|
| 所有 `read` 工具 | 0 | 自动执行 |
| `set_photo_rating` | 0 | 自动执行 |
| `toggle_photo_favorite` | 0 | 自动执行 |
| `create_tag` | 0 | 自动执行 |
| `add_shot_log_entry` | 0 | 自动执行 |
| `set_roll_cover` | 0 | 自动执行 |
| `update_photo_metadata` | 1 | 用户确认 |
| `update_roll` | 1 | 用户确认 |
| `update_shot_log` | 1 | 用户确认 |
| `update_inventory_item` | 1 | 用户确认 |
| `update_equipment` | 1 | 用户确认 |
| `add_equipment` | 1 | 用户确认 |
| `record_film_purchase` | 1 | 用户确认 |
| `attach_tags` | 1 | 用户确认 |
| `detach_tags` | 1 | 用户确认 |
| `set_roll_preset` | 1 | 用户确认 |
| `suggest_render_params` | 1 | 用户确认 |
| `batch_update_photos` | 2 | 确认 + 预览 |
| `batch_apply_preset` | 2 | 确认 + 预览 |
| `delete_photo` | 2 | 确认 + 预览 |
