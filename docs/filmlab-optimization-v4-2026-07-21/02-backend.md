# 02 · 后端问题（31 项）

v3 后首次系统化后端审计，覆盖 Express 路由、SQLite 数据库、Docker 部署。

---

## P0 — 关键（7 项）

### P0-1 内存内 Job Store 无限增长

- **batch-render.js:24 / batch-download.js:30 / import.js:33**
- 完成/取消/失败 job 仅在客户端显式 DELETE 时移除，否则累计。
- **修复**：TTL 淘汰（完成后 1 小时），定期清扫。

### P0-2 GET /api/health/database 请求悬挂

- **health.js:104-119**
- 嵌套 `db.get` 回调无错误处理，DB 连接忙时 res.json 永不调用。
- **修复**：Promise 包装 + 超时 + try/catch。

### P0-3 GET /api/photos 无分页

- **photos.js:101-309**
- 14 个 LEFT JOIN 的查询无 LIMIT，千张照片返回巨大 JSON。
- **修复**：加 LIMIT/OFFSET query params（默认 500），返回 totalCount。

### P0-4 Favorites/Negatives/Tag Photos 无分页

- **photos.js:370-408 / tags.js:22-35**

### P0-5 日志打印完整 req.body + EXIF GPS

- **photos.js:414** — `console.log(req.body)` 完整请求体。
- **photos.js:1423** — `JSON.stringify(exifData, null, 2)` 含 GPS 坐标。
- **修复**：移除或脱敏。

### P0-6 Film 缩略图删除潜在路径遍历

- **films.js:64-66, 131-133, 167-169**
- `row.thumbPath.replace(/^\/uploads\//, '')` 仅去前缀，DB 损坏时 `../../etc` 可逃逸。
- **修复**：`isPathConfined(uploadsDir, safeRelPath)` 守卫。

### P0-7 Legacy filename 路径遍历

- **photos.js:1125**
- `path.join(__dirname, '../', row.filename.replace(/^\//, ''))` —— 解析到源码树目录而非 uploadsDir。DB 损坏时任意文件删除。
- **修复**：统一使用 uploadsDir + 路径约束检查。

---

## P1 — 高（6 项）

### P1-1 photos 表缺关键索引

- **db.js schema + photos.js 查询**
- 无索引列：`roll_id`（每查询必 JOIN）、`date_taken`（ORDER BY）、`location_id`（geo）、`rating`（favorites）
- **修复**：`CREATE INDEX IF NOT EXISTS idx_photos_roll ON photos(roll_id)` 等。

### P1-2 GET /api/photos/random 全表 RANDOM() 排序

- **photos.js:314-335**
- `ORDER BY RANDOM()` 为每行生成随机值 + 全表排序。
- **修复**：便宜列 + 子查询优化。

### P1-3 CORS origin:true + Private Network 过于宽松

- **server.js:73-79**
- 任何 origin 的请求都被允许。soft-mode ON 时 LAN 恶意网站可无认证调用。
- **修复**：限制 CORS origin 到已知值（Electron file://、localhost、配对移动端）。

### P1-4 compute 端点无限速

- **filmlab.js:27,126,260 / photos.js:737,961**
- 全分辨率导出无 rate limiting。
- **修复**：compute 端点单独 stricter limiter（10/min）。

### P1-5 WAL PASSIVE checkpoint 负载下永不完成

- **db.js:251**
- `PRAGMA wal_checkpoint(PASSIVE)` 不阻塞读者，持续读负载下 WAL 无限增长。
- **修复**：定期 `TRUNCATE` 或 `RESTART` checkpoint。

### P1-6 文件删除无防御性路径约束

- **photos.js:1096-1155 / films.js:64-66**
- 路径来自 DB（通常安全），但无 defense-in-depth `isPathConfined` 检查。
- **修复**：所有 `fs.unlink` 前加 `isPathConfined(uploadsDir, relPath)`。

---

## P2 — 中等（9 项）

- **错误响应格式不一致**：`{error}`, `{ok:false, error}`, `{success:false, error}` 混用。→ 统一为 `{ok:false, error, code}`。
- **health 端点暴露路径**：未认证即可获得数据库路径、uploadsDir 绝对路径。→ 移除或加认证。
- **POST /api/locations 竞态**：SELECT + INSERT 不在事务中。→ `INSERT OR IGNORE`。
- **多路由缺输入验证**：equipment/ai-chat/film-items/locations 创建路由直接传 req.body。→ 加验证中间件。
- **AI API key 明文存储**：`ai_models` 表存明文 API key。→ 加密存储。
- **空搜索返回全部**：search.js 空 q → `%%` → 匹配全部。→ 检查空 q，返回 400。
- **Docker 无资源限制**：docker-compose deploy.resources 被注释。→ 启用内存/CPU 限制。
- **Edge Detection fallback 空路径**：`photo.filename || photo.original_rel_path || ...` 全 null 时 crash。→ 返回 400。
- **Docker HEALTHCHECK 用 shell 形式**：→ exec form。

---

## P3 — 低（9 项）

- **API 版本化缺失**：无 `/api/v4/` 前缀。→ 在 v4 加前缀。
- **db.serialize() 阻塞启动**：慢磁盘/网络挂载延迟数秒。→ parallelize PRAGMA 配置。
- **直接 require('../db') 而非 DI**：多文件 singleton 依赖，启动顺序脆弱。→ app.locals.db。
- **硬编码版本号 1.9.2**：→ 从 package.json 读取。
- **Sync fs 调用**：health.js / filmlab.js 的 existsSync/statSync 阻塞事件循环。→ async。
- **Multer 错误未处理**：uploads.js uploadTmp.array 错误未 catch。→ 三参数 handler。
- **LUT 上传文件名冲突**：同名 .cube 无后缀→覆盖。→ 加 timestamp/UUID。
- **Film Item CSV 导出无 JSON 验证**：→ validate shot_logs 结构。
- **Dockerfile Node 版本不一致**：.nvmrc 22 / Dockerfile 20 / Dockerfile.cn 18。→ 统一到 22。
