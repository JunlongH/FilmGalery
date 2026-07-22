# 01 · 现状分析

> 基于对 `/home/juno/FilmGallery` 代码库的探索（2026-07-22）。

## 1. 地图服务架构

**多 provider 切换架构**，三层各自独立：

| 层 | 默认 (osm) | 可选 (amap) |
|---|---|---|
| 瓦片 | CARTO/OSM + ESRI 卫星 | 高德 `webrd0{s}.is.autonavi.com` / `webst0{s}.is.autonavi.com` |
| 正向 geocode (addr→coord) | Photon → Nominatim | AMap REST `restapi.amap.com/v3/geocode/geo` |
| 逆向 geocode (coord→addr) | Photon reverse → Nominatim reverse | AMap REST `restapi.amap.com/v3/geocode/regeo` |
| 手机/手表 逆向 | BigDataCloud（免费、无 key） | AMap REST |

**渲染库**：
- 桌面：`leaflet` ^1.9.4 + `react-leaflet` ^4.2.1 + `react-leaflet-cluster` + 可选 3D `react-globe.gl`
- 手机：自定义 WebView-Leaflet（`mobile/src/components/map/LeafletMap.tsx` + `leafletHtml.ts` + vendored Leaflet 1.9.4），**未使用 `react-native-maps`**

**坐标系**：DB 存 WGS-84；AMap API/瓦片用 GCJ-02；在所有 AMap 边界处通过 `packages/shared/coordTransform.js` 转换。

**API Key 配置**：
- **无 env var**。配置存在客户端存储，由 Settings UI 管理：
  - 桌面：`localStorage['map_provider']`（`'osm'|'amap'`）、`localStorage['amap_web_key']`
  - 手机：`AsyncStorage.getItem('map_provider')`、`AsyncStorage.getItem('amap_key')`
- 设置 UI：`client/src/components/Settings/MapSettings.jsx`
- 不需要 key 的 provider：BigDataCloud、Photon、Nominatim（限速 1 req/s）、CARTO/OSM/ESRI 瓦片

## 2. 后端地图/位置端点

路由挂载：`server/server.js:255` — `app.use('/api/locations', cacheSeconds(300), require('./routes/locations'))`

**`server/routes/locations.js`（135 行）— 纯 CRUD，无 geocoding：**

| 端点 | 行号 | 说明 |
|---|---|---|
| `GET /api/locations` | 32-115 | 搜索/列表本地 `locations` 表，支持 `country`/`query`/`hasRecords`/`withCounts`/`includeUserCities` |
| `GET /api/locations/countries` | 7-16 | 去重国家列表 |
| `GET /api/locations/:id` | 18-29 | 单条 |
| `POST /api/locations` | 117-133 | **地址→经纬度写入路径**：客户端先 geocode，把 `city_lat`/`city_lng` POST 上来 |

**其他相关端点：**
- `GET /api/photos/geo`（`server/routes/photos.js:1466-1556`）— 返回带坐标的照片供地图渲染
- `PUT /api/photos/:id`（`photos.js:436+`）— 写 photo 的 `location_id`/`detail_location`/`latitude`/`longitude`/`altitude`/`location_name`/`country`/`city`
- `PUT /api/film-items/:id`（`server/routes/film-items.js:189-204`）— 写 `shot_logs`（TEXT 列存 JSON 字符串）
- `GET /api/stats/locations`（`stats.js:319-367`）— 统计页城市聚合

**关键事实：服务端零 geocoding 代码**。正向和逆向 geocoding 全在客户端。

## 3. 数据库 Schema（`server/utils/schema-migration.js`）

```sql
-- :105-113
CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT, country_name TEXT, city_name TEXT,
  city_lat REAL, city_lng REAL,
  UNIQUE(country_code, city_name)
);

-- :114-120  roll 与 location 多对多
CREATE TABLE roll_locations (
  roll_id INTEGER, location_id INTEGER,
  PRIMARY KEY(roll_id, location_id),
  FOREIGN KEY (roll_id) REFERENCES rolls(id),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

-- :238, 241-270  photos 表 ALTER 添加的位置列
location_id INTEGER, detail_location TEXT,
latitude REAL, longitude REAL, altitude REAL,
location_name TEXT, country TEXT, city TEXT
-- 索引 idx_photos_location on photos(location_id)  :317

-- shot_logs 不是独立表，是 film_items.shot_logs TEXT 列（:157）存 JSON 字符串
```

## 4. 桌面 Photo Detail Modal

**文件**：`client/src/components/PhotoDetailsSidebar.jsx`（748 行）

**形态**：右侧滑入 `<aside>` 面板（420px 宽），**不是居中 modal**。

**Props**：`{ photo, photos, roll, onClose, onSaved }`（`photos` 数组时为批量编辑模式）

**打开方式**：父组件 `useState` + 条件渲染（无 portal、无 Context、无 Zustand）
- `RollDetail.jsx:536-548`：批量编辑
- `ImageViewer.jsx:561-569`：单张编辑

**关闭**：4 种 — 遮罩点击 / × 按钮 / Cancel 按钮 / Esc 键（200ms 退出动画）

**位置区域**（:435-540）：
1. Country/City — `<LocationInput>`（DB 支持的 `<datalist>` 自动完成）
2. 「Fill Coordinates」按钮 — 仅当所选城市有 `city_lat`/`city_lng` 时显示
3. Latitude/Longitude — 两个 `<input type="number">`，**无地图、无微调按钮、无逆向 geocode 按钮**
4. Detail Location — `<GeoSearchInput>`（地址搜索下拉）

**保存**：`PUT /api/photos/:id`，只提交 dirty 字段。`FIELD_GROUPS.location = ['location_id','country','city','detail_location','latitude','longitude']`

**关键：sidebar 内无任何地图渲染**。整个桌面客户端唯一的地图 UI 在 `pages/MapPage.jsx`（全页）。

**CSS 风格**：用 `fg-*` 自定义类（`fg-input`/`fg-btn`/`fg-sidepanel`/`fg-label`/`fg-section-header`，定义在 `client/src/styles/forms.css` 与 `sidebar.css`），**非 HeroUI**。但项目其他 modal（`EquipmentEditModal`/`ContactSheetModal` 等）用 `GlassModal`（HeroUI）。

## 5. 桌面 Shot Log 增加/修改

**文件**：`client/src/components/ShotLogModal.jsx`（1668 行）

**形态**：HeroUI Modal，由 `FilmLibrary.jsx` 懒加载（`lazyModal(() => import('./ShotLogModal'))`）

**结构**：
- Quick-Add 表单（:977-1221）— 顶部内联表单
- `EntryEditModal` 子组件（:17-277）— 编辑单条已有条目
- 日历视图 / 列表视图 / 统计

**位置字段（每条 5 个）**：`country`（text+datalist）、`city`（text+datalist）、`detail_location`（`GeoSearchInput`）、`latitude`、`longitude`（number input）

**地理位置回调**：
```js
// ShotLogModal.jsx:753-759
const handleGeoSelect = (result) => {
  setNewLatitude(result.latitude);
  setNewLongitude(result.longitude);
  if (result.country) setNewCountry(result.country);
  if (result.city) setNewCity(result.city);
  if (result.detail) setNewDetail(result.detail);
};

// :762-775  当无精确地址搜索时，用 getCityCoordinates(country, city) 兜底
const handleAutoFillCoordinates = async () => {
  if (newLatitude && newLongitude) return;
  if (!newCountry && !newCity) return;
  const coords = await getCityCoordinates(newCountry, newCity);
  if (coords) { setNewLatitude(coords.latitude); setNewLongitude(coords.longitude); }
};
```

**数据模型**：`shot_logs` 是 `film_items` 表的 TEXT 列，存 JSON 字符串数组。每条 13 字段：`date, shot_time, count, lens, focal_length, aperture, shutter_speed, country, city, detail_location, latitude, longitude, caption`

**位置是可选的**——`handleAdd` 守卫只检查 `date` 和 `count > 0`。

**保存**：`PUT /api/film-items/:id` body `{ shot_logs: JSON.stringify(logs) }`

**与照片的关联**：在 `NewRollForm.jsx` 创建 roll 时，用户通过 `ShotLogMapper` 把文件映射到日志条目，**字段被复制**到每张照片的 metadata。无 DB 外键。

## 6. 手机端

### Photo View
**文件**：`mobile/src/screens/viewing/PhotoViewScreen.tsx`（356 行）
- 全屏 modal（`presentation: 'fullScreenModal'`）
- 基于 `react-native-image-viewing`，支持滑动、负片切换、收藏、备注、标签编辑
- **位置数据只读**（无编辑入口）

### Shot Log
**文件**：`mobile/src/screens/shooting/ShotLogScreen.tsx`（969 行）
- 全屏 modal
- 完整 CRUD：FlatList 列表 + 底部添加表单
- 位置字段：`country`/`city`（TextInput + chip list）、`detail_location`（free text）、`latitude`/`longitude`（**仅显示**，来自 GPS）
- GPS 自动捕获：`locationService.native.ts`（557 行）
  - 策略：cache → Expo `getLastKnownPositionAsync` → `@react-native-community/geolocation` → `watchPositionAsync`
  - 逆向 geocoding：AMap → `@filmgallery/shared/geocode` `reverseGeocodeBigDataCloud` → Expo `Location.reverseGeocodeAsync`
- **无地图点选入口**

### Map Screen
**文件**：`mobile/src/screens/map/MapScreen.tsx`
- `GET /api/photos/geo` → 网格聚类 → `LeafletMap`（WebView）
- WGS-84→GCJ-02（amap 时）转换
- 点击 marker → 照片卡片 → 跳转 `PhotoView`

### 导航 & UI
- **导航**：React Navigation 6（`@react-navigation/native` ^6.1.9 + `native-stack` ^6.9.17 + `bottom-tabs` ^6.0.0）。**非 Expo Router**
- **UI 库**：`react-native-paper` ^5.11.1
- **API 客户端**：用 `@filmgallery/api-client`（共享包），通过 `mobile/src/api/client.ts` 的 Proxy 模式支持运行时切换 baseUrl
- **地图**：自定义 WebView-Leaflet（`LeafletMap.tsx` + `leafletHtml.ts` + `leafletVendor.ts` vendored），通过 `postMessage`/`onMessage` 通信（`UPDATE_PHOTOS`/`CENTER_MAP`/`MAP_READY`/`MARKER_PRESS`）

## 7. 共享包现状

| 包 | 用途 | 被消费方 |
|---|---|---|
| `@filmgallery/types` | TS 类型（`Film`/`Photo`/`Location`/`ShotLog`/`GeocodeResult`/`ReverseGeocoder` 等） | mobile + watch-app（桌面是 `.jsx` 不导入） |
| `@filmgallery/shared` | 通用库：`coordTransform`、`geocode`（BigDataCloud）、FilmLab 处理管线、常量 | mobile + watch + 桌面（FilmLab 部分） |
| `@filmgallery/api-client` | typed HTTP 客户端工厂（`createApiClient` + 各资源 namespace） | **仅 mobile + watch**；桌面有自己的 `client/src/api/core.js` |
| `@filmgallery/libraw-native` | 原生 LibRaw 绑定 | server / Electron |

**`@filmgallery/shared/geocode.js`**（90 行）— BigDataCloud 逆向 geocode 提供方：
- `reverseGeocodeBigDataCloud(lat, lng, opts)` — `AbortController` 超时（默认 5s）
- `normalizeBigDataCloud(data, lat, lng)` — 映射到 `GeocodeResult`
- URL：`https://api.bigdatacloud.net/data/reverse-geocode-client`（免费、无 key）
- 被 mobile `locationService.native.ts:14` 使用；**桌面未使用**

**`@filmgallery/shared/coordTransform.js`** — `wgs84ToGcj02`/`gcj02ToWgs84`/`isInChina`
- 被桌面 `PhotoMap.jsx:20`、`geocoding.js:12` 和手机 `locationService.native.ts:13`、`MapScreen.tsx:34` 使用

**`@filmgallery/types/index.d.ts:140-153`** — `GeocodeResult` 契约：
```ts
export interface GeocodeResult {
  displayName: string; country: string; city: string; state: string;
  latitude: number; longitude: number;
}
```
字符串字段**永不 undefined**（失败时为空串，坐标永远 echo 输入）。

## 8. 关键问题与不一致

### 8.1 API 契约不一致
- `client/src/api/metadata.js:22-25` 调用 `/api/locations/search` —— **服务端不存在该端点**（实际是 `GET /api/locations?query=...`）。死代码。
- `packages/@filmgallery/api-client/locations.js` 声明 `update(id, data)` 和 `delete(id)` —— **服务端未实现 `PUT /:id` / `DELETE /:id`**。

### 8.2 geocoding 实现三处重复
- 桌面 `client/src/utils/geocoding.js`（377 行）— AMap/Photon/Nominatim，**不使用 `GeocodeResult` 契约**
- 共享 `packages/shared/geocode.js` — 仅 BigDataCloud 逆向
- 手机 `mobile/src/services/locationService.native.ts` — AMap/BigDataCloud/Expo 三层
- 三处 provider 链重叠但不一致；共享 `geocode.js` 为 mobile+watch 而建，桌面未迁移。

### 8.3 lat/lng 范围校验缺失
- 客户端：`Number.isFinite` 检查存在，但**无 -90..90 / -180..180 范围校验**。
- 服务端：`PUT /api/photos/:id` 和 `PUT /api/film-items/:id`（shot_logs JSON）**完全不做校验**，原样写入。
- 也不强制 lat/lng 成对出现。

### 8.4 桌面 photo detail 缺少逆向 geocode
- `client/src/utils/geocoding.js:327-369` 有 `reverseGeocode(lat, lng)` 导出，但 `PhotoDetailsSidebar` **没有使用它**——有坐标时无法反查地址。

### 8.5 遗留/死代码
- `client/src/components/PhotoMetaEditModal.jsx`（325 行）—— 旧版居中 modal 编辑器，**未被任何文件 import**，已被 `PhotoDetailsSidebar` 取代。其内部有 lat/lng `+/-` 微调按钮（:146-158）——思路可借鉴。

## 9. 现有可复用资产

### 桌面地图组件（`client/src/components/map/`）
| 文件 | 作用 |
|---|---|
| `PhotoMap.jsx`（637 行） | 主 Leaflet 地图，瓦片切换，2D/3D 切换。已有 `FitBoundsToPhotos`（:296-315）和 `MapEventHandler`（:248-271）演示 `useMap`/`useMapEvents` 模式 |
| `PhotoMarker.jsx` | Leaflet marker |
| `PhotoGlobe.jsx` | 3D 地球（`react-globe.gl`） |
| `MapPhotoPreview.jsx` | marker 弹出预览 |
| `MapFilterPanel.jsx` | 地图页过滤侧栏 |

### 通用 UI
- `GlassModal`（`client/src/components/ui/GlassModal.jsx`）— HeroUI Modal 封装，blur 背景 + framer-motion
- `lazyModal`（`client/src/components/common/lazyModal`）— 代码分割懒加载 modal
- `GeoSearchInput`（`client/src/components/GeoSearchInput.jsx`）— 地址搜索下拉，已复用

### 共享
- `@filmgallery/shared/coordTransform` — 坐标转换
- `@filmgallery/shared/geocode` — BigDataCloud 逆向
- `@filmgallery/types` `GeocodeResult` — 契约
- `@filmgallery/api-client/locations` — typed locations API
