# 移动端数码模式改造

桌面端 digital mode 已落地（详见上一级目录 `DIGITAL-MODE-IMPLEMENTATION-REVIEW.md`：418 测试全绿、`/api/albums`、`/api/photos?mode=`、`/api/photos/facets?mode=digital`、软删除、develop/save/export 全链路通）。本子目录是**移动端**改造的设计与计划，与桌面共用同一服务端，但走独立的 UI 与导航分支。

> **修订记录（v2，2026-07-25）**：经 `@review` 子 agent 对抗审查，修正了 4 个 Critical 错误（API client 方法签名/字段名与实际服务端契约不符）和 5 个 Warning。详见各文档内"修订"标注与文末 §"Review 修订记录"。
>
> **核心修正**：(1) 不使用 `api.photos.search()`（其调用 `/api/photos/search` 服务端不存在 → 404），改用 `api.http.get('/api/photos', {...})`；(2) 不使用 `api.photos.getFavorites()`（无参签名会吞掉 `{mode}`），改用 `api.http.get('/api/photos/favorites', {mode})`；(3) `/api/discover` 返回 `capabilities.digital`（**不是** `digitalEnabled`）；(4) 照片 GPS 字段为 `latitude`/`longitude`（**不是** `gps_lat`/`gps_lon`）。

## 文档索引

| 文档 | 用途 |
|---|---|
| [01-mobile-scope-and-decisions.md](./01-mobile-scope-and-decisions.md) | 移动端范围、决策（薄客户端 / 不做调色 / Phase 切分）、与桌面 06 号设计文档的差异修订 |
| [02-mobile-architecture.md](./02-mobile-architecture.md) | 导航/路由/状态/缓存/AP I 复用、相册与库的数据流、source_type 分支策略 |
| [03-mobile-implementation-plan.md](./03-mobile-implementation-plan.md) | 分波（M1/M2/M3）实现计划：文件清单、依赖、工作量、验收标准 |
| [04-mobile-implementation-checklist.md](./04-mobile-implementation-checklist.md) | 逐文件检查清单（实现完成后用）|

## 一句话定位

**移动端做"现场胶片日志 + 数码照片只读浏览/操作"，不做导入、不做调色**——复用桌面端已经验证过的服务端契约和共享 `@filmgallery/api-client`，UI 适配 React Native + Paper + 薄查询缓存。

## 与设计文档 06 的差异修订

设计文档 06（`../06-mobile-and-phasing.md`）写于数码模式尚未实现时。现在桌面端已落地，下列决策随之调整：

| 06 原计划 | 现状 / 调整 |
|---|---|
| Phase 1 MVP 移动端"仅在 Settings 显示提示" | 仍保留作为最低门槛，但**移动端不再等"观察期"**——桌面已稳定，直接做 Phase 2 只读浏览 |
| Phase 2 移动端 5 人天做 4 个数码屏 | 修订为 **M1+M2 共 ~6 人天**，覆盖范围与 06 一致但补齐软删除/分页/相册操作 |
| Phase 3 手机照片直接导入 | **暂不纳入本计划**，单独立项评估（涉及后台传输、断点续传、权限，工作量大） |
| 共享视图（Calendar/Map/Favorites/Themes/Stats）加 mode 过滤 | 服务端已全部支持（桌面 W2-B 完成），移动端**直接消费 `?mode=digital`**，无需改服务端 |

## 关键约束

1. **服务端零改动**：所有需要的端点（`/api/albums/*`、`/api/photos?mode=`、`/api/photos/facets`、`/api/photos/:id/restore`、软删除语义、`/api/discover` capabilities）桌面端都已交付并通过测试。
2. **共享 API 客户端**：`packages/@filmgallery/api-client` 已含 `albums`、`digitalSessions`、`appConfig` 等模块。移动端通过 `mobile/src/api/client.ts` 间接复用，**不需要新增任何 API 文件**。注意若干 client 方法（`photos.search` / `photos.getFavorites` / `stats.*`）签名与服务端契约不符，移动端一律用 `api.http.get(path, params)` 绕过——详见 02 §2.2.1。
3. **JSX vs TSX**：移动端是 TypeScript（`.tsx`），桌面端是 JSX。不要从桌面拷贝粘贴，要按移动端既有约定重写（StyleSheet + Paper + `useApiQuery` + i18n + `useT()`）。
4. **照片 URL 拼接**：移动端用 `mobile/src/utils/urls.ts` 的 `getPhotoUrl(baseUrl, photo, 'thumb'|'full')`。数码照片走 `positive_thumb_rel_path` / `positive_rel_path` / `full_rel_path`，已与桌面统一——`utils/urls.ts` **不需要改**。
5. **PhotoViewScreen 单一入口**：现有 `PhotoViewScreen.tsx` 是胶片+数码共用的全屏看片器，通过 `source_type` 字段分支（数码隐藏底片切换按钮、显示 EXIF/相册信息块），不要新建并行屏。
