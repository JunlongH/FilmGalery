# 02 · 组件架构与数据流

## 1. 设计原则

1. **渲染层不跨端共享**：桌面 DOM（`react-leaflet`）与手机 RN（WebView-Leaflet）渲染模型不同，且本仓库无共享 UI 包先例。强行抽象会引入复杂度。
2. **数据层全共享**：types、geocoding、坐标转换、瓦片配置、聚类算法 —— 这些是纯逻辑，与平台无关。
3. **配置注入而非全局读取**：共享 geocoding 模块**不直接读 `localStorage`/`AsyncStorage`**，由调用方读取后作为参数传入。保持模块纯度，便于测试。
4. **复用现有 `GeocodeResult` 契约**：所有 geocoding 输出对齐 `@filmgallery/types` 的 `GeocodeResult`（字符串字段永不 undefined）。
5. **DB 永远存 WGS-84**：所有 AMap 边界处用 `coordTransform` 转换，与现状一致。
6. **不破坏现有 API**：新增端点优先，修改端点保持向后兼容。

## 2. 三层架构

```
┌─────────────────────────────────────────────────────────────────┐
│  应用层（平台特定 UI）                                            │
│  桌面: LocationPickerModal (GlassModal) + LocationPicker.jsx    │
│  手机: LocationPickerScreen (RN stack screen) + LeafletMap pick  │
└─────────────────────────────────────────────────────────────────┘
                              ↕ 调用
┌─────────────────────────────────────────────────────────────────┐
│  共享数据层（@filmgallery/shared + @filmgallery/types）           │
│  • geocoding: searchAddress / reverseGeocode (provider 配置注入) │
│  • coordTransform: wgs84ToGcj02 / gcj02ToWgs84 (已有)            │
│  • mapUtils: 瓦片 URL 构建、聚类、MapProvider 常量                │
│  • types: LocationPickerValue / MapProvider / GeocodeResult      │
└─────────────────────────────────────────────────────────────────┘
                              ↕ 调用
┌─────────────────────────────────────────────────────────────────┐
│  后端（server/）                                                  │
│  Phase 1: 修契约 + 加校验（无新端点）                             │
│  Phase 2 (可选): GET /api/geocode/search, /api/geocode/reverse   │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 核心数据契约

### 3.1 `LocationPickerValue`（新增 type）

```ts
// packages/@filmgallery/types/index.d.ts
export interface LocationPickerValue {
  latitude: number;       // WGS-84, 必填
  longitude: number;      // WGS-84, 必填
  country: string;        // 反查得到的国家名，失败为 ''
  city: string;           // 反查得到的城市/地区，失败为 ''
  state: string;          // 一级行政区，失败为 ''
  detail_location: string;// 完整格式化地址，失败为 ''
  displayName: string;    // 同 detail_location 或更短显示名
}
```

> 与 `GeocodeResult` 字段对齐，多了 `detail_location`/`displayName` 语义。可考虑直接复用 `GeocodeResult` + 加 `detail_location` 别名，但保留独立类型更清晰。

### 3.2 `MapProvider`（从 mobile 迁出）

```ts
// packages/@filmgallery/types/index.d.ts
export type MapProvider = 'osm' | 'amap';
```

当前在 `mobile/src/context/ApiContext.ts:3` 定义，应迁到共享 types，桌面与手机共用。

### 3.3 Geocoding 选项

```ts
export interface GeocodeConfig {
  provider: MapProvider;
  amapKey?: string;        // provider='amap' 时必填
  signal?: AbortSignal;    // 取消
  timeout?: number;        // ms，默认 5000
}

export interface SearchOptions extends GeocodeConfig {
  limit?: number;          // 默认 5
}

export interface SearchResult {
  displayName: string;
  latitude: number;
  longitude: number;
  country: string;
  city: string;
  state: string;
  road?: string;
  houseNumber?: string;
}
```

## 4. 共享 geocoding 模块（`@filmgallery/shared/geocoding`）

> 详见 [03-shared-layer.md](./03-shared-layer.md)

**API：**
```js
import { searchAddress, reverseGeocode, getCityCoordinates } from '@filmgallery/shared/geocoding';

const results = await searchAddress(query, { provider: 'amap', amapKey: 'xxx', limit: 5 });
// SearchResult[]

const result = await reverseGeocode(lat, lng, { provider: 'osm' });
// GeocodeResult（永不抛错，失败返回空字段 + echo 坐标）

const coords = await getCityCoordinates('China', 'Beijing', { provider: 'osm' });
// { latitude, longitude } | null
```

**Provider 链：**
- `searchAddress`：`provider==='amap' && amapKey` → AMap（GCJ-02→WGS-84） → Photon → Nominatim（1.1s 限速）
- `reverseGeocode`：`provider==='amap' && amapKey` → AMap（WGS-84→GCJ-02） → Photon reverse → Nominatim reverse → 返回空 `GeocodeResult`

**与现有代码关系：**
- 桌面 `client/src/utils/geocoding.js` → 改为薄封装，从 `@filmgallery/shared/geocoding` re-export，读取 `localStorage` 注入配置
- 手机 `mobile/src/services/locationService.native.ts` 的逆向 geocoding 部分 → 改为调用共享 `reverseGeocode`，保留 GPS 获取逻辑（设备特定）
- 共享 `packages/shared/geocode.js`（BigDataCloud）→ 合并为 `reverseGeocode` 的一个 provider 实现（或保留作为手机/手表的离线兜底）

## 5. 桌面组件设计

### 5.1 `LocationPicker.jsx`（内层 Leaflet 地图）

**位置**：`client/src/components/map/LocationPicker.jsx`

**Props：**
```jsx
<LocationPicker
  initialLatLng={[lat, lng] | null}   // null = 无初始 marker
  provider="osm" | "amap"
  amapKey="..."
  mapStyle="light" | "dark" | "satellite"   // 默认 'light'
  onLatLngChange={(lat, lng) => {}}    // marker 拖动/地图点击时实时回调
  searchFn={(query) => Promise<SearchResult[]>}  // 注入，默认用共享 searchAddress
  reverseGeocodeFn={(lat, lng) => Promise<GeocodeResult>}  // 默认用共享 reverseGeocode
  onReverseGeocode={(result) => {}}    // 逆向 geocode 完成回调（显示地址）
  className="..."
/>
```

**功能：**
- 地图点击 → 放置/移动 marker → `onLatLngChange` → 触发 `reverseGeocodeFn` → `onReverseGeocode`
- marker 拖动 → 同上
- 顶部嵌入 `GeoSearchInput`（复用现有组件）→ 选中结果 → 平移地图 + 设 marker
- 右上角瓦片切换按钮（light/dark/satellite）
- 右下角「使用我的位置」按钮（`navigator.geolocation.getCurrentPosition`）
- 复用 `PhotoMap.jsx` 的瓦片配置与 `coordTransform` 逻辑

**实现要点：**
- 用 `react-leaflet` 的 `MapContainer` + `TileLayer` + `Marker`（`draggable`）
- 用 `useMapEvents({ click })` 监听点击
- 参考 `PhotoMap.jsx:248-271` 的 `MapEventHandler` 模式
- marker 图标复用 `PhotoMarker.jsx` 的 leaflet icon 工厂，或新建更醒目的「pin」图标

### 5.2 `LocationPickerModal.jsx`（外层 GlassModal 包裹）

**位置**：`client/src/components/map/LocationPickerModal.jsx`

**Props：**
```jsx
<LocationPickerModal
  isOpen={boolean}
  initialValue={LocationPickerValue | null}  // 编辑模式预填
  title="Pick Photo Location"                // 可定制
  provider="osm" | "amap"
  amapKey="..."
  onConfirm={(value: LocationPickerValue) => {}}  // 用户点「确认」
  onCancel={() => {}}
/>
```

**布局：**
```
┌─ GlassModal ─────────────────────────────────────────┐
│ Header: 标题 + × 关闭                                  │
├──────────────────────────────────────────────────────┤
│ ┌─ 顶部搜索栏 ─────────────────────────────────────┐ │
│ │ [GeoSearchInput: 搜索地址]   [瓦片切换] [我的位置]│ │
│ └──────────────────────────────────────────────────┘ │
│ ┌─ 地图区（flex: 1）──────────────────────────────┐ │
│ │                                                  │ │
│ │              [可拖动 marker]                      │ │
│ │                                                  │ │
│ └──────────────────────────────────────────────────┘ │
│ ┌─ 底部信息栏 ─────────────────────────────────────┐ │
│ │ Lat: [input]  Lng: [input]   [±微调]             │ │
│ │ 地址: 反查得到的 displayName（可编辑）            │ │
│ │ 国家/城市: 反查结果（可编辑）                      │ │
│ └──────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────┤
│ Footer: [取消]                            [确认]      │
└──────────────────────────────────────────────────────┘
```

**状态管理：**
- 内部 `useState` 维护 `latLng`、`reverseResult`（`GeocodeResult`）、`manualAddress`（用户编辑后的地址）
- 用户编辑 lat/lng 输入框 → 触发 `reverseGeocode` 更新地址
- 用户编辑地址输入框 → 不反查（避免循环）
- 确认时组装 `LocationPickerValue` 调 `onConfirm`

**样式**：用 `GlassModal`（HeroUI），内部用 `fg-*` 类与 sidebar 一致。modal 尺寸较大（`size="5xl"` 或自定义 800×600）。

**懒加载**：通过 `lazyModal(() => import('./map/LocationPickerModal'))` 引入，避免 Leaflet 初始 bundle 膨胀。

## 6. 手机组件设计

### 6.1 `LocationPickerScreen.tsx`（全屏 modal）

**位置**：`mobile/src/screens/location/LocationPickerScreen.tsx`

**注册**：`App.tsx` 的 `RootStack.Screen`：
```tsx
<RootStack.Screen
  name="LocationPicker"
  component={LocationPickerScreen}
  options={{ presentation: 'fullScreenModal', headerShown: false }}
/>
```

### 6.2 `LeafletMap.tsx` 扩展 — pick 模式

**改动**：`mobile/src/components/map/LeafletMap.tsx` 与 `leafletHtml.ts` 增加 pick 模式：
- 新 prop `mode: 'view' | 'pick'`（默认 `'view'`，向后兼容）
- pick 模式下：
  - 瓦片可点击 → 通过 `postMessage` 发送 `MAP_PICK` 消息（`{ type: 'MAP_PICK', lat, lng }`）
  - 显示一个可拖动 marker（HTML5 dragend 也通过 `postMessage` 发 `MAP_PICK`）
  - 不渲染照片 marker cluster（避免干扰点选）
- RN 侧 `LeafletMap` 收到 `MAP_PICK` → 调 `onPick(lat, lng)` 回调

### 6.3 数据回传 — `LocationPickerContext` + Promise 模式

React Navigation 不能直接传 callback 给目标 screen。为保持跨平台一致并支持 `await pickLocation(initial)`，新增 Context：

```tsx
// mobile/src/context/LocationPickerContext.tsx
interface LocationPickerContextValue {
  pickLocation: (initial?: LocationPickerValue | null) => Promise<LocationPickerValue | null>;
}
```

**实现**：
- Provider 内部用 `useState` 持有 `{ initial, resolve, reject }` 与可见性
- `pickLocation` 返回 Promise，同时 `navigation.navigate('LocationPicker', { initial })`
- `LocationPickerScreen` 通过 `useLocationPicker()` 拿到当前 pending 请求
- 用户确认 → `resolve(value)` + `navigation.goBack()`
- 用户取消 → `resolve(null)` + `navigation.goBack()`
- 硬件返回键 → 视为取消

**使用方：**
```tsx
const { pickLocation } = useLocationPicker();

const handlePick = async () => {
  const result = await pickLocation(currentLocation);
  if (result) {
    setCountry(result.country);
    setCity(result.city);
    setDetail(result.detail_location);
    setLat(result.latitude);
    setLng(result.longitude);
  }
};
```

**为什么不直接用 route params 回传？**
- 回传时需要 source screen 在 `useEffect` 监听 `route.params.pickedLocation`，逻辑分散
- 多个 source screen（ShotLog、PhotoView）都要重复实现监听
- Promise 模式更符合「打开选择器 → 等待结果」的语义，且未来桌面也可复用同一接口（通过 portal + Promise）

### 6.4 Screen 布局

```
┌─ SafeAreaView ───────────────────────────────────────┐
│ Header: [← 返回]  选择位置                    [完成]   │
├──────────────────────────────────────────────────────┤
│ ┌─ 搜索栏 ─────────────────────────────────────────┐ │
│ │ [TextInput + 搜索按钮]                           │ │
│ └──────────────────────────────────────────────────┘ │
│ ┌─ 地图 (LeafletMap mode="pick") ──────────────────┐ │
│ │                                                   │ │
│ │              [可拖动 marker]                       │ │
│ │                                                   │ │
│ │                                  [📍 我的位置]     │ │
│ └──────────────────────────────────────────────────┘ │
│ ┌─ 底部卡片 (Paper Card) ──────────────────────────┐ │
│ │ Lat: xxx, Lng: xxx                                │ │
│ │ 地址: 反查结果（可编辑 TextInput）                 │ │
│ │ 国家: xxx  城市: xxx                              │ │
│ └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## 7. 集成点

### 7.1 桌面 `PhotoDetailsSidebar.jsx`

**改动位置**：`:435-540` 位置区域

**新增**：
- 在 lat/lng 输入框旁加 `📍 在地图上选择` 按钮
- 点击 → `setShowPicker(true)`
- 渲染 `<LocationPickerModal isOpen={showPicker} initialValue={currentLocation} onConfirm={handlePickConfirm} ... />`
- `handlePickConfirm(value)`：设置 `location.latitude`/`longitude`/`detailLocation`/`country`/`city`，标记 dirty

**顺手优化**：
- 加 `🔄 逆向地理编码` 按钮（当 lat/lng 有值时显示），调 `reverseGeocode` 填充 `detailLocation`
- 加 lat/lng 范围校验（`[-90,90]` / `[-180,180]`），越界红色提示
- 加 ±0.00001 微调按钮（借鉴已废弃的 `PhotoMetaEditModal.jsx:146-158`）

### 7.2 桌面 `ShotLogModal.jsx`

**改动位置**：
- Quick-Add 表单 `:1135-1189`（detail_location 字段旁）
- `EntryEditModal` `:187-228`

**新增**：同样的 `📍 在地图上选择` 按钮 + `LocationPickerModal`。

**复用**：把 `LocationPickerModal` 的引用提到模块顶层，Quick-Add 和 EntryEditModal 共用一个实例（通过 state 控制 `activePickerTarget: 'quickAdd' | 'editModal' | null`）。

### 7.3 手机 `ShotLogScreen.tsx`

**改动**：
- 在底部添加表单的「Detail / Address」字段旁加 `📍 地图选择` 按钮
- 用 `useLocationPicker()` 的 `pickLocation`
- App.tsx 注册 `LocationPickerScreen` 与 `LocationPickerProvider` 包裹 RootStack

### 7.4 手机 `PhotoViewScreen.tsx`（可选，Tier 2）

当前位置只读。可加「编辑位置」action（长按或菜单项）→ `pickLocation` → 调 `PUT /api/photos/:id`。

## 8. 数据流（点选 → 入库）

```
用户点击地图
  ↓ onLatLngChange(lat, lng)
  ↓ debounce 300ms
共享 reverseGeocode(lat, lng, { provider, amapKey })
  ↓ AMap / Photon / Nominatim（按 provider 链）
  ↓ 返回 GeocodeResult（WGS-84 坐标，地址字符串）
UI 更新：lat/lng + 地址 + country/city
  ↓ 用户点「确认」
onConfirm(LocationPickerValue)
  ↓ 父组件设置 state
  ↓ 用户点 sidebar 的「Save」（location section）
PUT /api/photos/:id { latitude, longitude, country, city, detail_location, location_id }
  ↓ 服务端写入 photos 表（DB 存 WGS-84）
```

## 9. 错误处理

| 场景 | 行为 |
|---|---|
| 逆向 geocode 全部 provider 失败 | UI 仍显示 lat/lng，地址字段为空，提示「无法获取地址，可手动输入」 |
| 正向搜索无结果 | 下拉显示「无匹配结果」 |
| AMap key 未配置但 provider='amap' | 自动 fallback 到 osm 链；Settings 提示 |
| 网络超时 | `AbortController` 5s 超时；UI 显示「地理编码超时，重试」 |
| GPS 被拒绝（桌面/手机） | Toast「无法获取定位权限」；按钮禁用或提示去设置 |
| lat/lng 越界 | 输入框红色边框 + 提示；确认按钮禁用 |

## 10. 性能考虑

- **Leaflet 懒加载**：`LocationPickerModal` 用 `lazyModal` 代码分割，避免首屏加载 Leaflet
- **逆向 geocode 防抖**：marker 拖动时 300ms debounce，避免频繁请求
- **手机 WebView 复用**：pick 模式复用现有 `LeafletMap` 的 WebView，不新建
- **共享 geocoding 模块按需 import**：tree-shaking 友好
