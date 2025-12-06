# 2. 数据库设计

## 2.1 核心表结构

### 2.1.1 films (胶片类型表)
存储胶片的基本信息（如柯达 Portra 400、富士 Pro 400H）。

```sql
CREATE TABLE films (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,              -- 胶片名称
  iso INTEGER,                     -- 感光度
  format TEXT,                     -- 格式 (135/120/etc)
  type TEXT,                       -- 类型 (彩色/黑白)
  category TEXT,                   -- 分类
  description TEXT,                -- 描述
  thumbPath TEXT,                  -- 缩略图路径
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2.1.2 film_items (胶片库存表)
存储每一卷实际购买的胶片，追踪全生命周期。

```sql
CREATE TABLE film_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  film_id INTEGER NOT NULL,        -- 关联 films.id
  roll_id INTEGER,                 -- 拍摄后关联 rolls.id
  status TEXT NOT NULL,            -- 状态：in_stock/loaded/shot/sent_to_lab/developed/archived
  purchase_date TEXT,              -- 购买日期
  purchase_channel TEXT,           -- 购买渠道
  purchase_cost REAL,              -- 购买成本
  develop_cost REAL,               -- 冲洗成本
  develop_lab TEXT,                -- 冲洗店
  develop_process TEXT,            -- 冲洗工艺
  develop_channel TEXT,            -- 冲洗渠道
  develop_note TEXT,               -- 冲洗备注
  loaded_camera TEXT,              -- 装填相机
  loaded_date TEXT,                -- 装填日期
  finished_date TEXT,              -- 拍完日期
  shot_logs TEXT,                  -- 拍摄日志 (JSON)
  negative_archived INTEGER DEFAULT 0,  -- 底片是否归档
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME,             -- 软删除标记
  FOREIGN KEY(film_id) REFERENCES films(id),
  FOREIGN KEY(roll_id) REFERENCES rolls(id)
);
```

### 2.1.3 rolls (胶卷表)
拍摄完成并冲洗的胶卷。

```sql
CREATE TABLE rolls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  film_item_id INTEGER,            -- 关联 film_items.id
  title TEXT,                      -- 标题
  start_date DATE,                 -- 开始日期
  end_date DATE,                   -- 结束日期
  camera TEXT,                     -- 相机
  lens TEXT,                       -- 镜头
  photographer TEXT,               -- 摄影师
  filmId INTEGER,                  -- 关联 films.id
  film_type TEXT,                  -- 胶片类型
  iso INTEGER,                     -- ISO
  exposures INTEGER,               -- 张数
  cover_photo TEXT,                -- 封面照片
  folderName TEXT,                 -- 文件夹名
  notes TEXT,                      -- 备注
  display_seq INTEGER DEFAULT 0,  -- 显示序号
  preset_json TEXT,                -- 编辑预设 (JSON)
  develop_date DATE,               -- 冲洗日期
  develop_lab TEXT,                -- 冲洗店
  develop_process TEXT,            -- 冲洗工艺
  develop_cost REAL,               -- 冲洗费用
  develop_note TEXT,               -- 冲洗备注
  purchase_cost REAL,              -- 购买费用
  purchase_channel TEXT,           -- 购买渠道
  batch_number TEXT,               -- 批次号
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(filmId) REFERENCES films(id)
);
```

### 2.1.4 photos (照片表)
存储每张照片的元数据和路径。

```sql
CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roll_id INTEGER,                 -- 关联 rolls.id
  filename TEXT NOT NULL,          -- 文件名
  frame_number INTEGER,            -- 帧号
  
  -- 图片路径
  original_rel_path TEXT,          -- 原图相对路径
  positive_rel_path TEXT,          -- 正片相对路径
  full_rel_path TEXT,              -- 全尺寸路径
  negative_rel_path TEXT,          -- 负片路径
  thumb_rel_path TEXT,             -- 缩略图路径
  positive_thumb_rel_path TEXT,    -- 正片缩略图
  negative_thumb_rel_path TEXT,    -- 负片缩略图
  
  -- 拍摄参数
  aperture REAL,                   -- 光圈
  shutter_speed TEXT,              -- 快门速度
  iso INTEGER,                     -- ISO
  focal_length REAL,               -- 焦距
  
  -- 元数据
  caption TEXT,                    -- 标题
  rating INTEGER DEFAULT 0,        -- 评分 (0-5)
  notes TEXT,                      -- 备注
  
  -- 拍摄信息
  date_taken DATE,                 -- 拍摄日期
  time_taken TIME,                 -- 拍摄时间
  camera TEXT,                     -- 相机
  lens TEXT,                       -- 镜头
  photographer TEXT,               -- 摄影师
  
  -- 地理位置
  location_id INTEGER,             -- 关联 locations.id
  detail_location TEXT,            -- 详细地点
  latitude REAL,                   -- 纬度
  longitude REAL,                  -- 经度
  
  -- 编辑参数
  edit_params TEXT,                -- 编辑参数 (JSON)
  
  display_seq INTEGER DEFAULT 0,  -- 显示序号
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(roll_id) REFERENCES rolls(id),
  FOREIGN KEY(location_id) REFERENCES locations(id)
  > shot_logs JSON 结构：`[{ date: 'YYYY-MM-DD', count: 12, lens?: '50mm f/1.8' }]`
  > - 每条对象是一条拍摄记录（可同一日期多条，新增时不覆盖旧记录）
  > - `count`：该条记录的拍摄张数
  > - `lens`：可选，镜头型号；镜头下拉从 rolls/photos/film_items.shot_logs 的历史值去重汇总，自定义输入保存后自动进入常用列表
);
```

### 2.1.5 tags (标签表)
存储所有标签（小写存储，防止重复）。

```sql
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL        -- 标签名（小写）
);
```

### 2.1.6 photo_tags (照片-标签关联表)
多对多关系表。

```sql
CREATE TABLE photo_tags (
  photo_id INTEGER,
  tag_id INTEGER,
  PRIMARY KEY (photo_id, tag_id),
  FOREIGN KEY(photo_id) REFERENCES photos(id),
  FOREIGN KEY(tag_id) REFERENCES tags(id)
);
```

### 2.1.7 locations (地理位置表)
存储城市级别的地理位置。

```sql
CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT,               -- 国家代码 (CN/US/etc)
  country_name TEXT,               -- 国家名称
  city_name TEXT,                  -- 城市名称
  city_lat REAL,                   -- 城市纬度
  city_lng REAL                    -- 城市经度
);
```

### 2.1.8 roll_locations (胶卷-地点关联表)
记录胶卷拍摄的地点。

```sql
CREATE TABLE roll_locations (
  roll_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  PRIMARY KEY (roll_id, location_id)
);
```

### 2.1.9 roll_gear (胶卷设备表)
记录胶卷使用的相机、镜头、摄影师（去重）。

```sql
CREATE TABLE roll_gear (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roll_id INTEGER NOT NULL,
  type TEXT NOT NULL,              -- 'camera' | 'lens' | 'photographer'
  value TEXT NOT NULL,
  UNIQUE(roll_id, type, value),
  FOREIGN KEY(roll_id) REFERENCES rolls(id) ON DELETE CASCADE
);
```

### 2.1.10 presets (预设表)
保存编辑参数预设。

```sql
CREATE TABLE presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,              -- 预设名称
  params TEXT NOT NULL,            -- 参数 (JSON)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 2.2 数据关系图

```
films ──┬─→ film_items ──→ rolls ──→ photos ──→ photo_tags ──→ tags
        │                    │         │
        └────────────────────┘         ├─→ locations
                                       └─→ roll_gear
                                       
roll_locations: rolls ←→ locations (多对多)
```

## 2.3 索引设计

关键索引提升查询性能：

```sql
-- 照片查询
CREATE INDEX idx_photos_roll ON photos(roll_id);
CREATE INDEX idx_photos_date_taken ON photos(date_taken);
CREATE INDEX idx_photos_rating ON photos(rating);
CREATE INDEX idx_photos_roll_date_id ON photos(roll_id, date_taken, id);

-- 胶片库存
CREATE INDEX idx_film_items_status_deleted ON film_items(status, deleted_at);
```

## 2.4 数据库迁移

### 2.4.1 迁移系统
使用基于文件的迁移系统：

```javascript
// server/utils/migration.js
async function runMigration() {
  const migrations = fs.readdirSync('./migrations')
    .filter(f => f.endsWith('.js'))
    .sort();
  
  for (const file of migrations) {
    const { up } = require(`./migrations/${file}`);
    await up();
  }
}
```

### 2.4.2 重要迁移历史
- **2025-11-db-revamp.js**: 添加 locations, roll_locations, 扩展 rolls/photos 字段
- **2025-11-30-add-photo-equipment.js**: 添加 camera/lens/photographer 到 photos
- **2025-11-30-add-roll-gear.js**: 创建 roll_gear 表
- **2025-11-30-rename-shooter-to-photographer.js**: 统一命名
- **2025-12-02-add-film-items.js**: 创建 film_items 库存系统
- **2025-12-02-add-shot-logs.js**: 添加 shot_logs 字段

### 2.4.3 Schema 迁移工具
自动补全缺失的列和表：

```javascript
// server/utils/schema-migration.js
function runSchemaMigration() {
  // 1. 确保所有表存在
  // 2. 确保所有列存在
  // 3. 创建索引
}
```

## 2.5 数据完整性

### 2.5.1 外键约束
```sql
PRAGMA foreign_keys = ON;  -- 启用外键约束
```

### 2.5.2 级联删除
- `roll_gear`: 删除 roll 时自动删除关联设备
- `photo_tags`: 删除 photo/tag 时自动删除关联

### 2.5.3 软删除
`film_items` 使用 `deleted_at` 软删除，保留历史记录。

## 2.6 常用查询模式

### 2.6.1 获取胶卷及其照片
```sql
SELECT r.*, 
       COUNT(p.id) as photo_count,
       GROUP_CONCAT(t.name) as tags
FROM rolls r
LEFT JOIN photos p ON p.roll_id = r.id
LEFT JOIN photo_tags pt ON pt.photo_id = p.id
LEFT JOIN tags t ON t.id = pt.tag_id
WHERE r.id = ?
GROUP BY r.id;
```

### 2.6.2 按标签搜索照片
```sql
SELECT DISTINCT p.*
FROM photos p
JOIN photo_tags pt ON pt.photo_id = p.id
JOIN tags t ON t.id = pt.tag_id
WHERE t.name = ?;
```

### 2.6.3 统计数据
```sql
SELECT 
  COUNT(DISTINCT r.id) as total_rolls,
  COUNT(p.id) as total_photos,
  SUM(r.purchase_cost + r.develop_cost) as total_cost
FROM rolls r
LEFT JOIN photos p ON p.roll_id = r.id;
```
