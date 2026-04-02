---
description: "Use when writing database queries, schema migrations, SQLite configuration, or data access code. Covers prepared statements, migration patterns, and OneDrive compatibility."
applyTo: "server/db.js, server/utils/migration*.js, server/utils/schema*.js"
---
# 数据库开发规范

## SQLite 配置

- WAL 模式（默认，支持并发读）
- OneDrive 场景可切换 TRUNCATE 模式（写穿透）
- `busy_timeout = 30000`（适应云同步延迟）
- `mmap_size = 128MB`
- `foreign_keys = ON`

## 查询模式

必须使用 `PreparedStmt`，**禁止字符串拼接 SQL**：

```javascript
// 正确 ✓
const rows = await PreparedStmt.allAsync('photos.listByRoll', [rollId]);
const row = await PreparedStmt.getAsync('rolls.getById', [id]);
const result = await PreparedStmt.runAsync('photos.create', [name, rollId, path]);

// 错误 ✗
db.all(`SELECT * FROM photos WHERE roll_id = ${rollId}`);
```

## 命名约定

- 表名: snake_case 复数 (`photos`, `film_items`, `rolls`)
- 字段: snake_case (`photo_id`, `roll_id`, `created_at`)
- 索引: `idx_表名_字段名`

## 迁移模板

```javascript
// server/utils/migrations/YYYYMMDD-description.js
async function run(db) {
  await db.run(`
    CREATE TABLE IF NOT EXISTS new_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (parent_id) REFERENCES parents(id)
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_new_table_name ON new_table(name)`);
}

module.exports = { run };
```

迁移在服务器启动时自动运行，状态记录在 `migrations_applied` 表中。
