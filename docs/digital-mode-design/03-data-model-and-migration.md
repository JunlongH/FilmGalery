# 03 — 数据模型与迁移

## 3.1 现有 Schema 概览(胶片侧)

经 `server/utils/run-all-migrations.js` 注册的三个迁移构造了当前 schema:

```
films(胶片库存目录) ──1:多── film_items(库存+冲洗生命周期) ──1:多── rolls(胶卷) ──1:多── photos(照片)
                                          │                                  │
                                          └── camera_equip_id                ├── roll_locations ── locations
                                                                             └── roll_gear(自由文本器材)
photos ── 多:多 ── photo_tags ── 多:多 ── tags
photos ── 多:1 ── locations
photos ── 多:1 ── equip_cameras / equip_lenses / equip_flashes / equip_scanners
equip_cameras.format_id ── ref_film_formats
presets / film_curve_profiles / ai_config / ai_conversations / sessions
```

**核心约束**:`photos.roll_id` 当前事实非空(每张照片必属一卷);所有共享查询隐式假设 `JOIN rolls` 不会丢行。

## 3.2 新增/修改的表

### 3.2.1 `app_config`(新)— 单例配置表

```sql
CREATE TABLE IF NOT EXISTS app_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_mode TEXT NOT NULL DEFAULT 'film',  -- film | digital | both(默认过滤)
  default_source_filter TEXT NOT NULL DEFAULT 'film',  -- 用于新打开视图的初始过滤
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  digital_enabled INTEGER NOT NULL DEFAULT 0,  -- 用户是否启用了数码模式
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO app_config (id) VALUES (1);
```

设计要点:
- 单行表(`CHECK (id = 1)`),类比现有 `ai_config`(`server.js:388-404`)
- `active_mode` 当前模式(实际就是默认过滤),`default_source_filter` 是新视图初始值
- `digital_enabled` 区分"未引导用户"和"已引导但选纯胶片"——避免反复弹引导

### 3.2.2 `digital_sessions`(新)— 数码导入批次/拍摄日

```sql
CREATE TABLE IF NOT EXISTS digital_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,  -- 可选,如"东京之行 Day 3"
  session_date TEXT,  -- 拍摄日期(从 EXIF 推断)
  import_batch_id TEXT NOT NULL,  -- UUID,同一次导入的所有照片共享
  camera_equip_id INTEGER REFERENCES equip_cameras(id) ON DELETE SET NULL,
  lens_equip_id INTEGER REFERENCES equip_lenses(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  notes TEXT,
  photo_count INTEGER NOT NULL DEFAULT 0,
  cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_digital_sessions_import_batch ON digital_sessions(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_digital_sessions_date ON digital_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_digital_sessions_deleted ON digital_sessions(deleted_at);
```

设计要点:
- 轻量容器,类比 rolls 但字段少得多(无冲洗/扫描/成本)
- `import_batch_id` 用于"Previous Import"快速过滤和去重
- 不做侧栏入口(见 D4);Calendar 视图按 session_date 自动分组提供时序浏览

### 3.2.3 `albums`(新)— 数码策展相册

```sql
CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  parent_album_id INTEGER REFERENCES albums(id) ON DELETE CASCADE,  -- 嵌套
  cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  date_start TEXT,  -- 自动从照片 EXIF 推断
  date_end TEXT,
  photo_count INTEGER NOT NULL DEFAULT 0,  -- 缓存计数
  is_smart INTEGER NOT NULL DEFAULT 0,  -- Phase 2: 智能相册标志(schema 预留)
  criteria_json TEXT,  -- Phase 2: 智能相册规则 JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_albums_parent ON albums(parent_album_id);
CREATE INDEX IF NOT EXISTS idx_albums_deleted ON albums(deleted_at);
CREATE INDEX IF NOT EXISTS idx_albums_date_start ON albums(date_start);
```

设计要点:
- 命名 `albums` 而非 `digital_albums`(胶片侧不需要 albums 概念,无冲突)
- `parent_album_id` 支持嵌套(文件夹式层级)
- `is_smart` + `criteria_json` 在 MVP 不用,但 schema 预留避免 Phase 2 二次迁移
- 胶片照片也可加入相册(M2M,见下),跨模式策展

### 3.2.4 `album_photos`(新)— 相册↔照片 多:多

```sql
CREATE TABLE IF NOT EXISTS album_photos (
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (album_id, photo_id)
);

CREATE INDEX IF NOT EXISTS idx_album_photos_photo ON album_photos(photo_id);
CREATE INDEX IF NOT EXISTS idx_album_photos_album_sort ON album_photos(album_id, sort_order);
```

设计要点:
- 多:多(一张照片可在多个相册),与 rolls 的 1:多形成对比
- 不在 photos 表上加 `album_id` 字段(避免"一张照片只能在一个相册"的死路)
- `sort_order` 支持相册内自定义排序

### 3.2.5 `photos` 表修改(增量)

```sql
-- source_type: 区分胶片/数码照片
ALTER TABLE photos ADD COLUMN source_type TEXT;  -- 'film' | 'digital',默认 NULL(迁移后 backfill 为 'film')
CREATE INDEX IF NOT EXISTS idx_photos_source_type ON photos(source_type);

-- 数码侧关联
ALTER TABLE photos ADD COLUMN session_id INTEGER REFERENCES digital_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_photos_session ON photos(session_id);

-- 内容哈希(去重:同一张照片不会被重复导入)
ALTER TABLE photos ADD COLUMN content_hash TEXT;  -- xxhash 或 sha256
CREATE INDEX IF NOT EXISTS idx_photos_content_hash ON photos(content_hash);

-- 软删除(回收站)
ALTER TABLE photos ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_photos_deleted ON photos(deleted_at);

-- 媒体类型(为 Phase 3 视频/Live Photo 预留)
ALTER TABLE photos ADD COLUMN media_type TEXT DEFAULT 'image';  -- image | video | live_photo

-- 栈组(为 Phase 2 RAW+JPEG 配对/连拍/HDR 预留)
ALTER TABLE photos ADD COLUMN stack_id TEXT;  -- 同一栈组的照片共享 stack_id(UUID)
ALTER TABLE photos ADD COLUMN stack_role TEXT DEFAULT 'cover';  -- cover | raw_sibling | jpeg_sibling | alternate

-- 数码侧 EXIF 扩展(数码照片的传感器/白平衡等)
ALTER TABLE photos ADD COLUMN white_balance TEXT;  -- 'auto' | 'daylight' | 'cloudy' | 'tungsten' | 'fluorescent' | 'custom' | ...
ALTER TABLE photos ADD COLUMN color_space TEXT;  -- 'sRGB' | 'AdobeRGB' | 'ProPhoto' | 'DisplayP3' | ...
ALTER TABLE photos ADD COLUMN original_filename TEXT;  -- 导入时的原始文件名(便于"在 Finder 中显示")

-- DigitalDevelop 调色参数入库(D9)
ALTER TABLE photos ADD COLUMN develop_params_json TEXT;  -- JSON,类比胶片 params_json;含 WB/exposure/contrast/HSL/tone_curve/split_tone/lut/crop

-- 场景关联(Q5,schema 预留,UI Phase 2)
ALTER TABLE photos ADD COLUMN scene_id TEXT;  -- UUID,同场景(胶片+数码对比)的照片共享
CREATE INDEX IF NOT EXISTS idx_photos_scene ON photos(scene_id);

-- 复用现有字段(不加新列):
--   original_rel_path  → RAW 原件路径(数码)或底片扫描原件路径(胶片)
--   positive_rel_path  → 调色后的 JPEG(数码 demosaic+调色后;胶片是调色后正片)
--   thumb_rel_path     → 缩略图
--   full_rel_path      → 显示尺寸(legacy,数码可复用 positive_rel_path)
```

设计要点:
- 所有新列都 nullable(无 NOT NULL 约束,避免 SQLite 添加非空列的限制)
- `source_type` 迁移后 backfill 为 `'film'`,之后新胶片照片默认 `'film'`(由应用层在 INSERT 时设置)
- **不加** `raw_rel_path` 字段——RAW 用 `original_rel_path`,语义上 RAW 就是数码的"原件",和胶片的"底片扫描原件"共用字段,靠 `source_type` 区分(见 D7)
- **不加** `album_id` 字段——用 `album_photos` M2M 表,见 3.2.4
- `stack_id` + `stack_role` 在 MVP 不用,但加上避免 Phase 2 二次迁移

### 3.2.6 `equip_cameras` 表修改(增量)

```sql
ALTER TABLE equip_cameras ADD COLUMN is_digital INTEGER NOT NULL DEFAULT 0;  -- 0=胶片相机, 1=数码相机
ALTER TABLE equip_cameras ADD COLUMN sensor_type TEXT;  -- 'CMOS' | 'CCD' | 'BSI-CMOS' | 'X-Trans' | 'Foveon' | ...
ALTER TABLE equip_cameras ADD COLUMN sensor_width_mm REAL;
ALTER TABLE equip_cameras ADD COLUMN sensor_height_mm REAL;
ALTER TABLE equip_cameras ADD COLUMN megapixels REAL;
ALTER TABLE equip_cameras ADD COLUMN crop_factor REAL;  -- 相对 135 全幅
ALTER TABLE equip_cameras ADD COLUMN sensor_format TEXT;  -- 'full-frame' | 'APS-C' | 'APS-H' | 'M4/3' | '1"' | 'medium-format' | 'phone' | ...
```

设计要点:
- 与现有 `format_id`(胶片画幅)并存——一台相机要么是胶片(`is_digital=0`,有 format_id)要么是数码(`is_digital=1`,有 sensor_*)。应用层校验:不能两者都有值
- 数码相机自然归属数码模式;但胶片相机仍可被数码模式引用(例如用户用胶片相机拍的照片被扫描后作为数码照片入库——这是合理的)
- 应用层校验:`is_digital=1` 的相机不应被分配到 rolls.camera_equip_id(数码相机不能装胶卷)

## 3.3 完整迁移脚本

新文件:`server/utils/digital-mode-migration.js`,在 `server/utils/run-all-migrations.js:23` 的 `REGISTERED_MIGRATIONS` 数组追加:

```javascript
{
  id: '20260801_digital_mode',
  description: 'Add digital photo management mode (albums, sessions, source_type, etc.)',
  runner: require('./digital-mode-migration.js')
}
```

`digital-mode-migration.js` 结构(遵循现有 schema-migration.js 的幂等模式——`ALTER TABLE ADD COLUMN` 用 try/catch 包裹,`CREATE TABLE` 用 `IF NOT EXISTS`):

```javascript
const { db, runAsync, allAsync } = require('../db');

async function migrate() {
  // 1. 创建新表(幂等)
  await runAsync(`CREATE TABLE IF NOT EXISTS app_config (...)`);
  await runAsync(`INSERT OR IGNORE INTO app_config (id) VALUES (1)`);
  await runAsync(`CREATE TABLE IF NOT EXISTS digital_sessions (...)`);
  await runAsync(`CREATE TABLE IF NOT EXISTS albums (...)`);
  await runAsync(`CREATE TABLE IF NOT EXISTS album_photos (...)`);

  // 2. 给 photos 加列(每条 try/catch,忽略 "duplicate column" 错误)
  const photoColumns = [
    `ALTER TABLE photos ADD COLUMN source_type TEXT`,
    `ALTER TABLE photos ADD COLUMN session_id INTEGER`,
    `ALTER TABLE photos ADD COLUMN content_hash TEXT`,
    `ALTER TABLE photos ADD COLUMN deleted_at TEXT`,
    `ALTER TABLE photos ADD COLUMN media_type TEXT DEFAULT 'image'`,
    `ALTER TABLE photos ADD COLUMN stack_id TEXT`,
    `ALTER TABLE photos ADD COLUMN stack_role TEXT DEFAULT 'cover'`,
    `ALTER TABLE photos ADD COLUMN white_balance TEXT`,
    `ALTER TABLE photos ADD COLUMN color_space TEXT`,
    `ALTER TABLE photos ADD COLUMN original_filename TEXT`,
    `ALTER TABLE photos ADD COLUMN develop_params_json TEXT`,  // D9: DigitalDevelop 调色参数 JSON(含 crop)
    `ALTER TABLE photos ADD COLUMN scene_id TEXT`  // Q5: 场景关联(schema 预留,UI Phase 2)
  ];
  for (const sql of photoColumns) {
    try { await runAsync(sql); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
  }

  // 3. 给 equip_cameras 加列
  const cameraColumns = [
    `ALTER TABLE equip_cameras ADD COLUMN is_digital INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE equip_cameras ADD COLUMN sensor_type TEXT`,
    // ... 其余传感器字段
  ];
  for (const sql of cameraColumns) {
    try { await runAsync(sql); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
  }

  // 4. 创建索引(幂等)
  await runAsync(`CREATE INDEX IF NOT EXISTS idx_photos_source_type ON photos(source_type)`);
  await runAsync(`CREATE INDEX IF NOT EXISTS idx_photos_session ON photos(session_id)`);
  await runAsync(`CREATE INDEX IF NOT EXISTS idx_photos_content_hash ON photos(content_hash)`);
  await runAsync(`CREATE INDEX IF NOT EXISTS idx_photos_deleted ON photos(deleted_at)`);
  await runAsync(`CREATE INDEX IF NOT EXISTS idx_photos_scene ON photos(scene_id)`);
  // ... 其余索引

  // 5. Backfill:现有照片全部标记为胶片
  await runAsync(`UPDATE photos SET source_type = 'film' WHERE source_type IS NULL`);

  // 6. 现有相机全部标记为胶片(is_digital 默认 0,无需 backfill)
}

module.exports = { migrate };
```

## 3.4 迁移安全与回滚

### 现有迁移系统特性(已验证)
- `server/utils/run-all-migrations.js:9-11`:迁移**前向 only,无 down()**
- `server/utils/migration-tracker.js:21`:迁移前自动备份数据库到 `film.db.backup-{ISO}`,保留最近 3 份
- 现有迁移幂等模式:`ALTER TABLE ADD COLUMN` 用 try/catch 包"duplicate column"错误,`CREATE TABLE` 用 `IF NOT EXISTS`

### 本迁移的安全保证
1. **纯增量**:所有变更都是 ADD COLUMN / CREATE TABLE / CREATE INDEX / UPDATE backfill,无 DROP / RENAME / MODIFY
2. **幂等**:重复运行不报错(已有列/表/索引被静默跳过)
3. **向后兼容**:新列 nullable,新表空;胶片流程不依赖任何新字段
4. **回滚路径**:恢复 `film.db.backup-{ISO}` 即完全回到胶片-only 状态;新表/新列消失,胶片流程零影响
5. **应用层兼容**:即使迁移成功但应用未升级,旧应用读新表/新列会得到 NULL/空,不报错(只要旧应用不依赖新字段)

### 测试清单
- [ ] 在真实 `film.db` 副本上跑迁移,验证零错误
- [ ] 跑迁移后启动胶片流程(列表/RollDetail/FilmLab/Stats),验证零回归
- [ ] 跑迁移后用旧版本应用连新数据库,验证零报错(向前兼容)
- [ ] 跑迁移两次,验证幂等(第二次零变更)
- [ ] 恢复备份,验证完全回滚

### 不可逆的边界
- 一旦数码照片入库,回滚到迁移前会丢失数码数据(因为没有数码表)
- 但胶片数据零影响——这是可接受的回滚语义("放弃数码模式 = 丢失数码数据,胶片不动")

## 3.5 数据流:一张数码照片的入库全流程

```
用户拖入 5 张 JPEG + 3 张 RAW
  ↓
[导入向导] 解析 EXIF(相机/镜头/光圈/快门/ISO/GPS/日期)
  ↓
[去重] 计算每张 content_hash,查询 photos.content_hash 是否已存在
  ↓ 已存在 → 跳过 + 提示用户
  ↓ 不存在 → 继续
  ↓
[文件分流]
  JPEG → 直接作为 positive_rel_path
  RAW  → libraw-native demosaic → 生成 JPEG 作为 positive_rel_path
         RAW 文件存为 original_rel_path(供 DigitalDevelop 重新渲染)
  ↓
[创建 session] INSERT INTO digital_sessions (import_batch_id=UUID, session_date=最早EXIF日期, ...)
  ↓
[复制文件] 上传到 uploads/digital/{year}/{month}/{photoId}_original.{ext}(RAW 或 JPEG 原件)
                 uploads/digital/{year}/{month}/{photoId}_positive.jpg(demosaic 后的 JPEG)
  ↓
[生成缩略图] 后台 worker 用 sharp 生成 {photoId}_thumb.jpg(复用 thumb-service)
  ↓
[INSERT photos] source_type='digital', session_id=X,
                original_rel_path=RAW, positive_rel_path=JPEG, thumb_rel_path=...,
                EXIF 字段全填, content_hash=...,
                develop_params_json=NULL(MVP 阶段未调色)
  ↓
[可选: 加入相册] 如果用户在向导里选了相册,INSERT INTO album_photos (album_id, photo_id) VALUES ...
  ↓
[更新 session.photo_count] UPDATE digital_sessions SET photo_count = photo_count + N
```

### 调色流程(DigitalDevelop 打开一张数码 RAW 时)

```
用户在 PhotoView 点击"调色"按钮
  ↓
[DigitalDevelop 加载] 读取 photos.original_rel_path(RAW 文件路径)
  ↓
[libraw demosaic] 调用 @filmgallery/libraw-native 解码 RAW → RGB buffer
  ↓
[应用 develop_params_json] 若该照片已有调色参数,解析 JSON 应用到 RGB buffer
  ↓
[RenderCore 渲染] 复用 packages/shared/render/RenderCore.js
  ├─ filmLabWhiteBalance.apply(rgb, {temp, tint})
  ├─ 曝光/对比/高光/阴影 adjustment
  ├─ filmLabHSL.apply(rgb, hsl_params)
  ├─ filmLabToneLUT.apply(rgb, tone_curve)
  ├─ filmLabCurves.apply(rgb, curves)
  └─ filmLabSplitTone.apply(rgb, split_tone)
  ↓
[预览] Canvas 显示渲染结果(用户实时调整滑条,重新跑 RenderCore)
  ↓
[用户点"保存"] UPDATE photos SET develop_params_json=? WHERE id=?
              + 渲染最终 JPEG 覆盖 positive_rel_path
              + 重新生成 thumb_rel_path
  ↓
[用户点"存为预设"] INSERT INTO presets (name, category='digital', params_json=?) 
                  便于复用到其他数码照片
```

## 3.6 资产存储路径方案

```
uploads/
├── rolls/{rollId}/...                    (胶片,现有结构不变)
├── films/...                             (胶片库存缩略图,现有)
├── equipment/...                         (器材图片,现有)
└── digital/                              (数码,新)
    └── {year}/{month}/                   (按年月分片,避免单目录 50k+ 文件)
        ├── {photoId}_original.{ext}      (原件 JPEG 或归档 RAW)
        ├── {photoId}_display.jpg         (显示尺寸,可选,降低浏览带宽)
        └── thumb/
            └── {photoId}_thumb.jpg       (缩略图,240px,quality 40,复用 thumb-service)
```

设计要点:
- 年月分片是性能关键(50k 文件平铺会让 `readdir` 卡死)
- 复用 `thumb_rel_path` / `original_rel_path` / `positive_rel_path` 字段语义:
  - 数码:`original_rel_path` = 原件,`positive_rel_path` = 用于浏览的 JPEG(导入即原件本身,除非用户后续调色),`thumb_rel_path` = 缩略图
  - 胶片:字段语义不变
- 静态服务路由(`/uploads`)已配置 1 年 immutable 缓存(`server.js:179-198`),数码文件也是 immutable,无需改

## 3.7 索引策略

| 索引 | 用途 |
|---|---|
| `idx_photos_source_type` | 共享视图按模式过滤(必加) |
| `idx_photos_session` | 按 session 查询数码照片(必加) |
| `idx_photos_content_hash` | 去重查询(必加) |
| `idx_photos_deleted` | 回收站过滤(必加) |
| `idx_photos_date_taken_id` | 已有,时序浏览(胶片数码共用) |
| `idx_photos_rating` | 已有,Favorites 视图 |
| `idx_photos_location_id` | 已有,Map 视图 |
| `idx_album_photos_album_sort` | 相册内排序查询(必加) |
| `idx_album_photos_photo` | 反查"一张照片在哪些相册"(必加) |
| `idx_digital_sessions_import_batch` | "Previous Import" 过滤(必加) |
| `idx_albums_parent` | 嵌套相册查询(必加) |

## 3.8 关系图(迁移后)

```mermaid
erDiagram
    films ||--o{ film_items : "1:N"
    film_items ||--o{ rolls : "1:N"
    rolls ||--o{ photos : "1:N (film photos only)"
    rolls }o--o{ locations : "M:N via roll_locations"
    rolls }o--|| equip_cameras : "camera_equip_id"
    rolls }o--|| equip_lenses : "lens_equip_id"
    rolls }o--|| equip_scanners : "scanner_equip_id"

    digital_sessions ||--o{ photos : "1:N (digital photos only)"
    digital_sessions }o--|| equip_cameras : "camera_equip_id"
    digital_sessions }o--o| locations : "location_id"

    albums ||--o{ albums : "parent_album_id (nesting)"
    albums }o--o{ photos : "M:N via album_photos"
    albums }o--o| locations : "location_id"
    albums }o--|| photos : "cover_photo_id"

    photos }o--o| digital_sessions : "session_id (digital only)"
    photos }o--o| rolls : "roll_id (film only, nullable now)"
    photos }o--o{ tags : "M:N via photo_tags"
    photos }o--o| locations : "location_id"
    photos }o--|| equip_cameras : "camera_equip_id"
    photos }o--|| equip_lenses : "lens_equip_id"
    photos }o--o{ albums : "M:N via album_photos"

    equip_cameras }o--o| ref_film_formats : "format_id (film only)"
    equip_cameras }o--.| { is_digital, sensor_* } : "digital-only fields"

    app_config ||--|| { singleton } : "id=1"
```
