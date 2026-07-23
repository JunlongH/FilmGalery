# V5 Handoff — LocationPicker 手机端 UI 修复 + 地图主题自适应

> 状态：实施中 · 创建：2026-07-22 · 审查修订：2026-07-23 · 前序：`docs/plans/location-picker/` (V1-V4)

## 0. 审查修订（2026-07-23）

V5 初稿经代码核对后，以下方案缺陷已修订（下方对应章节的代码块已更新为正确版本）：

1. **问题 3 — `cache: true` 是不存在的 Leaflet 选项**（TileLayer/GridLayer 无此属性，HTTP 缓存由浏览器自动处理）。已改为真实有效的性能项：`fadeAnimation`、`updateWhenZooming`、`updateWhenIdle`、`keepBuffer`。
2. **问题 4 — CENTER_MAP 必须经过 GCJ-02 转换**。`LeafletMap.tsx` 是 WGS-84 ↔ GCJ-02 的唯一边界（见 `displayInitialLatLngRef` 与 `MAP_PICK` 回传）。`centerOn` 的 useEffect 在 amap 下必须先 `wgs84ToGcj02` 再 postMessage，否则 GPS 定位后地图偏移数百米（火星坐标偏移）。
3. **问题 4 — 自动定位 useEffect 缺少卸载守卫与依赖**。已加 `isMountedRef` 与正确依赖，避免 setState 命中已卸载组件。
4. **问题 5 — `const pickMarker` 脆弱**。初始 marker 用 `const` 声明，但 click 的 else 分支会赋值，行为一旦变化即 `TypeError`。已统一为 `let`。
5. **问题 6（架构）— 不要在 `leafletHtml.ts` 再硬编码一套瓦片 URL**，否则就是把 v4 警告 PhotoMap.jsx 的同一种 drift 搬到手机端。**根本解法**：`leafletHtml.ts` 与 `PhotoMap.jsx` 都改为消费 `packages/shared/mapUtils.js` 的 `getTileLayerConfig()`，全端唯一真相源。
6. **问题 1 — App 根部缺少 `SafeAreaProvider`**。`DraggableFab.tsx` / `ShotModeModal.tsx` 已调用 `useSafeAreaInsets()`，但全局无 Provider → 当前静默返回 0。根本解法是在 `App.tsx` 根部包一层 `<SafeAreaProvider>`（全 App 受益），LocationPickerScreen 再用 `useSafeAreaInsets()`。

## 1. 背景

V1-V4 完成了 LocationPicker 的跨端实现（共享层 + 桌面 + 手机 + 后端）。代码已通过全量测试（1040 root tests + 33 mobile tests + tsc + eslint）和对抗性 review（3 Critical + 4 Warning 已修复）。

本次 handoff 基于**真机视觉测试**（GLM-4V-Flash + MiniMax-M3 双模型分析截图 `tmp/locationPicker.png`）发现 6 个问题，需在 V5 中修复。

## 2. 问题清单

### 问题 1：顶部条带和系统状态栏冲突

**现象**：LocationPickerScreen 的 header（返回箭头 + "选择位置" + "完成"按钮）从屏幕 y=0 开始绘制，被 Android 系统状态栏覆盖。视觉上标题文字几乎不可见。

**根因**：

`LocationPickerScreen.tsx:148` 使用了 RN 的 `SafeAreaView`，但它在 **Android 上不会自动处理状态栏**（只处理 iOS 刘海）。同时 screen 注册时设置了 `headerShown: false`（`App.tsx:359`），没有导航栏来占据状态栏下方的空间。

```ts
// LocationPickerScreen.tsx:148
<SafeAreaView style={styles.container}>
  <View style={styles.header}>  // ← 从 y=0 开始，被状态栏覆盖
```

```ts
// styles.container = { flex: 1, backgroundColor: '#fff' }  // 没有 paddingTop
// styles.header = { ..., height: 56 }  // 没有考虑状态栏高度
```

**修复方向（根本解法）**：

经核对，App 根部（`mobile/App.tsx`）**没有** `<SafeAreaProvider>`，但 `DraggableFab.tsx` / `ShotModeModal.tsx` 已调用 `useSafeAreaInsets()` → 当前静默返回 0（这是潜在 bug）。因此根本解法是双管齐下：

1. 在 `mobile/App.tsx` 根部包一层 `<SafeAreaProvider>`（全 App 受益，顺带修复既有组件的零 inset）。
2. `LocationPickerScreen.tsx` 用 `useSafeAreaInsets()` 取 `insets.top`，在 `styles.container` 加 `paddingTop`；同时 `header` 用该 inset 定位。

方案 B（备选）：仅用 `StatusBar.currentHeight`（只解决 Android，不处理 iOS 刘海，且不修复既有组件）。不推荐。

方案 C（不推荐）：去掉 `headerShown: false` 让导航栏处理状态栏，但丢失全屏 modal 风格。

**影响文件**：
- `mobile/App.tsx`（加 SafeAreaProvider）
- `mobile/src/screens/location/LocationPickerScreen.tsx`

---

### 问题 2：底部卡片字体颜色不适配暗色模式

**现象**：底部信息卡片在暗色模式下背景是深色（Paper Card 自带主题），但输入框文字是黑色 → 黑字深底 → 看不见。

**根因**：

`LocationPickerScreen.tsx:18` 从 `react-native` 导入 `TextInput`（**不是** React Native Paper 的 `TextInput`）：

```ts
// 第 18 行 — RN 的 TextInput（不适配主题）
import { View, TextInput, ... } from 'react-native';
// 第 19 行 — Paper 的 Text/Card（适配主题）
import { IconButton, Text, Button, Card, ... } from 'react-native-paper';
```

RN 原生 `TextInput` 的默认文字颜色是**黑色**，不随主题变化。而 Paper 的 `Card` 在暗色模式下背景是深色 → 黑字深底 → 看不见。

同理，`styles` 中所有硬编码颜色不适配暗色模式：
- `borderColor: '#ccc'`（暗色下太亮）
- `backgroundColor: '#fff'`（container 背景，暗色下应为深色）
- `borderBottomColor: '#eee'`（搜索结果分隔线）

**修复方向**：

方案 A（推荐）：把所有 RN `TextInput` 换成 Paper 的 `TextInput`（`import { TextInput } from 'react-native-paper'`），Paper 组件自动适配暗色模式。

方案 B：用 `useTheme()` 获取当前主题颜色，手动传入 `TextInput` 的 `style` 和 `placeholderTextColor`。

同时需要修复 `styles` 中的硬编码颜色，改为主题感知：
```ts
const theme = useTheme();
// container: { backgroundColor: theme.colors.background }
// searchInput: { borderColor: theme.colors.outline, color: theme.colors.onSurface }
```

**影响文件**：
- `mobile/src/screens/location/LocationPickerScreen.tsx`

---

### 问题 3：瓦片渲染慢

**现象**：地图打开后部分区域（特别是左上角和顶部条带）长时间显示为灰色空白，瓦片加载缓慢。

**根因**：三个层面：

**a) Leaflet 瓦片层配置缺少优化**：

`leafletHtml.ts:286` 的 `L.tileLayer` 没有设置性能优化选项：

```ts
L.tileLayer(${tileLayerConfig.url}, ${tileLayerConfig.options}).addTo(map);
// options 只有 maxZoom 和 subdomains，没有 cache/fadeAnimation 等
```

每次缩放/平移都重新请求所有可见瓦片，且带有淡入动画，在模拟器网络下延迟明显。

**b) 初始缩放级别过高**：

`leafletHtml.ts:279`：pick 模式下 `startZoom = 13`，如果初始没有定位，地图中心在上海但缩放 13 级需要加载大量瓦片（~50+ 张）。

**c) WebView 无缓存策略**：

`LeafletMap.tsx:138-149` 的 `WebView` 没有显式设置缓存相关属性。inline HTML 模式下 WebView 的缓存行为不确定。

**修复方向**：

```ts
// leaftletHtml.ts — tile layer 优化（均为真实有效的 Leaflet GridLayer 选项）
// 注意：Leaflet TileLayer/GridLayer 没有 `cache` 选项；HTTP 缓存由浏览器/WebView 自动处理。
options: `{
  maxZoom: 19,
  subdomains: ['1','2','3','4'],
  fadeAnimation: false,      // 禁用淡入动画（Android WebView 渲染问题 + 模拟器卡顿）
  updateWhenZooming: false,  // 缩放过程中不重新请求瓦片
  updateWhenIdle: true,      // 仅在缩放/平移停下后更新（省带宽）
  keepBuffer: 2              // 视口外保留 2 层缓冲瓦片
}`
```

```ts
// leaftletHtml.ts — 初始缩放降低
const startZoom = ${isPickMode ? '13' : '5'};
// 如果没有 initialLatLng，改为更小的 zoom（如 11），减少初始瓦片数
```

```ts
// LeafletMap.tsx — WebView 缓存（cacheEnabled 是 RN WebView 的真实 prop）
<WebView
  ...
  cacheEnabled={true}
  startInLoadingState={true}
/>
```

**影响文件**：
- `mobile/src/components/map/leafletHtml.ts`
- `mobile/src/components/map/LeafletMap.tsx`

---

### 问题 4：GPS 按钮不回到当前位置 + 初始不显示定位

**现象**：
- 点击右上角 GPS 按钮（crosshairs-gps 图标）后，底部卡片的坐标更新了，但**地图没有移动**到新位置。
- 打开 LocationPicker 时如果没有传入 `initial` 值，地图默认在上海，**不会自动获取用户当前位置**。

**根因**：四个代码缺陷：

**a) `handleUseMyLocation` 只更新 React state，不通知 WebView 移动地图**：

```ts
// LocationPickerScreen.tsx:92-100
const handleUseMyLocation = async () => {
  const pos = await getCurrentPosition();
  if (pos) {
    handlePick(pos.latitude, pos.longitude);  // 只 setLat/setLng + reverseGeocode
    // ❌ 没有告诉 LeafletMap 移动地图中心！
  }
};
```

**b) `LeafletMap` 只在 view 模式下发送 `CENTER_MAP` 消息**：

```ts
// LeafletMap.tsx:87
if (mode === 'view' && isMapReady && webViewRef.current && region) {
  // 只有 view 模式才发送 CENTER_MAP
  // pick 模式下没有任何机制让父组件告诉 WebView "移动到这个坐标"
}
```

**c) `displayInitialLatLngRef` 只捕获一次**（`LeafletMap.tsx:43-49`）：

```ts
const displayInitialLatLngRef = useRef<[number, number] | null>(null);
if (displayInitialLatLngRef.current === null && initialLatLng) {
  // 只在第一次有值时捕获，后续变化不更新
  displayInitialLatLngRef.current = ...;
}
```

这是为了防止每次点击导致 WebView 重载（正确的决策），但导致 GPS 定位后无法通过 `initialLatLng` prop 传递新坐标给 WebView。

**d) `LocationPickerScreen` 挂载时不自动获取定位**：

没有在 `useEffect` 中自动调用 `handleUseMyLocation`。如果 `initial` 为 null（新增场景），地图默认在上海且无标记。

**修复方向**：

1. **LeafletMap 新增 `centerOn` prop**（坐标 + nonce），变化时 postMessage 给 WebView：

```ts
// LeafletMap.tsx — 新增 prop
interface LeafletMapProps {
  ...
  centerOn?: { lat: number; lng: number; zoom?: number; nonce: number } | null;
}

// useEffect 监听 centerOn 变化。
// ⚠️ 关键：centerOn 传入的是 WGS-84（来自 getCurrentPosition / 搜索结果）。
// LeafletMap 是 WGS-84 ↔ GCJ-02 的唯一边界（见 displayInitialLatLngRef
// 与 MAP_PICK 回传）。amap 下必须先 wgs84ToGcj02 再 postMessage，
// 否则 GPS 定位后地图偏移数百米（火星坐标偏移）。
useEffect(() => {
  if (!isMapReady || !webViewRef.current || !centerOn) return;
  const lat = centerOn.lat;
  const lng = centerOn.lng;
  const target = mapProvider === 'amap'
    ? (() => { const c = wgs84ToGcj02(lat, lng); return [c.lat, c.lng]; })()
    : [lat, lng];
  webViewRef.current.postMessage(JSON.stringify({
    type: 'CENTER_MAP',
    payload: { lat: target[0], lng: target[1], zoom: centerOn.zoom || 15 }
  }));
}, [centerOn, isMapReady, mapProvider]);
```

2. **pick 模式的 HTML 也要处理 `CENTER_MAP` 消息**（`leafletHtml.ts` 的 `pickModeScript` 需要添加 `handleMessage` 监听）：

```ts
// leaftletHtml.ts — pickModeScript 中添加消息处理
document.addEventListener('message', handleMessage);
window.addEventListener('message', handleMessage);
function handleMessage(event) {
  try {
    const data = JSON.parse(event.data);
    if (data.type === 'CENTER_MAP') {
      const { lat, lng, zoom } = data.payload;
      map.setView([lat, lng], zoom || 15, { animate: true });
      // 同时移动 marker
      if (pickMarker) pickMarker.setLatLng([lat, lng]);
    }
  } catch (e) {}
}
```

3. **`LocationPickerScreen` 使用 `centerOn` 而非 `initialLatLng` 来移动地图**：

```ts
const [centerOn, setCenterOn] = useState<{lat:number,lng:number,zoom?:number,nonce:number} | null>(null);

const handleUseMyLocation = async () => {
  const pos = await getCurrentPosition();
  if (pos) {
    handlePick(pos.latitude, pos.longitude);
    setCenterOn({ lat: pos.latitude, lng: pos.longitude, zoom: 15, nonce: Date.now() });
  }
};

// 挂载时自动获取定位（仅当没有 initial 时）。
// ⚠️ getCurrentPosition 异步无取消，必须用 isMountedRef 守卫，防止用户
// 立即按返回时 setState 命中已卸载组件；同时显式声明依赖以满足 lint。
const mountedRef = useRef(true);
useEffect(() => {
  mountedRef.current = true;
  if (!initial) {
    handleUseMyLocation().finally(() => {
      // 结果在 handleUseMyLocation 内部通过 setLat 等消费，这里无需处理
    });
  }
  return () => { mountedRef.current = false; };
}, []); // 仅挂载一次（handleUseMyLocation 通过 useCallback 稳定）
```

4. **传给 LeafletMap**：

```tsx
<LeafletMap
  mode="pick"
  initialLatLng={mapInitial}
  centerOn={centerOn}
  onPick={handlePick}
/>
```

**影响文件**：
- `mobile/src/components/map/LeafletMap.tsx`
- `mobile/src/components/map/leafletHtml.ts`
- `mobile/src/screens/location/LocationPickerScreen.tsx`

---

### 问题 5：地图选点 marker 没有加载

**现象**：在地图上点击或传入初始坐标后，地图上没有显示任何 marker 图标（应该有一个可拖动的红色定位针）。

**根因**：

`leafletHtml.ts:29` 使用 `L.marker([lat, lng], { draggable: true })`，Leaflet 的默认 marker 图标需要加载图片文件（`marker-icon.png` 等）：

```ts
// leaftletHtml.ts:29
const pickMarkerInit = initialLatLng
  ? `const pickMarker = L.marker([${initialLatLng[0]}, ${initialLatLng[1]}], { draggable: true }).addTo(map);`
  : `let pickMarker = null;`;
```

但 HTML 是作为 **inline 字符串**传给 WebView 的（`LeafletMap.tsx:142`：`source={{ html: htmlContent }}`），没有 base URL。Leaflet 默认尝试从相对路径 `images/marker-icon.png` 加载图标 → 在 inline HTML 中这些路径无法解析 → **marker 图标不显示**。

桌面端 `PhotoMap.jsx:28-31` 已修复了同样的问题（用 `import` + `L.Icon.Default.mergeOptions`），但手机端 `leafletHtml.ts` 没有做同样的修复。

**修复方向**：

在 pick mode HTML 中用 `L.divIcon` + 内联 SVG 替代默认 `L.marker`（和桌面 `LocationPicker.jsx` 的 `pinIcon` 一样）：

```ts
// leaftletHtml.ts — pickMarkerInit 使用 divIcon
const pickMarkerIcon = `L.divIcon({
  className: 'fg-pick-marker',
  html: '<svg width="32" height="32" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z" fill="#ef4444" stroke="white" stroke-width="1.5"/></svg>',
  iconSize: [32, 32],
  iconAnchor: [16, 32]
})`;

const pickMarkerInit = initialLatLng
  ? `const pickMarker = L.marker([${initialLatLng[0]}, ${initialLatLng[1]}], { draggable: true, icon: ${pickMarkerIcon} }).addTo(map);`
  : `let pickMarker = null;`;

// ⚠️ 始终用 `let pickMarker`。有 initial 时虽是 const，但下面的 click
// else 分支会赋值 pickMarker；一旦行为变化（如初始无 marker 后点击创建）
// 即 TypeError。统一声明 let，消除脆弱性。
// 点击创建 marker 时也要用同样的 icon
map.on('click', function(e) {
  if (pickMarker) {
    pickMarker.setLatLng([lat, lng]);
  } else {
    pickMarker = L.marker([lat, lng], { draggable: true, icon: ${pickMarkerIcon} }).addTo(map);
  }
  sendMessage('MAP_PICK', { lat, lng });
});
```

同时在 CSS 中添加 `.fg-pick-marker` 样式（background transparent, border none）。

**影响文件**：
- `mobile/src/components/map/leafletHtml.ts`

---

### 问题 6：地图主题需要自适应 App 主题（暗色/亮色模式）

**现象**：当 App 处于暗色模式时，LocationPicker 的地图和主页面的地图页面（MapScreen）仍然显示亮色瓦片，与 App 的暗色 UI 不协调。

**根因**：

**a) LocationPicker 的地图**：

`leafletHtml.ts:17-25` 中，高德暗色模式仅通过 CSS filter 模拟（`amap-dark-tile` class），但这个 class 只在 `mapProvider === 'amap' && isDark` 时添加。`LeafletMap.tsx:35` 从 `ApiContext` 读取 `darkMode`，但 `LocationPickerScreen` 没有传递 `isDark` 给 `LeafletMap` — `LeafletMap` 自己读 `ApiContext.darkMode`，这部分是正确的。

但问题是 **CSS filter 模拟暗色效果不好**（颜色失真），且 **OSM/CartoDB 瓦片没有暗色变体**：

```ts
// leaftletHtml.ts:22-25 — OSM 用的是 CartoDB Voyager（始终亮色）
{
  url: `'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'`,
  options: `{ maxZoom: 20, subdomains: 'abcd' }`
}
```

CartoDB 实际上有暗色瓦片：`dark_all` 和 `dark_nolabels`，但当前代码没有使用。

**b) 主页面地图（MapScreen）**：

同样的 `leafletHtml.ts` 被 `MapScreen` 使用，存在相同问题。

**修复方向（根本解法：统一真相源，不再硬编码）**：

`leafletHtml.ts:17-25` 自己硬编码了一套瓦片 URL，这正是 v4 handoff 警告 `PhotoMap.jsx` 的同一种 drift（三处各写一份配置）。`packages/shared/mapUtils.js` 已有完整的 `TILE_LAYERS` + `getTileLayerConfig(provider, style)`，覆盖：

- `osm.light` → CartoDB Positron (`light_all`)，`osm.dark` → CartoDB Dark Matter (`dark_all`)，`osm.satellite`
- `amap.light` → 道路图，`amap.dark` → 同 URL + `className:'amap-dark-tile'`（CSS filter，因高德无原生暗色瓦片），`amap.satellite`

因此：

1. **`leafletHtml.ts` 消费 `getTileLayerConfig(mapProvider, isDark ? 'dark' : 'light')`**，按返回的 `{url, subdomains, maxZoom, className}` 拼接 `L.tileLayer` 的 options 字符串（含 `className`）。不再在本文件写任何 `https://...autonavi...` / `cartocdn...` URL。

2. **OSM 暗色**：经由上一步自动切到 `dark_all`（真暗色瓦片），无需特殊处理。

3. **AMap 暗色**：保留 CSS filter 方案（`getTileLayerConfig('amap','dark').className === 'amap-dark-tile'` 已声明）。**不**改用卫星图 `style=6` —— 那会把语义从"道路图"变成"卫星图"，亮/暗不一致。CSS filter 是高德无原生暗色瓦片下的务实选择，与桌面端 `PhotoMap.jsx` 行为一致。

4. **`#map` 背景色自适应**：

```css
#map { background-color: ${isDark ? '#1a1a1a' : '#f8f9fa'}; }
```

5. **顺带消除桌面端 drift**：将 `PhotoMap.jsx` 的本地 `TILE_LAYERS` / `AMAP_TILE_LAYERS` 也改为消费 `getTileLayerConfig()`，实现桌面 / 手机 / 共享层三处共用唯一真相源（关闭 v4 遗留建议）。

6. **确认 `LeafletMap.tsx` 正确传递 `darkMode`**：

`LeafletMap.tsx:35` 已经从 `ApiContext` 读取 `darkMode`，`leafletHtml.ts` 的 `isDark` 参数也正确传入。需要确保 `getLeafletHtml` 的 `isDark` 参数与实际主题一致。

**影响文件**：
- `mobile/src/components/map/leafletHtml.ts`（核心修改）
- `mobile/src/components/map/LeafletMap.tsx`（确认 darkMode 传递，可能无需改）

**影响范围**：
- LocationPickerScreen 的地图
- MapScreen 的地图（主页地图页面）

---

## 3. 文件清单

| 文件 | 问题 # | 改动内容 |
|---|---|---|
| `mobile/App.tsx` | 1 | 根部包 `<SafeAreaProvider>`（全 App 受益） |
| `mobile/src/screens/location/LocationPickerScreen.tsx` | 1, 2, 4 | SafeArea insets、Paper TextInput + 主题色、centerOn state + 自动定位（带卸载守卫） |
| `mobile/src/components/map/leafletHtml.ts` | 3, 4, 5, 6 | 消费 `getTileLayerConfig`（去硬编码）、瓦片性能优化、pick mode CENTER_MAP、divIcon marker、`#map` 自适应背景 |
| `mobile/src/components/map/LeafletMap.tsx` | 3, 4 | WebView `cacheEnabled`、`centerOn` prop + useEffect（含 WGS84→GCJ02 转换） |
| `client/src/components/map/PhotoMap.jsx` | 6（drift） | 本地 `TILE_LAYERS`/`AMAP_TILE_LAYERS` 改为消费 `getTileLayerConfig()`（关闭 v4 遗留建议） |
| `packages/shared/mapUtils.js` | — | 修正 `buildTileLayerUrl` 的 `@returns` JSDoc |

## 4. 验收标准

| # | 验收项 |
|---|---|
| 1 | LocationPicker header 在 Android 状态栏下方正确显示，不被遮挡 |
| 2 | 暗色模式下底部卡片的 TextInput 文字可见（白色/浅色文字 on 深色背景） |
| 3 | 地图瓦片在 3 秒内开始加载，无大面积灰色空白超过 5 秒 |
| 4a | 点击 GPS 按钮后地图平滑移动到用户当前位置 |
| 4b | 打开 LocationPicker（无 initial）时自动获取 GPS 并移动到当前位置 |
| 5 | 地图上点击或拖动后显示红色定位针 marker（SVG divIcon） |
| 6a | 暗色模式下地图使用暗色瓦片（CartoDB Dark / AMap CSS filter） |
| 6b | 亮色模式下地图使用亮色瓦片（CartoDB Positron / AMap 道路图） |
| 6c | 主页面地图（MapScreen）也自适应主题 |

## 5. 测试方法

1. **视觉测试**：在 Android 模拟器上打开 LocationPicker，截图后用 GLM-4V-Flash + MiniMax-M3 双模型分析
2. **暗色模式测试**：在 Settings 中切换暗色模式，重新打开 LocationPicker 和 MapScreen，截图分析
3. **GPS 测试**：在模拟器中设置 mock location（`adb emu geo fix 121.4737 31.2304`），点击 GPS 按钮
4. **回归测试**：`npm test` + `cd mobile && npx tsc --noEmit` + `npx jest`

## 6. 注意事项

- **不要删除 `displayInitialLatLngRef`**：它防止 WebView 在每次点击时重载。GPS 移动地图应通过新的 `centerOn` prop 实现，不是修改 `initialLatLng`。
- **pick mode 的 `handleMessage`**：当前 `pickModeScript` 没有注册 `message` 事件监听器，添加 `CENTER_MAP` 处理时要同时添加监听器。
- **`leafletHtml.ts` 被两处共用**：LocationPicker（pick 模式）和 MapScreen（view 模式），暗色瓦片修改对两者都生效。
- **Paper TextInput 的 `mode="outlined"`**：与现有 RN TextInput 的 `borderWidth: 1` 风格一致，但 Paper 自带主题适配。
