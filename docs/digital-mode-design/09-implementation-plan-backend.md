# 09 — 实施计划：后端

> 基于 2026-07-24 实际代码审计。所有路由/服务/客户端模块都给出文件清单、函数签名、复用点。
> 前置:数据层 [08](./08-implementation-plan-data.md) 已完成。

## 9.0 后端总览

```
新增路由(5 个文件,mountRoutes 追加 5 行)
├── server/routes/albums.js            相册 CRUD(M2M、嵌套、封面)
├── server/routes/digital-sessions.js  导入批次查询(只读+软删)
├── server/routes/digital-import.js    导入向导后端(preview/execute/progress/cancel)
├── server/routes/digital-develop.js   数码调色(preview/save/export)
└── server/routes/app-config.js        应用配置(单例读写)

新增服务(4 个文件)
├── server/services/digital-import-service.js   原子导入(复用 photo-upload-service 模式)
├── server/services/digital-file-service.js     数码文件路径/发布(复用 roll-file-service 模式)
├── server/services/digital-develop-service.js  RAW demosaic + RenderCore 渲染
└── server/services/ai-tools/digital-tools.js   数码专属 AI 工具(Phase 2,MVP 可空)

修改现有(7 个文件)
├── server/server.js              mountRoutes + 静态服务 + discover capabilities
├── server/routes/photos.js       JOIN 审计(见 08)+ ?mode/album_id/session_id 参数
├── server/routes/stats.js        JOIN 审计 + ?mode + 4 个数码统计端点
├── server/routes/tags.js         JOIN 审计
├── server/routes/equipment.js    camera CRUD 加数码字段 + 应用层校验
├── server/services/ai-orchestrator.js  getToolSchemas(mode) 模式过滤
└── server/services/ai-tools/index.js   getToolSchemas(mode) 签名

新增 api-client 模块(5 个)
└── packages/@filmgallery/api-client/{albums,digital-sessions,digital-import,digital-develop,app-config}.js

新增 client api 模块(4 个)
└── client/src/api/{albums,digital-import,digital-develop,app-config}.js

类型包更新
└── packages/@filmgallery/types/index.d.ts  +Album +DigitalSession +AppConfig +DevelopParams
```

---

## 9.1 新增路由

### 9.1.1 `server/routes/albums.js`(新建)

**复用模式**:`server/routes/films.js`(简单 CRUD)+ `rolls.js`(mixin 模式)。遵循 try/next(err)、`module.exports = router`。

```javascript
// server/routes/albums.js
const express = require('express');
const router = express.Router();
const { runAsync, allAsync, getAsync } = require('../utils/db-helpers');
const PreparedStmt = require('../utils/prepared-statements');

// GET /api/albums?parent_id=&include_deleted=
router.get('/', async (req, res, next) => {
  try {
    const parentId = req.query.parent_id === 'null' ? null : (req.query.parent_id || null);
    const includeDeleted = req.query.include_deleted === 'true';
    const rows = await allAsync(`
      SELECT a.*, l.city_name AS location_city, l.country_name AS location_country,
             (SELECT thumb_rel_path FROM photos WHERE id = a.cover_photo_id) AS cover_thumb
      FROM albums a
      LEFT JOIN locations l ON a.location_id = l.id
      WHERE (? IS NULL OR a.parent_album_id ${parentId === null ? 'IS NULL' : '= ?'})
        ${includeDeleted ? '' : 'AND a.deleted_at IS NULL'}
      ORDER BY a.sort_order, a.updated_at DESC
    `, parentId === null ? [null] : [parentId]);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/albums/:id
router.get('/:id', async (req, res, next) => {
  try {
    const album = await getAsync(`
      SELECT a.*, l.city_name, l.country_name
      FROM albums a LEFT JOIN locations l ON a.location_id = l.id
      WHERE a.id = ? AND a.deleted_at IS NULL
    `, [req.params.id]);
    if (!album) return res.status(404).json({ error: 'Album not found' });
    res.json(album);
  } catch (err) { next(err); }
});

// GET /api/albums/:id/photos?mode=&sort=
router.get('/:id/photos', async (req, res, next) => {
  try {
    const rows = await PreparedStmt.allAsync('albums.photos', [req.params.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/albums  body: {title, description, parent_id, location_id}
router.post('/', async (req, res, next) => {
  try {
    const { title, description, parent_id, location_id } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    // 环检测(应用层)
    if (parent_id) {
      const cycle = await detectCycle(parent_id, null);
      if (cycle) return res.status(400).json({ error: 'Circular parent reference' });
    }
    const result = await runAsync(
      `INSERT INTO albums (title, description, parent_album_id, location_id) VALUES (?,?,?,?)`,
      [title, description || null, parent_id || null, location_id || null]
    );
    const album = await getAsync('SELECT * FROM albums WHERE id = ?', [result.lastID]);
    res.status(201).json({ ok: true, album });
  } catch (err) { next(err); }
});

// PUT /api/albums/:id  (title/description/parent_id/location_id/sort_order)
router.put('/:id', async (req, res, next) => { /* ... 同上校验 ... */ });

// DELETE /api/albums/:id?hard=true  (软删默认,hard=true 级联删 album_photos)
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.query.hard === 'true') {
      await runAsync('DELETE FROM albums WHERE id = ?', [req.params.id]);
    } else {
      await runAsync('UPDATE albums SET deleted_at = datetime(\'now\') WHERE id = ?', [req.params.id]);
    }
    res.json({ ok: true, deleted: req.params.id });
  } catch (err) { next(err); }
});

// POST /api/albums/:id/restore
// POST /api/albums/:id/cover  body: {photo_id}
// POST /api/albums/:id/photos  body: {photo_ids: [...]}  (批量加,INSERT OR IGNORE)
// DELETE /api/albums/:id/photos/:photoId  (删 album_photos 行,不删照片)
// PUT /api/albums/:id/photos/sort  body: {photo_ids: [ordered]}

async function detectCycle(albumId, startId) {
  // 从 albumId 向上追溯 parent_album_id 链,若回到 startId 则成环
  let cur = albumId;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    if (cur === startId) return true;
    seen.add(cur);
    const row = await getAsync('SELECT parent_album_id FROM albums WHERE id = ?', [cur]);
    cur = row?.parent_album_id;
  }
  return false;
}

module.exports = router;
```

**photo_count 维护**:加/删 `album_photos` 时触发 `UPDATE albums SET photo_count = (SELECT COUNT(*) FROM album_photos WHERE album_id=?)`。可用触发器或应用层(推荐应用层,触发器难调试)。

### 9.1.2 `server/routes/digital-sessions.js`(新建,极简)

只读为主 + 软删 + 更新 title/notes。**不暴露 POST**——session 由导入服务内部创建。

```javascript
// GET /api/digital-sessions?import_batch_id=&date_from=&date_to=
// GET /api/digital-sessions/:id
// GET /api/digital-sessions/:id/photos  (复用 photos 查询,WHERE session_id=?)
// PUT /api/digital-sessions/:id  (title/notes)
// DELETE /api/digital-sessions/:id  (软删,不删照片)
```

### 9.1.3 `server/routes/digital-import.js`(新建)

**这是最复杂的路由**——参照 `rolls.js:42-513` 的原子上传模式 + 新增进度上报(现有 render-worker-pool **无进度/取消**——审计报告 §3 确认,需自建进度层)。

```javascript
// server/routes/digital-import.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadTmp } = require('../config/multer');  // 复用现有 multer 配置
const digitalImportService = require('../services/digital-import-service');
const importJobs = require('../services/import-job-registry');  // 新建:内存 job 表

// POST /api/digital/import/preview
//   multipart: files[]  →  解析 EXIF 摘要 + content_hash 去重 + RAW 识别
//   返回: { total, duplicates, raws, jpeg, exif_summary: {dateRange, cameras, gps} }
const cpUpload = uploadTmp.array('files', 500);
router.post('/preview', (req, res, next) => {
  cpUpload(req, res, async (err) => {
    if (err) return next(err);
    try {
      const result = await digitalImportService.preview(req.files);
      res.json(result);
    } catch (e) { next(e); }
  });
});

// POST /api/digital/import/execute  body: {files_meta, session_title, album_id?}
//   → 异步执行,返回 {jobId}
//   客户端轮询 GET /:jobId/progress
router.post('/execute', async (req, res, next) => {
  try {
    const jobId = importJobs.create();
    // 异步启动(不 await)
    digitalImportService.execute(req.body, jobId, importJobs).catch(e => {
      importJobs.fail(jobId, e.message);
    });
    res.status(202).json({ ok: true, jobId });
  } catch (err) { next(err); }
});

// GET /api/digital/import/:jobId/progress
//   返回: {status, total, done, failed, current_file, errors:[]}
router.get('/:jobId/progress', async (req, res, next) => {
  const job = importJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job.status());
});

// POST /api/digital/import/:jobId/cancel  (标记 cancelled,worker 检查后停止)
// POST /api/digital/import/check-hash  body: {hash}  (单文件查重,向导 step1 实时检查)

module.exports = router;
```

### 9.1.4 `server/routes/digital-develop.js`(新建)

**参照** `server/routes/filmlab.js`(preview/render/export),但去掉反转步骤。

```javascript
// server/routes/digital-develop.js
const express = require('express');
const router = express.Router();
const digitalDevelopService = require('../services/digital-develop-service');

// POST /api/digital-develop/preview  body: {photo_id, params_json}
//   → libraw demosaic(original_rel_path) → RenderCore.apply(params) → JPEG buffer
router.post('/preview', async (req, res, next) => {
  try {
    const { photo_id, params_json } = req.body;
    const jpegBuf = await digitalDevelopService.renderPreview(photo_id, params_json);
    res.type('image/jpeg').send(jpegBuf);
  } catch (err) { next(err); }
});

// POST /api/digital-develop/save  body: {photo_id, params_json}
//   → 渲染最终 JPEG 覆盖 positive_rel_path + 重新生成 thumb + UPDATE develop_params_json
router.post('/save', async (req, res, next) => {
  try {
    const result = await digitalDevelopService.save(req.body.photo_id, req.body.params_json);
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// POST /api/digital-develop/export  body: {photo_id, params_json, with_exif}
//   → 渲染 JPEG 到下载(可选 EXIF 写入,复用 exif-service.writeExifWithExiftool)
router.post('/export', async (req, res, next) => { /* ... */ });

// GET /api/digital-develop/:photoId/params  → 读取已保存 develop_params_json
router.get('/:photoId/params', async (req, res, next) => {
  try {
    const row = await getAsync('SELECT develop_params_json FROM photos WHERE id = ?', [req.params.photoId]);
    res.json({ params: row?.develop_params_json ? JSON.parse(row.develop_params_json) : null });
  } catch (err) { next(err); }
});

module.exports = router;
```

### 9.1.5 `server/routes/app-config.js`(新建,极简)

```javascript
// GET /api/app-config  → 读 app_config 单例
// PUT /api/app-config  body: {active_mode?, default_source_filter?, digital_enabled?, show_*}
//   → UPDATE 后 bump updated_at
// POST /api/app-config/onboarding  body: {choice: 'film'|'digital'|'both', skip?}
//   → 一次性设置 + onboarding_completed=1
```

### 9.1.6 路由挂载

**文件**:`server/server.js` 的 `mountRoutes()`(line 252-289 区域):

```javascript
app.use('/api/albums', require('./routes/albums'));
app.use('/api/digital-sessions', require('./routes/digital-sessions'));
app.use('/api/digital/import', require('./routes/digital-import'));
app.use('/api/digital-develop', require('./routes/digital-develop'));
app.use('/api/app-config', require('./routes/app-config'));
```

---

## 9.2 新增服务

### 9.2.1 `server/services/digital-file-service.js`(新建)

**复用** `roll-file-service.js` 的 staging/publish/rollback 模式(审计报告 §2)。数码文件无 roll 概念,按 `{year}/{month}` 分片。

```javascript
// server/services/digital-file-service.js
const path = require('path');
const fs = require('fs').promises;
const { uploadsDir, localTmpDir } = require('../config/paths');
const { publishStagedOperations, rollbackCreatedFiles, cleanupTempArtifacts } =
  require('./roll-file-service');  // 复用现有原语!

const DIGITAL_DIR = path.join(uploadsDir, 'digital');

// 计算 {year}/{month} 分片路径(从 EXIF taken_at 或文件 mtime)
function computeShardPath(dateTaken) {
  const d = dateTaken ? new Date(dateTaken) : new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return path.join(String(year), month);
}

// 数码照片的相对路径(复用 photos 表现有字段语义)
function computeDigitalRelPaths(photoId, ext, shardPath, hasRaw) {
  const shard = shardPath;
  return {
    originalRelPath: hasRaw
      ? `digital/${shard}/${photoId}_original.${ext}`     // RAW 原件
      : `digital/${shard}/${photoId}_original.${ext}`,    // JPEG 原件
    positiveRelPath: `digital/${shard}/${photoId}_display.jpg`,   // 显示/调色后
    thumbRelPath:    `digital/${shard}/thumb/${photoId}_thumb.jpg`,
    // negativeRelPath: null  (数码无负片)
  };
}

function ensureDigitalDirs(shardPath) {
  const base = path.join(DIGITAL_DIR, shardPath);
  return Promise.all([
    fs.mkdir(path.join(base, 'thumb'), { recursive: true }),
  ]);
}

module.exports = {
  DIGITAL_DIR, computeShardPath, computeDigitalRelPaths, ensureDigitalDirs,
  publishStagedOperations, rollbackCreatedFiles, cleanupTempArtifacts,  // 转发现有
};
```

### 9.2.2 `server/services/digital-import-service.js`(新建)

**核心**:解析 EXIF → 计算 hash → 去重 → RAW demosaic → 生成 thumb → staging → 原子发布 → INSERT photos。

```javascript
// server/services/digital-import-service.js
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const { runAsync, getAsync } = require('../utils/db-helpers');
const PreparedStmt = require('../utils/prepared-statements');
const rawDecoder = require('@filmgallery/libraw-native');  // 已有
const thumbService = require('./thumb-service');           // 已有(positive 专用)
const digitalFileService = require('./digital-file-service');
const exifr = require('exifr');  // ⚠ 新增依赖!需加入 server/package.json(见 §9.3.6)

// 预览:不写文件,只解析 EXIF + 去重 + RAW 可读性试探
async function preview(files) {
  const items = [];
  for (const f of files) {
    const buf = await fs.readFile(f.path);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const existing = await getAsync('SELECT id FROM photos WHERE content_hash = ?', [hash]);
    const exif = await safeParseExif(f.path);
    const isRaw = /\.(cr2|cr3|nef|arw|rw2|raf|dng)$/i.test(f.originalname);
    // review W11:RAW 预览阶段试探测码,提前发现不支持的格式
    let rawSupported = null;
    if (isRaw && !existing) {
      try {
        await rawDecoder.decodeToBuffer(f.path);  // 试探(可缓存结果供 execute 复用)
        rawSupported = true;
      } catch (e) {
        rawSupported = false;  // 预览表格显示警告图标
      }
    }
    items.push({ file: f, hash, duplicate: !!existing, isRaw, rawSupported, exif });
  }
  return {
    total: items.length,
    duplicates: items.filter(i => i.duplicate).length,
    raws: items.filter(i => i.isRaw).length,
    rawUnsupported: items.filter(i => i.isRaw && i.rawSupported === false).length,  // review W11
    jpeg: items.filter(i => !i.isRaw).length,
    items,
    exif_summary: summarizeExif(items.filter(i => !i.duplicate)),
  };
}

// 执行:原子导入(jobId 用于进度上报)
async function execute(body, jobId, jobRegistry) {
  const { items, session_title, album_id } = body;
  const importBatchId = crypto.randomUUID();
  // 1. 创建 session
  const sessionResult = await runAsync(
    `INSERT INTO digital_sessions (title, session_date, import_batch_id) VALUES (?,?,?)`,
    [session_title || null, items[0]?.exif?.DateTimeOriginal || null, importBatchId]
  );
  const sessionId = sessionResult.lastID;

  // 2. 逐文件处理(可并发到 render-worker-pool,但 MVP 顺序+进度)
  const stagedOps = [], tempArtifacts = [], photoRows = [];
  for (let i = 0; i < items.length; i++) {
    if (jobRegistry.isCancelled(jobId)) {
      await rollbackPartial(stagedOps);  // 清理已 staging 的
      jobRegistry.markCancelled(jobId);
      return;
    }
    const it = items[i];
    if (it.duplicate) { jobRegistry.tick(jobId, it.file.originalname); continue; }
    try {
      const row = await processOne(it, sessionId);
      photoRows.push(row);
      jobRegistry.tick(jobId, it.file.originalname);
    } catch (e) {
      jobRegistry.recordError(jobId, it.file.originalname, e.message);
    }
  }

  // 3. 更新 session.photo_count
  await runAsync('UPDATE digital_sessions SET photo_count = ? WHERE id = ?',
    [photoRows.length, sessionId]);

  // 4. 可选加入相册(review W10:批量 INSERT 必须包事务,否则 N 次独立写事务极慢)
  if (album_id) {
    await runAsync('BEGIN');
    try {
      for (const r of photoRows) {
        await runAsync('INSERT OR IGNORE INTO album_photos (album_id, photo_id) VALUES (?,?)',
          [album_id, r.id]);
      }
      await runAsync('UPDATE albums SET photo_count = (SELECT COUNT(*) FROM album_photos WHERE album_id=?) WHERE id=?', [album_id, album_id]);
      await runAsync('COMMIT');
    } catch (e) {
      await runAsync('ROLLBACK');
      jobRegistry.recordError(jobId, 'album-join', e.message);
    }
  }

  jobRegistry.complete(jobId, { sessionId, imported: photoRows.length });
}

async function processOne(item, sessionId) {
  // a. 生成 photoId 先拿 ID
  const shard = digitalFileService.computeShardPath(item.exif?.DateTimeOriginal);
  await digitalFileService.ensureDigitalDirs(shard);

  // b. RAW demosaic 或直接用 JPEG
  let positiveBuf;
  if (item.isRaw) {
    positiveBuf = await rawDecoder.decodeToBuffer(item.file.path);  // demosaic
  } else {
    positiveBuf = await fs.readFile(item.file.path);
  }

  // c. 先 INSERT 拿 photoId(用于文件命名)
  const ins = await runAsync(
    `INSERT INTO photos (source_type, session_id, content_hash, original_filename, ...) VALUES ('digital', ?, ?, ?, ...)`,
    [sessionId, item.hash, item.file.originalname /*, ...exif fields */]
  );
  const photoId = ins.lastID;

  // d. 生成 thumb + display,写 final 路径
  const relPaths = digitalFileService.computeDigitalRelPaths(photoId, extOf(item.file.originalname), shard, item.isRaw);
  // ... (生成 thumb via thumbService.generatePositiveThumb, 写 display JPEG)

  // e. UPDATE photos SET *_rel_path = ...
  await runAsync(`UPDATE photos SET original_rel_path=?, positive_rel_path=?, thumb_rel_path=? WHERE id=?`,
    [relPaths.originalRelPath, relPaths.positiveRelPath, relPaths.thumbRelPath, photoId]);

  return { id: photoId };
}

module.exports = { preview, execute };
```

### 9.2.3 `server/services/import-job-registry.js`(新建)

render-worker-pool 无进度/取消(审计 §3),数码导入需要自建内存 job 表:

```javascript
// 简单 Map<jobId, {status, total, done, failed, current_file, errors[], cancelled}>
// create() / get() / tick() / complete() / fail() / cancel() / isCancelled() / status()
// 进程重启后丢失——但导入是短任务(分钟级),可接受;持久化 import_batch_id 在 DB 用于"未完成批次"恢复(Phase 2)
```

### 9.2.4 `server/services/digital-develop-service.js`(新建)

**复用** `packages/shared/render/RenderCore.js` + libraw-native(审计 §6、§7)。filmLab 底层模块已被 RenderCore 内部 import,DigitalDevelop 只需构造正确的 params。

```javascript
// server/services/digital-develop-service.js
const { RenderCore, DEFAULT_CROP_RECT } = require('@filmgallery/shared');  // 转发
const rawDecoder = require('@filmgallery/libraw-native');
const { getAsync, runAsync } = require('../utils/db-helpers');
const thumbService = require('./thumb-service');
const digitalFileService = require('./digital-file-service');

async function renderPreview(photoId, paramsJson) {
  const photo = await getAsync('SELECT original_rel_path FROM photos WHERE id = ?', [photoId]);
  // 1. demosaic RAW(或读 JPEG)
  const rawPath = resolveAbsPath(photo.original_rel_path);
  const { buffer, width, height } = await rawDecoder.decode(rawPath);
  // 2. 构造 RenderCore params(数码:inverted=false,无 filmCurve)
  const params = { ...JSON.parse(paramsJson), inverted: false, filmCurveEnabled: false };
  const rc = new RenderCore(params);
  await rc.prepareLUTs();
  // 3. 逐像素渲染(或走 render-worker-pool.processImage 批量)
  const out = renderBuffer(buffer, { width, height, channels: 3, params: rc });
  return out.jpeg8;  // JPEG buffer
}

async function save(photoId, paramsJson) {
  const jpegBuf = await renderPreview(photoId, paramsJson);
  const photo = await getAsync('SELECT positive_rel_path, thumb_rel_path FROM photos WHERE id = ?', [photoId]);
  // 覆盖 positive_rel_path
  await fs.writeFile(resolveAbsPath(photo.positive_rel_path), jpegBuf);
  // 重新生成 thumb(复用 thumbService,cleanupOldThumb 已有)
  // UPDATE develop_params_json
  await runAsync('UPDATE photos SET develop_params_json = ?, updated_at = datetime(\'now\') WHERE id = ?',
    [paramsJson, photoId]);
  return { photoId };
}

module.exports = { renderPreview, save };
```

---

## 9.3 修改现有路由

### 9.3.1 `server/routes/photos.js`(JOIN 审计见 08 + 新参数)

新增 query 参数解析(line 103 区域,现有 filter 逻辑后追加):

```javascript
// ?mode=film|digital|all  → source_type IN (...)
// ?album_id=N            → JOIN album_photos
// ?session_id=N          → WHERE session_id=?
// ?include_deleted=true  → 默认 WHERE deleted_at IS NULL,加参数后包含
const modeFilter = resolveModeFilter(req.query.mode);
const albumId = req.query.album_id ? Number(req.query.album_id) : null;
const sessionId = req.query.session_id ? Number(req.query.session_id) : null;
const includeDeleted = req.query.include_deleted === 'true';
```

### 9.3.2 `server/routes/stats.js`(?mode= + 数码专属端点)

**现有端点加 mode**(见 08 的 JOIN 改造)+ **新增 4 个数码统计端点**(成本低):

```javascript
// GET /api/stats/digital/cameras  → top 相机(WHERE source_type='digital' GROUP BY camera_equip_id)
// GET /api/stats/digital/focal-lengths  → 焦距直方图
// GET /api/stats/digital/monthly  → 月度拍摄量(按 taken_at)
// GET /api/stats/digital/sensors  → 传感器分布(JOIN equip_cameras.sensor_format)
```

这些不 JOIN rolls,只过滤 `source_type='digital'`,性能好。

### 9.3.3 `server/routes/equipment.js`(camera 加数码字段 + 校验)

- `GET /api/equipment/cameras?mode=digital` → `WHERE is_digital=1`
- POST/PUT camera 接受新字段:`is_digital, sensor_type, sensor_width_mm, sensor_height_mm, megapixels, crop_factor, sensor_format`
- 应用层校验:`is_digital=1` 时 `format_id` 应 NULL

### 9.3.4 `server/server.js`

**静态服务**(line 179-198 区域)——加 digital thumb 短缓存规则:

```javascript
// 数码缩略图短缓存(类比 rolls thumb,line ~186)
app.use('/uploads/digital', express.static(path.join(uploadsDir, 'digital'), {
  setHeaders: (res, filePath) => {
    if (filePath.includes(path.sep + 'thumb' + path.sep)) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));
```

**`/api/discover` capabilities**(line 293-316):加 `digitalMode: true, activeMode, digitalEnabled`(从 app_config 读)。

**app_config 单例恢复守卫**(review W9)——在 `mountRoutes()` **之前**、迁移之后,插入启动守卫:

```javascript
// server.js — 在 runAllMigrations() 之后,mountRoutes() 之前
// 确保 app_config 单例存在(防止用户/bug 误删后整个数码模式崩溃)
await runAsync('INSERT OR IGNORE INTO app_config (id) VALUES (1)');
```

### 9.3.5 AI 工具模式过滤

**关键修正**(审计 §9):`getToolSchemas()` 由 `ai-orchestrator.js:257` 调用,**不是** ai-chat.js。

**改 `server/services/ai-tools/index.js`**(line 40-42):

```javascript
const FILM_ONLY = new Set([
  ...Object.keys(ROLL_TOOLS), ...Object.keys(FILM_TOOLS),
  ...Object.keys(SHOT_LOG_TOOLS), ...Object.keys(RENDER_TOOLS)
]);

function getToolSchemas(mode = 'all') {
  if (mode === 'digital') {
    return Object.entries(TOOLS)
      .filter(([name]) => !FILM_ONLY.has(name))
      .map(([, t]) => t.schema);
  }
  return Object.values(TOOLS).map(t => t.schema);
}
module.exports = { getToolSchemas, /* ...其余导出..., */ getToolSchemasByMode: getToolSchemas };
```

**改 `server/services/ai-orchestrator.js:257`**:

```javascript
// 改前:tools: getToolSchemas(),
// 改后:
const activeMode = await getAppConfigValue('active_mode');  // 从 app_config 读
tools: getToolSchemas(activeMode),
```

**新增** `server/services/ai-tools/digital-tools.js`(MVP 可空对象,Phase 2 填 auto_album/duplicate_detect)。

### 9.3.6 新增依赖:`exifr`(review C4)

**问题**:导入服务 `require('exifr')`,但 `exifr` 仅存在于 `client/package.json`(v7.1.3),**服务端无此依赖**。`server/package.json` 只有 `exiftool-vendored`(写 EXIF)和 `piexifjs`(JPEG 写)。

**方案 A(推荐)**:将 `exifr` 加入 `server/package.json`:
```bash
cd server && npm install exifr
```
理由:`exifr` 比 `exiftool-vendored` 轻量(纯 JS,无原生二进制),解析速度快,API 更简洁,适合导入时的批量读取。

**方案 B(备选)**:用 `sharp` 的 `metadata()` 读取基本 EXIF(已在服务端),复杂字段(GPS、镜头)回退 `exiftool-vendored`。无需新依赖但 API 碎片化。

MVP 采用方案 A。`exifr` 加入 server/package.json 后,迁移服务端 EXIF 解析从 `scan-exif-service.js` 的胶片专用逻辑迁移到 `exifr` 通用解析。

---

## 9.4 api-client 模块(`packages/@filmgallery/api-client/`)

每个模块遵循 `createXxxApi(http)` 工厂模式(审计 §11),返回方法对象。

```javascript
// albums.js
function createAlbumsApi(http) {
  return {
    list: (params) => http.get('/api/albums', params),
    get: (id) => http.get(`/api/albums/${id}`),
    getPhotos: (id, params) => http.get(`/api/albums/${id}/photos`, params),
    create: (data) => http.post('/api/albums', data),
    update: (id, data) => http.put(`/api/albums/${id}`, data),
    delete: (id, params) => http.delete(`/api/albums/${id}`, params),  // DELETE 不带 body,hard 用 query
    restore: (id) => http.post(`/api/albums/${id}/restore`),
    setCover: (id, photoId) => http.post(`/api/albums/${id}/cover`, { photo_id: photoId }),
    addPhotos: (id, photoIds) => http.post(`/api/albums/${id}/photos`, { photo_ids: photoIds }),
    removePhoto: (id, photoId) => http.delete(`/api/albums/${id}/photos/${photoId}`),
    sortPhotos: (id, photoIds) => http.put(`/api/albums/${id}/photos/sort`, { photo_ids: photoIds }),
  };
}
module.exports = { createAlbumsApi };
```

同样模式建 `digital-sessions.js`、`digital-import.js`(注意 execute 返回 jobId + 后续轮询 progress)、`digital-develop.js`、`app-config.js`。

**改 `index.js`**(line 89-109 返回对象):加 5 个命名空间。

```javascript
return {
  /* ...existing... */
  albums: createAlbumsApi(http),
  digitalSessions: createDigitalSessionsApi(http),
  digitalImport: createDigitalImportApi(http),
  digitalDevelop: createDigitalDevelopApi(http),
  appConfig: createAppConfigApi(http),
};
```

并在文件顶部 require 新模块。

---

## 9.5 client api 模块(`client/src/api/`)

遵循 `rolls.js` 的 named-export 模式(审计 §11),thin wrapper 调用 `core.js` 的 `jsonFetch/postJson/putJson/deleteRequest/uploadWithProgress`。

```javascript
// client/src/api/albums.js
import { jsonFetch, postJson, putJson, deleteRequest, buildQueryString } from './core';
export const getAlbums = (params = {}) => jsonFetch(`/api/albums${buildQueryString(params)}`);
export const getAlbum = (id) => jsonFetch(`/api/albums/${id}`);
export const getAlbumPhotos = (id, params) => jsonFetch(`/api/albums/${id}/photos${buildQueryString(params)}`);
export const createAlbum = (data) => postJson('/api/albums', data);
export const updateAlbum = (id, data) => putJson(`/api/albums/${id}`, data);
export const deleteAlbum = (id, hard = false) => deleteRequest(`/api/albums/${id}${hard ? '?hard=true' : ''}`);
export const addPhotosToAlbum = (id, photoIds) => postJson(`/api/albums/${id}/photos`, { photo_ids: photoIds });
// ...
```

同样建 `digital-import.js`、`digital-develop.js`、`app-config.js`。

**改 `client/src/api/index.js`**(line 15-204 barrel):追加 `export { ... } from './albums';` 等。

---

## 9.6 类型包更新(`packages/@filmgallery/types/index.d.ts`)

追加 `Album`、`DigitalSession`、`AppConfig`、`DevelopParams`、`CropParams` 接口,扩展现有 `Photo`、`Camera`(完整定义见 [05 §5.7](./05-backend-api-stats-ai.md))。

**新增** `CropParams`(D10 裁剪参数,归一化 0-1):

```typescript
export interface CropParams {
  x: number; y: number; width: number; height: number;  // 归一化 0-1
  rotation: number;      // 度,通常 0/90/180/270
  flip_h: boolean;
  flip_v: boolean;
}
export interface DevelopParams {
  white_balance?: { temp: number; tint: number };
  exposure?: number; contrast?: number;
  highlights?: number; shadows?: number; whites?: number; blacks?: number;
  hsl?: Record<string, { hue: number; sat: number; lum: number }>;
  tone_curve?: { rgb: number[]; red: number[]; green: number[]; blue: number[] };
  split_tone?: { highlights: { color: string; balance: number }; shadows: { color: string; balance: number } };
  lut?: string;
  crop?: CropParams;  // D10
}
```

---

## 9.7 后端验证清单

| # | 验证项 | 方法 |
|---|---|---|
| 1 | 迁移后数码照片出现在 `/api/photos?mode=digital` | 手动 INSERT 测试行,GET 验证 |
| 2 | 数码照片出现在 `/api/photos/geo?mode=all` | 同上 |
| 3 | 数码照片出现在 `/api/tags/:id/photos?mode=all` | 给数码照片打 tag |
| 4 | `/api/stats/summary?mode=digital` 返回数码计数 | 导入测试照片 |
| 5 | `/api/stats/digital/cameras` 返回 top 相机 | 同上 |
| 6 | `/api/albums` CRUD 完整(post→get→put→delete→restore) | curl/httpie |
| 7 | 导入向导 preview 返回正确去重/hash/exif | 拖入重复文件 |
| 8 | 导入向导 execute 创建 session + photos + files | 检查 DB + 文件系统 |
| 9 | 导入中断后 cancel 清理 tmp 文件 | 手动 cancel |
| 10 | `/api/digital-develop/preview` 返回 JPEG | 有 RAW 的照片 |
| 11 | `/api/digital-develop/save` 更新 develop_params_json + 覆盖 positive | 重新打开参数一致 |
| 12 | AI 工具在 digital 模式隐藏 roll/film/shot-log/render | 检查 orchestrator 日志 |
| 13 | `/api/discover` 返回 digitalMode capabilities | GET 验证 |
| 14 | 静态服务 `/uploads/digital/.../thumb/` 短缓存 | curl -I 检查 Cache-Control |
| 15 | 数据完整性脚本 `digital-integrity-check.js` 全 PASS | npm run |

## 9.8 后端文件改动清单

| 文件 | 操作 | 行数 |
|---|---|---|
| `server/routes/albums.js` | 新建 | ~200 |
| `server/routes/digital-sessions.js` | 新建 | ~80 |
| `server/routes/digital-import.js` | 新建 | ~120 |
| `server/routes/digital-develop.js` | 新建 | ~100 |
| `server/routes/app-config.js` | 新建 | ~60 |
| `server/services/digital-import-service.js` | 新建 | ~280 |
| `server/services/digital-file-service.js` | 新建 | ~100 |
| `server/services/digital-develop-service.js` | 新建 | ~120 |
| `server/services/import-job-registry.js` | 新建 | ~80 |
| `server/services/ai-tools/digital-tools.js` | 新建(MVP 空) | ~20 |
| `server/services/ai-tools/index.js` | 改 getToolSchemas | +15 |
| `server/services/ai-orchestrator.js` | 传 mode | +5 |
| `server/routes/photos.js` | 新参数(JOIN 见 08) | +40 |
| `server/routes/stats.js` | ?mode + 4 端点(JOIN 见 08) | +120 |
| `server/routes/equipment.js` | camera 数码字段 + 校验 | +50 |
| `server/server.js` | mount + static + discover | +25 |
| `packages/@filmgallery/api-client/*.js` ×5 | 新建 | ~250 |
| `packages/@filmgallery/api-client/index.js` | 改 | +15 |
| `client/src/api/*.js` ×4 | 新建 | ~160 |
| `client/src/api/index.js` | 改 | +12 |
| `packages/@filmgallery/types/index.d.ts` | 追加接口 | +90 |
| **合计** | | **~1940 行** |

后端预估 12-14 人天(含调试)。
