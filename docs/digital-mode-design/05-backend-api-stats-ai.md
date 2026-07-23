# 05 — 后端 API、统计、AI

## 5.1 新增 API 端点

### `/api/albums` — 相册 CRUD

文件:`server/routes/albums.js`(新建,镜像 `server/routes/rolls.js` 但大幅简化)

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/albums` | 列出相册(支持 `?parent_id=`、`?include_deleted=`) |
| `GET` | `/api/albums/:id` | 相册详情(含 photo_count, cover_photo, date_range) |
| `POST` | `/api/albums` | 创建相册(`{title, description, parent_id, location_id}`) |
| `PUT` | `/api/albums/:id` | 更新相册元数据 |
| `DELETE` | `/api/albums/:id?hard=true` | 软删(`deleted_at`)/ 硬删(`hard=true` 时级联删 album_photos) |
| `POST` | `/api/albums/:id/restore` | 恢复软删 |
| `POST` | `/api/albums/:id/cover` | 设封面(`{photo_id}`) |
| `POST` | `/api/albums/:id/photos` | 批量加照片(`{photo_ids: [...]}`) |
| `DELETE` | `/api/albums/:id/photos/:photoId` | 从相册移除照片(只删 album_photos 行,不删照片) |
| `PUT` | `/api/albums/:id/photos/sort` | 重排(`{photo_ids: [ordered list]}`) |
| `GET` | `/api/albums/:id/photos` | 相册内照片(分页、排序,复用 photos 查询逻辑) |

挂载:`server/server.js` 的 `mountRoutes()` 中追加 `app.use('/api/albums', require('./routes/albums'));`

### `/api/digital-sessions` — 导入批次查询

文件:`server/routes/digital-sessions.js`(新建,极简)

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/digital-sessions` | 列出 session(支持 `?import_batch_id=`、`?date_from=`、`?date_to=`) |
| `GET` | `/api/digital-sessions/:id` | session 详情 |
| `GET` | `/api/digital-sessions/:id/photos` | session 内照片 |
| `DELETE` | `/api/digital-sessions/:id` | 软删 session(不删照片,只标记 session 删除) |
| `PUT` | `/api/digital-sessions/:id` | 更新 session(title/notes) |

不做 POST/创建端点——session 由导入向导内部创建,不暴露给前端手动建。

### `/api/digital/import` — 导入向导后端

文件:`server/routes/digital-import.js`(新建)

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/digital/import/preview` | 上传文件到 tmp,返回 EXIF 摘要 + 去重结果 + RAW 识别结果 |
| `POST` | `/api/digital/import/execute` | 执行导入(创建 session + 复制文件 + RAW demosaic + 生成缩略图 + INSERT photos + 可选加入相册) |
| `GET` | `/api/digital/import/:jobId/progress` | 查询导入进度(SSE 或轮询,复用现有 batch-render 进度机制) |
| `POST` | `/api/digital/import/:jobId/cancel` | 取消导入(清理 tmp + 已写入的文件) |
| `POST` | `/api/digital/import/check-hash` | 单文件哈希查重(向导 step 1 实时检查) |

复用现有:
- `server/services/thumb-service.js`(缩略图)
- `server/services/render-worker-pool.js`(后台 worker,并行 demosaic)
- `server/services/exif-service.js`(EXIF 提取)
- `server/services/photo-upload-service.js`(原子上传模式参考)
- `server/services/roll-file-service.js` 的"atomic publish"模式参考
- `@filmgallery/libraw-native`(RAW demosaic,已有)

### `/api/digital-develop` — 数码调色(D6/D9)

文件:`server/routes/digital-develop.js`(新建,镜像 `server/routes/filmlab.js` 但简化)

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/digital-develop/preview` | 实时预览:输入 `photo_id` + `params_json` → libraw demosaic → 应用 RenderCore → 返回预览 JPEG |
| `POST` | `/api/digital-develop/save` | 保存:更新 `photos.develop_params_json` + 渲染最终 JPEG 覆盖 `positive_rel_path` + 重新生成 `thumb_rel_path` |
| `POST` | `/api/digital-develop/export` | 导出:渲染最终 JPEG 到下载(可选带 EXIF 写入) |
| `GET` | `/api/digital-develop/:photoId/params` | 读取该照片已保存的 `develop_params_json` |

复用现有:
- `packages/shared/render/RenderCore.js` + `renderChunked.js`(渲染管线,零改动)
- `packages/shared/filmLabWhiteBalance.js` / `filmLabHSL.js` / `filmLabToneLUT.js` / `filmLabCurves.js` / `filmLabSplitTone.js`(底层模块,零改动)
- `@filmgallery/libraw-native`(RAW demosaic)
- `server/services/exif-service.js`(导出时 EXIF 写入)
- `server/routes/filmlab.js` 的"atomic upload + render" 模式参考
- `presets` 表(加 `category='digital'` 区分数码预设)

### 与 `/api/filmlab` 的差异

| 端点 | `/api/filmlab`(胶片) | `/api/digital-develop`(数码) |
|---|---|---|
| 输入源 | 负片扫描(`negative_rel_path`/`original_rel_path`) | RAW demosaic 后 RGB(来自 `original_rel_path` 的 RAW) |
| 反转步骤 | ✅(linear/log inversion) | ❌ 跳过 |
| FILM_PROFILES | ✅(胶片特性曲线) | ❌ 不应用 |
| H&D 曲线 | ✅ | ❌ |
| WB/HSL/Tone/Curves/SplitTone | ✅ | ✅(完全复用) |
| 输出 | `positive_rel_path`(正片) | `positive_rel_path`(调色后 JPEG) |
| 参数存储 | `photos.params_json`(legacy) + `presets`(category='positive') | `photos.develop_params_json` + `presets`(category='digital') |

### `/api/library` — 跨模式照片查询

文件:不新建,扩展现有 `/api/photos` 即可(见 5.2)

### `/api/app-config` — 应用配置

文件:`server/routes/app-config.js`(新建,极简)

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/app-config` | 读 `app_config` 单例 |
| `PUT` | `/api/app-config` | 更新 `active_mode` / `default_source_filter` / `digital_enabled` / `sidebar.show_*` |
| `POST` | `/api/app-config/onboarding` | 标记 onboarding 完成 |

## 5.2 修改的现有 API 端点

### `/api/photos` — 加 `?mode=` 过滤

文件:`server/routes/photos.js`

修改点(13 处 JOIN 审计 + mode 过滤):

| 行号 | 端点 | 修改 |
|---|---|---|
| 159 | `GET /` 列表 | `JOIN rolls` → `LEFT JOIN rolls`;加 `WHERE p.source_type IN (?, ...)`(由 `?mode=` 决定) |
| 183 | `GET /` 计数 | 同上 |
| 343 | `GET /single/:id` | `JOIN rolls` → `LEFT JOIN`(单照片查询,数码照片需要返回) |
| 366 | `GET /random` | 同上 |
| 387 | `GET /favorites` | 同上 |
| 414 | `GET /geo` | 同上 + 确保数码照片的 GPS 不被过滤 |
| 1191 | `GET /negatives` | 加 `WHERE source_type='film'`(数码无负片) |
| 1501 | 已是 LEFT JOIN,无改动 | — |

`?mode` 参数语义:
- `?mode=film` → `WHERE p.source_type='film'`
- `?mode=digital` → `WHERE p.source_type='digital'`
- `?mode=all` 或缺省 → 不加 source_type 过滤

新增过滤参数:
- `?album_id=` → 加 `JOIN album_photos ap ON ap.photo_id=p.id AND ap.album_id=?`
- `?session_id=` → 加 `WHERE p.session_id=?`
- `?include_deleted=true` → 默认 `WHERE p.deleted_at IS NULL`,加参数后包含回收站

### `/api/tags/:tagId/photos` — 加 mode 过滤

文件:`server/routes/tags.js:29`

`JOIN rolls r ON r.id = p.roll_id` → `LEFT JOIN rolls r ON r.id = p.roll_id`;加 `WHERE p.source_type IN (?, ...)` 由 `?mode=` 决定。

### `/api/stats/*` — 加 `?mode=` 参数

文件:`server/routes/stats.js`

| 端点 | 当前行为 | 修改后 |
|---|---|---|
| `GET /summary` | JOIN rolls 计数 | `?mode=film` 现状;`?mode=digital` 改 JOIN digital_sessions;`?mode=all` UNION ALL 两套计数 |
| `GET /gear` (line 47) | JOIN rolls 取 top cameras/lenses | `LEFT JOIN rolls`;`?mode=digital` 时按 `source_type='digital'` 过滤,top cameras/lenses 来自 photos 直接字段(不依赖 rolls) |
| `GET /activity` (line 84) | JOIN rolls 按 roll 月份 | `?mode=film` 现状;`?mode=digital` 改按 digital_sessions.session_date 月份,或直接按 photos.taken_at 月份 |
| `GET /costs` (line 94) | JOIN rolls 取成本 | 加 `WHERE source_type='film'`(数码无成本,数码模式返回空) |
| `GET /ratings` | photos 直接查 | 加 `?mode=` 过滤 |
| `GET /locations` | photos 直接查 | 加 `?mode=` 过滤 |
| `GET /temporal` | photos.taken_at 直接查 | 加 `?mode=` 过滤 |
| `GET /themes` | photos JOIN photo_tags | 加 `?mode=` 过滤 |
| `GET /inventory` | film_items | 数码模式返回空(数码无库存概念) |

新增数码专属统计端点(Phase 1 MVP 也做,因为成本低):

| 端点 | 用途 |
|---|---|
| `GET /api/stats/digital/cameras` | 数码照片 top 相机(按 photo_count) |
| `GET /api/stats/digital/focal-lengths` | 焦距分布(按 photos.focal_length 直方图) |
| `GET /api/stats/digital/monthly` | 月度数码拍摄量(按 photos.taken_at) |
| `GET /api/stats/digital/sensors` | 传感器分布(按 equip_cameras.sensor_format) |

实现:这些查询只过滤 `WHERE source_type='digital'`,不 JOIN rolls,性能好。

### `/api/equipment` — 加 `?mode=` 过滤

文件:`server/routes/equipment.js`

- `GET /api/equipment/cameras?mode=digital` → `WHERE is_digital=1`
- `GET /api/equipment/cameras?mode=film` → `WHERE is_digital=0`
- `GET /api/equipment/cameras?mode=all` 或缺省 → 不加过滤
- scanners/film-backs/formats 在数码模式前端不显示(后端不改,前端 EquipmentManager 过滤)
- 新增字段返回:`is_digital`, `sensor_type`, `sensor_format`, `megapixels`, `crop_factor`

### `/api/equipment/cameras` POST/PUT — 支持新字段

`server/routes/equipment.js` 的 camera CRUD 接受新字段:`is_digital`, `sensor_type`, `sensor_width_mm`, `sensor_height_mm`, `megapixels`, `crop_factor`, `sensor_format`。

应用层校验(在路由 handler 或 service):
- `is_digital=1` 时,`format_id` 应为 NULL(数码相机无胶片画幅)
- `is_digital=1` 的相机不应被分配到 `rolls.camera_equip_id`(在 roll 创建/更新时校验)

### `/api/discover` — 暴露 active_mode

`server/server.js:293-316` 的 `/api/discover` 返回 `capabilities`,新增:
```json
{
  "capabilities": {
    "digitalMode": true,
    "activeMode": "film",
    "digitalEnabled": true
  }
}
```
让移动端和配对设备知道桌面端是否启用了数码模式。

## 5.3 资产静态服务

`server.js:179-198` 现有静态服务配置:
- `/uploads/tmp` → `localTmpDir`(短缓存)
- `/uploads/rolls/.../thumb/...` → 短缓存(缩略图可变)
- `/uploads` → 1 年 immutable 缓存(原件不可变)

数码文件加在同一静态服务下:
- `/uploads/digital/{year}/{month}/{photoId}_original.{ext}` → 1 年 immutable(原件不可变)
- `/uploads/digital/{year}/{month}/thumb/{photoId}_thumb.jpg` → 短缓存(缩略图可重新生成)

需要在 `server.js:179-198` 加一条 digital thumb 的短缓存规则(类比 rolls thumb):
```javascript
app.use('/uploads/digital', express.static(uploadsDir + '/digital', {
  setHeaders: (res, path) => {
    if (path.includes('/thumb/')) {
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5min, 可变
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));
```

## 5.4 AI 工具按模式过滤

文件:`server/services/ai-tools/index.js`

### 现状
```javascript
// ai-tools/index.js:27-36
const ALL_TOOLS = {
  ...PHOTO_TOOLS,      // 共享
  ...ROLL_TOOLS,       // 胶片专属
  ...FILM_TOOLS,       // 胶片专属
  ...EQUIPMENT_TOOLS,  // 共享
  ...TAG_TOOLS,        // 共享
  ...SHOT_LOG_TOOLS,   // 胶片专属
  ...STATS_TOOLS,      // 共享
  ...RENDER_TOOLS      // 胶片专属
};

function getToolSchemas() {
  return Object.values(ALL_TOOLS).map(t => t.schema);
}
```

### 修改
```javascript
const FILM_ONLY = new Set([
  ...Object.keys(ROLL_TOOLS),
  ...Object.keys(FILM_TOOLS),
  ...Object.keys(SHOT_LOG_TOOLS),
  ...Object.keys(RENDER_TOOLS)
]);

function getToolSchemas(mode = 'all') {
  if (mode === 'digital') {
    return Object.entries(ALL_TOOLS)
      .filter(([name]) => !FILM_ONLY.has(name))
      .map(([, t]) => t.schema);
  }
  return Object.values(ALL_TOOLS).map(t => t.schema);
}
```

调用方(`server/routes/ai-chat.js`)在请求时传 `mode = req.app.locals.active_mode`(或从 app_config 读)。

### AI Context Builder 模式感知

`server/services/ai-context-builder.js` 的系统提示注入 `active_mode`:

```javascript
// 在 buildSystemPrompt() 中追加
const modeLine = activeMode === 'digital'
  ? '当前模式: 数码。用户正在管理数码照片。不要建议胶片专属操作(冲洗/扫描/FilmLab/卷管理)。'
  : activeMode === 'film'
    ? '当前模式: 胶片。用户正在管理胶片照片。'
    : '当前模式: 全部(胶片+数码)。';
```

### 数码专属 AI 工具(Phase 2+,MVP 不做)
- `auto_album` — 按 EXIF 日期邻近度 + GPS 聚类 + 相机自动分组(纯启发式,无 ML)
- `duplicate_detect` — 按 content_hash 分组(极简)
- `auto_tag` / `quality_score` — 需视觉模型,Phase 3+ 评估

## 5.5 AI 提示模板/快捷词调整

`server/server.js:478-482` 现有 4 个内置模板:通用助手、照片分析师、数据管家、FilmLab 调色顾问。

新增 1 个数码专属模板:
- **数码整理顾问** — 帮助用户基于 EXIF 自动分组、建议相册结构、识别重复

`server/server.js:454-461` 的 prompt shortcuts 现有 7 个(含胶片特性、FilmLab 建议等)。新增 1 个:
- **数码整理** — 触发 auto_album / duplicate_detect 工具(Phase 2 才有真实工具,MVP 只是快捷词)

## 5.6 API 客户端更新

### `packages/@filmgallery/api-client/`

新增资源模块(镜像现有 rolls.js 模式):

- `packages/@filmgallery/api-client/albums.js` — `createApiClient` 返回 `{ albums: { list, get, create, update, delete, addPhotos, removePhoto, setCover, sortPhotos } }`
- `packages/@filmgallery/api-client/digital-sessions.js` — `{ digitalSessions: { list, get, getPhotos, update, delete } }`
- `packages/@filmgallery/api-client/digital-import.js` — `{ digitalImport: { preview, execute, getProgress, cancel, checkHash } }`
- `packages/@filmgallery/api-client/digital-develop.js` — `{ digitalDevelop: { preview, save, export, getParams } }`
- `packages/@filmgallery/api-client/app-config.js` — `{ appConfig: { get, update, completeOnboarding } }`

修改 `packages/@filmgallery/api-client/photos.js`:
- `list({ mode, albumId, sessionId, includeDeleted })` 加新参数
- `getGeo({ mode })` 加 mode 参数

修改 `packages/@filmgallery/api-client/stats.js`:
- 所有方法加 `mode` 参数,默认 `'all'`

`packages/@filmgallery/api-client/index.js` 重新导出新模块。

### `client/src/api/`

- `client/src/api/albums.js`(新建,调用 `@filmgallery/api-client/albums`)
- `client/src/api/digital-import.js`(新建)
- `client/src/api/digital-develop.js`(新建)
- `client/src/api/app-config.js`(新建)
- `client/src/api/index.js` 重新导出

### `mobile/src/api/`

MVP 不动(移动端数码 = Phase 2)。Phase 2 时再加 `mobile/src/api/albums.ts` 等只读客户端。

## 5.7 类型包更新

`packages/@filmgallery/types/index.d.ts` 新增:

```typescript
export interface Album {
  id: number;
  title: string;
  description?: string;
  parent_album_id?: number | null;
  cover_photo_id?: number | null;
  sort_order: number;
  location_id?: number | null;
  date_start?: string;
  date_end?: string;
  photo_count: number;
  is_smart: boolean;
  criteria_json?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface DigitalSession {
  id: number;
  title?: string;
  session_date?: string;
  import_batch_id: string;
  camera_equip_id?: number | null;
  lens_equip_id?: number | null;
  location_id?: number | null;
  notes?: string;
  photo_count: number;
  cover_photo_id?: number | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface AppConfig {
  active_mode: 'film' | 'digital' | 'all';
  default_source_filter: 'film' | 'digital' | 'all';
  onboarding_completed: boolean;
  digital_enabled: boolean;
  sidebar: {
    show_film_section: boolean;
    show_digital_section: boolean;
  };
}

// 修改现有 Photo 接口
export interface Photo {
  // ...现有字段
  source_type?: 'film' | 'digital';
  session_id?: number | null;
  content_hash?: string;
  deleted_at?: string | null;
  media_type?: 'image' | 'video' | 'live_photo';
  stack_id?: string;
  stack_role?: 'cover' | 'raw_sibling' | 'jpeg_sibling' | 'alternate';
  white_balance?: string;
  color_space?: string;
  original_filename?: string;
  develop_params_json?: string;  // D9: DigitalDevelop 调色参数 JSON
}

// DigitalDevelop 调色参数结构(与胶片 params_json 共享大部分字段)
export interface DevelopParams {
  white_balance?: { temp: number; tint: number };
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  hsl?: { [color: string]: { hue: number; sat: number; lum: number } };
  tone_curve?: { rgb: number[]; red: number[]; green: number[]; blue: number[] };
  split_tone?: { highlights: { color: string; balance: number }; shadows: { color: string; balance: number } };
  lut?: string;  // LUT 文件名
}

// 修改现有 Camera 接口
export interface Camera {
  // ...现有字段
  is_digital?: boolean;
  sensor_type?: string;
  sensor_width_mm?: number;
  sensor_height_mm?: number;
  megapixels?: number;
  crop_factor?: number;
  sensor_format?: string;
}
```

## 5.8 共享包(serverCapabilities)

`packages/shared/serverCapabilities.js` 不需要新增 PHOTOGRAPHY_MODE——模式是应用层概念,不是部署能力。但可以加一个辅助函数:

```javascript
// packages/shared/photographyMode.js (新建)
const PHOTO_MODES = {
  FILM: 'film',
  DIGITAL: 'digital',
  ALL: 'all'
};

function isFilmMode(mode) { return mode === PHOTO_MODES.FILM; }
function isDigitalMode(mode) { return mode === PHOTO_MODES.DIGITAL; }
function isAllMode(mode) { return mode === PHOTO_MODES.ALL; }

// 用于 SQL IN 子句生成
function sourceTypeFilter(mode) {
  if (mode === PHOTO_MODES.FILM) return ['film'];
  if (mode === PHOTO_MODES.DIGITAL) return ['digital'];
  return ['film', 'digital'];
}

module.exports = { PHOTO_MODES, isFilmMode, isDigitalMode, isAllMode, sourceTypeFilter };
```

在 `packages/shared/index.js` 导出。

## 5.9 健康检查与诊断

`server/routes/health.js` 的 `GET /api/health/database` 应增加数码模式相关计数:

```json
{
  "photos": {
    "total": 14847,
    "film": 2103,
    "digital": 12744,
    "deleted": 12
  },
  "albums": { "total": 23, "deleted": 1 },
  "digital_sessions": { "total": 89 },
  "app_config": { "active_mode": "all", "digital_enabled": true }
}
```

便于诊断"数码照片为什么不显示"类问题。
