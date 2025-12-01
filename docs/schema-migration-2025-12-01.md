# Schema Migration Summary - 2025-12-01

## 问题描述

1. **Roll 编号问题**：RollDetail 界面左上角显示的是 `roll_id` 而非按拍摄时间排序的 `seq`
2. **Create Roll 失败**：后端代码使用 `photographer` 字段，但数据库仍使用旧字段名 `shooter`

## 解决方案

### 1. 数据库 Schema 迁移

#### 执行的更改
```sql
-- 1. 将 shooter 列重命名为 photographer
ALTER TABLE rolls RENAME COLUMN shooter TO photographer;

-- 2. 添加 display_seq 列用于按时间排序
ALTER TABLE rolls ADD COLUMN display_seq INTEGER NOT NULL DEFAULT 0;

-- 3. 更新 roll_gear 表中的类型名称
UPDATE roll_gear SET type = 'photographer' WHERE type = 'shooter';
```

#### 迁移结果
- ✅ 成功将 `shooter` 重命名为 `photographer`
- ✅ 添加了 `display_seq` 列
- ✅ 为 11 个现有 rolls 按 `start_date` 计算了序号（1-11）

### 2. 序列号自动计算系统

#### 排序逻辑
在 `server/services/roll-service.js` 中实现：
```javascript
ORDER BY 
  CASE WHEN start_date IS NULL THEN 1 ELSE 0 END,
  start_date ASC,          -- 主排序：按开始日期升序
  CASE WHEN created_at IS NULL THEN 1 ELSE 0 END,
  created_at ASC,          -- 次排序：按创建时间升序
  id ASC                   -- 最终排序：按 ID 升序
```

#### 触发时机
`recomputeRollSequence()` 在以下情况自动调用：
1. **服务器启动时**（`server.js`）
2. **创建新 Roll 时**（`POST /api/rolls`）
3. **更新 Roll 信息时**（`PUT /api/rolls/:id`）
4. **删除 Roll 时**（`DELETE /api/rolls/:id`）

### 3. 代码统一性修改

#### 后端文件更新
- `server/init-db.js`：schema 定义中添加 `display_seq`
- `server/utils/schema-migration.js`：将 `shooter` 改为 `photographer`
- `server/server.js`：启动时调用 `recomputeRollSequence()`
- `server/routes/rolls.js`：已使用 `photographer`（无需修改）
- `server/routes/metadata.js`：已使用 `photographer`（无需修改）

#### 前端文件状态
- ✅ 所有组件已使用 `photographer` 字段
- ✅ `RollDetail.jsx` 已使用 `display_seq` 显示编号
- ✅ 无 `shooter` 引用需要清理

### 4. 验证结果

#### 数据库状态
```
✓ photographer 列存在（TEXT 类型）
✓ display_seq 列存在（INTEGER 类型）
✗ shooter 列已移除
```

#### 当前 Roll 序列（示例）
```
SEQ | ID | START_DATE | TITLE
----+----|------------|------
  1 |  8 | 2024-12-01 | 一次性的瞬间
  2 |  2 | 2024-12-25 | First roll
  3 |  3 | 2024-12-28 | Winter walk
  4 |  4 | 2025-01-01 | 东四
  5 |  5 | 2025-01-11 | 冬天里的日常
  6 | 35 | 2025-01-23 | 凤凰200下的家
  7 |  7 | 2025-03-25 | 野山桃的春天
  8 |  9 | 2025-05-01 | 神农
  9 | 34 | 2025-05-01 | 洗过的黑白
 10 | 10 | 2025-05-03 | 碎碎拍
 11 | 33 | 2025-06-19 | 半年后的新开始
```

## 使用说明

### 创建新 Roll
1. 填写 Roll 信息（包括 `photographer` 字段）
2. 上传照片
3. 系统自动计算新的 `display_seq`（基于 `start_date`）
4. 前端显示正确的序号

### 删除 Roll
1. 删除 Roll 记录
2. 系统自动重新计算所有剩余 Rolls 的 `display_seq`
3. 序号保持连续（1, 2, 3...）

### 更新 Roll 日期
1. 修改 Roll 的 `start_date`
2. 系统自动重新排序并更新所有 Rolls 的 `display_seq`
3. Roll 编号会根据新的时间顺序变化

## 技术细节

### 性能考虑
- `recomputeRollSequence()` 使用事务批量更新，对于 <10K rolls 性能良好
- 只在必要时触发（创建/更新/删除），不影响日常查询性能

### 数据一致性
- 使用 SQLite 事务确保原子性操作
- 服务器启动时自动修复任何不一致的序号
- 删除 Roll 时自动重新编号，避免序号跳跃

### 兼容性
- 旧的 `roll_id` 仍然保留用于数据库关系
- 前端优先显示 `display_seq`，降级到 `id`
- 不影响现有照片的 `roll_id` 外键引用

## 已知限制

1. **并发创建**：多个 Roll 同时创建时可能需要额外的锁机制（当前未实现）
2. **大规模数据**：超过 10,000 rolls 时重新计算可能需要优化
3. **时区处理**：日期比较基于字符串格式，跨时区可能需要额外处理

## 后续优化建议

1. 添加索引：`CREATE INDEX idx_rolls_start_date ON rolls(start_date)`
2. 缓存序号：在高频读取场景下考虑缓存 display_seq
3. 增量更新：只重新计算受影响的 rolls（需要复杂的范围判断）

---

**迁移完成时间**：2025-12-01  
**影响范围**：数据库 schema、Roll 创建/更新/删除流程  
**测试状态**：✅ Schema 验证通过，✅ 序列号正确排序
