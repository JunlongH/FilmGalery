# 07 · 衍生功能

按**价值 / 工作量**分级。Tier 1 与 LocationPicker 同期交付；Tier 2-3 后续迭代。

## Tier 1 — 高价值、低工作量（同期交付）

### 1.1 逆向地理编码按钮

**位置**：桌面 `PhotoDetailsSidebar.jsx`、桌面 `ShotLogModal.jsx`、手机 `ShotLogScreen.tsx`

**场景**：当 lat/lng 已有值（GPS 或手填）时，点「🔄 反查地址」一键填充 `detail_location` / `country` / `city`。

**实现**：调共享 `reverseGeocode(lat, lng, { provider, amapKey })`，结果填入字段。`reverseGeocode` 永不抛错（失败返回空字段）。

**价值**：解决现状「`reverseGeocode` 工具已有但 `PhotoDetailsSidebar` 未使用」的遗留问题。

**工作量**：1-2h（含三处集成）

---

### 1.2「使用我的 GPS 位置」按钮

**位置**：桌面 `LocationPickerModal`、手机 `LocationPickerScreen`

**场景**：用户在地图选择器内一键定位到当前位置。

**实现**：
- 桌面：`navigator.geolocation.getCurrentPosition`（Electron 支持）
- 手机：复用 `locationService.native.ts` 的 GPS 获取链，导出 `getCurrentPosition()`

**价值**：桌面首次有 GPS 入口；手机补充「GPS 不可用时手选」之外的快捷路径。

**工作量**：1-2h

---

### 1.3 lat/lng 范围校验

**位置**：所有写入 lat/lng 的入口（桌面 sidebar / shot log modal、手机 shot log screen / photo view、服务端 `PUT /api/photos/:id` / `PUT /api/film-items/:id` / `POST,PUT /api/locations`）

**场景**：防止用户输入 `latitude: 200` 等无效值入库。

**实现**：
- 共享 `isValidLatitude` / `isValidLongitude` / `isValidLatLng`（在 `@filmgallery/shared/mapUtils`）
- 客户端：输入框 `fg-input-error` 红框 + 确认按钮禁用
- 服务端：拒绝并返回 400（详见 [04-backend.md](./04-backend.md) 2.3）

**价值**：补全当前完全缺失的校验，防止脏数据。

**工作量**：2-3h（共享校验函数已计入 03）

---

### 1.4 坐标微调按钮（桌面）

**位置**：桌面 `PhotoDetailsSidebar.jsx` 的 lat/lng 输入框旁

**场景**：用户想微调坐标（如 GPS 略有偏差），用 ±0.0001 按钮精细调整。

**实现**：借鉴已废弃的 `PhotoMetaEditModal.jsx:146-158`，每个输入框两侧加 `−` / `+` 按钮，步长 0.0001（约 11 米，与旧版一致）。

**价值**：恢复被废弃代码中有用但被丢失的功能。

**工作量**：1h

## Tier 2 — 中价值、中工作量（短期迭代）

### 2.1 地图缩略图预览

**位置**：桌面 `PhotoDetailsSidebar.jsx` 位置区域顶部、桌面 `ShotLogModal.jsx` 每条 entry 卡片、手机 shot log 条目

**场景**：当坐标已存在时，展示一个非交互的小地图（120×120px），让用户直观看到位置。

**实现**：
- 桌面：`react-leaflet` 的 `MapContainer` 加 `interactive={false}` `zoomControl={false}` `dragging={false}` `scrollWheelZoom={false}`，只渲染一个 marker
- 手机：复用 `LeafletMap`，加 `mode="preview"`（只渲染单 marker，禁用交互），或用静态地图图片（避免 WebView 开销）

**变通**：手机用静态地图图片更省资源（OpenStreetMap Static Map API 或 AMap 静态图 API）。但引入新 API 依赖。**推荐先只在桌面做缩略图，手机保持文字坐标显示**。

**价值**：提升位置数据的可读性。

**工作量**：桌面 2-3h；手机静态图方案 3-4h（含 API 选型）

---

### 2.2 最近使用位置快捷选择

**位置**：`LocationPickerModal` / `LocationPickerScreen` 顶部

**场景**：用户经常重复去同一批地点，快捷选择最近用过的位置。

**实现**：
- **纯客户端方案（推荐）**：每次 picker `onConfirm` 后，把 value 存 `localStorage['recent_locations']` / `AsyncStorage` 的数组（最多 10 条，去重）
- picker 打开时显示最近位置的 chip 列表，点击直接填入
- 不需要后端改动

**替代方案**：`GET /api/locations/recent`（详见 [04-backend.md](./04-backend.md) 2.4），返回被照片引用最多的 location。但只能到城市级，不到精确坐标。客户端方案更灵活。

**价值**：减少重复点选，提升体验。

**工作量**：2h

---

### 2.3 坐标格式切换（十进制 / 度分秒）

**位置**：桌面 `PhotoDetailsSidebar.jsx`、桌面 `ShotLogModal.jsx`

**场景**：摄影爱好者有时记录 DMS 格式（如 `39°54'27.6"N`）。

**实现**：
- 共享 `formatLatLng(lat, lng, 'decimal' | 'dms')` 在 `mapUtils`
- 显示标签加切换按钮，DB 仍存十进制
- 输入框保持十进制（避免解析复杂），仅显示层切换

**价值**：小众需求，但对部分用户友好。

**工作量**：1-2h

---

### 2.4 手机 `PhotoViewScreen` 位置编辑入口

**位置**：手机 `PhotoViewScreen.tsx`

**场景**：当前手机照片位置只读，加「编辑位置」action。

**实现**：详见 [06-mobile.md](./06-mobile.md) 第 6 节。

**价值**：补齐手机端照片位置编辑能力。

**工作量**：2h

## Tier 3 — 中长期演进

### 3.1 服务端 geocoding 代理

**详见** [04-backend.md](./04-backend.md) Phase 2。

**价值**：
- 隐藏 AMap key（安全）
- 规避 CORS / 网络问题
- 集中限流
- 支持未来批量 geocoding（如 CSV 导入 shot log 时批量解析地址）

**工作量**：4-6h（含 env var、capability 检测、客户端 fallback）

---

### 3.2 Shot Log 路径地图

**位置**：桌面 `ShotLogModal.jsx` 新增 tab、或独立 `ShotLogPathMap` 组件

**场景**：一个 film item 的多条 shot log entry 在地图上按日期串联，形成拍摄路径。

**实现**：
- 复用 `LocationPicker` 的 `MapContainer`，或独立组件
- 按 entry.date 排序，用 `react-leaflet` 的 `Polyline` 连接有坐标的 entries
- 每个点用 numbered marker（L1, L2, ...）
- 点击 marker 弹出 entry 详情卡片

**价值**：可视化拍摄轨迹，对旅行/采风摄影有吸引力。

**工作量**：4-6h

---

### 3.3 收藏位置

**位置**：`LocationPickerModal` 顶部「⭐ 收藏」按钮 + 收藏列表

**场景**：用户常去一些城市级以下的精确地点（如某机位），希望保存复用。

**实现**：
- 新建 `favorite_locations` 表（`id, name, latitude, longitude, country, city, detail_location, created_at`）
- 或纯客户端存储（`localStorage` / `AsyncStorage`），跨设备不同步
- picker 内可「保存当前为收藏」+「从收藏选择」

**与 `locations` 表的区别**：`locations` 是城市级（用于 roll 级标签），`favorite_locations` 是精确坐标级（用于 picker 快速跳转）。

**价值**：常去拍摄点的快速复用。

**工作量**：4-5h（含 DB schema + CRUD 端点 + UI）

---

### 3.4 在 `MapPage` 上拖动 marker 修改照片位置

**位置**：桌面 `pages/MapPage.jsx` + `PhotoMap.jsx`

**场景**：用户在主地图页浏览照片时，直接拖动 marker 到新位置 → 弹出确认 → `PUT /api/photos/:id` 更新坐标。

**实现**：
- `PhotoMarker.jsx` 加 `draggable` 选项
- 拖动结束 → 弹出 `GlassModal` 确认框（显示新坐标 + 逆向 geocode 结果）
- 确认 → `updatePhoto(id, { latitude, longitude, ... })` + React Query invalidate

**价值**：批量修正位置时无需进入每张照片的 sidebar。

**风险**：误拖可能污染数据。需明确「拖动 = 编辑」模式的开关（如长按或工具栏按钮进入编辑模式）。

**工作量**：6-8h

---

### 3.5 Roll 级位置编辑用地图

**位置**：桌面 `RollEditDrawer` / `NewRollForm` 的 `LocationSelect` 旁

**场景**：当前 roll 级位置用 `LocationSelect`（DB 城市级下拉），无法选精确坐标。可加「在地图上选」按钮，picker 返回后调 `POST /api/locations`（如有坐标）或直接关联已有城市。

**复杂点**：roll_locations 是 location_id 关联，而 picker 返回精确坐标。需决定：roll 是否支持精确坐标？当前 schema 不支持（roll_locations 只有 location_id）。

**决策**：暂不在 roll 级引入精确坐标。picker 在 roll 场景下仅作为「查找城市」的辅助（picker 返回 → 反查最近的城市 → 关联 location_id）。

**价值**：低（roll 级城市级已够用）。**不推荐短期实现**。

## Tier 4 — 未来探索（不在本计划范围）

- **绘制区域/路径**：shot log 支持在地图上画 polygon 标记拍摄区域
- **AR 取景框叠加位置信息**：手机拍摄时显示附近已标记的位置
- **地图图层叠加**：日出日落方向、天气、黄金时刻等摄影图层
- **跨设备位置同步**：通过服务端同步收藏位置 / 最近位置

## 优先级矩阵

| 功能 | 价值 | 工作量 | 优先级 |
|---|---|---|---|
| 1.1 逆向 geocode 按钮 | 高 | 低 | **P0** |
| 1.2 GPS 按钮 | 高 | 低 | **P0** |
| 1.3 lat/lng 校验 | 高 | 低 | **P0** |
| 1.4 微调按钮 | 中 | 低 | **P0** |
| 2.1 地图缩略图（桌面） | 中 | 中 | P1 |
| 2.2 最近位置 | 中 | 低 | P1 |
| 2.3 DMS 格式 | 低 | 低 | P2 |
| 2.4 手机 photo view 编辑 | 中 | 中 | P1 |
| 3.1 服务端 geocoding 代理 | 中 | 中 | P2 |
| 3.2 Shot log 路径地图 | 中 | 中 | P2 |
| 3.3 收藏位置 | 中 | 中 | P2 |
| 3.4 MapPage 拖动改位置 | 中 | 高 | P3 |
| 3.5 Roll 级地图选 | 低 | 高 | 不推荐 |
