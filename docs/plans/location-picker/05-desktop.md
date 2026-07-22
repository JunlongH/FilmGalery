# 05 · 桌面端实现

## 1. 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `client/src/components/map/LocationPicker.jsx` | **新增** | 内层 Leaflet 地图，点选 + 拖动 marker |
| `client/src/components/map/LocationPickerModal.jsx` | **新增** | `GlassModal` 包裹，含搜索栏、信息栏、确认/取消 |
| `client/src/components/map/LocationPickerModal.module.css` | **新增**（可选） | 局部样式，或复用 `fg-*` |
| `client/src/components/PhotoDetailsSidebar.jsx` | 改 | 位置区域加「在地图上选择」按钮 + 逆向 geocode 按钮 + 微调按钮 + 范围校验 |
| `client/src/components/ShotLogModal.jsx` | 改 | Quick-Add 与 `EntryEditModal` 各加「在地图上选择」按钮 |
| `client/src/utils/geocoding.js` | 改 | 改为薄封装，re-export `@filmgallery/shared/geocoding` |
| `client/src/components/common/lazyModal` | 已有 | 复用懒加载机制 |

## 2. `LocationPicker.jsx`（内层地图）

### 2.1 Props

```jsx
LocationPicker({
  initialLatLng,       // [number, number] | null
  provider,            // 'osm' | 'amap'
  amapKey,             // string
  mapStyle,            // 'light' | 'dark' | 'satellite'，默认 'light'
  onLatLngChange,      // (lat, lng) => void  —— marker 移动/点击时实时回调
  onReverseGeocode,    // (GeocodeResult) => void —— 逆向 geocode 完成回调
  searchFn,            // 可选，默认用共享 searchAddress
  reverseGeocodeFn,    // 可选，默认用共享 reverseGeocode
  className,
})
```

### 2.2 实现要点

```jsx
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useState, useRef, useCallback } from 'react';
import { searchAddress, reverseGeocode } from '@filmgallery/shared/geocoding';
import { wgs84ToGcj02, gcj02ToWgs84 } from '@filmgallery/shared/coordTransform';
import { TILE_LAYERS } from '@filmgallery/shared/mapUtils';

// 瓦片 URL（amap 时坐标需 GCJ-02，但 leaflet 的 {x}{y}{z} 是瓦片索引，与坐标无关；
// marker 坐标需 WGS-84↔GCJ-02 转换以与 amap 瓦片对齐）
function tileUrl(provider, style) {
  return TILE_LAYERS[provider][style] || TILE_LAYERS.osm.light;
}

// 点击/拖动处理器
function MapClickHandler({ onPick }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      onPick(lat, lng);
    },
  });
  return null;
}

export default function LocationPicker(props) {
  const [markerPos, setMarkerPos] = useState(props.initialLatLng);
  const [geocoding, setGeocoding] = useState(false);
  const debounceRef = useRef();

  const handlePick = useCallback((lat, lng) => {
    setMarkerPos([lat, lng]);
    props.onLatLngChange?.(lat, lng);
    // debounce 逆向 geocode
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setGeocoding(true);
      try {
        const result = await (props.reverseGeocodeFn || reverseGeocode)(lat, lng, {
          provider: props.provider, amapKey: props.amapKey,
        });
        props.onReverseGeocode?.(result);
      } finally { setGeocoding(false); }
    }, 300);
  }, [props]);

  // amap 时 marker 坐标需转 GCJ-02 才能与瓦片对齐
  // 注意：coordTransform 返回 { lat, lng } 对象，不是数组（见 coordTransform.js:48-60）
  let displayMarkerPos = markerPos;  // [lat, lng] | null
  if (markerPos && props.provider === 'amap') {
    const c = wgs84ToGcj02(markerPos[0], markerPos[1]);  // { lat, lng }
    displayMarkerPos = [c.lat, c.lng];
  }

  return (
    <MapContainer center={displayMarkerPos || [20, 0]} zoom={markerPos ? 13 : 2} className={props.className}>
      <TileLayer url={tileUrl(props.provider, props.mapStyle)} />
      <MapClickHandler onPick={handlePick} />
      {displayMarkerPos && (
        <Marker
          position={displayMarkerPos}
          draggable
          eventHandlers={{ dragend: (e) => {
            const ll = e.target.getLatLng();  // { lat, lng } in leaflet 坐标系
            if (props.provider === 'amap') {
              // 拖动得到的是 amap 瓦片下的 GCJ-02，转回 WGS-84
              const w = gcj02ToWgs84(ll.lat, ll.lng);  // { lat, lng }
              handlePick(w.lat, w.lng);
            } else {
              handlePick(ll.lat, ll.lng);
            }
          }}}
        />
      )}
      {/* MapContainer 在 modal 动画期间可能高度为 0，需 invalidateSize */}
      <MapResizer />
    </MapContainer>
  );
}

// 处理 modal 内 MapContainer 零高度问题（react-leaflet v4 已知问题）
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 300);  // 等 HeroUI modal 动画结束
    return () => clearTimeout(t);
  }, [map]);
  return null;
}
```

**坐标系说明**（关键）：
- DB 与对外 API：永远 WGS-84
- `react-leaflet` 的 `latlng` 在用 OSM 瓦片时是 WGS-84，在用 AMap 瓦片时若直接传 WGS-84 会有偏移
- 因此用 amap 时，marker 显示位置 = `wgs84ToGcj02(wgs84)`；用户拖动/点击得到的 GCJ-02 坐标 = `gcj02ToWgs84(gcj02)` → 存 WGS-84
- `onLatLngChange` 与 `onReverseGeocode` 始终用 WGS-84
- **注意**：`coordTransform` 函数返回 `{ lat, lng }` 对象（非数组），需解构使用，参考 `geocoding.js:44` 现有写法
- **重要**：现有 `PhotoMap.jsx` **未做** amap 瓦片坐标转换（marker 直接用 WGS-84 显示，amap 时会有偏移）。本组件的转换是新行为，**实现前需 spike 验证**：在 amap 瓦片上用 `wgs84ToGcj02` 转换后 marker 是否与底图对齐
- `MapResizer` 组件解决 `MapContainer` 在 modal 动画期间零高度问题（react-leaflet v4 已知行为）

### 2.3 marker 图标

新建一个醒目的「pin」图标（区别于照片 marker），或复用 leaflet 默认：
```js
const pinIcon = L.divIcon({
  className: 'fg-location-picker-pin',
  html: '<svg ...>📍</svg>',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});
```

### 2.4 顶部搜索栏

复用 `GeoSearchInput`：
```jsx
<GeoSearchInput
  value={searchText}
  onChange={setSearchText}
  onSelect={(result) => {
    handlePick(result.latitude, result.longitude);
    // 平移地图（通过 useMap 的 flyTo）
  }}
/>
```

`GeoSearchInput` 当前内部直接调 `client/src/utils/geocoding.js` 的 `searchAddress`（薄封装后→共享模块），无需改动。`GeoSearchInput` 的 props 是 `{ value, onChange, onSelect, placeholder, className, style, disabled }`（见 `GeoSearchInput.jsx:25-33`），**不接受** `provider`/`amapKey` —— geocoding 模块内部读 `localStorage` 获取配置，保持现状即可。

**决策**：`GeoSearchInput` 保持现状（内部读 `localStorage`），不强制传 props。`LocationPicker` 内部 geocoding 调用也读 `localStorage`。这样集成最简单。

### 2.5 「使用我的位置」按钮

```jsx
const handleUseMyLocation = () => {
  if (!navigator.geolocation) return toast('浏览器不支持定位');
  navigator.geolocation.getCurrentPosition(
    (pos) => handlePick(pos.coords.latitude, pos.coords.longitude),
    (err) => toast(`定位失败: ${err.message}`),
    { enableHighAccuracy: true, timeout: 8000 }
  );
};
```

桌面 Electron 环境 `navigator.geolocation` 可用。

## 3. `LocationPickerModal.jsx`（外层）

### 3.1 Props

```jsx
LocationPickerModal({
  isOpen,              // boolean
  initialValue,        // LocationPickerValue | null
  title,               // string，默认 '选择位置'
  onConfirm,           // (LocationPickerValue) => void
  onCancel,            // () => void
  provider,            // 透传，默认读 localStorage
  amapKey,             // 透传
})
```

### 3.2 实现

```jsx
import GlassModal from '../ui/GlassModal';
import { useState, useEffect } from 'react';
import LocationPicker from './LocationPicker';
import GeoSearchInput from '../GeoSearchInput';
import { isValidLatitude, isValidLongitude } from '@filmgallery/shared/mapUtils';

export default function LocationPickerModal({ isOpen, initialValue, title = '选择位置', onConfirm, onCancel }) {
  const [lat, setLat] = useState(initialValue?.latitude ?? null);
  const [lng, setLng] = useState(initialValue?.longitude ?? null);
  const [reverse, setReverse] = useState(null);  // GeocodeResult
  const [detail, setDetail] = useState(initialValue?.detail_location ?? '');
  const [country, setCountry] = useState(initialValue?.country ?? '');
  const [city, setCity] = useState(initialValue?.city ?? '');
  const [mapStyle, setMapStyle] = useState('light');

  // 当 initialValue 变化（再次打开编辑不同 photo）时重置
  useEffect(() => {
    if (isOpen) {
      setLat(initialValue?.latitude ?? null);
      setLng(initialValue?.longitude ?? null);
      setReverse(null);
      setDetail(initialValue?.detail_location ?? '');
      setCountry(initialValue?.country ?? '');
      setCity(initialValue?.city ?? '');
    }
  }, [isOpen, initialValue]);

  const handleLatLngChange = (newLat, newLng) => {
    setLat(newLat); setLng(newLng);
  };
  const handleReverseGeocode = (result) => {
    setReverse(result);
    setDetail(result.displayName || '');
    setCountry(result.country || '');
    setCity(result.city || '');
  };

  const canConfirm = isValidLatitude(lat) && isValidLongitude(lng);

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      latitude: lat, longitude: lng,
      country, city, state: reverse?.state || '',
      detail_location: detail, displayName: detail,
    });
  };

  // 「使用我的位置」—— 在 modal 层定义，调用后触发 LocationPicker 的 onLatLngChange
  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      // toast('浏览器不支持定位');  // 项目现有 toast 机制
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => handleLatLngChange(pos.coords.latitude, pos.coords.longitude),
      (err) => console.error('定位失败:', err.message),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // 读取 localStorage 配置
  const provider = localStorage.getItem('map_provider') || 'osm';
  const amapKey = localStorage.getItem('amap_web_key') || '';

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      size="5xl"
      footer={
        <>
          <Button variant="light" onPress={onCancel}>取消</Button>
          <Button color="primary" onPress={handleConfirm} isDisabled={!canConfirm}>确认</Button>
        </>
      }
    >
      {/* 顶部搜索栏 + 瓦片切换 + 我的位置 */}
      <div className="fg-field" style={{ display: 'flex', gap: 8 }}>
        <GeoSearchInput value={detail} onChange={setDetail}
          onSelect={(r) => { handleLatLngChange(r.latitude, r.longitude); setDetail(r.detail || r.displayName); setCountry(r.country||''); setCity(r.city||''); }}
          placeholder="搜索地址或输入详细位置" style={{ flex: 1 }} />
        <Button size="sm" onClick={() => setMapStyle(s => s === 'light' ? 'dark' : s === 'dark' ? 'satellite' : 'light')}>瓦片</Button>
        <Button size="sm" onClick={handleUseMyLocation}>📍我的位置</Button>
      </div>
      {/* 地图 */}
      <LocationPicker
        initialLatLng={lat != null && lng != null ? [lat, lng] : null}
        provider={provider} amapKey={amapKey} mapStyle={mapStyle}
        onLatLngChange={handleLatLngChange}
        onReverseGeocode={handleReverseGeocode}
        className="fg-location-picker-map"
      />
      {/* 底部信息栏 */}
      <div className="fg-grid-2">
        <div className="fg-field">
          <label className="fg-label">纬度 Latitude</label>
          <input type="number" step="0.00001" value={lat ?? ''} onChange={e => setLat(e.target.value === '' ? null : Number(e.target.value))} className="fg-input" />
        </div>
        <div className="fg-field">
          <label className="fg-label">经度 Longitude</label>
          <input type="number" step="0.00001" value={lng ?? ''} onChange={e => setLng(e.target.value === '' ? null : Number(e.target.value))} className="fg-input" />
        </div>
      </div>
      <div className="fg-field">
        <label className="fg-label">详细位置 / 地址</label>
        <input type="text" value={detail} onChange={e => setDetail(e.target.value)} className="fg-input" />
      </div>
      <div className="fg-grid-2">
        <div className="fg-field">
          <label className="fg-label">国家</label>
          <input type="text" value={country} onChange={e => setCountry(e.target.value)} className="fg-input" />
        </div>
        <div className="fg-field">
          <label className="fg-label">城市</label>
          <input type="text" value={city} onChange={e => setCity(e.target.value)} className="fg-input" />
        </div>
      </div>
    </GlassModal>
  );
}
```

### 3.3 懒加载

```jsx
// 在使用方（PhotoDetailsSidebar / ShotLogModal）
import lazyModal from './common/lazyModal';
const LocationPickerModal = lazyModal(() => import('./map/LocationPickerModal'));

// 使用
{showPicker && (
  <LocationPickerModal
    isOpen={showPicker}
    initialValue={currentLocationValue}
    onConfirm={handlePickConfirm}
    onCancel={() => setShowPicker(false)}
  />
)}
```

## 4. 集成：`PhotoDetailsSidebar.jsx`

### 4.1 改动位置：`:435-540` 位置区域

在 lat/lng 输入框旁加按钮：

```jsx
// 现有 lat/lng 输入框（:489-514）旁追加
<Button size="sm" onClick={() => setShowLocationPicker(true)}>📍 在地图上选择</Button>
<Button size="sm" onClick={handleReverseGeocode} disabled={!location.latitude || !location.longitude}>🔄 反查地址</Button>
```

### 4.2 新增 state

```jsx
const [showLocationPicker, setShowLocationPicker] = useState(false);
```

### 4.3 反查地址处理

```jsx
const handleReverseGeocode = async () => {
  if (!location.latitude || !location.longitude) return;
  const result = await reverseGeocode(location.latitude, location.longitude);
  if (result.displayName) {
    setDetailLocation(result.displayName);
    markDirty('detail_location');
  }
  if (result.country) { setLocation(prev => ({ ...prev, country: result.country })); markDirty('country'); }
  if (result.city)    { setLocation(prev => ({ ...prev, city: result.city }));    markDirty('city'); }
};
```

### 4.4 picker 确认处理

```jsx
const handlePickConfirm = (value) => {
  setLocation(prev => ({
    ...prev,
    latitude: value.latitude,
    longitude: value.longitude,
    country: value.country || prev.country,
    city: value.city || prev.city,
  }));
  if (value.detail_location) setDetailLocation(value.detail_location);
  ['latitude', 'longitude', 'country', 'city', 'detail_location'].forEach(markDirty);
  setShowLocationPicker(false);
};

const currentLocationValue = location.latitude && location.longitude ? {
  latitude: location.latitude, longitude: location.longitude,
  country: location.country || '', city: location.city || '',
  detail_location: detailLocation || '',
} : null;
```

### 4.5 顺手优化：lat/lng 微调按钮

借鉴废弃的 `PhotoMetaEditModal.jsx:146-158`，在 lat/lng 输入框旁加 ±0.0001 按钮（步长与旧版一致，约 11 米）：

```jsx
<div className="fg-input-group">
  <button onClick={() => nudge('latitude', -0.0001)}>−</button>
  <input type="number" step="0.0001" value={location.latitude ?? ''} ... />
  <button onClick={() => nudge('latitude', +0.0001)}>+</button>
</div>
```

### 4.6 顺手优化：范围校验

```jsx
const latInvalid = location.latitude != null && !isValidLatitude(location.latitude);
const lngInvalid = location.longitude != null && !isValidLongitude(location.longitude);
// input className 加条件：latInvalid ? 'fg-input fg-input-error' : 'fg-input'
```

## 5. 集成：`ShotLogModal.jsx`

### 5.1 Quick-Add 表单（`:1135-1189`）

在 detail_location 字段下方或旁边加按钮：
```jsx
<Button size="sm" onClick={() => openPicker('quickAdd')}>📍 在地图上选择</Button>
```

### 5.2 `EntryEditModal`（`:17-277`）

同样加按钮：
```jsx
<Button size="sm" onClick={() => openPicker('editModal')}>📍 在地图上选择</Button>
```

### 5.3 共用一个 picker 实例

`ShotLogModal` 顶层持有：
```jsx
const [pickerTarget, setPickerTarget] = useState(null);  // 'quickAdd' | 'editModal' | null

const openPicker = (target) => setPickerTarget(target);
const handlePickConfirm = (value) => {
  if (pickerTarget === 'quickAdd') {
    setNewLatitude(value.latitude); setNewLongitude(value.longitude);
    if (value.country) setNewCountry(value.country);
    if (value.city) setNewCity(value.city);
    if (value.detail_location) setNewDetail(value.detail_location);
  } else if (pickerTarget === 'editModal') {
    setEditData(prev => ({ ...prev,
      latitude: value.latitude, longitude: value.longitude,
      country: value.country || prev.country,
      city: value.city || prev.city,
      detail_location: value.detail_location || prev.detail_location,
    }));
  }
  setPickerTarget(null);
};

const pickerInitialValue = pickerTarget === 'quickAdd'
  ? (newLatitude && newLongitude ? { latitude: newLatitude, longitude: newLongitude, country: newCountry, city: newCity, detail_location: newDetail } : null)
  : pickerTarget === 'editModal'
  ? (editData?.latitude && editData?.longitude ? { latitude: editData.latitude, longitude: editData.longitude, country: editData.country, city: editData.city, detail_location: editData.detail_location } : null)
  : null;

// 渲染（在 modal 顶层）
{pickerTarget && (
  <LocationPickerModal
    isOpen={!!pickerTarget}
    initialValue={pickerInitialValue}
    onConfirm={handlePickConfirm}
    onCancel={() => setPickerTarget(null)}
  />
)}
```

## 6. CSS

在 `client/src/styles/forms.css` 或新文件追加：
```css
.fg-location-picker-map { height: 400px; width: 100%; border-radius: 8px; overflow: hidden; }
.fg-location-picker-pin { /* pin 样式 */ }
.fg-input-error { border-color: #ef4444; }
.fg-input-group { display: flex; align-items: center; gap: 4px; }
.fg-input-group input { flex: 1; }
.fg-input-group button { padding: 4px 8px; }
```

## 7. 测试要点

| 场景 | 验证 |
|---|---|
| 打开 picker（无初始值） | 地图居中默认位置，无 marker |
| 打开 picker（有初始值） | 地图居中初始坐标，有 marker |
| 点击地图 | marker 移动，lat/lng 更新，逆向 geocode 触发 |
| 拖动 marker | 同上 |
| 搜索地址 | 下拉结果，选中后地图平移 + marker |
| 「我的位置」 | 浏览器授权后定位 |
| 确认 | `onConfirm` 收到 `LocationPickerValue`，modal 关闭 |
| 取消 / Esc / 遮罩 | modal 关闭，无数据变更 |
| amap provider | marker 与瓦片对齐（无偏移） |
| 范围校验 | lat 输入 200 → 确认按钮禁用 |
| photo sidebar 集成 | 选完位置 → 字段填充 → Save 成功 |
| shot log Quick-Add 集成 | 同上 |
| shot log EntryEditModal 集成 | 同上 |

## 8. 工作量估算

| 项 | 估算 |
|---|---|
| `LocationPicker.jsx` + marker 图标 + 坐标转换 | 4-5h |
| `LocationPickerModal.jsx` + CSS | 3-4h |
| `PhotoDetailsSidebar` 集成 + 反查按钮 + 微调 + 校验 | 2-3h |
| `ShotLogModal` 集成（Quick-Add + EntryEditModal） | 2h |
| `geocoding.js` 改薄封装 | 1h（在 03 已计入） |
| 手工测试 + 调优 | 3h |
| **小计** | **~15-18h** |
