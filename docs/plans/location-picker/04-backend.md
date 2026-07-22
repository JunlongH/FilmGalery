# 04 · 后端改动

## 1. 总体策略

后端当前是**纯 CRUD 层，零 geocoding 代码**。本计划采取保守策略：

- **Phase 1（必做）**：修契约不一致 + 加 lat/lng 校验。无新端点，无新依赖。
- **Phase 2（可选）**：新增服务端 geocoding 代理端点。隐藏 AMap key、规避 CORS、集中限流。

不改动数据库 schema（`locations` / `photos` / `film_items.shot_logs` 字段已够用）。

## 2. Phase 1：契约修复与校验

### 2.1 修复 `/api/locations/search` 死代码

**现状**：
- `client/src/api/metadata.js:22-25` 调用 `GET /api/locations/search${qs}`
- 服务端 `server/routes/locations.js` **没有** `/search` 子路由，实际查询走 `GET /api/locations?query=...`

**方案**：删除客户端死代码（推荐），或服务端补 `/search` 别名。

**选择删除客户端死代码**（影响小、避免冗余）：

```diff
// client/src/api/metadata.js
-export async function searchLocations(params = {}) {
-  const qs = buildQueryString(params);
-  return jsonFetch(`/api/locations/search${qs}`);
-}
```

**检查调用方**：搜索 `searchLocations` 在 `client/src/**` 的引用，若有则改为 `getLocations({ query })`。

### 2.2 实现 `PUT /api/locations/:id` 与 `DELETE /api/locations/:id`

**现状**：`packages/@filmgallery/api-client/locations.js` 声明 `update(id, data)` 与 `delete(id)`，但服务端只实现了 `POST /`（create）。

**方案**：在 `server/routes/locations.js` 补两个端点，使共享 client 的声明可用。

```js
// server/routes/locations.js （在 POST / 之后追加）

// PUT /api/locations/:id  —— 更新城市坐标/名称
router.put('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const { country_code, country_name, city_name, city_lat, city_lng } = req.body || {};
  if (!city_name) return res.status(400).json({ error: 'city_name required' });
  // 校验坐标
  if (city_lat != null && !isValidLatitude(city_lat)) return res.status(400).json({ error: 'invalid city_lat' });
  if (city_lng != null && !isValidLongitude(city_lng)) return res.status(400).json({ error: 'invalid city_lng' });
  try {
    const result = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE locations SET country_code=?, country_name=?, city_name=?, city_lat=?, city_lng=? WHERE id=?`,
        [country_code || null, country_name || null, city_name, city_lat ?? null, city_lng ?? null, id],
        function(err){ if (err) reject(err); else resolve(this.changes); }
      );
    });
    if (result === 0) return res.status(404).json({ error: 'not found' });
    res.json({ id, ok: true });
  } catch (e) { next(e); }
});

// DELETE /api/locations/:id
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    // 检查是否被 photos / roll_locations 引用
    const refCount = await getAsync(
      `SELECT (SELECT COUNT(*) FROM photos WHERE location_id=?) + (SELECT COUNT(*) FROM roll_locations WHERE location_id=?) AS c`,
      [id, id]
    );
    if (refCount && refCount.c > 0) {
      return res.status(409).json({ error: 'location in use', refCount: refCount.c });
    }
    const result = await new Promise((resolve, reject) => {
      db.run('DELETE FROM locations WHERE id=?', [id], function(err){ if (err) reject(err); else resolve(this.changes); });
    });
    if (result === 0) return res.status(404).json({ error: 'not found' });
    res.json({ id, ok: true });
  } catch (e) { next(e); }
});
```

### 2.3 lat/lng 范围校验

**现状**：客户端有 `Number.isFinite` 检查但**无范围校验**；服务端完全无校验。

**新增**：共享校验函数（放 `packages/shared/mapUtils.js`，前后端共用）：
```js
function isValidLatitude(n)  { return typeof n === 'number' && Number.isFinite(n) && n >= -90  && n <= 90; }
function isValidLongitude(n) { return typeof n === 'number' && Number.isFinite(n) && n >= -180 && n <= 180; }
function isValidLatLng(lat, lng) {
  // 两者必须同时为 null 或同时为有效值
  if (lat == null && lng == null) return true;
  if (lat == null || lng == null) return false;
  return isValidLatitude(lat) && isValidLongitude(lng);
}
```

**服务端接入点**：

1. `server/routes/photos.js` 的 `PUT /api/photos/:id`（:436+）：
   ```js
   if ('latitude' in body || 'longitude' in body) {
     const lat = body.latitude ?? null;
     const lng = body.longitude ?? null;
     if (!isValidLatLng(lat, lng)) {
       return res.status(400).json({ error: 'invalid latitude/longitude' });
     }
   }
   ```

2. `server/routes/film-items.js` 的 `PUT /api/film-items/:id`（:189-204）：
   - `shot_logs` 是 JSON 字符串，需 parse 后逐条校验
   - 在 `updateFilmItem` service（`server/services/film/film-item-service.js`）内加：
   ```js
   if (key === 'shot_logs' && value) {
     try {
       const logs = JSON.parse(value);
       if (!Array.isArray(logs)) throw new Error('shot_logs must be array');
       for (const [i, entry] of logs.entries()) {
         // date 是必填字段（与客户端 ShotLogModal.handleAdd 守卫一致）
         if (!entry.date) throw new Error(`entry[${i}]: date required`);
         if (!isValidLatLng(entry.latitude ?? null, entry.longitude ?? null)) {
           throw new Error(`entry[${i}]: invalid latitude/longitude`);
         }
       }
     } catch (e) {
       throw new Error(`invalid shot_logs: ${e.message}`);
     }
   }
   ```

3. `server/routes/locations.js` 的 `POST /`（:117-133）与新增 `PUT /:id`：
   - 校验 `city_lat`/`city_lng` 范围（同上）

### 2.4（可选）`GET /api/locations/recent` —— 最近使用位置

为支持「最近使用位置快捷选择」衍生功能（见 [07-derivative-features.md](./07-derivative-features.md) Tier 2），可加：

```js
// GET /api/locations/recent?limit=10
// 返回最近 N 个被 photos 引用的 location（按 photos.id DESC）
router.get('/recent', async (req, res, next) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  try {
    const rows = await allAsync(
      `SELECT l.*, MAX(p.id) AS last_photo_id
       FROM locations l
       JOIN photos p ON p.location_id = l.id
       GROUP BY l.id
       ORDER BY last_photo_id DESC
       LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch (e) { next(e); }
});
```

**或纯客户端实现**：picker 每次确认后把 value 存 `localStorage`/`AsyncStorage` 的 `recent_locations` 数组（最多 10 条），无需后端。**推荐后者**（更简单、无网络开销）。

## 3. Phase 2（可选）：服务端 geocoding 代理

### 3.1 动机

| 痛点 | 服务端代理如何解决 |
|---|---|
| AMap Web Service Key 暴露在客户端存储 | key 存服务端 env var，客户端只调内部 API |
| Nominatim/Photon CORS 或网络不稳 | 服务端转发，可控重试 |
| 集中限流 | 服务端统一限速，避免多客户端各自 1 req/s |
| 手机网络差时 geocoding 慢 | 服务端可缓存（短期内存或 SQLite） |
| 批量 geocoding（如 CSV 导入） | 客户端循环调服务端，服务端排队 |

### 3.2 新增端点

```
GET /api/geocode/search?q=<query>&limit=5
GET /api/geocode/reverse?lat=<lat>&lng=<lng>
```

**实现**：新建 `server/routes/geocode.js`，内部调 `@filmgallery/shared/geocoding`（复用共享模块）。

```js
// server/routes/geocode.js
const express = require('express');
const router = express.Router();
const { searchAddress, reverseGeocode } = require('@filmgallery/shared/geocoding');
const { getMapConfig } = require('../services/map-config');  // 新建

// GET /api/geocode/search?q=...&limit=5
router.get('/search', async (req, res, next) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || 5, 20);
  if (!q || q.length < 2) return res.status(400).json({ error: 'q required (min 2 chars)' });
  try {
    const cfg = await getMapConfig();  // { provider, amapKey }
    const results = await searchAddress(q, { ...cfg, limit });
    res.json({ results });
  } catch (e) { next(e); }
});

// GET /api/geocode/reverse?lat=...&lng=...
router.get('/reverse', async (req, res, next) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return res.status(400).json({ error: 'invalid lat/lng' });
  }
  try {
    const cfg = await getMapConfig();
    const result = await reverseGeocode(lat, lng, cfg);
    res.json({ result });
  } catch (e) { next(e); }
});

module.exports = router;
```

**挂载**（`server/server.js`）：
```js
app.use('/api/geocode', require('./routes/geocode'));  // 不缓存
```

### 3.3 服务端 map 配置（`server/services/map-config.js`）

**新增**：从环境变量读取 provider 与 AMap key。

```js
// server/services/map-config.js
function getMapConfig() {
  const provider = (process.env.MAP_PROVIDER || 'osm').toLowerCase() === 'amap' ? 'amap' : 'osm';
  const amapKey = process.env.AMAP_WEB_KEY || '';
  return { provider, amapKey };
}
module.exports = { getMapConfig };
```

**env var 新增**（`docker/.env.example` 与文档）：
```env
# Map geocoding provider: 'osm' (default, no key) or 'amap' (requires AMAP_WEB_KEY)
MAP_PROVIDER=osm
# AMap Web Service Key (only used when MAP_PROVIDER=amap). Server-side geocoding proxy.
# Get from https://lbs.amap.com/dev
AMAP_WEB_KEY=
```

### 3.4 与客户端配置的关系

**重要决策**：是否让服务端 geocoding 代理取代客户端 geocoding？

**否**。客户端 geocoding 保留，作为：
1. 离线/局域网模式（Electron 本地服务器，无外网时只能用客户端 OSM）
2. 用户希望用自己的 AMap key（避免服务端配 key）

**服务端代理是补充**：
- 客户端检测到服务端 `GET /api/server-capabilities` 返回 `geocode_proxy: true` 时，优先调服务端代理
- 否则 fallback 到客户端 geocoding（现状）

### 3.5 缓存（可选）

逆向 geocoding 结果可短期缓存（同一坐标 100m 内 24h 命中）：
- 简单方案：内存 `Map` + TTL（重启失效）
- 持久方案：新建 `geocode_cache` 表（`lat_index, lng_index, result_json, created_at`），`lat_index = Math.round(lat*100)`（约 1km 精度）

**推荐先不做缓存**，Phase 2 先上代理，观察负载后再决定。

## 4. 不做的事

- ❌ **不改 DB schema**：`locations` / `photos` / `shot_logs` 字段已够用
- ❌ **不强制 lat/lng 成对**为强约束（保持 nullable 语义；仅在写入时校验「要么都 null 要么都有效」）
- ❌ **不加服务端正向 geocoding 写入路径**：现状客户端 geocode → POST `locations` 的模式保留
- ❌ **不改 `shot_logs` 从 JSON 字符串迁移到独立表**：超出本计划范围

## 5. 工作量估算

| 项 | Phase | 估算 |
|---|---|---|
| 删除 `searchLocations` 死代码 + 检查调用方 | 1 | 0.5h |
| 实现 `PUT/DELETE /api/locations/:id` + 单测 | 1 | 1.5h |
| lat/lng 校验（photos + film-items + locations 路由） + 单测 | 1 | 2h |
| `server/routes/geocode.js` + `map-config.js` | 2 | 2h |
| env var 与文档更新 | 2 | 0.5h |
| 客户端检测服务端代理能力并优先使用 | 2 | 1.5h |
| **小计** | 1+2 | **~8h**（Phase 1 约 4h，Phase 2 约 4h） |
