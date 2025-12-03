# 5. 核心功能

## 5.1 胶片库存管理

### 5.1.1 生命周期状态
```
in_stock → loaded → shot → sent_to_lab → developed → archived
(库存)    (装填)   (拍完)    (送冲洗)     (已冲洗)    (已归档)
```

### 5.1.2 状态转换逻辑
```javascript
// server/routes/film-items.js
PUT /api/film-items/:id/status

const transitions = {
  in_stock: ['loaded'],
  loaded: ['shot'],
  shot: ['sent_to_lab'],
  sent_to_lab: ['developed'],
  developed: ['archived']
};
```

### 5.1.3 关联胶卷
当 film_item 状态变为 `shot` 时，可以创建 roll 并关联：

```javascript
// 创建胶卷时关联库存
POST /api/rolls
{
  "film_item_id": 5,
  "title": "春日樱花",
  // ...其他字段
}

// 自动更新 film_item.roll_id 和状态
```

## 5.2 标签系统

### 5.2.1 标签规范化
所有标签**强制小写存储**，避免重复：

```javascript
// server/services/tag-service.js
const normalizeTagNames = (input) => {
  const seen = new Set();
  const result = [];
  
  for (const raw of input) {
    const lower = String(raw).trim().toLowerCase();
    if (lower && !seen.has(lower)) {
      seen.add(lower);
      result.push(lower);
    }
  }
  return result;
};
```

### 5.2.2 保存流程
```javascript
async function savePhotoTags(photoId, rawNames) {
  // 1. 规范化标签名（小写、去重）
  const names = normalizeTagNames(rawNames);
  
  // 2. 删除旧关联
  await PreparedStmt.runAsync('photo_tags.deleteByPhoto', [photoId]);
  
  // 3. 确保标签存在（INSERT OR IGNORE）
  for (const name of names) {
    await PreparedStmt.runAsync('tags.insert', [name]);
  }
  
  // 4. 查询标签 ID
  const tags = await allAsync(
    `SELECT id, name FROM tags WHERE name IN (${placeholders})`,
    names
  );
  
  // 5. 创建新关联
  await Promise.all(
    tags.map(tag => 
      PreparedStmt.runAsync('photo_tags.insert', [photoId, tag.id])
    )
  );
  
  // 6. 清理孤立标签（非阻塞）
  runAsync('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM photo_tags)')
    .catch(err => console.warn('Cleanup failed:', err));
}
```

### 5.2.3 客户端使用
```jsx
// 标签编辑
const [tags, setTags] = useState(['风景', '街拍']);

const handleSave = async () => {
  // 客户端也进行规范化（可选）
  const normalized = tags.map(t => t.toLowerCase());
  await updatePhoto(photoId, { tags: normalized });
};
```

## 5.3 地理位置管理

### 5.3.1 位置层级
```
Country (国家) → City (城市) → Detail Location (详细地点)
```

### 5.3.2 自动地理编码
根据城市坐标自动填充照片经纬度：

```javascript
// server/utils/db-helpers.js
async function validatePhotoUpdate(photoId, body) {
  if (body.location_id && !body.latitude) {
    // 从 locations 表获取城市坐标
    const loc = await getAsync(
      'SELECT city_lat, city_lng FROM locations WHERE id = ?',
      [body.location_id]
    );
    if (loc) {
      body.latitude = loc.city_lat;
      body.longitude = loc.city_lng;
    }
  }
  return body;
}
```

### 5.3.3 胶卷地点关联
一个胶卷可以有多个拍摄地点：

```javascript
// 自动添加地点到胶卷
if (photo.location_id) {
  await runAsync(
    'INSERT OR IGNORE INTO roll_locations (roll_id, location_id) VALUES (?, ?)',
    [photo.roll_id, photo.location_id]
  );
}
```

## 5.4 设备管理 (roll_gear)

### 5.4.1 智能去重
当更新照片的 camera/lens/photographer 时，自动添加到 roll_gear：

```javascript
// server/services/gear-service.js
async function addOrUpdateGear(rollId, type, value) {
  // 检查是否所有照片都使用同一设备
  const photos = await allAsync(
    'SELECT DISTINCT ?? FROM photos WHERE roll_id = ?',
    [type, rollId]
  );
  
  if (photos.length === 1 && photos[0][type] === value) {
    // 所有照片都用同一设备，更新 roll 表
    await runAsync(`UPDATE rolls SET ${type} = ? WHERE id = ?`, [value, rollId]);
  }
  
  // 添加到 roll_gear（自动去重）
  await runAsync(
    'INSERT OR IGNORE INTO roll_gear (roll_id, type, value) VALUES (?, ?, ?)',
    [rollId, type, value]
  );
}
```

### 5.4.2 获取设备列表
```javascript
// GET /api/rolls/:id 自动包含设备信息
{
  "roll": { /* ... */ },
  "gear": {
    "cameras": ["Nikon F3", "Leica M6"],
    "lenses": ["50mm f/1.4", "35mm f/2"],
    "photographers": ["张三", "李四"]
  }
}
```

## 5.5 照片编辑参数

### 5.5.1 参数保存
照片的编辑参数保存为 JSON：

```javascript
PUT /api/photos/:id
{
  "edit_params": {
    "contrast": 1.2,
    "saturation": 0.9,
    "brightness": 0.1,
    "grain": 0.3
  }
}
```

### 5.5.2 预设系统
保存常用编辑参数为预设：

```javascript
// 保存预设
POST /api/presets
{
  "name": "胶片风格",
  "params": { /* 编辑参数 */ }
}

// 应用预设到照片
PUT /api/photos/:id
{
  "edit_params": presets[0].params
}
```

## 5.6 文件上传与处理

### 5.6.1 单张照片上传
```javascript
// Multer 配置
const upload = multer({
  dest: 'uploads/temp/',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images allowed'));
    }
  }
});

POST /api/photos/:id/update-positive
Content-Type: multipart/form-data
```

### 5.6.2 批量上传
```javascript
POST /api/uploads/roll
Content-Type: multipart/form-data

roll_id: 5
photos: [File, File, File, ...]
```

### 5.6.3 图片处理 (Sharp)
自动生成缩略图：

```javascript
const sharp = require('sharp');

await sharp(inputPath)
  .resize(400, 400, { fit: 'inside' })
  .jpeg({ quality: 85 })
  .toFile(thumbPath);
```

## 5.7 统计分析

### 5.7.1 数字格式化
整数和小数分别处理：

```javascript
// client/src/components/Statistics.jsx
const formatStat = (num) => {
  if (!num && num !== 0) return '-';
  // 整数不显示小数点
  return Number.isInteger(num) ? num.toString() : num.toFixed(2);
};

// 示例：
// 10 → "10"
// 12.5 → "12.50"
// 35.11111 → "35.11"
```

### 5.7.2 时间线聚合
```javascript
// 按月聚合
SELECT 
  strftime('%Y-%m', date_taken) as month,
  COUNT(*) as count
FROM photos
WHERE date_taken IS NOT NULL
GROUP BY month
ORDER BY month;
```

### 5.7.3 成本统计
```javascript
SELECT 
  SUM(purchase_cost) as total_purchase,
  SUM(develop_cost) as total_develop,
  SUM(purchase_cost + develop_cost) as total_cost,
  AVG(purchase_cost + develop_cost) as avg_per_roll
FROM rolls;
```

## 5.8 搜索功能

### 5.8.1 全文搜索
```javascript
// 搜索胶卷
SELECT * FROM rolls 
WHERE title LIKE ? OR notes LIKE ?
   OR camera LIKE ? OR lens LIKE ?;

// 搜索照片
SELECT * FROM photos
WHERE caption LIKE ? OR notes LIKE ?;

// 搜索标签
SELECT * FROM tags WHERE name LIKE ?;
```

### 5.8.2 高级筛选
```javascript
GET /api/photos?rating=4&tag=风景&date_from=2025-01-01&date_to=2025-12-31
```

## 5.9 冲洗店管理 (FilmLab)

### 5.9.1 导出数据
生成 Excel 格式的冲洗单：

```javascript
GET /api/filmlab/export?roll_ids=1,2,3

// 返回包含以下字段的表格：
// - 帧号
// - 文件名
// - 相机
// - 镜头
// - 评分
// - 标签
```

### 5.9.2 批量操作
```javascript
// 标记为已送冲洗
POST /api/film-items/batch-status
{
  "ids": [1, 2, 3],
  "status": "sent_to_lab",
  "develop_lab": "XX冲印店"
}
```

## 5.10 冲突解决 (OneDrive)

### 5.10.1 自动检测冲突文件
```javascript
// server/conflict-resolver.js
function detectConflicts(dirPath) {
  const pattern = /-[A-Z0-9]{8}\.(db|db-wal|db-shm)$/;
  return fs.readdirSync(dirPath)
    .filter(f => pattern.test(f));
}
```

### 5.10.2 冲突合并策略
```javascript
// 1. 保留最新的文件（按修改时间）
// 2. 备份旧文件到 .backup/
// 3. 重启 WAL checkpoint
```

### 5.10.3 前端冲突提示
```jsx
// ConflictBanner.jsx
const { data: conflicts } = useQuery({
  queryKey: ['conflicts'],
  queryFn: () => fetch('/api/conflicts').then(r => r.json()),
  refetchInterval: 60000 // 每分钟检查
});

{conflicts?.length > 0 && (
  <Banner>发现 {conflicts.length} 个冲突文件，请处理</Banner>
)}
```
