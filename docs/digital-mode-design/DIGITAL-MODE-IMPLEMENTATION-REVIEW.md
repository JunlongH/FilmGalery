# Digital-Mode 实现审查与修复总结

> 审查分支：`feat/digital-mode`（改动未提交）  
> 审查方法：orchestrator + general subagent(GLM-5.2) 执行 + review subagent(DeepSeek) 对抗审查，分三波（W1/W2/W3）迭代  
> 对照基线：`docs/digital-mode-design/` 01/04/06/11 设计文档  
> 日期：2026-07-25

---

## 一、审查结论：主链路全断（报告宣称全 PASS）

初轮代码盘点对照设计文档，发现 **3 个 P0 契约不匹配**，导致数码模式三大主链路（导入 / 显影 / 相册）全部功能性失败：

| # | 主链路 | 客户端 | 服务端 | 后果 |
|---|---|---|---|---|
| P0-1 | 导入向导 | 读 `result.files`；execute 发 `{files,album_id}`；进度读 `processed` | 返回 `{total,duplicates,raws,items,exif_summary}`；execute 要 `{items,session_title,album_id}`；进度字段 `done` | 导入完全不可用 |
| P0-2 | DigitalDevelop | 发 `{photoId,params}`；预览期望 `{previewUrl}` JSON | 读 `{photo_id,params_json}`；预览返 `image/jpeg` 二进制 | 显影预览/保存全断 |
| P0-3 | 相册卡片 | 渲染 `photo_count` / `date_range_start` | `albums.list` SQL 不返回这两个字段（表也无此列） | 卡片恒显示「0 photos」 |

**目标偏离**（设计 04 §G1-G4 与 11 检查清单）：

- **G3 跨模式浏览未达成** —— workspace toggle 后 DigitalRoutes 仅 6 路由，Calendar/Map/Favorites/Themes/Stats 在数码模式全缺。
- **Library（51 行）** 无筛选/排序/分页/多选/搜索。
- **相册** 服务端端点齐全（添加/移除/封面/排序/恢复），但 UI 无任何调用入口。
- **DigitalDevelop** 仅 9 滑条，设计要求的 10 类控件（HSL/曲线/分色调/LUT/预设/对比/导出）全缺；旋转存在 CSS transform + 服务端双重应用隐患。
- **Onboarding（04 §4.8）/ 默认工作区 / 软删除 / 切换快捷键 / 路由记忆** 均未实现。
- photos `DELETE` 硬删与 `deleted_at` 软删列 schema 矛盾。

---

## 二、分波执行成果

### W1 — P0 契约修复 + 回归测试

**修复**
- `DigitalImportWizard.jsx`：读 `result.items`（`item.file.originalname` / `item.exif` / `item.duplicate` / `item.isRaw`）；新增 EXIF 摘要块、Session 标题可选输入；execute 发 `{items, session_title, album_id}`；进度 `processed`→`done`。
- `client/src/api/core.js`：新增 `postForBlob(url,data,{signal})`（POST JSON → Blob，与 `jsonFetch` 同错误/鉴权语义，支持 AbortController）。
- `client/src/api/digital-develop.js`：preview/save/export 发 `{photo_id, params_json}`；preview/export 返 Blob。
- `DigitalDevelop.jsx`：`URL.createObjectURL(blob)` 预览，旧 URL 自动 revoke + unmount 清理。
- `prepared-statements.js` `albums.list`：补 `photo_count` / `date_range_start` / `date_range_end`（后由 review 优化为 LEFT JOIN + GROUP BY）。

**新增测试**（共 14 例全过）
- `server/routes/__tests__/digital-import.test.js`（5：202+jobId 契约、legacy `{files}` → 400、items 缺失/空 → 400）
- `server/routes/__tests__/digital-develop.test.js`（6：preview→image/jpeg、legacy `{photoId}` → 400、save/export/getParams）
- `server/utils/__tests__/albums-list.test.js`（3：临时 DB，count/日期范围/空相册 null）

**W1-R review 修复**：DigitalDevelop 预览竞态（generation counter + AbortController）、`crop`↔服务端 `cropRect` 键名（normalizeParams 双向兼容）、`handleSave` 错误横幅、wizard albumId stale ref（ref 镜像）、import preview tmp 文件 1h TTL 清扫、`postForBlob` signal 透传、`albums.list` SQL 重写、export 路由移除未用解构。

### W2 — 相册闭环 / 跨模式浏览 / Develop 完整化（三 agent 并行）

**W2-A 相册闭环**（`client/src/components/digital/albums/`）
- `PhotoGrid`：opt-in `renderTile` render prop（无 prop 时逐字节一致，胶片路径零影响）。
- `AlbumDetail`：添加照片模态（`AlbumAddPhotosModal` 新文件，分页 60/页 + 300ms 防抖搜索 + 已加入置灰）、tile hover 操作（设封面 / 移除）、HTML5 拖拽排序 + 保存排序。
- `AlbumLibrary`：父子嵌套分组（孤儿提升为根）+ `DeletedAlbumsSection`（新文件，恢复 / 彻底删除）。
- Query keys：`['albums']`、`['album',id]`、`['album-photos',id]`、`['album-photo-picker',q,page]`、`['albums','with-deleted']`。
- 服务端 `include_deleted` 期望字符串 `'true'`。

**W2-B 数码 workspace 共享视图**
- `DigitalRoutes` 加 `/calendar` `/map` `/favorites` `/themes` `/themes/:tagId` `/stats`；共享视图加 `mode` prop，`FilmRoutes` 显式传 `mode='film'`（G1 纯度）。
- 服务端补 mode 过滤 6 处：`/api/photos/favorites`、`/api/photos/geo`（主查询+count）、`/api/tags`、`/api/tags/:id/photos`、`/api/stats/themes`、`/api/stats/locations`（新测试 `mode-filter.test.js` 11 例）。
- Sidebar 数码快捷键：⌘1 Overview ⌘2 Library ⌘3 Albums ⌘4 Import ⌘5-8 Calendar/Map/Favorites/Themes ⌘9 Statistics ⌘0 Equipment ⌘, Settings。
- `Statistics` mode prop 重载（`'stats'|'spending'` 视图切换保留；`'film'|'digital'` = workspace）+ 数码面板（相机分布 / 月度活动）。
- `DigitalOverview`：收藏计数改 `page=1&pageSize=1` 读 `total`；加「最近导入」session 列表。

**W2-C DigitalDevelop 完整化**（`DigitalDevelop.jsx` 全重写）
- 移除 CSS `transform: rotate()`（修双重应用，旋转仅服务端 `buildPipeline → img.rotate`）。
- 拖拽裁剪：8 手柄 + 比例预设（自由/1:1/3:2/4:3/16:9）+ 清除 + letterbox 补偿；crop 模式时预览发 `crop:null` 使坐标系与服务端旋转后坐标一致。
- 接入 `HSLPanel` / `ToneCurveEditor`（RGB/R/G/B）/ `SplitTonePanel` / `LutSelectorModal`（+opacity）；折叠分组 基础/白平衡/HSL/曲线/分色调/LUT/裁剪旋转。
- 长按对比原图；导出 blob 下载；预设复用现有 `/api/presets`（`category='digital'`）。
- 服务端 `normalizeParams` 扩展：`temperature`→`temp` 别名（顺带修活死滑条）、LUT Float32Array 反序列化。
- 管线确认：`RenderCore.processPixelFloat` 原生按 LUT→WB→曝光→曲线→HSL→饱和度→分色调顺序应用，**无需改 filmlab-service/shared**。
- 新测试 `digital-develop-service.test.js`（15 例）。

**W2-R review 三 Critical 修复**
1. **LUT Float32Array 经 JSON.stringify 变普通对象** → `deserializeLut` 得空数组：`handleLutSelect` 存参前 `Array.from`（对齐 FilmLab.jsx:2019）；加 `data.length < 3·size³` 校验。
2. **裁剪手柄定位用了图像绝对坐标**，而 DOM 父级是裁剪框 → 改 `HANDLE_POS` 相对映射（百分比的百分比）。
3. **`normalizeParams` 原地变异** 致 save 后 crop 丢失 → 防御性拷贝 `{...paramsJson}`。
- 另加：拖拽 listener unmount 清理、Reset 退出 crop 模式、export revoke 延时 1s→10s、UI 文案中文化。

### W3 — Library 升级 / Viewer 操作 / Onboarding（三 agent 并行）

**W3-A Library 升级**（`LibraryView.jsx` 全重写，592 行）
- 左筛选栏（facets 年/月/相机/镜头多选，来自新端点 `GET /api/photos/facets?mode=digital`）、`q` 防抖搜索、4 种排序（`date_taken desc/asc`、`rating desc`、`id desc`）、收藏 chip。
- 「上次导入」filter（`session_id` + URL 参数，dismissible chip）。
- 分页 `page/pageSize=100` + 加载更多（`pagesMap` 按页存 + id 去重）。
- 多选模式 + 批量栏（加入相册 modal / 收藏 rating 0↔1 via `updatePhoto` / 删除，分块 5 并发避免连接池耗尽）。
- 服务端 `photos.js` sort/order 白名单（防注入）+ facets 端点。

**W3-B ImageViewer 数码操作 + Sidebar**
- `PhotoDetailsSidebar`：评分星（1-5 + 清除，接入 `FIELD_GROUPS` dirty/save-all 机制，数码 + batch 通用）+ 所在相册 chips（`getAlbumsForPhoto` → navigate，仅数码非 batch）。
- `ImageViewer`：补全缺失的数码工具栏按钮（收藏 / 加入相册 modal / 删除）+ 相册选择 modal（每次打开 refetch）；修 index 越界崩溃（`if(!img) return null`）；Escape 加 typing+uiBusy 守卫。
- 服务端 `albums.js` 加 `?photo_id` 过滤；`api/albums.js` `getAlbumsForPhoto`；`queryClient.js` 注册 `photoAlbums` 缓存策略。
- 发现：全站收藏语义 `rating ≠ 0`，胶片 UI 也是 0/1 toggle（保持一致）。

**W3-C Onboarding + Settings + 软删除 + 快捷键**
- `App.jsx`：路由记忆（`fg-last-route-film/digital`）+ `Ctrl/Cmd+Shift+M` 切换 + `fg-set-workspace-mode` 事件监听 + FilmRoutes 补 catch-all → Overview（路由腐坏不白屏）。
- 新 `Onboarding.jsx`：`onboarding_completed≠1` 时 probe `/api/rolls`——非空→升级门 modal，空/失败→三卡首启流程；`POST /api/app-config/onboarding` + localStorage + 事件同步；`retry:1`（瞬时错误不永久隐藏）。
- `GeneralSettings`：默认工作区 Select（写 `default_source_filter` + `photography_mode`）。
- photos `DELETE` 软删（200 `{deleted:1,soft:true}`，已删 404）、`?hard=true` 保留硬删（文件+行）、新增 `POST /:id/restore`；`checkHash` 加 `deleted_at IS NULL`；9 个软删除测试。

### 软删除审计遗漏（orchestrator 直接修复）

W3-C 审计发现多处查询缺 `deleted_at` 过滤（软删照片仍可见），全部修复：
`photos.listByRoll`、`rolls.countPhotos`、`/api/photos/favorites`、`/api/photos/geo`（主查询+count）；ImageViewer / LibraryView 删除文案改「将从图库中移除（磁盘文件保留）」。

### W3-R review 修复（两路 review）

**已修**：(1) `year`+`month` 组合 OR→AND（同时修了 LifeLog 日历月视图显示全年的既有 bug；`ym` 路径不受影响）；(2) 硬删前补 `DELETE photo_tags` + `album_photos`（schema 无 FK 级联，孤儿行阻碍 tags 清扫）；(3) ImageViewer Escape 守卫；(4) LibraryView `resetPages` 改 `useCallback` + 批量 op onSuccess 调 `resetPages`（修总数漂移）+ 分块并发；(5) Onboarding `retry:false→1`；(6) FilmRoutes catch-all；(7) sidebar 批量保存吞错→统计失败数，有失败即 throw 保留 dirty。

**有依据跳过**：facets 参数三倍 spread（reviewer 误判——3 个 UNION 分支各需一份 params 拷贝，现码正确）；heart 0↔1 折叠多星（全站胶片端同约定）；refs 渲染期赋值（既有模式）；app-config 参数命名（cosmetic）。

---

## 三、最终验证（全绿）

| 检查项 | 结果 |
|---|---|
| jest | **418/418 通过**（4 个 suite 加载失败均为预先存在：`_helpers.js` 无测试、`mount-order.test.js`、`dist_v9` 产物，与本分支无关） |
| eslint (`npx eslint .`) | **0 errors**（264 warnings 全为预先存在） |
| `node tools/check-join-rolls.js` | PASS |
| vite build | ✓ built in 4.14s（系统 Node 18 缺 `styleText`，用 `~/.local/node20` 跑通；5226 模块转换） |

---

## 四、设计目标达成对照

| 设计目标 | 初始 | 最终 |
|---|---|---|
| **G1 导入向导** | 契约全断 | 契约修复 + EXIF 摘要 + Session 命名 + tmp 1h 清扫 + 回归测试 |
| **G2 相册** | UI 仅壳，卡片字段服务端不返回 | 完整闭环：添加/移除/封面/拖拽排序/嵌套/回收站；SQL 改 LEFT JOIN+GROUP BY |
| **G3 跨模式浏览** | 数码仅 6 路由 | Calendar/Map/Favorites/Themes/Stats 全通（mode prop + 6 个服务端端点补 mode 过滤 + 快捷键 ⌘5-9） |
| **G4 Develop** | 契约断 + 仅 9 滑条 + 旋转双应用 | 拖拽裁剪 / HSL / 曲线 / 分色调 / LUT / 预设 / 导出 / 长按对比；修 LUT 序列化、cropRect 键名、temperature 死滑条 |
| **Library** | 51 行无功能 | 筛选栏（facets）/ 排序 / 搜索 / 上次导入 / 分页 / 多选批量 |
| **Onboarding / 软删除 / UX** | 缺失 | 三卡首启 + 升级门、默认工作区、⌘⇧M 切换 + 路由记忆、照片软删 + restore + 全查询补 `deleted_at` |

---

## 五、已知遗留（有依据不修）

- 收藏 heart 0↔1 折叠多星 —— 全站既有约定（胶片端同样），保持一致。
- `ToneCurveEditor` 取色器模式 stubbed（`isPicking=false`）；histogram 未喂入（渲染平直基线）。
- eslint 根 flat-config 不覆盖 `client/` JSX（设计如此 —— client 自有工具链）；已用 `esbuild --loader:.jsx=jsx` 语法检查 + Vite 编译验证全部通过。
- 所有改动**未提交**（按要求保留在工作区供审查）。

---

## 六、改动文件清单（按层）

**Server**
- `routes/photos.js`（sort 白名单 + facets 端点 + year/month AND + 软删 + restore + 4 处 deleted_at 过滤 + photo_tags/album_photos 级联清理）
- `routes/albums.js`（`?photo_id` 过滤）
- `routes/digital-import.js` / `digital-develop.js` / `digital-sessions.js`（契约对齐）
- `routes/stats.js`（mode 过滤 4 处 + digital gear 跳过 films JOIN）
- `routes/tags.js`（mode-scoped photos_count + cover + photos）
- `services/digital-import-service.js`（tmp 清扫）/ `digital-develop-service.js`（normalizeParams 扩展 + 防御拷贝 + LUT 校验 + deserializeLut 导出）
- `utils/prepared-statements.js`（`albums.list` 重写 LEFT JOIN+GROUP BY；`photos.checkHash` +deleted_at；`photos.listByRoll`/`rolls.countPhotos` +deleted_at）
- `utils/digital-mode-migration.js`（未改，键已存在）

**Client**
- `components/digital/`：`DigitalImportWizard`、`DigitalDevelop`（全重写）、`DigitalOverview`、`LibraryView`（全重写）、`albums/{AlbumDetail,AlbumLibrary,AlbumCard,AlbumEditModal,AlbumAddPhotosModal,DeletedAlbumsSection}`
- `components/`：`PhotoGrid`（selection + renderTile）、`ImageViewer`（数码工具栏 + 守卫）、`PhotoDetailsSidebar`（评分+相册）、`Onboarding`（新）、共享视图加 `mode` prop（CalendarView/MapPage/Favorites/TagGallery/Statistics/PhotoMap/MapFilterPanel）、`Sidebar`（数码快捷键）、`Settings/GeneralSettings`
- `App.jsx`（路由记忆 + 切换快捷键 + 事件监听 + Onboarding mount + FilmRoutes catch-all）
- `api/`：`core.js`（postForBlob）、`photos.js`（getPhotoFacets/getFavoritePhotos mode）、`albums.js`（getAlbumsForPhoto）、`digital-develop.js`（契约）、`index.js`（补导出）
- `lib/queryClient.js`（photoAlbums 缓存策略）、`lib/dataPrefetch.js`（tags key 对齐）

**Tests**（新增 6 文件，~50 例全过）
- `server/routes/__tests__/{digital-import,digital-develop,photos-facets,photos-soft-delete,mode-filter,albums}.test.js`
- `server/utils/__tests__/albums-list.test.js`
- `server/services/__tests__/digital-develop-service.test.js`
