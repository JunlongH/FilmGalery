# 08 — 实施计划：数据层

> 基于实际代码审计(2026-07-24)。本文档是落地的、可执行的工程清单,不是设计讨论。
> 前置文档:[03-data-model-and-migration.md](./03-data-model-and-migration.md)(决策已锁定)。

## 8.0 实施总览

数据层工作是整个数码模式的**关键路径**——D5(JOIN 审计)做不彻底,数码照片会在所有共享视图"消失"。

```
迁移脚本(digital-mode-migration.js)
  ├─ Phase A: 新建 4 张表(app_config / digital_sessions / albums / album_photos)
  ├─ Phase B: photos 加 12 列 + equip_cameras 加 7 列(幂等 ADD COLUMN)
  ├─ Phase C: 创建 11 个索引
  ├─ Phase D: Backfill(source_type='film', existing cameras is_digital=0)
  └─ Phase E: 注册到 run-all-migrations.js

JOIN 审计(13 处 + 2 处新发现 = 15 处)
  ├─ photos.js × 7 INNER → LEFT JOIN
  ├─ stats.js × 3 INNER → LEFT JOIN
  ├─ tags.js × 1 INNER → LEFT JOIN
  ├─ download-service.js × 2 INNER → LEFT JOIN
  ├─ db-helpers.js × 1 INNER → LEFT JOIN(新发现)
  ├─ render-service.js × 1 保持 INNER(FilmLab 专用,加 source_type='film' 守卫)
  └─ check-lens-data.js × 1 保持 INNER(一次性脚本,不进 MVP 路径)

Prepared Statements 扩展
  └─ prepared-statements.js STATEMENTS 注册表新增 digital 域查询
```

---

## 8.1 迁移脚本(完整可执行)

### 8.1.1 文件:`server/utils/digital-mode-migration.js`(新建)

**遵循的现有模式**(`schema-migration.js:26-31` 的 `run` helper 吞错误、`columns` 数组迭代 `ALTER TABLE`、`CREATE ... IF NOT EXISTS` 幂等):

```javascript
// server/utils/digital-mode-migration.js
const path = require('path');
const fs = require('fs');
const { getDbPath } = require('../config/db-config');

function log(msg) {
  const logPath = path.join(path.dirname(getDbPath()), 'digital-mode-migration.log');
  const ts = new Date().toISOString();
  fs.appendFileSync(logPath, `[${ts}] ${msg}\n`);
  console.log(`[DIGITAL] ${msg}`);
}

function runDigitalModeMigration() {
  return new Promise(async (resolve, reject) => {
    const dbPath = getDbPath();
    log(`Starting digital-mode migration on: ${dbPath}`);

    const db = require('../db');  // 复用全局 db 句柄(已是 sqlite3.Database)
    const run = (sql, params = []) => new Promise((res) => {
      db.run(sql, params, function (err) {
        if (err) res(err); else res(null);  // 吞错误(schema-migration.js:28 一致)
      });
    });
    const all = (sql, params = []) => new Promise((res, rej) => {
      db.all(sql, params, (err, rows) => err ? rej(err) : res(rows));
    });

    try {
      // ============ Phase A: 新建表 ============
      await run(`CREATE TABLE IF NOT EXISTS app_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        active_mode TEXT NOT NULL DEFAULT 'film',
        default_source_filter TEXT NOT NULL DEFAULT 'film',
        onboarding_completed INTEGER NOT NULL DEFAULT 0,
        digital_enabled INTEGER NOT NULL DEFAULT 0,
        show_film_section INTEGER NOT NULL DEFAULT 1,
        show_digital_section INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      await run(`INSERT OR IGNORE INTO app_config (id) VALUES (1)`);

      await run(`CREATE TABLE IF NOT EXISTS digital_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        session_date TEXT,
        import_batch_id TEXT NOT NULL,
        camera_equip_id INTEGER REFERENCES equip_cameras(id) ON DELETE SET NULL,
        lens_equip_id INTEGER REFERENCES equip_lenses(id) ON DELETE SET NULL,
        location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
        notes TEXT,
        photo_count INTEGER NOT NULL DEFAULT 0,
        cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
      )`);

      await run(`CREATE TABLE IF NOT EXISTS albums (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        parent_album_id INTEGER REFERENCES albums(id) ON DELETE CASCADE,
        cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
        date_start TEXT,
        date_end TEXT,
        photo_count INTEGER NOT NULL DEFAULT 0,
        is_smart INTEGER NOT NULL DEFAULT 0,
        criteria_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
      )`);

      await run(`CREATE TABLE IF NOT EXISTS album_photos (
        album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (album_id, photo_id)
      )`);

      // ============ Phase B: ADD COLUMN(幂等)============
      // 模式照搬 schema-migration.js:287-289 的 {table,col,type} 数组迭代
      const photoColumns = [
        { col: 'source_type',        type: 'TEXT' },                // 'film'|'digital'
        { col: 'session_id',         type: 'INTEGER' },             // → digital_sessions
        { col: 'content_hash',       type: 'TEXT' },                 // 去重(xxhash/sha256)
        { col: 'deleted_at',         type: 'TEXT' },                 // 软删除(回收站)
        { col: 'media_type',         type: "TEXT DEFAULT 'image'" }, // Phase 3 视频/Live Photo
        { col: 'stack_id',           type: 'TEXT' },                 // Phase 2 RAW+JPEG/连拍/HDR
        { col: 'stack_role',         type: "TEXT DEFAULT 'cover'" },
        { col: 'white_balance',      type: 'TEXT' },                 // 数码 EXIF
        { col: 'color_space',        type: 'TEXT' },
        { col: 'original_filename',  type: 'TEXT' },
        { col: 'develop_params_json', type: 'TEXT' },                // D9 DigitalDevelop 参数
        { col: 'scene_id',           type: 'TEXT' }                  // Q5 场景关联(schema 预留)
      ];
      for (const { col, type } of photoColumns) {
        const err = await run(`ALTER TABLE photos ADD COLUMN ${col} ${type}`);
        if (err && !String(err.message).includes('duplicate column')) {
          throw err;  // 非"已存在"错误才抛(schema-migration.js:29 一致)
        }
      }

      const cameraColumns = [
        { col: 'is_digital',      type: 'INTEGER NOT NULL DEFAULT 0' },
        { col: 'sensor_type',     type: 'TEXT' },    // CMOS|CCD|BSI-CMOS|X-Trans|Foveon
        { col: 'sensor_width_mm', type: 'REAL' },
        { col: 'sensor_height_mm',type: 'REAL' },
        { col: 'megapixels',      type: 'REAL' },
        { col: 'crop_factor',     type: 'REAL' },
        { col: 'sensor_format',   type: 'TEXT' }     // full-frame|APS-C|APS-H|M4/3|1"|medium-format|phone
      ];
      for (const { col, type } of cameraColumns) {
        const err = await run(`ALTER TABLE equip_cameras ADD COLUMN ${col} ${type}`);
        if (err && !String(err.message).includes('duplicate column')) throw err;
      }

      // ============ Phase C: 索引(幂等)============
      // 顺序:列加完后才建索引(schema-migration.js:291-294 的 2C bug 教训)
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_photos_source_type ON photos(source_type)`,
        `CREATE INDEX IF NOT EXISTS idx_photos_session ON photos(session_id)`,
        `CREATE INDEX IF NOT EXISTS idx_photos_content_hash ON photos(content_hash)`,
        `CREATE INDEX IF NOT EXISTS idx_photos_deleted ON photos(deleted_at)`,
        `CREATE INDEX IF NOT EXISTS idx_photos_scene ON photos(scene_id)`,
        `CREATE INDEX IF NOT EXISTS idx_photos_stack ON photos(stack_id)`,
        `CREATE INDEX IF NOT EXISTS idx_album_photos_photo ON album_photos(photo_id)`,
        `CREATE INDEX IF NOT EXISTS idx_album_photos_album_sort ON album_photos(album_id, sort_order)`,
        `CREATE INDEX IF NOT EXISTS idx_albums_parent ON albums(parent_album_id)`,
        `CREATE INDEX IF NOT EXISTS idx_albums_deleted ON albums(deleted_at)`,
        `CREATE INDEX IF NOT EXISTS idx_albums_date_start ON albums(date_start)`,
        `CREATE INDEX IF NOT EXISTS idx_digital_sessions_import_batch ON digital_sessions(import_batch_id)`,
        `CREATE INDEX IF NOT EXISTS idx_digital_sessions_date ON digital_sessions(session_date)`,
        `CREATE INDEX IF NOT EXISTS idx_digital_sessions_deleted ON digital_sessions(deleted_at)`,
        // 复合:source_type + date_taken(跨模式时序浏览核心索引)
        `CREATE INDEX IF NOT EXISTS idx_photos_source_date ON photos(source_type, date_taken, id)`,
        // 复合:session + frame(数码 session 内排序)
        `CREATE INDEX IF NOT EXISTS idx_photos_session_date ON photos(session_id, date_taken, id)`
      ];
      for (const sql of indexes) await run(sql);

      // ============ Phase D: Backfill ============
      // 现有照片全部标记为胶片(source_type 为空 → 'film')
      const filmResult = await run(`UPDATE photos SET source_type = 'film' WHERE source_type IS NULL`);
      log(`Backfill photos.source_type='film': ${filmResult?.changes || 0} rows (err=${filmResult?.message || 'none'})`);
      // equip_cameras.is_digital 默认 0,无需 backfill

      log('Digital-mode migration complete.');
      resolve();
    } catch (err) {
      log(`FATAL: ${err.message}\n${err.stack}`);
      reject(err);
    }
  });
}

module.exports = { runDigitalModeMigration };
```

### 8.1.2 注册到 runner

**文件**:`server/utils/run-all-migrations.js`

**改动 1** — `REGISTERED_MIGRATIONS` 数组(line 23-27)追加:
```javascript
const REGISTERED_MIGRATIONS = [
  '20240101_core_schema',
  '20241001_equipment_tables',
  '20241101_film_structure',
  '20260701_digital_mode',  // ← 新增(触发备份逻辑)
];
```

**改动 2** — `runAllMigrations()` 内(line 104 之后)追加 runner.add:
```javascript
  // 4. Digital photo mode (albums, sessions, source_type, develop params).
  runner.add('20260701_digital_mode', async () => {
    const { runDigitalModeMigration } = require('./digital-mode-migration');
    await runDigitalModeMigration();
  });
```

**改动 3** — `getMigrationStatus()` 的 `summary.total`(line 124)`3 → 4`。

### 8.1.3 迁移验证清单

- [ ] 在 `film.db` **副本**上跑迁移,验证零错误
- [ ] 跑两次,验证幂等(第二次零变更、零报错)
- [ ] 迁移后启动胶片流程(列表/RollDetail/FilmLab/Stats/Map/Calendar),验证**零回归**
- [ ] 迁移后用旧版本应用连新数据库,验证零报错(向前兼容)
- [ ] 恢复 `film.db.backup-{ISO}`,验证完全回滚到胶片-only
- [ ] `SELECT COUNT(*) FROM photos WHERE source_type IS NULL` 应返回 0(backfill 成功)
- [ ] `SELECT * FROM app_config WHERE id=1` 应返回 1 行
- [ ] `.schema photos` 应包含 12 个新列
- [ ] `.indexes photos` 应包含 6 个新索引

---

## 8.2 JOIN 审计(逐站点改造清单)

### 8.2.1 审计结果(基于 2026-07-24 实际 grep)

`rg "JOIN\s+rolls\s+r\s+ON" server/` 命中 15 处 JOIN + 1 处隐式排除子查询(review 发现)。

| # | 文件:行 | 上下文 | 改造 | 优先级 |
|---|---|---|---|---|
| 1 | `routes/photos.js:159` | `GET /` 列表 | INNER → LEFT + `?mode=` 过滤 | P0 |
| 2 | `routes/photos.js:183` | `GET /` 计数 | INNER → LEFT + `?mode=` | P0 |
| 3 | `routes/photos.js:343` | `GET /single/:id` | INNER → LEFT | P0 |
| 4 | `routes/photos.js:366` | `GET /random` | INNER → LEFT | P0 |
| 5 | `routes/photos.js:387` | `GET /favorites` | INNER → LEFT + `?mode=` | P0 |
| 6 | `routes/photos.js:414` | `GET /geo` | INNER → LEFT + `?mode=` | P0 |
| 7 | `routes/photos.js:1191` | `GET /negatives` | **保持 INNER** + 加 `WHERE p.source_type='film'` | P1 |
| 8 | `routes/photos.js:1501` | 已是 LEFT JOIN | **无改动** | — |
| 9 | `routes/stats.js:47` | `GET /gear` | INNER → LEFT + `?mode=` | P0 |
| 10 | `routes/stats.js:84` | `GET /activity` | INNER → LEFT + `?mode=`(数码按 taken_at 月份) | P0 |
| 11 | `routes/stats.js:94` | `GET /costs` | **保持 INNER** + `WHERE p.source_type='film'` | P1 |
| **12** | **`routes/stats.js:11`** | **`GET /summary` 子查询** `WHERE roll_id IN (SELECT id FROM rolls)` — **非 JOIN 但等效排除**:`NULL IN (...)` 为 FALSE,数码照片 `roll_id IS NULL` → 永不计数 | **重写为** `WHERE source_type IN (...) AND deleted_at IS NULL`,用 `resolveModeFilter` 动态拼接 | **P0** |
| 13 | `routes/tags.js:29` | `GET /:tagId/photos` | INNER → LEFT + `?mode=` | P0 |
| 14 | `services/download-service.js:75` | 下载服务 | INNER → LEFT | P0 |
| 15 | `services/download-service.js:126` | 下载服务 | INNER → LEFT | P0 |
| 16 | `utils/db-helpers.js:41` | `validatePhotoUpdate` — INNER → LEFT **+ 数码日期校验跳过**(见 §8.2.6) | P0 |
| 17 | `services/render-service.js:32` | FilmLab 渲染 | **保持 INNER** + `WHERE p.source_type='film'` 守卫 | P1 |
| 18 | `scripts/check-lens-data.js:35` | 一次性脚本 | **不改**(不进 MVP 路径) | — |

**已经是 LEFT JOIN 的站点(无需改)**:`services/ai-tools/photo-tools.js:45,93`、`services/ai-tools/stats-tools.js:113,124,333`、`services/export-history-service.js:158`、`routes/photos.js:1501`。

> **⚠ review 修正**:站点 #12(`stats.js:11`)是隐式排除——它不是 JOIN 而是 `WHERE roll_id IN (SELECT id FROM rolls)` 子查询。数码照片 `roll_id IS NULL`,`NULL IN (...)` 恒为 FALSE,导致数码照片在 `total_photos` 中**永不出现**。仅改 `?mode=` 参数无效——必须重写子查询 WHERE 子句。

### 8.2.2 改造模板

**P0 站点(INNER → LEFT + mode 过滤)**,以 `photos.js:159` 为例:

```javascript
// 改造前:
const rows = await allAsync(`
  SELECT p.*, r.title AS roll_title, r.film_type, ...
  FROM photos p
  JOIN rolls r ON p.roll_id = r.id
  WHERE ...
  ORDER BY p.date_taken DESC
`, params);

// 改造后:
const modeFilter = resolveModeFilter(req.query.mode);  // → ['film']|['digital']|['film','digital']
const rows = await allAsync(`
  SELECT p.*, r.title AS roll_title, r.film_type, ...
         ${modeFilter.includes('digital') ? ', s.title AS session_title, s.session_date' : ''}
  FROM photos p
  LEFT JOIN rolls r ON p.roll_id = r.id
  ${modeFilter.includes('digital') ? 'LEFT JOIN digital_sessions s ON p.session_id = s.id' : ''}
  WHERE p.deleted_at IS NULL
    AND p.source_type IN (${modeFilter.map(() => '?').join(',')})
  ORDER BY p.date_taken DESC
`, [...modeFilter, ...params]);
```

**新增辅助**(放在 `server/utils/mode-filter.js`,被所有路由复用):

```javascript
// server/utils/mode-filter.js
const PHOTO_SOURCE_TYPES = { FILM: 'film', DIGITAL: 'digital' };

// mode → source_type 数组(SQL IN 子句用)
function resolveModeFilter(mode) {
  if (mode === 'film')    return ['film'];
  if (mode === 'digital') return ['digital'];
  return ['film', 'digital'];  // 'all' / undefined
}

// 用于 prepared statement 占位符
function modePlaceholders(mode) {
  return resolveModeFilter(mode).map(() => '?').join(',');
}

module.exports = { PHOTO_SOURCE_TYPES, resolveModeFilter, modePlaceholders };
```

### 8.2.3 P1 站点(source_type 守卫)

`render-service.js:32`、`photos.js:1191`(negatives)、`stats.js:94`(costs)保持 INNER JOIN,但加 source_type='film' 守卫——这些端点数码模式天然不适用:

```javascript
// render-service.js:32 改造
JOIN rolls r ON p.roll_id = r.id
+ WHERE p.source_type = 'film'   -- 数码不走 FilmLab 渲染
```

### 8.2.4 软删除过滤(所有列表查询)

**新约定**:所有 photos 列表查询默认 `WHERE p.deleted_at IS NULL`,显式 `?include_deleted=true` 才包含回收站。这影响 P0 改造的每一处(模板已含)。

现有代码无 deleted_at 过滤(因为胶片是硬删除),改造时统一加上。

### 8.2.5 防回归 lint 规则

**新增**:`package.json` 的 eslint config 或独立脚本 `tools/check-join-rolls.js`:

```javascript
// 禁止 "JOIN rolls r ON p.roll_id"(必须 LEFT JOIN)
// 白名单:render-service.js、photos.js /negatives、stats.js /costs(有 source_type 守卫)
const WHITELIST = new Set([
  'server/services/render-service.js:32',
  'server/routes/photos.js:1191',
  'server/routes/stats.js:94',
  'server/scripts/check-lens-data.js:35',
]);
// grep 命中 "JOIN rolls" 且不在白名单 → 退出码 1
```

挂到 `npm run lint` 或 CI。防止未来新增 INNER JOIN 回归。

### 8.2.6 `validatePhotoUpdate` 数码日期校验跳过(review W7)

**站点 #16**(`db-helpers.js:41`)不仅需要 INNER → LEFT JOIN,还需要**跳过胶片日期范围校验**。现有逻辑(line 44-49):

```javascript
// 改造后(db-helpers.js:40-50):
async function validatePhotoUpdate(photoId, body) {
  const row = await getAsync(
    'SELECT p.id, p.roll_id, p.source_type, r.start_date, r.end_date ' +
    'FROM photos p LEFT JOIN rolls r ON r.id = p.roll_id WHERE p.id = ?', [photoId]
  );
  if (!row) throw new Error('Photo not found');

  const date_taken = body.date_taken;
  if (date_taken && row.source_type === 'film' && row.roll_id) {
    // 仅胶片照片有 roll 日期范围约束;数码照片无此限制
    const d = new Date(date_taken);
    const s = row.start_date ? new Date(row.start_date) : null;
    const e = row.end_date ? new Date(row.end_date) : null;
    if (s && d < s) throw new Error('date_taken before roll start');
    if (e && d > e) throw new Error('date_taken after roll end');
  }
  // ...其余逻辑不变(location_id 解析等)
}
```

**关键**:若仅改 JOIN 不跳过校验,`row.start_date`/`end_date` 为 NULL,`new Date(null)` 返回 `Invalid Date`,后续比较结果不可预测。

### 8.2.7 Prepared Statements 调用者审计(review W8)

除路由文件的 JOIN 外,**现有 Prepared Statements 的调用者**也需检查 `roll_id` 假设:

| Statement key | 风险 | 处理 |
|---|---|---|
| `photos.getById` | 返回 `roll_id`,调用者可能假设非 NULL | 调用者加 null 检查 |
| `photos.getByIdWithPaths` | 同上 | 同上 |
| `photos.listByRoll` | `WHERE roll_id = ?`,天然只返回胶片 | 无需改(数码用 `photos.listDigital`) |
| `photos.delete` | 硬删除——数码模式应改为软删除 | 改为 `UPDATE ... SET deleted_at = ...` |
| `rolls.countPhotos` | 只数胶片 | 无需改(数码用 session 计数) |

**MVP 约定**:`photos.delete` prepared statement 改为软删除(`UPDATE photos SET deleted_at = datetime('now') WHERE id = ?`),硬删除仅在"清空回收站"场景使用(新端点 `DELETE /api/photos/:id?hard=true`)。

---

## 8.3 Prepared Statements 扩展

**文件**:`server/utils/prepared-statements.js`

在 `STATEMENTS` 注册表(line 10-59)新增 digital 域查询(注意:PreparedStmt 的 `getAsync/allAsync/runAsync` 接**注册表 key**,与 `db-helpers` 接**raw SQL** 不同——见审计报告 §10):

```javascript
// 追加到 STATEMENTS(按字母序插入现有分组之后)

// ---- digital_sessions ----
'digitalSessions.list': `
  SELECT ds.*, c.name AS camera_name, l.city_name AS location_city,
         (SELECT thumb_rel_path FROM photos WHERE id = ds.cover_photo_id) AS cover_thumb
  FROM digital_sessions ds
  LEFT JOIN equip_cameras c ON ds.camera_equip_id = c.id
  LEFT JOIN locations l ON ds.location_id = l.id
  WHERE ds.deleted_at IS NULL
  ORDER BY ds.session_date DESC NULLS LAST`,

'digitalSessions.getByBatchId': `
  SELECT * FROM digital_sessions WHERE import_batch_id = ? AND deleted_at IS NULL`,

// ---- albums ----
'albums.list': `
  SELECT a.*, (SELECT thumb_rel_path FROM photos WHERE id = a.cover_photo_id) AS cover_thumb
  FROM albums a
  WHERE a.deleted_at IS NULL AND (? IS NULL OR a.parent_album_id = ?)
  ORDER BY a.sort_order, a.updated_at DESC`,

'albums.getById': `
  SELECT a.*, l.city_name AS location_city, l.country_name AS location_country
  FROM albums a
  LEFT JOIN locations l ON a.location_id = l.id
  WHERE a.id = ? AND a.deleted_at IS NULL`,

'albums.photos': `
  SELECT p.*, ap.sort_order AS album_sort_order, ap.added_at AS album_added_at,
         r.title AS roll_title,
         ds.title AS session_title
  FROM album_photos ap
  JOIN photos p ON ap.photo_id = p.id
  LEFT JOIN rolls r ON p.roll_id = r.id
  LEFT JOIN digital_sessions ds ON p.session_id = ds.id
  WHERE ap.album_id = ? AND p.deleted_at IS NULL
  ORDER BY ap.sort_order, ap.added_at`,

// ---- photos (digital-aware) ----
'photos.checkHash':   `SELECT id, source_type FROM photos WHERE content_hash = ?`,
'photos.listDigital': `
  SELECT p.*, ds.title AS session_title, ds.session_date,
         c.name AS camera_name, l.city_name AS location_city
  FROM photos p
  LEFT JOIN digital_sessions ds ON p.session_id = ds.id
  LEFT JOIN equip_cameras c ON p.camera_equip_id = c.id
  LEFT JOIN locations l ON p.location_id = l.id
  WHERE p.source_type = 'digital' AND p.deleted_at IS NULL
  ORDER BY p.date_taken DESC NULLS LAST, p.id DESC`,
```

**注意**:复杂过滤(多 WHERE 组合、分页)仍用 `db-helpers` 的 raw SQL 动态拼接(类比 `photos.js:144-191` 现状);PreparedStmt 只固化**高频、固定形状**的查询。

---

## 8.4 应用层校验(防不一致状态)

这些校验放在**路由 handler 或 service 层**(不放 DB 约束,SQLite 表达力有限):

### 8.4.1 equip_cameras 一致性

- `is_digital=1` 时,`format_id` 应为 NULL(数码相机无胶片画幅)
- `is_digital=1` 的相机不应被分配到 `rolls.camera_equip_id`
- 校验位置:`server/routes/equipment.js` 的 camera POST/PUT handler

### 8.4.2 photos 一致性

- `source_type='digital'` 时,`roll_id` 应为 NULL,`session_id` 应非 NULL
- `source_type='film'` 时,`roll_id` 应非 NULL,`session_id` 应为 NULL
- `scan_*` 字段仅 `source_type='film'` 有值
- 校验位置:导入服务(`digital-import-service.js`)和现有 rolls 创建路径

### 8.4.3 albums 一致性

- `is_smart=1` 时,`criteria_json` 应非空
- `parent_album_id` 不应形成环(应用层 DFS 检查)
- 删除相册时 `ON DELETE CASCADE` 自动清 `album_photos`(DB 层已保证)

---

## 8.5 数据完整性自检脚本

**新增**:`server/scripts/digital-integrity-check.js`(类比现有 `check-lens-data.js`,npm script 可选运行)

```javascript
// 检查项:
// 1. SELECT COUNT(*) FROM photos WHERE source_type IS NULL  → 应为 0
// 2. SELECT COUNT(*) FROM photos WHERE source_type='digital' AND roll_id IS NOT NULL  → 应为 0
// 3. SELECT COUNT(*) FROM photos WHERE source_type='film' AND session_id IS NOT NULL  → 应为 0
// 4. SELECT COUNT(*) FROM album_photos ap LEFT JOIN photos p ON ap.photo_id=p.id WHERE p.id IS NULL  → 应为 0
// 5. SELECT COUNT(*) FROM album_photos ap LEFT JOIN albums a ON ap.album_id=a.id WHERE a.id IS NULL  → 应为 0
// 6. SELECT COUNT(*) FROM digital_sessions WHERE photo_count != (SELECT COUNT(*) FROM photos WHERE session_id=digital_sessions.id)  → 应为 0
// 7. SELECT COUNT(*) FROM equip_cameras WHERE is_digital=1 AND format_id IS NOT NULL  → 应为 0
```

输出格式:每项 PASS/FAIL + 行数。FAIL 时退出码 1。

---

## 8.6 文件改动清单(数据层)

| 文件 | 操作 | 行数估计 |
|---|---|---|
| `server/utils/digital-mode-migration.js` | **新建** | ~180 |
| `server/utils/run-all-migrations.js` | 改 3 处(数组+add+total) | +8 |
| `server/utils/mode-filter.js` | **新建** | ~25 |
| `server/utils/prepared-statements.js` | STATEMENTS 追加 digital 域 | +60 |
| `server/scripts/digital-integrity-check.js` | **新建** | ~80 |
| `server/routes/photos.js` | 7 处 JOIN 改造 + mode 过滤 | ~120 行 diff |
| `server/routes/stats.js` | 3 处 JOIN 改造 + mode 过滤 | ~60 行 diff |
| `server/routes/tags.js` | 1 处 JOIN 改造 | ~10 行 diff |
| `server/services/download-service.js` | 2 处 JOIN 改造 | ~20 行 diff |
| `server/utils/db-helpers.js` | 1 处 JOIN 改造 | ~5 行 diff |
| `server/services/render-service.js` | 1 处加 source_type 守卫 | +2 |
| `tools/check-join-rolls.js`(或 eslint rule) | **新建** | ~40 |
| **合计** | | **~610 行** |

数据层是后续后端/前端的前置依赖,必须先完成并验证(预估 3-4 人天)。
