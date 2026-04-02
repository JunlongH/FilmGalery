---
description: "Use when writing or modifying Express server code, API routes, services, middleware, or database queries. Covers server architecture patterns, SQLite usage, and error handling."
applyTo: "server/**"
---
# Server 开发规范

## 三层架构

```
routes/   → 接收 HTTP 请求，参数校验，调用 service
services/ → 业务逻辑，调用数据库辅助函数
db.js     → SQLite 连接，PreparedStmt 模块
```

## 路由模板

```javascript
const express = require('express');
const router = express.Router();
const someService = require('../services/some-service');

router.get('/:id', async (req, res) => {
  try {
    const result = await someService.getById(req.params.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) {
    console.error('[SomeRoute] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

## Service 模板

```javascript
const { PreparedStmt } = require('../db');

async function getById(id) {
  return PreparedStmt.getAsync('resource.getById', [id]);
}

async function create(data) {
  const { name, description } = data;
  const result = await PreparedStmt.runAsync(
    'resource.create',
    [name, description]
  );
  return { id: result.lastID, ...data };
}

module.exports = { getById, create };
```

## 关键约束

- **禁止字符串拼接 SQL**，必须使用 `PreparedStmt` 及参数化查询
- 路由始终 `async/await` + `try-catch`
- 数据库字段使用 snake_case（如 `roll_id`, `photo_id`）
- API 路由使用 kebab-case（如 `/api/film-items`）
- 迁移文件在 `server/utils/` 下，启动时自动运行
- NAS 模式下 compute-guard 中间件会阻断 GPU 相关路由
- OneDrive 场景需考虑 WAL 模式和 busy_timeout

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SERVER_MODE` | standalone / nas / dev | standalone |
| `DATA_ROOT` | 数据目录 | ./data |
| `UPLOADS_ROOT` | 图片存储 | ./uploads |
| `API_PORT` | 服务端口 | 4000 |
| `DB_WRITE_THROUGH` | OneDrive 写穿透 | auto |
