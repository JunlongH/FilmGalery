# 09 · 审查结果与修订记录

> 审查时间：2026-07-22
> 审查者：DeepSeek V4 Pro（adversarial review subagent）
> 审查方式：对照实际代码库验证计划文档的每项声明

## 总体结论

**计划架构合理，但实现前需修订 4 个 Critical 问题。**

"共享数据层、不共享渲染层"的决策正确；后端改动范围得当；Phase 依赖顺序（共享层先行）正确；工作量估算 ~65-80h 略乐观但合理。主要问题集中在代码示例的具体错误和对现有 API 的误用。

## Critical（阻塞实现，必须修）

### C1. `coordTransform` 返回对象，计划代码当数组用
- **计划位置**：`05-desktop.md:82-84, 96-100`
- **实际**：`packages/shared/coordTransform.js:48-60, 68-78` — `wgs84ToGcj02`/`gcj02ToWgs84` 返回 `{ lat, lng }` 对象，不是 `[lat, lng]` 数组
- **后果**：`displayMarkerPos` 会变成对象，`MapContainer.center` 期望数组；`handlePick(wgs84[0], wgs84[1])` 在 amap 时得到 `undefined`
- **修复**：用解构 `const { lat, lng } = gcj02ToWgs84(...)`，或参考 `geocoding.js:44` 现有写法

### C2. `handleUseMyLocation` 在 `LocationPickerModal` 中引用但未定义
- **计划位置**：`05-desktop.md:245`
- **实际**：函数在 `LocationPicker.jsx` 描述（:150-158）中定义，但 `LocationPickerModal.jsx`（:188-288）内未定义也未通过 prop 传入
- **修复**：在 `LocationPickerModal` 内定义，或从 `LocationPicker` 通过回调暴露

### C3. 手机 `ApiContext` 没有 `useApi` hook —— 导入路径错误
- **计划位置**：`06-mobile.md:164` — `import { useApi } from '../../context/ApiContext'`
- **实际**：`mobile/src/context/ApiContext.ts` 只导出 `ApiContext` 对象和类型，没有 `useApi` hook。现有代码用 `useContext(ApiContext)` 直接访问（见 `LeafletMap.tsx:21`）
- **修复**：在 `ApiContext.ts` 加 `useApi` 便利 hook，或改计划代码用 `useContext(ApiContext)`

### C4. `PhotoMap.jsx:331-337` 并无坐标转换代码 —— 参考引用错误
- **计划位置**：`05-desktop.md:114` — "这与现有 `PhotoMap.jsx:331-337` 的处理一致，可参考"
- **实际**：`PhotoMap.jsx:330-341` 只是读 `localStorage` 和监听 `map-settings-changed` 事件，**无坐标转换代码**
- **背景**：`PhotoMap.jsx` 的 marker 直接用 WGS-84 显示在任何瓦片上（即 amap 瓦片上会有偏移，但现有代码未处理）。计划提出的 WGS-84→GCJ-02 转换是新行为，无先例
- **修复**：更新参考引用；实现前需 spike 验证 amap 瓦片 + 转换后 marker 的对齐效果

## Warning（很可能出问题，应处理）

### W5. `lazyModal` + 条件渲染配合脆弱
- 计划用 `{showPicker && <LocationPickerModal isOpen={showPicker} .../>}`，但 `lazyModal` 内部 `hasOpened` state 随 `LazyModal` 卸载而丢失。实际能工作（chunk 已缓存），但 `LazyModal` 与内层 `LocationPickerModal` 都监听 `isOpen`，可能在关闭动画期间产生竞态
- **建议**：测试关闭动画期间的 effect 触发

### W6. React 反模式：`setState` updater 内有副作用
- **计划位置**：`06-mobile.md:53-58` — `resolvePick` 在 `setPending` updater 内调 `current?.resolve(value)`
- **问题**：React 18 strict mode 下 updater 可能被双重调用；违反 purity 契约
- **修复**：用 ref 持有 pending 请求，updater 外 resolve：
  ```ts
  const pendingRef = useRef<PendingRequest | null>(null);
  const resolvePick = (value) => {
    pendingRef.current?.resolve(value);
    pendingRef.current = null;
    setPending(null);
  };
  ```

### W7. `MapContainer` 在 modal 内零高度 —— 未调 `invalidateSize()`
- **计划位置**：`08-task-breakdown.md:242` 已识别风险，但 `05-desktop.md` 未给方案
- **问题**：HeroUI Modal 动画期间容器可能 `height: 0`，即使 CSS 设 `height: 400px` 也需 `map.invalidateSize()` 在动画结束后调用
- **修复**：`useEffect` 内 `setTimeout(() => map.invalidateSize(), 300)` 或用 `whenReady` 回调

### W8. 微调步长与 `PhotoMetaEditModal` 不一致
- **计划位置**：`05-desktop.md:259, 372`、`07-derivative-features.md:59` — 步长 `0.00001`（约 1 米）
- **实际**：`PhotoMetaEditModal.jsx:146-147` 用 `0.0001`（约 11 米）
- **后果**：非错误但与声明矛盾；1 米精度对地图点选意义不大
- **建议**：统一为 `0.0001`，或在文档中说明"精度比旧版更高"是有意为之

### W9. `beforeRemove` 监听器可能双重触发 `resolvePick`
- **计划位置**：`06-mobile.md:223-231`
- **问题**：用户点"返回" → `handleCancel()` 调 `resolvePick(null)` + `goBack()` → `goBack()` 又触发 `beforeRemove` 再次 `resolvePick(null)`
- **后果**：第二次是 no-op，但模式不整洁
- **修复**：用 `resolvedRef` 标记已解决

### W10. `GeoSearchInput` 无需新增 `provider`/`amapKey` props
- **计划位置**：`05-desktop.md:144-146` 说"需新增"，随后又说保持现状
- **实际**：`GeoSearchInput.jsx:13` 已调 `searchAddress`（内部读 `localStorage`），props 是 `{ value, onChange, onSelect, placeholder, className, style, disabled }`
- **建议**：删除"需新增 props"的表述，统一为"保持现状"

### W11. `shot_logs` 校验只查 lat/lng 不查 date/count
- **计划位置**：`04-backend.md:114-131`
- **问题**：只校验 lat/lng 范围，未校验 `entry.date` 是否存在或 `count > 0`。客户端 `ShotLogModal.jsx` 的 `handleAdd` 守卫检查这两项，但服务端无校验，恶意/异常客户端可写入脏数据
- **建议**：至少加 `if (!entry.date) throw new Error('entry.date required')`

## Nit（次要）

### N12. `buildQueryString` 参数名差异
- `metadata.js:22-25` 的 `searchLocations` 死代码确认存在；删除方案正确

### N13. 行号引用偶有 off-by-one
- 如 `film-items.js` 的 `PUT /:id` 实际是 :188（注释）/:189（`router.put`），计划写 :189-204，无实质影响

### N14. `formatLatLng` DMS 测试断言
- 期望输出 `"39°54'27.6\"N 116°23'29.4\"E"` 中方向标识 `N/E` 是否包含需明确

### N15. `LocationPickerModal` 用原始 `<Modal>` 而非 `<GlassModal>`
- `05-desktop.md:182` 直接 import `Modal`，与计划文字"用 GlassModal"不一致
- **建议**：统一用 `GlassModal`（项目标准），与 `EquipmentEditModal` 等一致

### N16. `LocationPickerValue` 与 `GeocodeResult` 字段重叠描述不准确
- `03-shared-layer.md:53-61` 说"多了 `detail_location`/`displayName` 语义"，但 `displayName` 已在 `GeocodeResult` 中
- **建议**：明确"新增 `detail_location` 字段；其余字段与 `GeocodeResult` 对齐"

## 已验证准确的关键声明

以下经对照源码确认无误，实现时无需担心：

- 库版本（`leaflet ^1.9.4`、`react-leaflet ^4.2.1`、`react-native-paper ^5.11.1`、React Navigation 6 等）
- `searchLocations` 死代码（`metadata.js:22-25` 调不存在的 `/api/locations/search`）
- `@filmgallery/api-client/locations.js` 声明 `update`/`delete` 但服务端未实现
- `shot_logs` 是 `film_items` 表的 TEXT 列（`schema-migration.js:157`）
- `locations` 表 schema（`schema-migration.js:105-113`）
- 桌面 `PhotoDetailsSidebar` 位置区域在 `:435-540`，无地图无逆向 geocode 按钮
- 桌面 `ShotLogModal.handleGeoSelect` 在 `:753-759`，5 字段填充
- `EntryEditModal` 在 `ShotLogModal.jsx:17` 独立组件
- `GlassModal` 存在并封装 HeroUI Modal
- `lazyModal` 存在，签名 `(loader) => Component({ isOpen, ...props })`
- `GeoSearchInput` 从 `../utils/geocoding` 导入 `searchAddress`
- `reverseGeocode` 永不抛错，失败返回空 `GeocodeResult` 并 echo 输入坐标
- `coordTransform` 导出 `wgs84ToGcj02`/`gcj02ToWgs84`/`isInChina`
- `@filmgallery/types` 的 `GeocodeResult` shape
- 手机 `MapProvider` 类型在 `ApiContext.ts:3`
- 手机 `locationService` 已用共享 `reverseGeocodeBigDataCloud`
- 手机 `App.tsx` RootStack 结构（Provider 位置可行）
- `photos` 表位置列（`schema-migration.js:238-244, 267-270`）
- `cacheSeconds` 中间件只影响 GET（`server/utils/cache.js:4-7`）—— 加 PUT/DELETE 安全
- `serverCapabilities` 机制存在（`server.js:295`）—— Phase 2 `geocode_proxy: true` 扩展点可行
- `film-item-service.js` 的 `updateFilmItem` 用 allow-list 含 `shot_logs`（:144-155）
- `db-helpers.js` 导出 `runAsync`/`allAsync`/`getAsync` —— 新端点可用

## 修订行动清单

在开始实现前，必须更新以下计划文档：

| # | 文档 | 修订内容 |
|---|---|---|
| C1 | `05-desktop.md:82-100` | 修正 `LocationPicker.jsx` 代码：用解构替代数组索引 |
| C2 | `05-desktop.md:188-288` | 在 `LocationPickerModal` 内定义 `handleUseMyLocation` 或从 `LocationPicker` 暴露 |
| C3 | `06-mobile.md:164` + 全文 | 改 `useApi` 为 `useContext(ApiContext)`，或在 `ApiContext.ts` 加 `useApi` hook |
| C4 | `05-desktop.md:114` | 删除错误的 `PhotoMap.jsx:331-337` 参考引用；标注坐标转换是新行为，需 spike |
| W6 | `06-mobile.md:53-58` | 重写 `resolvePick` 用 ref 模式，不在 setState updater 内 resolve |
| W7 | `05-desktop.md` LocationPicker 节 | 加 `useEffect` + `map.invalidateSize()` 处理 modal 内零高度 |
| W8 | `05-desktop.md:259, 372`、`07:59` | 统一微调步长为 `0.0001`（与 `PhotoMetaEditModal` 一致） |
| W9 | `06-mobile.md:223-231` | 加 `resolvedRef` 防止 `beforeRemove` 双重 resolve |
| W10 | `05-desktop.md:144-146` | 删除"需新增 `provider`/`amapKey` props"表述 |
| W11 | `04-backend.md:114-131` | `shot_logs` 校验加 `entry.date` required 检查 |
| N15 | `05-desktop.md:182` | 改用 `GlassModal` 而非原始 `<Modal>` |
| N16 | `03-shared-layer.md:53-61` | 修正 `LocationPickerValue` 与 `GeocodeResult` 的字段重叠描述 |

## 推荐实现路径

1. 先 spike 验证 Critical C4：在 amap 瓦片上测试 `wgs84ToGcj02` 转换后 marker 的对齐效果（这是计划假设的核心行为，但无现有代码佐证）
2. 修订计划文档（按上表）
3. 按 Phase A → B → (C ∥ D) → E 顺序实现
4. Phase A 完成后回归测试桌面 + 手机地图功能，确保共享层抽取无回归
