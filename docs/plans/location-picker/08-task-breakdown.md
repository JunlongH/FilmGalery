# 08 · 任务拆解与验收标准

## 阶段总览

| 阶段 | 范围 | 依赖 | 工作量 |
|---|---|---|---|
| Phase A | 共享层抽取（types + geocoding + mapUtils） | 无 | ~13-15h |
| Phase B | 后端契约修复 + 校验 | Phase A（用 `mapUtils.isValid*`） | ~4h |
| Phase C | 桌面 LocationPicker + 集成 | Phase A | ~15-18h |
| Phase D | 手机 LocationPicker + 集成 | Phase A | ~16h（不含 Tier 2） |
| Phase E | Tier 1 衍生功能 | Phase C/D | ~5-7h |
| Phase F | Tier 2 衍生功能 | Phase C/D | ~8-10h |
| Phase G | Tier 3 服务端 geocoding 代理 | Phase A/B | ~4-6h |
| **总计** | | | **~65-80h**（Phase A-E 约 55-65h 为必做） |

> 工作量是粗估，含测试与调优。可并行：Phase C 与 Phase D 在 Phase A 完成后可并行。

## Phase A：共享层

### A1. 补充 `@filmgallery/types`
- [ ] 在 `packages/@filmgallery/types/index.d.ts` 新增 `MapProvider`、`LocationPickerValue`、`GeocodeConfig`、`SearchOptions`、`SearchResult`
- [ ] 迁移 `mobile/src/context/ApiContext.ts:3` 的 `MapProvider` 到 `@filmgallery/types`，改 re-export 保持兼容
- [ ] **验收**：`tsc --noEmit`（mobile）通过；桌面 `vite build` 不受影响

### A2. 实现 `@filmgallery/shared/geocoding`
- [ ] 新建 `packages/shared/geocoding.js`：从 `client/src/utils/geocoding.js` 抽取 `searchWithAmap`/`searchWithPhoton`/`searchWithNominatim`/`reverseWithAmap`/`reverseWithPhoton`/`reverseWithNominatim`，参数化 `{ provider, amapKey, signal, timeout }`
- [ ] 实现 `searchAddress(query, opts)` / `reverseGeocode(lat, lng, opts)` / `getCityCoordinates(country, city, opts)`，provider 链按 02 文档
- [ ] `reverseGeocode` 链尾追加 BigDataCloud 兜底（复用 `packages/shared/geocode.js`）
- [ ] 所有 AMap 边界处用 `coordTransform` 转换坐标
- [ ] 新建 `packages/shared/geocoding.d.ts`
- [ ] 新建 `packages/shared/__tests__/geocoding.test.js`：
  - mock fetch，验证 provider 链顺序与 fallback
  - 验证 AMap 边界坐标转换
  - 验证 `reverseGeocode` 永不抛错（全失败返回空 `GeocodeResult`）
  - 验证 Nominatim 限速
  - 验证 `AbortSignal` 超时
- [ ] **验收**：`jest packages/shared/__tests__/geocoding.test.js` 全绿

### A3. 实现 `@filmgallery/shared/mapUtils`
- [ ] 新建 `packages/shared/mapUtils.js`：
  - `MAP_PROVIDERS` 常量
  - `TILE_LAYERS` 配置（从 `PhotoMap.jsx:48-93` 抽取）
  - `buildTileLayerUrl(provider, style, { dark })`
  - `gridCluster(points, opts)`（从 `mobile/src/screens/map/MapScreen.tsx:174-221` 抽取）
  - `isValidLatitude` / `isValidLongitude` / `isValidLatLng`
  - `formatLatLng(lat, lng, 'decimal' | 'dms')`
- [ ] 新建 `packages/shared/mapUtils.d.ts`
- [ ] 新建 `packages/shared/__tests__/mapUtils.test.js`
- [ ] **验收**：单测全绿；`formatLatLng(39.90766, 116.39150, 'dms')` 输出 `"39°54'27.6\"N 116°23'29.4\"E"`

### A4. 更新 `packages/shared` 导出
- [ ] `packages/shared/package.json` 加 `"./geocoding"` 与 `"./mapUtils"` subpath exports
- [ ] `packages/shared/index.js` re-export 新模块
- [ ] **验收**：`node -e "require('@filmgallery/shared/geocoding').searchAddress"` 在 workspace 内可执行

### A5. 桌面 `geocoding.js` 改薄封装
- [ ] `client/src/utils/geocoding.js` 改为从 `@filmgallery/shared/geocoding` re-export `searchAddress`/`reverseGeocode`/`getCityCoordinates`
- [ ] 加 `getGeocodeConfig()` 便捷方法读 `localStorage` 返回 `{ provider, amapKey }`
- [ ] 保留旧导出签名（调用方零改动）
- [ ] **验收**：`GeoSearchInput`、`PhotoMap`、`ShotLogModal` 调用方无回归；桌面 `vite build` 通过

### A6. 手机 `locationService.native.ts` 接入共享 `reverseGeocode`
- [ ] 移除内联的 AMap/BigDataCloud 调用
- [ ] 改调 `@filmgallery/shared/geocoding` 的 `reverseGeocode`，配置从 `AsyncStorage` 读取
- [ ] 导出独立 `getCurrentPosition()`（只拿坐标，不做逆向 geocoding）
- [ ] 保留 Expo `Location.reverseGeocodeAsync` 作为设备端兜底（可在 `reverseGeocode` 链外保留）
- [ ] **验收**：手机 ShotLogScreen 的 GPS 自动捕获正常工作；逆向 geocoding 结果与改动前一致

## Phase B：后端契约修复 + 校验

### B1. 修复死代码
- [ ] 检查 `searchLocations` 在 `client/src/**` 的所有引用
- [ ] 删除 `client/src/api/metadata.js:22-25` 的 `searchLocations` 函数（或改为调 `getLocations({ query })`）
- [ ] **验收**：grep `searchLocations` 桌面源码无残留调用

### B2. 实现 `PUT/DELETE /api/locations/:id`
- [ ] `server/routes/locations.js` 加 `PUT /:id` 与 `DELETE /:id`（详见 04 文档 2.2）
- [ ] DELETE 检查 photos / roll_locations 引用，被引用时返回 409
- [ ] 新增单测 `server/__tests__/locations.test.js`（若有测试框架）或手工验证
- [ ] **验收**：`curl PUT` 与 `curl DELETE` 行为正确；`@filmgallery/api-client/locations` 的 `update`/`delete` 可用

### B3. lat/lng 校验
- [ ] `server/routes/photos.js` 的 `PUT /api/photos/:id`：校验 `latitude`/`longitude`（用 `mapUtils.isValidLatLng`）
- [ ] `server/services/film/film-item-service.js`：`shot_logs` JSON parse 后逐条校验
- [ ] `server/routes/locations.js` 的 `POST /` 与 `PUT /:id`：校验 `city_lat`/`city_lng`
- [ ] **验收**：`curl PUT /api/photos/:id -d '{"latitude": 200}'` 返回 400

## Phase C：桌面 LocationPicker + 集成

### C1. 实现 `LocationPicker.jsx`
- [ ] 新建 `client/src/components/map/LocationPicker.jsx`（详见 05 文档 2）
- [ ] 实现 MapContainer + TileLayer + 可拖动 Marker + MapClickHandler
- [ ] amap provider 坐标转换（WGS-84↔GCJ-02，marker 显示与瓦片对齐）
- [ ] 逆向 geocode debounce 300ms
- [ ] 新建 pin icon（`L.divIcon`）
- [ ] **验收**：单测难，靠手工 + 集成测试

### C2. 实现 `LocationPickerModal.jsx`
- [ ] 新建 `client/src/components/map/LocationPickerModal.jsx`（详见 05 文档 3）
- [ ] `GlassModal` 包裹，size `5xl`
- [ ] 顶部搜索栏（复用 `GeoSearchInput`）+ 瓦片切换 + 「我的位置」
- [ ] 底部信息栏：lat/lng 输入 + 详细位置 + 国家 + 城市
- [ ] 范围校验：`isValidLatitude`/`isValidLongitude`，越界禁用确认
- [ ] 通过 `lazyModal` 懒加载
- [ ] **验收**：手工跑通 05 文档 7 的测试矩阵

### C3. 集成 `PhotoDetailsSidebar.jsx`
- [ ] 在 `:489-514` lat/lng 输入区加 `📍 在地图上选择` 按钮
- [ ] 加 `showLocationPicker` state
- [ ] 实现 `handlePickConfirm(value)`：填字段 + markDirty
- [ ] 实现 `currentLocationValue` 转换
- [ ] **验收**：选完位置 → 字段填充 → Save → `PUT /api/photos/:id` 成功 → React Query invalidate → 地图页照片位置更新

### C4. 集成 `ShotLogModal.jsx`
- [ ] Quick-Add 表单加按钮
- [ ] `EntryEditModal` 加按钮
- [ ] 顶层 `pickerTarget` state 共用一个 picker 实例
- [ ] **验收**：Quick-Add 与 EditModal 都能正确填入；保存后 `PUT /api/film-items/:id` 成功

### C5. CSS
- [ ] 在 `client/src/styles/forms.css` 或新文件追加 `.fg-location-picker-map` / `.fg-input-error` / `.fg-input-group` / `.fg-location-picker-pin` 样式
- [ ] **验收**：modal 在 light/dark 主题下视觉正常

## Phase D：手机 LocationPicker + 集成

### D1. `LocationPickerContext` + Provider
- [ ] 新建 `mobile/src/context/LocationPickerContext.tsx`（详见 06 文档 2）
- [ ] 实现 `pickLocation(initial)` 返回 Promise
- [ ] **验收**：Context 在 NavigationContainer 内可用

### D2. `LeafletMap` 扩展 pick 模式
- [ ] `mobile/src/components/map/LeafletMap.tsx` 加 `mode` / `onPick` / `initialLatLng` props
- [ ] `mobile/src/components/map/leafletHtml.ts` pick 模式生成不同 HTML（点击/拖动 marker 发 `MAP_PICK`，不渲染 cluster）
- [ ] `onMessage` 处理 `MAP_PICK`
- [ ] 坐标系处理：amap 时 `MAP_PICK` 坐标转 WGS-84；`initialLatLng` 转 GCJ-02 注入
- [ ] **验收**：view 模式回归（MapScreen 不受影响）；pick 模式点击触发 `onPick`

### D3. `LocationPickerScreen.tsx`
- [ ] 新建 `mobile/src/screens/location/LocationPickerScreen.tsx`（详见 06 文档 4）
- [ ] 注册到 `App.tsx` RootStack，`presentation: 'fullScreenModal'`
- [ ] `LocationPickerProvider` 包裹 RootStack
- [ ] 更新 `mobile/src/navigation/types.ts`
- [ ] 实现 header / 搜索栏 / 地图 / 底部卡片
- [ ] 「我的位置」复用 `getCurrentPosition`
- [ ] 硬件返回键 → `resolvePick(null)`
- [ ] **验收**：手工跑通 06 文档 8 的测试矩阵（模拟器 + 真机）

### D4. 集成 `ShotLogScreen.tsx`
- [ ] 添加表单加「地图选择」按钮
- [ ] 编辑现有条目（如有内联编辑）同样加按钮
- [ ] **验收**：picker 返回后字段填充；保存后 shot_logs JSON 正确

### D5. （可选 Tier 2）集成 `PhotoViewScreen.tsx`
- [ ] 加「编辑位置」action
- [ ] 调 `pickLocation` → `updatePhoto`
- [ ] **验收**：编辑后照片位置在 MapScreen 上更新

## Phase E：Tier 1 衍生功能

### E1. 逆向 geocode 按钮
- [ ] 桌面 `PhotoDetailsSidebar` lat/lng 旁加 `🔄 反查地址` 按钮
- [ ] 桌面 `ShotLogModal` 同样
- [ ] 手机 `ShotLogScreen` 同样
- [ ] **验收**：有坐标时点击反查，地址字段被填充

### E2. GPS 按钮（picker 内）
- [ ] 桌面 `LocationPickerModal` 加「📍 我的位置」
- [ ] 手机 `LocationPickerScreen` 加同款
- [ ] **验收**：浏览器/RN 授权后定位到当前位置

### E3. lat/lng 范围校验（前端）
- [ ] 所有 lat/lng 输入框加 `isValidLatitude`/`isValidLongitude` 校验
- [ ] 越界红框 + 确认按钮禁用
- [ ] **验收**：输入 200 → 红框；picker 确认按钮禁用

### E4. 坐标微调按钮（桌面）
- [ ] `PhotoDetailsSidebar` lat/lng 输入框加 ±0.00001 按钮
- [ ] **验收**：点击 +/− 坐标增减 0.00001

## Phase F：Tier 2 衍生功能

### F1. 地图缩略图预览（桌面）
- [ ] `PhotoDetailsSidebar` 位置区顶部加非交互 `MapContainer`（120×120）
- [ ] `ShotLogModal` entry 卡片加缩略图
- [ ] **验收**：有坐标时显示 pin，无坐标时隐藏

### F2. 最近使用位置
- [ ] picker `onConfirm` 时存 `localStorage['recent_locations']` / `AsyncStorage`
- [ ] picker 顶部显示最近位置 chip
- [ ] **验收**：选过的位置出现在下次 picker 的 chip 列表

### F3. 坐标格式切换
- [ ] 共享 `formatLatLng`（A3 已做）
- [ ] 桌面显示标签加 DMS/十进制切换
- [ ] **验收**：切换显示格式，DB 仍存十进制

### F4. 手机 PhotoViewScreen 位置编辑
- [ ] 同 D5

## Phase G：Tier 3 服务端 geocoding 代理

### G1. 服务端配置与端点
- [ ] 新建 `server/services/map-config.js`（读 `MAP_PROVIDER` / `AMAP_WEB_KEY` env var）
- [ ] 新建 `server/routes/geocode.js`：`GET /api/geocode/search` 与 `/api/geocode/reverse`
- [ ] `server/server.js` 挂载 `app.use('/api/geocode', ...)`（不缓存）
- [ ] 更新 `docker/.env.example` 与文档
- [ ] **验收**：`curl 'http://localhost:4000/api/geocode/search?q=Beijing'` 返回结果

### G2. 客户端优先使用代理
- [ ] `server-capabilities` 端点加 `geocode_proxy: true` 标识（需检查现有 capability 机制）
- [ ] 客户端检测到代理可用时优先调 `/api/geocode/*`，失败 fallback 到本地 geocoding
- [ ] **验收**：服务端配 amap key 后，客户端不配 key 也能用 amap geocoding

## 跨阶段：回归测试清单

每次完成一个 Phase 后跑：
- [ ] `npx eslint .`（根目录）
- [ ] 桌面 `cd client && npm run build`（Vite 产物无报错）
- [ ] 桌面 `npm run dev` 手工冒烟：MapPage / RollDetail sidebar / ShotLogModal
- [ ] 手机 `cd mobile && npx tsc --noEmit`
- [ ] 手机 `npx expo start` 模拟器冒烟：MapScreen / ShotLogScreen / PhotoView
- [ ] `jest packages/shared` 全绿
- [ ] server `npm test`（若有）或 `node server/server.js` 启动 + `curl` 冒烟

## 完成定义（Definition of Done）

**Phase A-E 完成 = LocationPicker 功能可用：**
1. 桌面 photo sidebar、桌面 shot log（Quick-Add + EditModal）、手机 shot log 都能从地图点选位置返回经纬度 + 地址
2. 点选后自动逆向 geocoding 填充地址字段
3. 支持 osm / amap 两个 provider，amap 时坐标对齐无偏移
4. lat/lng 范围校验前后端都生效
5. 现有功能零回归（MapPage、GeoSearchInput、手机 GPS 自动捕获等）
6. 共享层抽取完成，桌面与手机 geocoding 不再重复实现

**Phase F-G = 增强体验**：缩略图预览、最近位置、服务端代理。

## 风险跟踪

| 风险 | 触发条件 | 缓解 | 状态 |
|---|---|---|---|
| 共享 `reverseGeocode` 与手机 `Expo Location.reverseGeocodeAsync` 行为不一致 | 手机端设备离线时共享模块全失败 | 保留 Expo 兜底在 `locationService` 内，不全部迁移 | 待 Phase A6 验证 |
| `react-leaflet` 4.x 的 `MapContainer` 在 modal 内尺寸为 0 | modal 打开动画期间地图容器未固定高度 | 强制 `height: 400px`；用 `whenReady` 回调或 `setTimeout` 触发 `map.invalidateSize()` | 待 C2 验证 |
| AMap key 用户拒绝在客户端配置 | picker 内 amap 模式 geocoding 失败 | 自动 fallback 到 osm 链；UI 提示去 Settings | 设计已含 |
| 手机 WebView postMessage 序列化大数据卡顿 | `MAP_PICK` 频繁触发 | debounce 300ms；只传 lat/lng 不传其他 | 待 D2 验证 |
