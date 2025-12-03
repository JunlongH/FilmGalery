# 3. 后端 API

## 3.1 API 基础

### 3.1.1 服务器配置
- **端口：** 4000（默认）
- **基础路径：** `/api`
- **数据格式：** JSON
- **文件上传：** Multipart/form-data

### 3.1.2 通用响应格式

**成功响应：**
```json
{
  "ok": true,
  "data": { /* 返回数据 */ }
}
```

**错误响应：**
```json
{
  "error": "错误信息描述"
}
```

**HTTP 状态码：**
- `200` - 成功
- `400` - 请求参数错误
- `404` - 资源不存在
- `500` - 服务器内部错误

## 3.2 Films API (胶片类型)

### GET `/api/films`
获取所有胶片类型。

**响应：**
```json
[
  {
    "id": 1,
    "name": "Kodak Portra 400",
    "iso": 400,
    "format": "135",
    "type": "彩色",
    "category": "负片",
    "thumbPath": "/uploads/films/portra400.jpg"
  }
]
```

### GET `/api/films/:id`
获取单个胶片详情。

### POST `/api/films`
创建新胶片类型。

**请求体：**
```json
{
  "name": "富士 Pro 400H",
  "iso": 400,
  "format": "135",
  "type": "彩色"
}
```

### PUT `/api/films/:id`
更新胶片类型。

### DELETE `/api/films/:id`
删除胶片类型。

## 3.3 Film Items API (胶片库存)

### GET `/api/film-items`
获取胶片库存列表。

**查询参数：**
- `status` - 筛选状态：`in_stock|loaded|shot|sent_to_lab|developed|archived`
- `limit` - 分页限制（默认 100）
- `offset` - 分页偏移

**响应：**
```json
{
  "items": [
    {
      "id": 1,
      "film_id": 5,
      "status": "in_stock",
      "purchase_date": "2025-11-01",
      "purchase_cost": 45.00,
      "film": {
        "name": "Kodak Portra 400",
        "iso": 400
      }
    }
  ],
  "total": 25
}
```

### GET `/api/film-items/:id`
获取单个库存详情。

### POST `/api/film-items`
添加新库存。

**请求体：**
```json
{
  "film_id": 5,
  "purchase_date": "2025-11-01",
  "purchase_cost": 45.00,
  "purchase_channel": "淘宝"
}
```

### PUT `/api/film-items/:id`
更新库存信息。

### PUT `/api/film-items/:id/status`
更新库存状态。

**请求体：**
```json
{
  "status": "loaded",
  "loaded_camera": "Nikon F3",
  "loaded_date": "2025-11-15"
}
```

### DELETE `/api/film-items/:id`
软删除库存（设置 `deleted_at`）。

## 3.4 Rolls API (胶卷)

### GET `/api/rolls`
获取胶卷列表。

**查询参数：**
- `limit` - 限制数量（默认 50）
- `offset` - 偏移量
- `sort` - 排序：`date|seq` (默认 seq)

**响应：**
```json
[
  {
    "id": 1,
    "title": "秋日京都",
    "start_date": "2025-10-01",
    "end_date": "2025-10-05",
    "camera": "Nikon F3",
    "lens": "50mm f/1.4",
    "photographer": "张三",
    "film_type": "Kodak Portra 400",
    "exposures": 36,
    "cover_photo": "/uploads/rolls/1/cover.jpg",
    "photo_count": 32,
    "locations": ["京都", "大阪"],
    "gear": {
      "cameras": ["Nikon F3"],
      "lenses": ["50mm f/1.4", "28mm f/2.8"]
    }
  }
]
```

### GET `/api/rolls/:id`
获取胶卷详情及所有照片。

**响应：**
```json
{
  "roll": { /* 胶卷信息 */ },
  "photos": [
    {
      "id": 1,
      "frame_number": 1,
      "full_rel_path": "/uploads/rolls/1/001.jpg",
      "thumb_rel_path": "/uploads/rolls/1/thumbs/001.jpg",
      "rating": 4,
      "tags": ["风景", "街拍"],
      "date_taken": "2025-10-01"
    }
  ],
  "locations": [ /* 地点列表 */ ],
  "gear": { /* 设备列表 */ }
}
```

### POST `/api/rolls`
创建新胶卷。

**请求体：**
```json
{
  "title": "春日樱花",
  "film_item_id": 5,
  "start_date": "2025-03-20",
  "camera": "Nikon F3",
  "lens": "50mm f/1.4",
  "photographer": "张三",
  "filmId": 3,
  "exposures": 36
}
```

### PUT `/api/rolls/:id`
更新胶卷信息。

### DELETE `/api/rolls/:id`
删除胶卷（同时删除关联的照片文件）。

### PUT `/api/rolls/:id/cover`
设置封面照片。

**请求体：**
```json
{
  "cover_photo": "/uploads/rolls/1/005.jpg"
}
```

### PUT `/api/rolls/:id/resequence`
重新计算 display_seq。

## 3.5 Photos API (照片)

### GET `/api/photos`
获取照片列表（支持多种筛选）。

**查询参数：**
- `roll_id` - 按胶卷筛选
- `rating` - 按评分筛选
- `tag` - 按标签筛选
- `date_from` - 开始日期
- `date_to` - 结束日期
- `location_id` - 按地点筛选
- `limit` - 限制数量
- `offset` - 偏移量

### GET `/api/photos/:id`
获取单张照片详情。

### PUT `/api/photos/:id`
更新照片元数据。

**请求体：**
```json
{
  "frame_number": 5,
  "caption": "京都街头",
  "rating": 4,
  "tags": ["街拍", "人文"],
  "date_taken": "2025-10-01",
  "time_taken": "14:30:00",
  "camera": "Nikon F3",
  "lens": "50mm f/1.4",
  "photographer": "张三",
  "location_id": 12,
  "detail_location": "清水寺附近",
  "latitude": 34.9948,
  "longitude": 135.7850
}
```

### DELETE `/api/photos/:id`
删除照片（同时删除文件）。

### POST `/api/photos/:id/update-positive`
上传/更新正片图片。

**请求：** Multipart/form-data
```
image: File
```

### POST `/api/photos/:id/update-negative`
上传/更新负片图片。

### GET `/api/photos/favorites`
获取收藏照片（rating >= 4）。

### GET `/api/photos/calendar`
获取按日期聚合的照片（用于日历视图）。

**响应：**
```json
[
  {
    "date": "2025-10-01",
    "count": 12,
    "preview": "/uploads/rolls/1/001.jpg"
  }
]
```

## 3.6 Tags API (标签)

### GET `/api/tags`
获取所有标签。

**响应：**
```json
[
  {
    "id": 1,
    "name": "风景",
    "count": 156
  },
  {
    "id": 2,
    "name": "街拍",
    "count": 89
  }
]
```

### GET `/api/tags/:tagName/photos`
获取标签下的所有照片。

## 3.7 Locations API (地理位置)

### GET `/api/locations`
获取所有地点。

**响应：**
```json
[
  {
    "id": 1,
    "country_name": "日本",
    "city_name": "京都",
    "city_lat": 35.0116,
    "city_lng": 135.7681,
    "photo_count": 45
  }
]
```

### GET `/api/locations/:id/photos`
获取地点的所有照片。

### POST `/api/locations`
添加新地点。

**请求体：**
```json
{
  "country_code": "JP",
  "country_name": "日本",
  "city_name": "京都",
  "city_lat": 35.0116,
  "city_lng": 135.7681
}
```

## 3.8 Stats API (统计)

### GET `/api/stats`
获取系统统计数据。

**响应：**
```json
{
  "total_rolls": 45,
  "total_photos": 1580,
  "total_films": 12,
  "avg_photos_per_roll": 35.11,
  "total_cost": 4580.50,
  "avg_cost_per_roll": 101.79,
  "top_cameras": [
    { "name": "Nikon F3", "count": 25 }
  ],
  "top_lenses": [
    { "name": "50mm f/1.4", "count": 30 }
  ],
  "top_photographers": [
    { "name": "张三", "count": 40 }
  ],
  "rolls_by_month": [
    { "month": "2025-10", "count": 5 }
  ],
  "photos_by_month": [
    { "month": "2025-10", "count": 180 }
  ]
}
```

### GET `/api/stats/timeline`
获取时间线统计（按年月汇总）。

## 3.9 Uploads API (文件上传)

### POST `/api/uploads/roll`
上传胶卷照片（批量）。

**请求：** Multipart/form-data
```
roll_id: number
photos: File[]
```

**响应：**
```json
{
  "uploaded": 24,
  "failed": 0,
  "photos": [ /* 照片列表 */ ]
}
```

### POST `/api/uploads/film-thumb`
上传胶片类型缩略图。

## 3.10 Search API (搜索)

### GET `/api/search`
全局搜索。

**查询参数：**
- `q` - 搜索关键词
- `type` - 搜索类型：`all|rolls|photos|tags`

**响应：**
```json
{
  "rolls": [ /* 匹配的胶卷 */ ],
  "photos": [ /* 匹配的照片 */ ],
  "tags": [ /* 匹配的标签 */ ]
}
```

## 3.11 Presets API (预设)

### GET `/api/presets`
获取所有编辑预设。

### POST `/api/presets`
保存新预设。

**请求体：**
```json
{
  "name": "胶片风格",
  "params": {
    "contrast": 1.2,
    "saturation": 0.9,
    "grain": 0.3
  }
}
```

### DELETE `/api/presets/:id`
删除预设。

## 3.12 Health API (健康检查)

### GET `/api/health`
服务器健康检查。

**响应：**
```json
{
  "status": "ok",
  "database": "connected",
  "uptime": 86400
}
```

## 3.13 错误处理

所有 API 统一错误处理：

```javascript
try {
  // 业务逻辑
} catch (err) {
  console.error('[API] Error:', err);
  res.status(500).json({ error: err.message });
}
```

常见错误：
- `SQLITE_CONSTRAINT` - 数据库约束冲突
- `ENOENT` - 文件不存在
- `Validation failed` - 参数验证失败
