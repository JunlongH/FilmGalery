# Handoff: v4 地图不显示根因 + 修复

## 日期
2026-07-23

## 问题

桌面端 LocationPicker（选点地图模态框）不显示地图瓦片，呈现灰色空白。

## 根因

**Leaflet `<TileLayer>` 缺少 `subdomains` 属性。**

高德地图瓦片 URL 使用 `{s}` 子域名分片：
```
https://webrd0{s}.is.autonavi.com/appmaptile?...
```

Leaflet 默认 `subdomains=['a','b','c']`，所以实际请求的 URL 变成：
```
https://webrd0a.is.autonavi.com/appmaptile?...
https://webrd0b.is.autonavi.com/appmaptile?...
```

高德的 DNS 只注册了 `webrd01` ~ `webrd04`（数字），`webrd0a` 等字母子域名不存在 → DNS 解析失败 → 瓦片加载失败 → 灰色空白。

主地图页面 `PhotoMap.jsx` 在自己的 `AMAP_TILE_LAYERS` 配置中正确设置了 `subdomains: ['1','2','3','4']`，但 `LocationPicker.jsx` 的 `<TileLayer url={tileUrl} />` 没有传 `subdomains` 属性。

## 之前的错误诊断

Q4 修复（上一轮）只改了 `LocationPickerModal.getMapConfig()` 的默认 provider 从 `'osm'` 改为 `'amap'`，但没有修复 `LocationPicker.jsx` 中 `<TileLayer>` 缺少 `subdomains` 的问题。所以即使切到了高德 provider，瓦片仍然加载不出来。

## 修复

### 1. `packages/shared/mapUtils.js` — 升级 TILE_LAYERS 结构

将 `TILE_LAYERS` 从 `{ provider: { style: 'url_string' } }` 升级为完整的配置对象：
```js
{
  amap: {
    light: {
      url: 'https://webrd0{s}.is.autonavi.com/...',
      subdomains: ['1', '2', '3', '4'],
      maxZoom: 19,
    },
    // ...
  }
}
```

新增 `getTileLayerConfig(provider, style)` 返回完整配置对象。`buildTileLayerUrl()` 保留向后兼容（只返回 `.url`）。

### 2. `client/src/components/map/LocationPicker.jsx` — 使用完整配置

从 `buildTileLayerUrl` 切换到 `getTileLayerConfig`，将 `subdomains`、`maxZoom`、`className` 传给 `<TileLayer>`：
```jsx
<TileLayer
  url={tileConfig.url}
  subdomains={tileConfig.subdomains || ['a', 'b', 'c']}
  maxZoom={tileConfig.maxZoom || 19}
  className={tileConfig.className}
/>
```

### 3. 测试

`packages/shared/__tests__/mapUtils.test.js` — 更新 `buildTileLayerUrl` 测试适配新结构（`.url`），新增 `getTileLayerConfig` 测试验证 `subdomains` 等。

## 验证

- `curl https://webrd01.is.autonavi.com/appmaptile?...` → HTTP 200, image/png ✅
- `curl https://webrd0a.is.autonavi.com/appmaptile?...` → HTTP 000, DNS 失败 ❌（旧行为）
- Jest: 1044/1044 tests passing ✅
- Lint: 0 errors ✅

## 后续建议

`PhotoMap.jsx` 仍使用自己硬编码的 `AMAP_TILE_LAYERS` 而非 `packages/shared/mapUtils.js` 的 `TILE_LAYERS`。虽然两者目前一致，但存在漂移风险。建议后续将 `PhotoMap.jsx` 也迁移到使用 `getTileLayerConfig()`。
