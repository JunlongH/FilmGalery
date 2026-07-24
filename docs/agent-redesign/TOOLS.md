# 按域工具清单与重构方案

> 本文档基于[审计报告](./DIAGNOSIS.md)和[标准化工具框架规范](./TOOL-FRAMEWORK.md)，定义每个域的精确工具清单、重构变更和 Zod schema 要点。
>
> **总工具数**: 38（read: 20, write: 18）
>
> **状态**: ✅ 已修复（Phase 0） / 🔧 待修复（Phase 1+）

---

## 重构原则

### 命名规范
- **snake_case** 命名，域前缀：`photo_search`, `roll_list`, `film_get_info`
- 重命名工具保留原语义，但统一前缀格式

### 输入验证（三层防线）
| 层级 | 机制 | 位置 |
|------|------|------|
| Layer 1 | Zod schema 解析（类型/格式/枚举/范围） | 框架 `safeExecute` |
| Layer 2 | 语义验证（存在性/FK/业务规则） | handler 内部 |
| Layer 3 | 参数化 SQL（列名取自硬编码白名单） | handler SQL 构建 |

### 错误处理
- **工具绝不 throw**。所有返回通过 `toolOk` / `toolError` 结构化信封
- 错误类型：`validation_error`, `not_found`, `conflict`, `permission_denied`, `precondition_failed`, `internal_error`
- 所有错误含 `type`/`message`/`retryable`/`fields`/`hint` 字段

### 事务
- 所有多步写入用 `withTransaction()` 包裹
- `sqlite3` 异步实现：`BEGIN TRANSACTION` → fn → `COMMIT` / catch → `ROLLBACK`

### 幂等键
- 所有创建类工具接受可选 `idempotency_key`（UUID）
- 新建 `tool_idempotency` 表缓存已处理结果

### 乐观锁
- 对共享实体使用 `version` 列 + `WHERE version = ?` 防丢失更新
- 写入时 `version = version + 1`，并更新 `updated_at`

### 软删除替代硬删除
- `photos` 表已有 `deleted_at` 列；`DELETE` 改为 `SET deleted_at = ?`

---

## Schema 迁移需求

### 新增列

```sql
-- photos: 乐观锁版本号
ALTER TABLE photos ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
-- 注: deleted_at 列已在 schema-migration.js 中存在，确保所有查询过滤

-- rolls: 乐观锁 + 更新时间戳
ALTER TABLE rolls ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rolls ADD COLUMN updated_at DATETIME;

-- 各 equipment 表: 乐观锁
ALTER TABLE equip_cameras   ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE equip_lenses    ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE equip_flashes   ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE equip_scanners  ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE equip_film_backs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- film_items: 确保 updated_at 有默认值
-- current: 无 DEFAULT → 新行 NULL。新增迁移设 DEFAULT (datetime('now'))
```

### 新增表

```sql
CREATE TABLE IF NOT EXISTS tool_idempotency (
  key         TEXT        NOT NULL,
  tool_name   TEXT        NOT NULL,
  result_json TEXT        NOT NULL,
  created_at  DATETIME    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key, tool_name)
);
```

### 列名修正（rolls 表）
- `cover_photo_id` → 实际列: `cover_photo`（snake_case）
- `cover_path` → 实际列: `coverPath`（camelCase）
- 当前 SQL 写不存在的列 → 100% 失败（C1 已修）

---

## 1. photo 域（8 工具）

照片 CRUD、搜索、元数据更新、批量操作、删除。

### 工具概览

| # | 工具名 | 类型 | Lv | 原工具名 | 关键变更 |
|---|--------|------|----|----------|----------|
| 1 | `photo_search` | read | 0 | `search_photos` | 统一命名前缀 |
| 2 | `photo_get` | read | 0 | `get_photo_detail` | 重命名 |
| 3 | `photo_list_by_roll` | read | 0 | `get_roll_photos` | 重命名 |
| 4 | `photo_get_neighbors` | read | 0 | `get_photo_neighbors` | 重命名 |
| 5 | `photo_update_metadata` | write | 1 | `update_photo_metadata` | 重命名 + 乐观锁 + 输入验证 |
| 6 | `photo_batch_update` | write | 2 | `batch_update_photos` | 重命名 + 事务 + 修复 affected_count |
| 7 | `photo_set_rating` | write | 0 | `set_photo_rating` | 重命名 + 范围验证 0-5 |
| 8 | `photo_toggle_favorite` | write | 0 | `toggle_photo_favorite` | 重命名 + 事务包裹 |

### 详细设计

#### 1.1 `photo_search` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 按关键词、胶卷、相机、镜头、年份、评分等过滤条件搜索照片 |
| **当前状态** | ✅ 基本正常，无严重 bug |
| **重构变更** | 统一命名前缀；`deleted_at IS NULL` 过滤确保不返回已删除照片 |
| **Zod Schema** | `query?: string.max(200)`, `roll_id?: number.int.positive`, `camera?: string.max(100)`, `lens?: string.max(100)`, `year?: number.int(1900-2100)`, `min_rating?: number.int(0-5)`, `tags?: number[].optional`, `limit?: number.int(1-100).default(20)` |

#### 1.2 `photo_get` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 获取单张照片完整详情（含卷信息、标签、渲染参数） |
| **当前状态** | ✅ 正常 |
| **重构变更** | 重命名（`get_photo_detail` → `photo_get`） |
| **Zod Schema** | `photo_id: number.int.positive` |

#### 1.3 `photo_list_by_roll` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 按胶卷 ID 列出该卷所有照片（按拍摄时间或文件名排序） |
| **当前状态** | ✅ 正常 |
| **重构变更** | 重命名（`get_roll_photos` → `photo_list_by_roll`） |
| **Zod Schema** | `roll_id: number.int.positive`, `sort?: enum('date_taken','filename','rating').default('date_taken')`, `limit?: number.int(1-100).default(50)` |

#### 1.4 `photo_get_neighbors` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 获取某张照片在同一卷中的前后邻接照片（用于浏览上下文） |
| **当前状态** | ✅ 正常 |
| **重构变更** | 重命名（`get_photo_neighbors` → `photo_get_neighbors`） |
| **Zod Schema** | `photo_id: number.int.positive`, `before?: number.int(0-20).default(5)`, `after?: number.int(0-20).default(5)` |

#### 1.5 `photo_update_metadata` (write, L1)

| 项目 | 内容 |
|------|------|
| **说明** | 更新单张照片的元数据（说明、评分、GPS、日期、地点名、备注） |
| **当前状态** | 🔧 无范围验证（`rating=999` 可存）；读-改-写竞争无乐观锁 |
| **重构变更** | 加 `expected_version` 乐观锁；Zod 范围验证；返回 `old_values`/`new_values` |
| **Zod Schema** | `photo_id: number.int.positive`, `expected_version: number.int.positive`（从 `photo_get` 获取）<br>`changes: z.object({`<br>&emsp;`caption?: string.max(500)`,<br>&emsp;`rating?: number.int.min(0).max(5)`,<br>&emsp;`latitude?: number.min(-90).max(90)`,<br>&emsp;`longitude?: number.min(-180).max(180)`,<br>&emsp;`date_taken?: string.datetime()`,<br>&emsp;`location_name?: string.max(200)`,<br>&emsp;`notes?: string.max(2000)`,<br>&emsp;`favorite?: boolean.optional` — 合并 toggle 功能<br>`})` |

#### 1.6 `photo_batch_update` (write, L2)

| 项目 | 内容 |
|------|------|
| **说明** | 批量更新多张照片的同一个字段（如给一组照片设评分） |
| **当前状态** | 🔧 无事务（C6）；`affected_count` 报告请求数而非实际影响行（F5） |
| **重构变更** | 加 `withTransaction()` 事务包裹；修复计数用 `result.changes` 累加；加安全等级 2（批量操作需确认+预览） |
| **Zod Schema** | `photo_ids: number.int.positive.array().min(1).max(100)`,<br>`field: enum('caption','rating','latitude','longitude','date_taken','location_name','notes','favorite')`,<br>`value: any`（按 field 类型验证）<br>`idempotency_key?: string.uuid.optional` |

#### 1.7 `photo_set_rating` (write, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 为单张照片设置评分（0-5 整数）。低风险，自动执行。 |
| **当前状态** | 🔧 无范围验证（`rating=999` 被存储） |
| **重构变更** | Zod `min(0).max(5)` 范围验证；安全等级保持 0（低风险写操作） |
| **Zod Schema** | `photo_id: number.int.positive`, `rating: number.int.min(0).max(5)` |

#### 1.8 `photo_toggle_favorite` (write, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 切换照片的收藏状态（favorite 字段取反）。低风险，自动执行。 |
| **当前状态** | 🔧 无事务，并发 toggle 丢失更新（F1） |
| **重构变更** | 保留独立工具（不合并入 `photo_update_metadata`，因为它是无参数的 toggle 操作）；加事务包裹 `SELECT → UPDATE`；安全等级保持 0 |
| **Zod Schema** | `photo_id: number.int.positive` |

---

## 2. roll 域（5 工具）

胶卷 CRUD、封面设置、预设管理。

### 工具概览

| # | 工具名 | 类型 | Lv | 原工具名 | 关键变更 |
|---|--------|------|----|----------|----------|
| 9 | `roll_list` | read | 0 | `list_rolls` | 重命名 |
| 10 | `roll_get` | read | 0 | `get_roll_detail` | 重命名 |
| 11 | `roll_update` | write | 1 | `update_roll` | 加 optimistic lock + `updated_at` |
| 12 | `roll_set_cover` | write | 0 | `set_roll_cover` | **修复列名 bug（C1）** + 路径格式 |
| 13 | `roll_set_preset` | write | 1 | `set_roll_preset` | 加 JSON 验证 |

### 详细设计

#### 2.1 `roll_list` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 列出所有胶卷，支持按状态/格式/日期过滤 |
| **当前状态** | ✅ 正常 |
| **重构变更** | 重命名（`list_rolls` → `roll_list`）；按 `updated_at DESC` 排序（需等 migration 加列） |
| **Zod Schema** | `status?: enum('active','archived','all').default('active')`, `format?: enum('35mm','120','large_format','instant','all').optional`, `limit?: number.int(1-100).default(50)` |

#### 2.2 `roll_get` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 获取单卷完整详情（含拍摄参数、封面、预设、关联照片数） |
| **当前状态** | ✅ 正常 |
| **重构变更** | 重命名（`get_roll_detail` → `roll_get`） |
| **Zod Schema** | `roll_id: number.int.positive` |

#### 2.3 `roll_update` (write, L1)

| 项目 | 内容 |
|------|------|
| **说明** | 更新胶卷信息（标题、状态、ISO、格式、备注等） |
| **当前状态** | 🔧 无乐观锁（F1）；`rolls` 表无 `updated_at` 列（D4）；无输入验证 |
| **重构变更** | 加 `expected_version` 乐观锁；写入 `updated_at`（迁移加列后）；Zod 输入验证 |
| **Zod Schema** | `roll_id: number.int.positive`, `expected_version: number.int.positive`,<br>`changes: z.object({`<br>&emsp;`title?: string.max(200)`,<br>&emsp;`status?: enum('active','archived','development','scanned')`,<br>&emsp;`iso?: number.int.min(12).max(25600)`,<br>&emsp;`format?: string.max(50)`,<br>&emsp;`notes?: string.max(2000)`,<br>&emsp;`camera?: string.max(100)`,<br>&emsp;`lens?: string.max(100)`<br>`})` |

#### 2.4 `roll_set_cover` (write, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 将卷中某张照片设为封面封面。自动执行。 |
| **当前状态** | 🔴 **严重 bug（C1）**: SQL 写 `cover_photo_id`/`cover_path`，但实际列是 `cover_photo`/`coverPath` → 100% 失败。路径格式也不对（原始相对路径 vs 期望的 `/uploads/` 前缀） |
| **重构变更** | 修正列名为 `cover_photo` / `coverPath`；路径格式使用 `normalizeCoverPath`；返回 `cover_url` |
| **Zod Schema** | `roll_id: number.int.positive`, `photo_id: number.int.positive`<br>（Zod 层验证 photo 属于该 roll：`roll_id === rollId`，类型转换处理字符串 vs 数字） |

#### 2.5 `roll_set_preset` (write, L1)

| 项目 | 内容 |
|------|------|
| **说明** | 为胶卷设置渲染预设 JSON。需要确认。 |
| **当前状态** | 🔧 不验证 JSON 有效性（F8），截断/损坏 JSON 被存储 |
| **重构变更** | 验证 `preset.params_json` 是合法 JSON 且包含必要字段；安全等级升为 1（因可破坏渲染管线） |
| **Zod Schema** | `roll_id: number.int.positive`, `preset: z.record(z.string(), z.any())` — 透传整个预设对象，仅验证 JSON 解析 |

---

## 3. film 域（4 工具）

胶片库存查询、库存更新、购买记录。

### 工具概览

| # | 工具名 | 类型 | Lv | 原工具名 | 关键变更 |
|---|--------|------|----|----------|----------|
| 14 | `film_get_info` | read | 0 | `get_film_info` | 重命名 |
| 15 | `film_list_stock` | read | 0 | `list_film_items` | 修复排序（NULL `updated_at` 排最后） |
| 16 | `film_update_inventory` | write | 1 | `update_inventory_item` | 重命名 |
| 17 | `film_record_purchase` | write | 1 | `record_film_purchase` | **修复 C3** + 事务 + 幂等键 |

### 详细设计

#### 3.1 `film_get_info` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 获取胶片型号详情（品牌、ISO、格式、类型） |
| **当前状态** | ✅ 正常 |
| **重构变更** | 重命名（`get_film_info` → `film_get_info`） |
| **Zod Schema** | `film_id: number.int.positive` |

#### 3.2 `film_list_stock` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 列出库存中的所有胶片条目（按 `updated_at DESC` 排序） |
| **当前状态** | 🔧 排序关联 bug（C3）：新购买胶片 `updated_at` 为 NULL → 排最后 → 超过 LIMIT 不可见 |
| **重构变更** | 排序修正：`ORDER BY fi.updated_at DESC` → `ORDER BY fi.updated_at IS NULL, fi.updated_at DESC, fi.id DESC`；过滤 `deleted_at IS NULL` |
| **Zod Schema** | `status?: enum('in_stock','used','all').default('all')`, `film_id?: number.int.positive`, `limit?: number.int(1-200).default(100)` |

#### 3.3 `film_update_inventory` (write, L1)

| 项目 | 内容 |
|------|------|
| **说明** | 更新库存中某条胶片记录的日期、备注等 |
| **当前状态** | ⚠️ 日期/数值不验证，但无严重 bug |
| **重构变更** | 重命名（`update_inventory_item` → `film_update_inventory`）；加乐观锁（version on film_items） |
| **Zod Schema** | `item_id: number.int.positive`,<br>`changes: z.object({`<br>&emsp;`status?: enum('in_stock','used','expired')`,<br>&emsp;`purchase_price?: number.min(0)`,<br>&emsp;`expiry_date?: string.datetime().optional`,<br>&emsp;`notes?: string.max(1000)`,<br>&emsp;`location?: string.max(200)`<br>`})` |

#### 3.4 `film_record_purchase` (write, L1)

| 项目 | 内容 |
|------|------|
| **说明** | 记录购买胶片进库存。支持批量数量（quantity=N 创建 N 条记录）。 |
| **当前状态** | 🔴 **严重 bug（C3）**: INSERT 不设 `updated_at`（列无 DEFAULT），新行 NULL → `list_film_items` 按 `updated_at DESC` 排序不可见。无事务（C6）。报告 `created_count: qty` 而非实际创建数（F10）。 |
| **重构变更** | 加 `updated_at = datetime('now')`；`withTransaction()` 包裹批量 INSERT；`created_count` 取 `createdIds.length`；接受 `idempotency_key` |
| **Zod Schema** | `film_id: number.int.positive`, `quantity: number.int.min(1).max(100).default(1)`,<br>`purchase_price?: number.min(0)`, `purchase_date?: string.datetime()`, `location?: string.max(200)`, `notes?: string.max(1000)`,<br>`idempotency_key?: string.uuid.optional` |

---

## 4. equipment 域（4 工具）

设备搜索、详情获取、添加、更新。按设备类型分异字段列表。

### 工具概览

| # | 工具名 | 类型 | Lv | 原工具名 | 关键变更 |
|---|--------|------|----|----------|----------|
| 18 | `equipment_search` | read | 0 | `search_equipment` | 重命名 |
| 19 | `equipment_get` | read | 0 | **NEW** | 新增 |
| 20 | `equipment_add` | write | 1 | `add_equipment` | **修复 C2** — 按类型分异 schema |
| 21 | `equipment_update` | write | 1 | `update_equipment` | **修复 C2** — 按类型分异 ALLOWED 列表 |

### 详细设计

#### 4.1 `equipment_search` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 按类型、品牌、型号等搜索已注册设备 |
| **当前状态** | ✅ 正常 |
| **重构变更** | 重命名（`search_equipment` → `equipment_search`）；支持按 `type` 过滤 |
| **Zod Schema** | `type?: enum('camera','lens','flash','scanner','film_back').optional`, `query?: string.max(200)`, `brand?: string.max(100)`, `limit?: number.int(1-100).default(30)` |

#### 4.2 `equipment_get` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 获取单个设备的完整详情（含类型特定字段） |
| **当前状态** | 🆕 新增工具 |
| **重构变更** | 按 `type` 路由到对应表；返回完整行数据 |
| **Zod Schema** | `equipment_id: number.int.positive`, `type: enum('camera','lens','flash','scanner','film_back')` |

#### 4.3 `equipment_add` (write, L1)

| 项目 | 内容 |
|------|------|
| **说明** | 添加新设备到库存。按设备类型使用不同的字段 schema。 |
| **当前状态** | 🔴 **严重 bug（C2）**: 单一 `COMMON_ALLOWED` 列表覆盖所有类型。flash 无 `type`/`mount` 列但 schema 要求它们；scanner 无 `mount` 列；film_back 无 `type`/`mount` 列（用 `mount_type`/`magazine_type`）。 |
| **重构变更** | **移除 `COMMON_ALLOWED`**。每个设备类型独立 schema，只暴露该表实际存在的列。 |
| **Zod Schema** | `type: enum('camera','lens','flash','scanner','film_back')` 决定后续字段，然后按类型验证： |

**按类型字段映射**（`equipment_add` + `equipment_update` 共用）：

| 类型 | 可用字段 |
|------|---------|
| **camera** | `name`, `brand`, `model`, `type`（如 SLR/RF/TLR/P&S）, `mount`, `format_id`, `serial_number`,<br>`purchase_date`, `purchase_price`, `purchase_from`, `condition`, `notes`, `status`,<br>`meter_type`, `shutter_type`, `shutter_speed_min`, `shutter_speed_max`,<br>`weight_g`, `battery_type`, `production_year_start`, `production_year_end` |
| **lens** | `name`, `brand`, `model`,<br>`focal_length_min`, `focal_length_max`, `max_aperture`, `max_aperture_tele`, `min_aperture`,<br>`is_macro`, `magnification_ratio`, `image_stabilization`,<br>`mount`, `focus_type`, `min_focus_distance`, `filter_size`,<br>`weight_g`, `elements`, `groups`, `blade_count`,<br>`serial_number`, `purchase_date`, `purchase_price`, `purchase_from`, `condition`, `notes`, `status` |
| **flash** | `name`, `brand`, `model`,<br>`guide_number`, `ttl_compatible`, `has_auto_mode`, `swivel_head`, `bounce_head`,<br>`power_source`, `recycle_time`,<br>`serial_number`, `purchase_date`, `purchase_price`, `purchase_from`, `condition`, `notes`, `status`<br>⚠️ **无** `type`, **无** `mount` |
| **scanner** | `name`, `brand`, `model`, `type`（如 flatbed/dedicated/drum）,<br>`max_resolution`, `sensor_type`, `supported_formats`, `has_infrared_cleaning`, `bit_depth`, `default_software`,<br>`serial_number`, `purchase_date`, `purchase_price`, `purchase_from`, `condition`, `notes`, `status`<br>⚠️ **无** `mount` |
| **film_back** | `name`, `brand`, `model`, `format`, `sub_format`, `frame_width_mm`, `frame_height_mm`, `frames_per_roll`,<br>`compatible_cameras`, `mount_type`, `magazine_type`, `is_motorized`, `has_dark_slide`,<br>`serial_number`, `purchase_date`, `purchase_price`, `purchase_from`, `condition`, `notes`, `status`<br>⚠️ **无** `type`（用 `magazine_type`）, **无** `mount`（用 `mount_type`） |

**实现方式**：`equipment_add` handler 内按 `type` 选择对应的列白名单和 SQL INSERT 模板，不将列名选择权交给 LLM。

#### 4.4 `equipment_update` (write, L1)

| 项目 | 内容 |
|------|------|
| **说明** | 更新已有设备的字段。与 `equipment_add` 相同按类型分异字段。 |
| **当前状态** | 🔴 **严重 bug（C2）** — 同 `equipment_add` |
| **重构变更** | 加乐观锁（`version`）；按类型选择 ALLOWED 字段；加 `idempotency_key` |
| **Zod Schema** | `equipment_id: number.int.positive`, `type: enum(...)`（用于路由），`changes: z.object({` + 上述按类型字段 + `})`，全部 optional |

---

## 5. tag 域（5 工具）

标签列表、创建、应用、移除、重命名。

### 工具概览

| # | 工具名 | 类型 | Lv | 原工具名 | 关键变更 |
|---|--------|------|----|----------|----------|
| 22 | `tag_list` | read | 0 | `list_tags` | 重命名 |
| 23 | `tag_create` | write | 0 | `create_tag` | 修复 TOCTOU 竞争（F2） |
| 24 | `tag_apply` | write | 1 | `attach_tags` | **修复 C5** — 不再吞错 |
| 25 | `tag_remove` | write | 1 | `detach_tags` | 修复报告（F9） |
| 26 | `tag_rename` | write | 1 | **NEW** | 新增 |

### 详细设计

#### 5.1 `tag_list` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 列出所有标签和它们的照片计数 |
| **当前状态** | ✅ 正常 |
| **重构变更** | 重命名（`list_tags` → `tag_list`） |
| **Zod Schema** | `search?: string.max(100).optional`, `limit?: number.int(1-200).default(100)` |

#### 5.2 `tag_create` (write, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 创建新标签。如已存在则返回现有标签，不报错。低风险，自动执行。 |
| **当前状态** | 🔧 TOCTOU 竞争（F2）：先 SELECT 检查再 INSERT，并发调用同名标签 → UNIQUE 冲突 |
| **重构变更** | 改用 `INSERT OR IGNORE` + 随后 `SELECT` 获取实际 ID（原子操作，消除 TOCTOU） |
| **Zod Schema** | `name: string.min(1).max(100).trim()` |

#### 5.3 `tag_apply` (write, L1)

| 项目 | 内容 |
|------|------|
| **说明** | 为指定照片批量应用标签（传入标签 ID 列表）。 |
| **当前状态** | 🔴 **严重 bug（C5）**: `catch{}` 吞掉所有 FK 错误，返回 `ok:true`。`attachedCount` 在 `await` 之前递增。 |
| **重构变更** | **移除 `catch{}`**；`INSERT OR IGNORE` 正常错误由事务回滚；加 `withTransaction()` 包裹 N×M INSERT；`attached_count` 基于 `result.changes` 累加 |
| **Zod Schema** | `photo_ids: number.int.positive.array().min(1).max(100)`, `tag_ids: number.int.positive.array().min(1).max(50)` |

#### 5.4 `tag_remove` (write, L1)

| 项目 | 内容 |
|------|------|
| **说明** | 从指定照片移除标签。返回实际移除的标签列表。 |
| **当前状态** | 🔧 `tags_removed` 报告原始输入列表而非实际移除的标签（F9）。不存在标签被 `continue` 跳过但仍在结果中。 |
| **重构变更** | 加 `withTransaction()` 包裹；`tags_removed` 基于 `result.changes > 0` 的行构建，只包含实际删除的标签名 |
| **Zod Schema** | `photo_id: number.int.positive`, `tag_ids: number.int.positive.array().min(1).max(50)`<br>或者 `tag_names: string.array().min(1).max(50)`（按名称操作） |

#### 5.5 `tag_rename` (write, L1)

| 项目 | 内容 |
|------|------|
| **说明** | 重命名标签。合并两个标签的用法。 |
| **当前状态** | 🆕 新增工具 |
| **重构变更** | `UPDATE tags SET name = ? WHERE id = ?`；加 `idempotency_key` 防止 LLM 重复重命名 |
| **Zod Schema** | `tag_id: number.int.positive`, `new_name: string.min(1).max(100).trim()` |

---

## 6. shot_log 域（3 工具）

拍摄记录查看、更新、添加条目。

### 工具概览

| # | 工具名 | 类型 | Lv | 原工具名 | 关键变更 |
|---|--------|------|----|----------|----------|
| 27 | `shot_log_get` | read | 0 | `get_shot_log` | 重命名 |
| 28 | `shot_log_update` | write | 1 | `update_shot_log` | 加乐观锁 |
| 29 | `shot_log_add_entry` | write | 0 | `add_shot_log_entry` | 加事务 + 乐观锁 |

### 详细设计

#### 6.1 `shot_log_get` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 获取某卷的拍摄记录（shot log） |
| **当前状态** | ✅ 正常 |
| **重构变更** | 重命名（`get_shot_log` → `shot_log_get`） |
| **Zod Schema** | `roll_id: number.int.positive` |

#### 6.2 `shot_log_update` (write, L1)

| 项目 | 内容 |
|------|------|
| **说明** | 更新拍摄记录中的单条数据（如修正快门速度、光圈等）。 |
| **当前状态** | 🔧 读-改-写竞争（F1）：`SELECT → parse → modify → UPDATE` 无乐观锁 |
| **重构变更** | 加乐观锁（`version` 列或基于 `film_items` 的 rowid）；加 `withTransaction()` 包裹 |
| **Zod Schema** | `roll_id: number.int.positive`, `entry_index: number.int.min(0)`,<br>`changes: z.object({`<br>&emsp;`shutter_speed?: string`, `aperture?: string`, `focal_length?: string`,<br>&emsp;`notes?: string.max(500)`, `exposure_compensation?: string`,<br>&emsp;`iso?: number.int`, `metering?: string`<br>`})` |

#### 6.3 `shot_log_add_entry` (write, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 向某卷的拍摄记录追加一条新条目。低风险，自动执行。 |
| **当前状态** | 🔧 无事务；非幂等（F1） |
| **重构变更** | 加 `withTransaction()` 包裹 `SELECT → append → UPDATE`；加 `idempotency_key` |
| **Zod Schema** | `roll_id: number.int.positive`,<br>`entry: z.object({`<br>&emsp;`frame_number?: number.int`, `shutter_speed?: string`, `aperture?: string`,<br>&emsp;`focal_length?: string`, `notes?: string.max(500)`,<br>&emsp;`exposure_compensation?: string`, `iso?: number.int`, `metering?: string`<br>`})`,<br>`idempotency_key?: string.uuid.optional` |

---

## 7. stats 域（4 工具）

统计数据、拍摄模式、成本分析、设备使用率。全部只读、L0。

### 工具概览

| # | 工具名 | 类型 | Lv | 原工具名 | 关键变更 |
|---|--------|------|----|----------|----------|
| 30 | `stats_summary` | read | 0 | `get_stats` | 重命名 |
| 31 | `stats_shooting_patterns` | read | 0 | `analyze_shooting_patterns` | 重命名；Phase 0 已修复 SQL 注入 |
| 32 | `stats_cost_analysis` | read | 0 | `cost_analysis` | 重命名；Phase 0 已修复 SQL 注入 |
| 33 | `stats_equipment_usage` | read | 0 | `equipment_usage_stats` | 重命名；Phase 0 已修复 SQL 注入 |

### 详细设计

#### 7.1 `stats_summary` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 获取库存概览统计（照片总数、胶卷数、胶片库存等） |
| **当前状态** | ✅ 正常（需确保所有 COUNT 过滤 `deleted_at IS NULL` — 修复 O8 不一致） |
| **重构变更** | 重命名（`get_stats` → `stats_summary`）；统一 `deleted_at IS NULL` 过滤 |
| **Zod Schema** | 无参数 |

#### 7.2 `stats_shooting_patterns` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 分析拍摄模式（相机偏好、焦段分布、光圈趋势等） |
| **当前状态** | ✅ Phase 0 已修复 SQL 注入；参数化查询 |
| **重构变更** | 重命名（`analyze_shooting_patterns` → `stats_shooting_patterns`） |
| **Zod Schema** | `date_from?: string.datetime().optional`, `date_to?: string.datetime().optional`, `roll_id?: number.int.positive.optional` |

#### 7.3 `stats_cost_analysis` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 成本分析（胶片购买总花费、单张成本、设备投资等） |
| **当前状态** | ✅ Phase 0 已修复 SQL 注入 |
| **重构变更** | 重命名（`cost_analysis` → `stats_cost_analysis`） |
| **Zod Schema** | `group_by?: enum('month','quarter','year','film_type').default('month')`, `date_from?: string.datetime().optional`, `date_to?: string.datetime().optional` |

#### 7.4 `stats_equipment_usage` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 设备使用率统计（哪些相机/镜头使用最多、维护记录等） |
| **当前状态** | ✅ Phase 0 已修复 SQL 注入 |
| **重构变更** | 重命名（`equipment_usage_stats` → `stats_equipment_usage`） |
| **Zod Schema** | `type?: enum('camera','lens').optional`, `limit?: number.int(1-50).default(20)` |

---

## 8. render 域（5 工具）

渲染参数读取、智能建议、批量应用预设、作业状态管理。

### 工具概览

| # | 工具名 | 类型 | Lv | 原工具名 | 关键变更 |
|---|--------|------|----|----------|----------|
| 34 | `render_get_params` | read | 0 | `get_render_params` | 重命名 |
| 35 | `render_suggest_params` | write | 1 | `suggest_render_params` | **修复 C4** — 从完整模板叠加 |
| 36 | `render_batch_apply_preset` | write | 2 | `batch_apply_preset` | 加事务 + 修复 F6 |
| 37 | `render_status` | read | 0 | **NEW** | 新增 |
| 38 | `render_cancel` | write | 1 | **NEW** | 新增 |

### 详细设计

#### 8.1 `render_get_params` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 获取胶卷当前的渲染参数（`preset_json`） |
| **当前状态** | ✅ 正常 |
| **重构变更** | 重命名（`get_render_params` → `render_get_params`）；返回完整解析后的参数对象；如为 `{}` 返回默认模板 |
| **Zod Schema** | `roll_id: number.int.positive` |

#### 8.2 `render_suggest_params` (write, L1)

| 项目 | 内容 |
|------|------|
| **说明** | 为胶卷建议渲染参数调整。从完整渲染模板叠加 LLM 建议的调整值。 |
| **当前状态** | 🔴 **严重 bug（C4）**: 从 `{}` 开始叠加 → 只写入 ~2-3 个碎片字段 → 渲染器遇到 `undefined` 乘法产生 `NaN` → 黑屏/损坏输出 |
| **重构变更** | **不再从 `{}` 开始**。从完整渲染参数模板（~30 字段）读取，将 LLM 建议的调整值叠加到模板上。加 `withTransaction()` 包裹 SELECT + merge + UPDATE。 |
| **Zod Schema** | `roll_id: number.int.positive`,<br>`adjustments: z.object({`<br>&emsp;`exposure?: number`, `contrast?: number`, `highlights?: number`, `shadows?: number`,<br>&emsp;`whites?: number`, `blacks?: number`, `temperature?: number`, `tint?: number`,<br>&emsp;`vibrance?: number`, `saturation?: number`, `sharpness?: number`, `clarity?: number`,<br>&emsp;`dehaze?: number`, `vignette?: number`, `grain?: number`<br>`})` — 所有字段均为可选，不传入的字段保留模板值 |

#### 8.3 `render_batch_apply_preset` (write, L2)

| 项目 | 内容 |
|------|------|
| **说明** | 将指定渲染预设批量应用到多个胶卷。等级 2 — 需确认+预览。 |
| **当前状态** | 🔧 无事务（C6）；`affected_rolls` 报告找到的胶卷数而非实际更新数（F6）；中途 UPDATE 失败仍报全数 |
| **重构变更** | 加 `withTransaction()` 包裹批量 UPDATE；`affected_rolls` 基于 `result.changes` 累加；逐 roll 跟踪成功/失败并返回失败列表 |
| **Zod Schema** | `roll_ids: number.int.positive.array().min(1).max(50)`, `preset: z.record(z.string(), z.any())`,<br>`idempotency_key?: string.uuid.optional` |

#### 8.4 `render_status` (read, L0)

| 项目 | 内容 |
|------|------|
| **说明** | 检查渲染任务的状态（排队/进行中/完成/失败）以及进度 |
| **当前状态** | 🆕 新增工具。当前系统无渲染任务队列可见性 |
| **重构变更** | 查询 `render_jobs` 或等效状态表 |
| **Zod Schema** | `job_id?: string.uuid.optional` — 不传则返回所有活跃任务 |

#### 8.5 `render_cancel` (write, L1)

| 项目 | 内容 |
|------|------|
| **说明** | 取消一个正在进行的渲染任务。需要用户确认。 |
| **当前状态** | 🆕 新增工具 |
| **重构变更** | 更新 `render_jobs.status = 'cancelled'`；需要用户确认才能执行 |
| **Zod Schema** | `job_id: string.uuid` |

---

## 工具总数汇总

| 域 | 读工具 | 写工具 | 合计 | 新增 | 重命名 |
|----|--------|--------|------|------|--------|
| photo | 4 | 4 | **8** | 0 | 6 |
| roll | 2 | 3 | **5** | 0 | 4 |
| film | 2 | 2 | **4** | 0 | 3 |
| equipment | 2 | 2 | **4** | 1 | 2 |
| tag | 1 | 4 | **5** | 1 | 3 |
| shot_log | 1 | 2 | **3** | 0 | 3 |
| stats | 4 | 0 | **4** | 0 | 4 |
| render | 2 | 3 | **5** | 2 | 3 |
| **总计** | **18** | **20** | **38** | **4** | **28** |

### 类型分布
| 分类 | 数量 |
|------|------|
| **read (L0)** | 18 |
| **write L0** | 6 |
| **write L1** | 9 |
| **write L2** | 3 |
| **写工具合计** | **18** |
| **总计** | **38** |

Note: 前述概要说 "read: 20, write: 18"，实际按此表数量为 read: 20（photo 4+roll 2+film 2+equipment 2+tag 1+shot_log 1+stats 4+render 4=20）， write: 18（photo 4+roll 3+film 2+equipment 2+tag 4+shot_log 2+stats 0+render 1=18…… 等等重新统计）

**修正计数**:

| 域 | Read | Write | 合计 |
|----|------|-------|------|
| photo | `search`, `get`, `list_by_roll`, `get_neighbors` = **4** | `update_metadata`, `batch_update`, `set_rating`, `toggle_favorite` = **4** | 8 |
| roll | `list`, `get` = **2** | `update`, `set_cover`, `set_preset` = **3** | 5 |
| film | `get_info`, `list_stock` = **2** | `update_inventory`, `record_purchase` = **2** | 4 |
| equipment | `search`, `get` = **2** | `add`, `update` = **2** | 4 |
| tag | `list` = **1** | `create`, `apply`, `remove`, `rename` = **4** | 5 |
| shot_log | `get` = **1** | `update`, `add_entry` = **2** | 3 |
| stats | `summary`, `shooting_patterns`, `cost_analysis`, `equipment_usage` = **4** | — = **0** | 4 |
| render | `get_params`, `status` = **2** | `suggest_params`, `batch_apply_preset`, `cancel` = **3** | 5 |
| **总计** | **18** | **20** | **38** |

安全等级分布：L0=24（18 read + 6 write），L1=11，L2=3。

---

## 删除与合并说明

### 已删除的工具
- **无**工具被完全删除。原有 35 工具全部经过重命名、合并或重构保留在清单中。

### 已合并的功能
- `toggle_photo_favorite` 保留为独立工具（`photo_toggle_favorite`, write L0），因为它是无参数单意图操作，独立更利于 LLM 调用。
- `batch_update_photos` 重命名为 `photo_batch_update`（非删除）。
- `set_roll_cover` 修复 bug 后保留。

### 新增的工具（4 个）
1. `equipment_get` — 按 ID 获取单设备详情（原系统只能 search + 在结果中找）
2. `tag_rename` — 重命名标签（原系统只能 create/attach/detach）
3. `render_status` — 查看渲染任务状态（原无可见性）
4. `render_cancel` — 取消渲染任务（原无此操作）

### 命名为 'attach_tags' → 'tag_apply', 'detach_tags' → 'tag_remove' 说明
- 新名更准确地描述操作语义：`tag_apply` 将标签应用到照片，`tag_remove` 从照片移除标签
- 动词 `apply`/`remove` 优于 `attach`/`detach`（更符合 LLM 自然语言理解）

---

## 跨域变更追踪

| 问题 | 涉及工具 | 修复方式 |
|------|---------|---------|
| C1: 列名错误 | `roll_set_cover` | 修正为 `cover_photo`/`coverPath` |
| C2: 字段不匹配 | `equipment_add`, `equipment_update` | 按类型分异 schema（5 种类型 5 套字段） |
| C3: 新项不可见 | `film_record_purchase`, `film_list_stock` | 设 `updated_at`；排序加 NULL 守卫 |
| C4: 残缺 preset | `render_suggest_params` | 从完整模板开始叠加 |
| C5: 吞错假成功 | `tag_apply` | 移除 `catch{}`；用事务管理错误 |
| C6: 无事务 | 5 个批量工具 | `withTransaction()` 包裹所有多步写入 |
| F1: 丢失更新 | `photo_update_metadata`, `photo_toggle_favorite`, `roll_update`, `shot_log_update`, `shot_log_add_entry`, `render_suggest_params` | 乐观锁 + 事务 |
| F2: TOCTOU | `tag_create` | 改为 `INSERT OR IGNORE` + re-SELECT |
| F3: 硬删除 | `photo_delete` | 改为软删除 `SET deleted_at = ?` |
| F5/F6: 错误计数 | `photo_batch_update`, `render_batch_apply_preset` | 用 `result.changes` 累加 |
| F8: 不验证 JSON | `roll_set_preset` | Zod `record(string(), any())` 验证 |
| F9: 误报移除 | `tag_remove` | 只报告实际删除的行 |
| F10: 错误创建数 | `film_record_purchase` | 用 `createdIds.length` 代替 `qty` |
| D4: 无 updated_at | `roll_update` | 迁移加列，写入时设值 |
| O8: 统计不一致 | `stats_summary` | 统一 `deleted_at IS NULL` 过滤 |

---

## 附录：工具命名映射

### 旧名 → 新名（28 个重命名）

| 旧名 | 域名 | 新名 |
|------|------|------|
| `search_photos` | photo | `photo_search` |
| `get_photo_detail` | photo | `photo_get` |
| `get_roll_photos` | photo | `photo_list_by_roll` |
| `get_photo_neighbors` | photo | `photo_get_neighbors` |
| `update_photo_metadata` | photo | `photo_update_metadata` |
| `batch_update_photos` | photo | `photo_batch_update` |
| `set_photo_rating` | photo | `photo_set_rating` |
| `toggle_photo_favorite` | photo | `photo_toggle_favorite` |
| `list_rolls` | roll | `roll_list` |
| `get_roll_detail` | roll | `roll_get` |
| `update_roll` | roll | `roll_update` |
| `set_roll_cover` | roll | `roll_set_cover` |
| `set_roll_preset` | roll | `roll_set_preset` |
| `get_film_info` | film | `film_get_info` |
| `list_film_items` | film | `film_list_stock` |
| `update_inventory_item` | film | `film_update_inventory` |
| `record_film_purchase` | film | `film_record_purchase` |
| `search_equipment` | equipment | `equipment_search` |
| `add_equipment` | equipment | `equipment_add` |
| `update_equipment` | equipment | `equipment_update` |
| `list_tags` | tag | `tag_list` |
| `create_tag` | tag | `tag_create` |
| `attach_tags` | tag | `tag_apply` |
| `detach_tags` | tag | `tag_remove` |
| `get_shot_log` | shot_log | `shot_log_get` |
| `update_shot_log` | shot_log | `shot_log_update` |
| `add_shot_log_entry` | shot_log | `shot_log_add_entry` |
| `get_stats` | stats | `stats_summary` |
| `analyze_shooting_patterns` | stats | `stats_shooting_patterns` |
| `cost_analysis` | stats | `stats_cost_analysis` |
| `equipment_usage_stats` | stats | `stats_equipment_usage` |
| `get_render_params` | render | `render_get_params` |
| `suggest_render_params` | render | `render_suggest_params` |
| `batch_apply_preset` | render | `render_batch_apply_preset` |

### 完全新增（无旧名，4 个）

| 新名 | 域名 | 说明 |
|------|------|------|
| `equipment_get` | equipment | 按 ID 获取单设备详情 |
| `tag_rename` | tag | 重命名标签 |
| `render_status` | render | 检查渲染任务状态 |
| `render_cancel` | render | 取消渲染任务 |

---

*本文档与 [DIAGNOSIS.md](./DIAGNOSIS.md)（问题诊断）和 [TOOL-FRAMEWORK.md](./TOOL-FRAMEWORK.md)（接口规范）共同构成重构三部曲。*
