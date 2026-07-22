# 03 · 共享层改动（`@filmgallery/shared` + `@filmgallery/types`）

## 1. 目标

1. 抽取统一的 geocoding 模块（正向 + 逆向），消除三处重复实现
2. 补充共享类型（`LocationPickerValue`、`MapProvider`、`GeocodeConfig` 等）
3. 抽取地图工具（瓦片 URL、聚类算法、`MapProvider` 常量）
4. 保持向后兼容：现有导入路径不破坏

## 2. 新增/改动文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `packages/@filmgallery/types/index.d.ts` | 改 | 新增 `MapProvider`、`LocationPickerValue`、`GeocodeConfig`、`SearchOptions`、`SearchResult` |
| `packages/shared/geocoding.js` | **新增** | 统一正向 + 逆向 geocoding（provider 配置注入） |
| `packages/shared/geocoding.d.ts` | **新增** | 类型声明 |
| `packages/shared/__tests__/geocoding.test.js` | **新增** | 单测 |
| `packages/shared/geocode.js` | 改 | 保留作为 BigDataCloud 单 provider 实现；`reverseGeocode` 内部可选调用 |
| `packages/shared/mapUtils.js` | **新增** | 瓦片 URL 构建、聚类算法、`MAP_PROVIDERS` 常量 |
| `packages/shared/mapUtils.d.ts` | **新增** | 类型声明 |
| `packages/shared/index.js` | 改 | re-export 新模块 |
| `packages/shared/package.json` | 改 | 新增 `./geocoding` 与 `./mapUtils` subpath exports |

## 3. `@filmgallery/types` 补充

```ts
// packages/@filmgallery/types/index.d.ts （在现有 GeocodeResult 之后追加）

export type MapProvider = 'osm' | 'amap';

export interface GeocodeConfig {
  provider: MapProvider;
  amapKey?: string;
  signal?: AbortSignal;
  timeout?: number;          // ms，默认 5000
}

export interface SearchOptions extends GeocodeConfig {
  limit?: number;            // 默认 5
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

// LocationPickerValue：在 GeocodeResult 基础上新增 detail_location 字段
// 其余字段（displayName/country/city/state/latitude/longitude）与 GeocodeResult 对齐
export interface LocationPickerValue {
  latitude: number;
  longitude: number;
  country: string;
  city: string;
  state: string;
  detail_location: string;  // 新增字段：完整格式化地址（picker 中可编辑）
  displayName: string;       // 与 GeocodeResult.displayName 同义，保留以对齐契约
}
```

**迁移**：
- `mobile/src/context/ApiContext.ts:3` 的 `export type MapProvider = 'osm' | 'amap'` 改为从 `@filmgallery/types` 导入
- 桌面无类型（`.jsx`），但在新 `LocationPicker.jsx` 的 JSDoc 中引用该契约

## 4. `@filmgallery/shared/geocoding`（新模块）

### 4.1 API

```js
const {
  searchAddress,        // (query: string, opts: SearchOptions) => Promise<SearchResult[]>
  reverseGeocode,       // (lat: number, lng: number, opts: GeocodeConfig) => Promise<GeocodeResult>
  getCityCoordinates,   // (country: string, city: string, opts: GeocodeConfig) => Promise<{latitude, longitude} | null>
  // 内部 provider（导出便于单测）
  searchWithAmap,
  searchWithPhoton,
  searchWithNominatim,
  reverseWithAmap,
  reverseWithPhoton,
  reverseWithNominatim,
} = require('@filmgallery/shared/geocoding');
```

### 4.2 Provider 链

**`searchAddress(query, opts)`**：
```
1. if opts.provider === 'amap' && opts.amapKey:
     try searchWithAmap(query, amapKey, limit)
     catch → 落到下一步
2. try searchWithPhoton(query, limit)
     catch → 下一步
3. try searchWithNominatim(query, limit)  // 1.1s 限速
     catch → 返回 []
```

**`reverseGeocode(lat, lng, opts)`**：
```
1. if opts.provider === 'amap' && opts.amapKey:
     try reverseWithAmap(lat, lng, amapKey)  // 输入 WGS-84 → GCJ-02 调用
     catch → 下一步
2. try reverseWithPhoton(lat, lng)
     catch → 下一步
3. try reverseWithNominatim(lat, lng)  // 1.1s 限速
     catch → 返回空 GeocodeResult（不抛错）
```

> **注意**：手机版当前还包含 BigDataCloud 作为兜底（`locationService.native.ts:105-114`）。统一模块应保留这个能力。决策：
> - 在 `reverseGeocode` 链尾追加 BigDataCloud 作为第 4 兜底（无 key、免费）
> - 链顺序：AMap → Photon → Nominatim → BigDataCloud → 空 result
> - 手机 `locationService` 改为直接调 `reverseGeocode`，去掉自己重复的 AMap/BigDataCloud 调用

### 4.3 坐标转换

所有 AMap 调用前后通过 `coordTransform` 转换：
- `searchWithAmap`：AMap 返回 GCJ-02 → `gcj02ToWgs84` → 输出 WGS-84
- `reverseWithAmap`：输入 WGS-84 → `wgs84ToGcj02` → 调 AMap → 返回值坐标 echo 原始 WGS-84

### 4.4 限速

- Nominatim：1.1s 间隔（复用现有 `waitForNominatimRateLimit` 逻辑）
- 其他 provider：无主动限速
- `AbortController` 超时：默认 5s

### 4.5 与现有代码的关系

| 现有 | 处理 |
|---|---|
| `client/src/utils/geocoding.js`（377 行） | **改为薄封装**：从 `@filmgallery/shared/geocoding` re-export `searchAddress`/`reverseGeocode`/`getCityCoordinates`；内部加一个 `getGeocodeConfig()` 读 `localStorage` 返回 `{ provider, amapKey }` 的便捷方法供桌面旧调用方使用 |
| `packages/shared/geocode.js`（BigDataCloud） | **保留**，被新 `geocoding.js` 的 `reverseGeocode` 链调用；继续单独导出供 watch-app 直接使用 |
| `mobile/src/services/locationService.native.ts` 的逆向部分 | **改为调用** `@filmgallery/shared/geocoding` 的 `reverseGeocode`，配置从 `AsyncStorage` 读取注入；GPS 获取逻辑保留（设备特定） |
| `client/src/utils/geocoding.js` 的 `searchAddress` 调用方 | 无需改动（薄封装保持同签名） |

### 4.6 单测

`packages/shared/__tests__/geocoding.test.js`：
- mock fetch，验证 provider 链顺序与 fallback
- 验证 AMap 边界的坐标转换（WGS-84↔GCJ-02）
- 验证 `reverseGeocode` 永不抛错（全失败时返回空 `GeocodeResult`）
- 验证 Nominatim 限速
- 验证 `AbortSignal` 超时
- 参考现有 `packages/shared/__tests__/geocode.test.js` 风格

## 5. `@filmgallery/shared/mapUtils`（新模块）

### 5.1 动机

当前瓦片 URL 配置分散在三处：
- 桌面 `PhotoMap.jsx:48-93`（`TILE_LAYERS` 与 `AMAP_TILE_LAYERS`）
- 手机 `leafletHtml.ts:9-19`（内联构建）
- 手机 `MapScreen.tsx`（间接通过 `leafletHtml`）

聚类算法：
- 桌面用 `react-leaflet-cluster`（DOM）
- 手机 `MapScreen.tsx:174-221` 内联实现网格聚类（纯 JS）

### 5.2 API

```js
const {
  MAP_PROVIDERS,                    // ['osm', 'amap']
  TILE_LAYERS,                      // { osm: { light, dark, satellite }, amap: { ... } }
  buildTileLayerUrl,                // (provider, style, { dark }) => string
  gridCluster,                      // (points, opts) => clusters[]
  formatLatLng,                     // (lat, lng, format: 'decimal' | 'dms') => string
  isValidLatitude,                  // (n) => boolean
  isValidLongitude,                 // (n) => boolean
} = require('@filmgallery/shared/mapUtils');
```

### 5.3 `TILE_LAYERS` 结构

```js
const TILE_LAYERS = {
  osm: {
    light:    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    dark:     'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    satellite:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  },
  amap: {
    light:    'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    satellite:'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
  },
};
```

> AMap 暗色用 CSS filter 模拟（手机现状），`buildTileLayerUrl` 不处理；由调用方在地图容器加 filter。

### 5.4 `gridCluster`

抽取自 `MapScreen.tsx:174-221`，签名：
```ts
function gridCluster(
  points: Array<{ id: string|number; latitude: number; longitude: number; [k: string]: any }>,
  opts: { zoom: number; threshold?: number }
): Array<
  | { type: 'single'; id: string|number; latitude: number; longitude: number; point: any }
  | { type: 'cluster'; id: string; latitude: number; longitude: number; count: number; points: any[] }
>;
```

桌面 `PhotoMap.jsx` 仍用 `react-leaflet-cluster`（不强制迁移），但新组件（如 shot log 路径地图，Tier 3）可用共享 `gridCluster`。

### 5.5 坐标校验与格式化

```js
isValidLatitude(n)   // typeof n === 'number' && !isNaN(n) && n >= -90 && n <= 90
isValidLongitude(n)  // typeof n === 'number' && !isNaN(n) && n >= -180 && n <= 180
formatLatLng(lat, lng, 'dms')  // "39°54'27.6"N 116°23'29.4"E"
formatLatLng(lat, lng, 'decimal')  // "39.90766, 116.39150"
```

## 6. `packages/shared/package.json` subpath 新增

```jsonc
{
  "exports": {
    ".": "./index.js",
    "./geocode": { /* 已有 */ },
    "./coordTransform": { /* 已有 */ },
    "./geocoding": {
      "default": "./geocoding.js",
      "types": "./geocoding.d.ts"
    },
    "./mapUtils": {
      "default": "./mapUtils.js",
      "types": "./mapUtils.d.ts"
    }
    /* 其他已有 */
  }
}
```

`packages/shared/index.js` re-export：
```js
// 在现有 re-export 之后
module.exports.geocoding = require('./geocoding');
Object.assign(module.exports, require('./geocoding'));  // 让 searchAddress 等可直接从主入口导入
module.exports.mapUtils = require('./mapUtils');
Object.assign(module.exports, require('./mapUtils'));
```

## 7. 向后兼容验证

| 现有导入 | 改动后是否可用 |
|---|---|
| `require('@filmgallery/shared/coordTransform')` | ✅ 不变 |
| `require('@filmgallery/shared/geocode')` | ✅ 不变（保留） |
| `require('@filmgallery/shared')` 主入口的 `reverseGeocodeBigDataCloud` | ✅ 不变 |
| 桌面 `import { searchAddress } from '../utils/geocoding'` | ✅ 薄封装保留同签名 |
| 手机 `import { reverseGeocodeBigDataCloud } from '@filmgallery/shared/geocode'` | ✅ 不变 |

## 8. 工作量估算

| 项 | 估算 |
|---|---|
| `types` 补充 | 0.5h |
| `geocoding.js` + `.d.ts`（从桌面 `geocoding.js` 抽取，参数化） | 3-4h |
| `geocoding.test.js` | 2h |
| `mapUtils.js` + `.d.ts` | 2h |
| `mapUtils.test.js` | 1h |
| 桌面 `geocoding.js` 改薄封装 | 1h |
| 手机 `locationService.native.ts` 接入共享 `reverseGeocode` | 1.5h |
| 迁移 `MapProvider` 类型到共享 | 0.5h |
| 回归测试（桌面 + 手机） | 2h |
| **小计** | **~13-15h** |
