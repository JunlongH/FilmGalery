# LocationPicker 地图点选组件 — 实施计划

> 状态：草案 · 范围：跨端（桌面 + 手机 + 共享层 + 后端）
> 创建：2026-07-22

## 1. 背景与目标

当前地图相关功能仅支持「地址 → 经纬度」的正向地理编码并写入数据库，**缺少「在地图上点选位置 → 返回经纬度 + 地址」的能力**。该能力需要在多处复用：

| 使用场景 | 当前状态 | 期望能力 |
|---|---|---|
| 桌面 Photo Detail Modal（`PhotoDetailsSidebar.jsx`） | 只有数字输入 + 地址搜索框，无地图、无逆向地理编码按钮 | 增加「在地图上点选」按钮 |
| 桌面 Shot Log 增加/修改（`ShotLogModal.jsx`） | 同上 | 同上（Quick-Add + EntryEditModal 两处） |
| 手机 Shot Log（`ShotLogScreen.tsx`） | 有 GPS 自动捕获，但 GPS 不可用时只能手填，无地图点选 | 增加「在地图上点选」入口 |
| 手机 Photo View（`PhotoViewScreen.tsx`） | 位置数据只读 | （可选）增加编辑入口 |

### 目标
1. 提供一个**可在地图上点选位置**的组件，返回 `{ latitude, longitude, country, city, detail_location, displayName }`
2. 组件在桌面和手机上**均可使用**，但渲染层保持平台原生（不强行跨端共享 UI）
3. **共享数据层**（types / geocoding / coordTransform），消除当前桌面与手机的 geocoding 重复实现
4. 不破坏现有架构，可顺手做必要的优化（修复 API 契约不一致、补 lat/lng 校验等）

### 非目标
- 不引入新的 map 渲染库（继续用 Leaflet）
- 不替换桌面 `react-leaflet` / 手机 WebView-Leaflet 为统一方案
- 不强制服务端 geocoding（列为可选 Phase 2）

## 2. 目录

| 文档 | 内容 |
|---|---|
| [01-current-state.md](./01-current-state.md) | 现状分析（基于代码探索的关键发现） |
| [02-architecture.md](./02-architecture.md) | 组件架构、数据流、共享层设计 |
| [03-shared-layer.md](./03-shared-layer.md) | `@filmgallery/shared` 与 `@filmgallery/types` 的改动 |
| [04-backend.md](./04-backend.md) | 后端改动（修契约、加校验、可选 geocoding 代理） |
| [05-desktop.md](./05-desktop.md) | 桌面 `LocationPicker` + `LocationPickerModal` 实现与集成 |
| [06-mobile.md](./06-mobile.md) | 手机 `LocationPickerScreen` 实现与集成 |
| [07-derivative-features.md](./07-derivative-features.md) | 衍生功能（按价值/工作量分级） |
| [08-task-breakdown.md](./08-task-breakdown.md) | 分阶段任务拆解与验收标准 |
| [09-review-findings.md](./09-review-findings.md) | 对抗性审查结果与修订记录（DeepSeek V4 Pro） |

> **重要**：实现前请先阅读 [09-review-findings.md](./09-review-findings.md)，其中记录了审查发现的 4 个 Critical 问题（已在 05/06 文档中修复）及推荐实现路径（含 amap 坐标转换的 spike 验证）。

## 3. 设计要点速览

```
┌─────────────────────────────────────────────────────────────┐
│                     共享层（packages/shared）                  │
│  • @filmgallery/types:        LocationPickerValue, MapProvider│
│  • @filmgallery/shared/geocoding (新): searchAddress,        │
│     reverseGeocode（provider 配置作为参数注入，纯函数）         │
│  • @filmgallery/shared/coordTransform (已有): WGS84↔GCJ02    │
│  • @filmgallery/shared/mapUtils (新): 瓦片 URL、聚类算法      │
└─────────────────────────────────────────────────────────────┘
              ▲                              ▲
              │                              │
   ┌──────────┴──────────┐        ┌──────────┴──────────┐
   │  桌面 (react-leaflet)│        │ 手机 (WebView-Leaflet)│
   │  LocationPicker.jsx  │        │ LocationPickerScreen │
   │  + LocationPickerModal│       │  (全屏 modal)         │
   │  (GlassModal 包裹)    │        │  + LeafletMap pick 模式│
   └──────────┬──────────┘        └──────────┬──────────┘
              │                              │
   ┌──────────┴──────────┐        ┌──────────┴──────────┐
   │ PhotoDetailsSidebar  │        │ ShotLogScreen        │
   │ ShotLogModal (Quick  │        │ PhotoViewScreen(可选) │
   │  Add + EntryEditModal)│       │                      │
   └─────────────────────┘        └──────────────────────┘
```

**关键决策：**
- 渲染层**不跨端共享**（DOM vs RN WebView，无现成共享 UI 包先例）
- **数据层全共享**：types / geocoding / 坐标转换 / 瓦片配置
- 桌面 picker 用 `GlassModal`（HeroUI）包裹，与现有 modal 风格一致
- 手机 picker 用全屏 modal（React Navigation stack screen），与 `ShotLogScreen` / `PhotoViewScreen` 一致
- 地图点选后**自动逆向地理编码**填充地址字段，用户可二次编辑

## 4. 衍生功能（节选，详见 07）

**Tier 1（与 picker 同期交付）：**
- 逆向地理编码按钮（在已有 lat/lng 时反查地址）
- 「使用我的 GPS 位置」按钮（桌面 `navigator.geolocation`，手机复用 `locationService`）
- lat/lng 范围校验（客户端 + 服务端，当前缺失）

**Tier 2（短期）：**
- 地图缩略图预览（侧栏/日志项内嵌非交互小地图）
- 最近使用位置快捷选择
- 坐标格式切换（十进制 / 度分秒）

**Tier 3（中期）：**
- 服务端 geocoding 代理（隐藏 AMap key、规避 CORS、集中限流）
- Shot log 路径地图（按日期串联多个日志条目）
- 收藏位置（与城市级 `locations` 表分离）

## 5. 风险与约束

| 风险 | 缓解 |
|---|---|
| 桌面 `PhotoDetailsSidebar` 用 `fg-*` CSS（非 HeroUI），modal 风格不一致 | picker 用 `GlassModal`（与 `EquipmentEditModal` 等一致），sidebar 内仅放触发按钮 |
| 手机 React Navigation 回传数据不优雅（不能直接传 callback） | 采用 `LocationPickerContext` + Promise 模式（`await pickLocation(initial)`），跨平台一致 |
| AMap 坐标系（GCJ-02）与 DB（WGS-84）混用风险 | 复用现有 `coordTransform`，所有 AMap 边界处转换；DB 永远存 WGS-84 |
| 共享 geocoding 模块需读取 provider 配置，桌面用 `localStorage`、手机用 `AsyncStorage` | 模块设计为**纯函数**，配置作为参数注入，存储读取由各平台负责 |
| 服务端当前无 geocoding，迁移客户端到共享模块可能引入回归 | Phase 1 仅新增共享模块，桌面旧 `geocoding.js` 改为薄封装代理；保留旧测试 |
