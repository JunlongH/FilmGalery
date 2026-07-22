# 06 · 手机端实现

## 1. 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `mobile/src/screens/location/LocationPickerScreen.tsx` | **新增** | 全屏 modal，含搜索栏 + 地图（pick 模式）+ 底部卡片 |
| `mobile/src/context/LocationPickerContext.tsx` | **新增** | Promise 模式 `pickLocation(initial)` |
| `mobile/src/components/map/LeafletMap.tsx` | 改 | 增加 `mode: 'view' \| 'pick'` prop 与 `onPick` 回调 |
| `mobile/src/components/map/leafletHtml.ts` | 改 | pick 模式下：地图点击/拖动 marker 发 `MAP_PICK` 消息；不渲染照片 cluster |
| `mobile/src/screens/shooting/ShotLogScreen.tsx` | 改 | 添加表单加「地图选择」按钮，用 `useLocationPicker` |
| `mobile/src/screens/viewing/PhotoViewScreen.tsx` | 改（可选 Tier 2） | 加「编辑位置」action |
| `mobile/src/navigation/types.ts` | 改 | `RootStackParamList` 加 `LocationPicker` |
| `mobile/App.tsx` | 改 | 注册 `LocationPickerScreen`；用 `LocationPickerProvider` 包裹 RootStack |
| `mobile/src/services/locationService.native.ts` | 改（在 03 已计入） | 逆向 geocoding 改调共享 `reverseGeocode` |

## 2. `LocationPickerContext.tsx`

### 2.1 设计

React Navigation 不能直接传 callback。采用 Promise 模式跨平台一致。

```tsx
// mobile/src/context/LocationPickerContext.tsx
import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { LocationPickerValue } from '@filmgallery/types';

interface PendingRequest {
  initial: LocationPickerValue | null;
  resolve: (value: LocationPickerValue | null) => void;
}

interface LocationPickerContextValue {
  pickLocation: (initial?: LocationPickerValue | null) => Promise<LocationPickerValue | null>;
  pending: PendingRequest | null;
  resolvePick: (value: LocationPickerValue | null) => void;
}

const LocationPickerContext = createContext<LocationPickerContextValue | null>(null);

export function LocationPickerProvider({ children }: { children: React.ReactNode }) {
  const navigation = useNavigation();
  const [pending, setPending] = useState<PendingRequest | null>(null);
  // 用 ref 持有 pending，避免在 setState updater 内执行副作用（React 18 strict mode 下 updater 可能双重调用）
  const pendingRef = useRef<PendingRequest | null>(null);

  const pickLocation = useCallback((initial: LocationPickerValue | null = null) => {
    return new Promise<LocationPickerValue | null>((resolve) => {
      const req = { initial, resolve };
      pendingRef.current = req;
      setPending(req);
      (navigation as any).navigate('LocationPicker', { initial });
    });
  }, [navigation]);

  const resolvePick = useCallback((value: LocationPickerValue | null) => {
    // 在 setState updater 外执行副作用，保证 purity
    const req = pendingRef.current;
    if (req) {
      req.resolve(value);
      pendingRef.current = null;
      setPending(null);
    }
  }, []);

  return (
    <LocationPickerContext.Provider value={{ pickLocation, pending, resolvePick }}>
      {children}
    </LocationPickerContext.Provider>
  );
}

export function useLocationPicker() {
  const ctx = useContext(LocationPickerContext);
  if (!ctx) throw new Error('useLocationPicker must be used within LocationPickerProvider');
  return ctx;
}
```

### 2.2 Provider 挂载

`App.tsx` 内，`LocationPickerProvider` 必须在 `NavigationContainer` 内部（这样 `useNavigation` 可用），且包裹 `RootStack`：

```tsx
<NavigationContainer ...>
  <LocationPickerProvider>
    <RootStack.Navigator ...>
      ...
      <RootStack.Screen name="LocationPicker" component={LocationPickerScreen}
        options={{ presentation: 'fullScreenModal', headerShown: false }} />
    </RootStack.Navigator>
  </LocationPickerProvider>
</NavigationContainer>
```

## 3. `LeafletMap.tsx` 扩展 — pick 模式

### 3.1 Props 新增

```tsx
interface LeafletMapProps {
  // 现有 props（photos, onMarkerPress, mapProvider, amapKey, ...）
  mode?: 'view' | 'pick';        // 新增，默认 'view'
  onPick?: (lat: number, lng: number) => void;  // 新增
  initialLatLng?: [number, number] | null;       // 新增，pick 模式的初始 marker
}
```

### 3.2 `leafletHtml.ts` 改动

pick 模式生成的 HTML 不同：
- **不**渲染照片 markers / cluster
- 地图点击：`map.on('click', e => ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_PICK', lat: e.latlng.lat, lng: e.latlng.lng })))`
- 可拖动 marker：`L.marker([lat, lng], { draggable: true }).on('dragend', e => postMessage MAP_PICK)`
- 初始 marker 位置由 `initialLatLng` 注入

`leafletHtml.ts` 新增参数 `{ mode, initialLatLng }`，根据 mode 生成不同 JS。

### 3.3 `LeafletMap.tsx` `onMessage` 处理

```tsx
const onMessage = (event: WebViewMessageEvent) => {
  const msg = JSON.parse(event.nativeEvent.data);
  switch (msg.type) {
    case 'MAP_READY': /* 现有 */ break;
    case 'MARKER_PRESS': /* 现有 */ break;
    case 'MAP_PICK':
      onPick?.(msg.lat, msg.lng);
      break;
  }
};
```

### 3.4 坐标系处理

`LeafletMap` 已有 `mapProvider` prop。pick 模式下：
- 瓦片用 `mapProvider` 对应的 URL（`leafletHtml.ts:9-19` 现有逻辑）
- `MAP_PICK` 报上来的坐标：osm 时是 WGS-84，amap 时是 GCJ-02
- 在 `onPick` 回调里，若是 amap 则 `gcj02ToWgs84` 转回 WGS-84
- 反之，注入 `initialLatLng` 时若是 amap 则 `wgs84ToGcj02` 转换

```tsx
const handlePick = (rawLat: number, rawLng: number) => {
  if (mapProvider === 'amap') {
    const [wgsLat, wgsLng] = gcj02ToWgs84(rawLat, rawLng);
    onPick?.(wgsLat, wgsLng);
  } else {
    onPick?.(rawLat, rawLng);
  }
};

// initialLatLng 转换后传给 LeafletMap
const displayInitial = initialLatLng && mapProvider === 'amap'
  ? wgs84ToGcj02(initialLatLng[0], initialLatLng[1])
  : initialLatLng;
```

## 4. `LocationPickerScreen.tsx`

### 4.1 结构

```tsx
import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { View, TextInput, StyleSheet, SafeAreaView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { IconButton, Text, Button, Card, ActivityIndicator } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import LeafletMap from '../../components/map/LeafletMap';
import { useLocationPicker } from '../../context/LocationPickerContext';
import { ApiContext } from '../../context/ApiContext';  // 注意：ApiContext 无 useApi hook，需用 useContext
import { searchAddress, reverseGeocode } from '@filmgallery/shared/geocoding';
import { wgs84ToGcj02, gcj02ToWgs84 } from '@filmgallery/shared/coordTransform';
import { isValidLatitude, isValidLongitude } from '@filmgallery/shared/mapUtils';
import type { LocationPickerValue, GeocodeResult } from '@filmgallery/types';

export default function LocationPickerScreen() {
  const navigation = useNavigation();
  const { pending, resolvePick } = useLocationPicker();
  const { mapProvider, amapKey } = useContext(ApiContext) as any;  // 现有代码用 useContext(ApiContext)（见 LeafletMap.tsx:21）

  const initial = pending?.initial ?? null;
  const [lat, setLat] = useState<number | null>(initial?.latitude ?? null);
  const [lng, setLng] = useState<number | null>(initial?.longitude ?? null);
  const [detail, setDetail] = useState(initial?.detail_location ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [reverseGeocoding, setReverseGeocoding] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  // 防止 beforeRemove 与 handleCancel 双重 resolve
  const resolvedRef = useRef(false);

  const handlePick = useCallback(async (pickedLat: number, pickedLng: number) => {
    setLat(pickedLat); setLng(pickedLng);
    setReverseGeocoding(true);
    try {
      const result = await reverseGeocode(pickedLat, pickedLng, { provider: mapProvider, amapKey });
      setDetail(result.displayName || '');
      setCountry(result.country || '');
      setCity(result.city || '');
    } finally { setReverseGeocoding(false); }
  }, [mapProvider, amapKey]);

  const handleSearch = async () => {
    if (!searchText.trim()) return;
    const results = await searchAddress(searchText, { provider: mapProvider, amapKey, limit: 5 });
    setSearchResults(results);
  };

  const handleSelectResult = (r: any) => {
    handlePick(r.latitude, r.longitude);
    setSearchText('');
    setSearchResults([]);
  };

  const handleUseMyLocation = async () => {
    // 复用 locationService 的 GPS 获取
    const pos = await getCurrentPosition();  // 从 locationService 导出
    if (pos) handlePick(pos.latitude, pos.longitude);
  };

  const doResolve = (value: LocationPickerValue | null) => {
    if (resolvedRef.current) return;  // 防双重 resolve
    resolvedRef.current = true;
    resolvePick(value);
  };

  const handleConfirm = () => {
    if (!isValidLatitude(lat) || !isValidLongitude(lng)) return;
    const value: LocationPickerValue = {
      latitude: lat, longitude: lng, country, city,
      state: '', detail_location: detail, displayName: detail,
    };
    doResolve(value);
    navigation.goBack();
  };

  const handleCancel = () => { doResolve(null); navigation.goBack(); };

  // 硬件返回键 —— doResolve 内部已防重入
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (e.data.action.type === 'GO_BACK') { doResolve(null); }
    });
    return unsub;
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="arrow-left" onPress={handleCancel} />
        <Text variant="titleMedium" style={{ flex: 1 }}>选择位置</Text>
        <Button mode="text" onPress={handleConfirm} disabled={!isValidLatitude(lat) || !isValidLongitude(lng)}>
          完成
        </Button>
      </View>

      {/* 搜索栏 */}
      <View style={styles.searchBar}>
        <TextInput style={styles.searchInput} placeholder="搜索地址"
          value={searchText} onChangeText={setSearchText} onSubmitEditing={handleSearch} />
        <IconButton icon="magnify" onPress={handleSearch} />
        <IconButton icon="crosshairs-gps" onPress={handleUseMyLocation} />
      </View>
      {searchResults.length > 0 && (
        <Card style={styles.searchResults}>
          {searchResults.map((r, i) => (
            <TouchableOpacity key={i} onPress={() => handleSelectResult(r)} style={styles.searchItem}>
              <Text>{r.displayName}</Text>
              <Text variant="bodySmall">📍 {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}</Text>
            </TouchableOpacity>
          ))}
        </Card>
      )}

      {/* 地图 */}
      <View style={{ flex: 1 }}>
        <LeafletMap
          mode="pick"
          mapProvider={mapProvider}
          amapKey={amapKey}
          initialLatLng={lat != null && lng != null ? [lat, lng] : null}
          onPick={handlePick}
        />
      </View>

      {/* 底部信息卡片 */}
      <Card style={styles.bottomCard}>
        <Card.Content>
          {reverseGeocoding ? (
            <ActivityIndicator size="small" />
          ) : (
            <>
              <Text variant="labelSmall">坐标: {lat?.toFixed(5) ?? '-'}, {lng?.toFixed(5) ?? '-'}</Text>
              <TextInput style={styles.detailInput} placeholder="详细位置" value={detail} onChangeText={setDetail} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput style={styles.cityInput} placeholder="国家" value={country} onChangeText={setCountry} />
                <TextInput style={styles.cityInput} placeholder="城市" value={city} onChangeText={setCity} />
              </View>
            </>
          )}
        </Card.Content>
      </Card>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 56 },
  searchBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  searchInput: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, height: 40 },
  searchResults: { marginHorizontal: 8, marginBottom: 4, maxHeight: 200 },
  searchItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  bottomCard: { margin: 8 },
  detailInput: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, marginVertical: 8, height: 40 },
  cityInput: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, height: 40 },
});
```

### 4.2 GPS 获取

从 `locationService.native.ts` 导出一个轻量 `getCurrentPosition()`（不触发逆向 geocoding，只拿坐标）。当前 `locationService` 可能没有这个独立导出，需检查并补充：

```ts
// mobile/src/services/locationService.native.ts 新增导出
export async function getCurrentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    // 复用现有的 cache → getLastKnownPositionAsync → geolocation → watchPositionAsync 链
    // 但只返回坐标，不做逆向 geocoding
    ...
  } catch { return null; }
}
```

## 5. 集成：`ShotLogScreen.tsx`

### 5.1 改动位置

底部添加表单的「Detail / Address」字段旁（搜索 `detail_location` 或 `setNewDetail` 的位置）。

### 5.2 新增按钮

```tsx
const { pickLocation } = useLocationPicker();

const handlePickLocation = async () => {
  const initial = newLatitude && newLongitude ? {
    latitude: newLatitude, longitude: newLongitude,
    country: newCountry, city: newCity, detail_location: newDetail,
  } : null;
  const result = await pickLocation(initial);
  if (result) {
    setNewLatitude(result.latitude);
    setNewLongitude(result.longitude);
    if (result.country) setNewCountry(result.country);
    if (result.city) setNewCity(result.city);
    if (result.detail_location) setNewDetail(result.detail_location);
  }
};

// UI
<Button mode="outlined" onPress={handlePickLocation} icon="map-marker">
  地图选择
</Button>
```

### 5.3 `EntryEditModal` 等价物（如有）

手机 `ShotLogScreen` 的编辑模式——需检查是否有独立编辑界面。根据探索，手机是 FlatList + 底部添加表单 + 内联编辑，没有独立的 `EntryEditModal`。编辑现有条目可能是点击条目展开内联编辑。

集成方式：编辑展开后同样加「地图选择」按钮，调 `pickLocation`，结果填入当前编辑条目 state。

## 6. 集成：`PhotoViewScreen.tsx`（可选 Tier 2）

当前位置只读。加「编辑位置」action：

```tsx
const { pickLocation } = useLocationPicker();

const handleEditLocation = async () => {
  const initial = photo.latitude && photo.longitude ? {
    latitude: photo.latitude, longitude: photo.longitude,
    country: photo.country, city: photo.city, detail_location: photo.detail_location,
  } : null;
  const result = await pickLocation(initial);
  if (result) {
    await updatePhoto(photo.id, {
      latitude: result.latitude, longitude: result.longitude,
      country: result.country, city: result.city, detail_location: result.detail_location,
    });
    // 刷新 photo state
  }
};
```

UI：在 header 或长按菜单加「编辑位置」action。

## 7. 导航类型

```ts
// mobile/src/navigation/types.ts
export type RootStackParamList = {
  // ...现有
  LocationPicker: { initial?: LocationPickerValue | null } | undefined;
};
```

## 8. 测试要点

| 场景 | 验证 |
|---|---|
| ShotLogScreen 点「地图选择」 | 全屏打开 LocationPickerScreen |
| 无初始值打开 | 地图默认位置，无 marker |
| 有初始值打开 | 地图居中，有 marker |
| 点击地图 | marker 移动，底部卡片更新坐标 + 触发逆向 geocode |
| 拖动 marker | 同上 |
| 搜索地址 | 列表展示，点击选中后地图平移 |
| 「我的位置」 | GPS 授权后定位 |
| 「完成」 | `pickLocation` Promise resolve，source screen 收到值，字段填充 |
| 硬件返回键 | Promise resolve null，source screen 无变更 |
| amap provider | marker 与瓦片对齐（无偏移） |
| 坐标校验 | lat/lng 越界时「完成」禁用 |
| 与现有 `LeafletMap` view 模式回归 | MapScreen 不受影响 |

## 9. 工作量估算

| 项 | 估算 |
|---|---|
| `LocationPickerContext` + Provider | 2h |
| `LeafletMap` 扩展 pick 模式（含 `leafletHtml.ts`） | 4-5h |
| `LocationPickerScreen` | 4-5h |
| `getCurrentPosition` 从 `locationService` 导出 | 1h |
| `ShotLogScreen` 集成 | 2h |
| 导航类型 + `App.tsx` 注册 | 0.5h |
| `PhotoViewScreen` 集成（Tier 2） | 2h |
| 手工测试（模拟器 + 真机） | 3h |
| **小计** | **~18-21h**（不含 Tier 2 约 16h） |
