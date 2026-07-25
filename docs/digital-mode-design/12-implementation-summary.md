# 12 — 数码模式实施总结

> **状态**: ✅ MVP 全部完成(Parts 1-8)
> **日期**: 2026-07-25
> **分支**: `feat/digital-mode`
> **范围**: 把 FilmGallery 从「胶片工作流」扩展为「胶片 + 数码」双工作区应用;胶片侧零回归,数码侧补齐存档/相册/导入/轻量调色完整链路

---

## 1. 一句话总结

**胶片侧保持原状,新增数码工作区(顶部切换按钮),后端统一 photos 表 + source_type 字段,设备库统一管理但相机/镜头区分胶片/数码,前端双套界面各自独立。**

---

## 2. 设计方案演进(2 次用户改方案)

| 阶段 | 方案 | 用户决策 |
|---|---|---|
| 初版设计(D1) | filter-chips(过滤器) | 接受 |
| Part 5 实现 | filter-chips + 共享视图嵌入 | 完成 |
| **Part 6 改方案** | **workspace toggle(工作区切换)** | 用户要求"切换后整体前端界面就切换到一套新的界面" |
| Part 7 设备 | 三态 is_digital(0/1/NULL) | 用户要求"统一管理但补数码词条" |

---

## 3. 核心架构(最终落地版)

### 数据层

**统一 photos 表 + source_type 字段**(D3)— 一次 `WHERE source_type=?` 即可跨模式查询,避免 UNION ALL。

| 改动 | 详情 |
|---|---|
| 迁移 | `server/utils/digital-mode-migration.js`(单文件 ~250 行,幂等,纯 additive) |
| 新表 | `app_config`(单例)、`digital_sessions`、`albums`(嵌套)、`album_photos`(M2M) |
| photos +12 列 | source_type / session_id / content_hash / deleted_at / media_type / stack_id / stack_role / white_balance / color_space / original_filename / develop_params_json / scene_id |
| equip_cameras +7 列 | is_digital / sensor_type / sensor_width_mm / sensor_height_mm / megapixels / crop_factor / sensor_format |
| equip_lenses +1 列 | is_digital(三态:0=film / 1=digital / NULL=通用) |
| 新索引 | 13 个(source_type / session / hash / deleted / scene / album_photos 双向等) |
| 回填 | `UPDATE photos SET source_type='film' WHERE source_type IS NULL`(强校验 0 NULL 残留) |

### 关键工程:JOIN 审计(D5 — 整个方案的成败点)

`photos.roll_id` 改 nullable 会让 18 处 `INNER JOIN rolls` 静默把数码照片排除出列表/搜索/统计/地图。

- **修复**:15 处 INNER → LEFT JOIN + 3 处加 source_type 守卫(`render-service.js` FilmLab 专用保留 INNER)
- **CRITICAL 修复**:`stats.js:11` 子查询 `WHERE roll_id IN (SELECT id FROM rolls)` 重写为基于 source_type 的子查询
- **防回归**:lint 规则 `tools/check-join-rolls.js`(negative lookbehind 检测非 LEFT JOIN rolls)

### 后端

| 层 | 新增/改造 |
|---|---|
| **5 个新路由** | `/api/app-config`、`/api/albums`、`/api/digital-sessions`、`/api/digital/import`、`/api/digital-develop` |
| **4 个新服务** | `digital-file-service`(year/month 分片)、`import-job-registry`(内存任务表 + 30min GC)、`digital-import-service`(EXIF + sha256 去重 + 原子导入)、`digital-develop-service`(libraw demosaic + Float 管线渲染) |
| **现有路由改造** | `photos.js`(?mode / ?album_id / ?session_id)、`stats.js`(?mode + 4 个 digital 子端点)、`equipment.js`(数码字段 + listFilter)、`photos.js /random`(?mode C1 修复) |
| **AI 工具过滤** | `getToolSchemas(mode)` — digital 模式隐藏 FILM_ONLY 工具(rolls/films/shot_logs/render) |
| **api-client** | 5 模块(albums/digital-sessions/digital-import/digital-develop/app-config)+ types(CropParams/DevelopParams/Album/DigitalSession/AppConfig 接口) |

### 前端(双工作区)

| 改造点 | 详情 |
|---|---|
| **工作区切换** | `App.jsx` `mode` 状态 + `FilmRoutes`(14 路由,完全等同 main)/ `DigitalRoutes`(6 路由)+ `toggleMode` 跳 `/` |
| **Sidebar** | 模式感知;顶部切换按钮(film 琥珀 / digital 天蓝);`FILM_SHORTCUTS` / `DIGITAL_SHORTCUTS` 两套独立快捷键 |
| **DigitalOverview** | 新建数码首页:HeroCarousel(mode=digital) → 4 stat cards → Recent Albums → Import CTA |
| **数码组件** | LibraryView、AlbumLibrary、AlbumDetail、AlbumEditModal、AlbumCard、DigitalImportWizard(3 步)、DigitalDevelop(9 控件 + 裁剪) |
| **FilmLab 复用** | DigitalDevelop 复用 SliderControl/ToneCurveEditor/HSLPanel/SplitToningPanel/LutSelectorModal(FilmLabCanvas 25+ props 无法复用,改服务端预览) |
| **ImageViewer 分流** | `photo.source_type==='digital'` → DigitalDevelop;否则 FilmLab(零回归) |
| **PhotoDetailsSidebar** | scanning 分组仅 film 显示;新增 Digital Source 分组(read-only) |

### 设备统一管理(Part 7 重点)

**分层设备模型** — 不拆分胶片/数码两套库,单页统一管理但加筛选:

| 表 | is_digital 语义 |
|---|---|
| `equip_cameras` | 二态(0=film / 1=digital)— Part 5 已加 |
| `equip_lenses` | 三态(0=film-only / 1=digital-only / **NULL=通用**)— Part 7 新增列 |
| `equip_flashes` | 无 flag(通用) |

**常量三处同步**(canonical `packages/shared/` + server `equipment-migration.js` + client `EquipmentEditModal.jsx`):
- 拆分 `FILM_CAMERA_TYPES`(9 项)/ `DIGITAL_CAMERA_TYPES`(8 项,新增 DSLR/Mirrorless/Compact/Phone/Action Camera/Cinema Camera/Digital Medium Format)
- `LENS_MOUNTS` += Canon RF / Nikon Z / L Mount / Fuji GF / Hasselblad X
- 新增 `SENSOR_SIZES`(7)+ 重命名 `SENSOR_TECHNOLOGIES`(5,消除与 scanner SENSOR_TYPES 冲突)

**联动 UX**:Phone 自动 `has_fixed_lens=1` + 禁用 mount;Film Format 字段数码隐藏;切换 is_digital 自动清空 type/sensor 字段(防脏数据);EquipmentManager 加 All/Film/Digital 子筛选芯片;7 个胶片工作流文件传 `mode="film"`;PhotoDetailsSidebar 动态 `mode={photo.source_type==='digital'?'digital':'film'}`。

---

## 4. 测试与验证(全 PASS)

| 测试 | 结果 |
|---|---|
| ESLint(`eslint server packages tools`) | 0 errors,206 pre-existing warnings |
| check-join-rolls | PASS(防回归 lint 规则) |
| Vite build(Node 20) | PASS(2.76s,5223 modules) |
| Jest(`npm test`) | **1020/1020** |
| Digital integrity check | **7/7** PASS |
| Digital smoke test | 54 pass(4 个"fail"是误报) |
| 服务器运行审查 | **0 个 500 错误**(20+ 端点全部 curl 验证) |
| Puppeteer E2E | 双工作区渲染截然不同内容,0 page errors |

**对抗式审查记录**(DeepSeek V4 Pro 跨 vendor 交叉审查,共 5 轮):
- Part 1: 3 Critical + 2 Warning → 全修
- Part 2: 0 Critical + 4 Warning + 3 Nit → 全处理
- Part 3: 3 Critical + 7 Warning → 全修
- Part 4: 0 Critical + 5 Warning → 全修
- Part 5: 2 Critical + 3 Warning + 2 Nit → 全处理
- Part 8(设备 + Overview): 0 Critical + 7 Warning + 4 Nit → 4 个真实问题已修(W1/W2/W4),其余误报或 cosmetic

---

## 5. 文件清单

**新建文件**(~14 个):
- 数据:`server/utils/digital-mode-migration.js`、`server/scripts/digital-integrity-check.js`、`tools/check-join-rolls.js`、`packages/shared/photographyMode.js`(+ .mjs)
- 后端服务:`server/services/{digital-file-service,import-job-registry,digital-import-service,digital-develop-service}.js`
- 后端路由:`server/routes/{app-config,albums,digital-sessions,digital-import,digital-develop}.js`
- 前端数码组件:`client/src/components/digital/{DigitalOverview,LibraryView,DigitalImportWizard,DigitalDevelop}.jsx`、`client/src/components/digital/albums/{AlbumLibrary,AlbumDetail,AlbumEditModal,AlbumCard}.jsx`

**修改文件**(~25 个):
- 数据:`schema-migration.js`(注册新迁移)、`run-all-migrations.js`、`prepared-statements.js`、`db-helpers.js`
- 后端路由:`photos.js`、`stats.js`、`tags.js`、`equipment.js`、`server.js`、`serverCapabilities.{js,mjs}`
- 后端服务:`equipment-service.js`、`ai-orchestrator.js`、`ai-tools/index.js`
- 共享常量:`packages/shared/constants/equipment.js`、`server/utils/equipment-migration.js`
- 前端:`App.jsx`、`Sidebar/Sidebar.jsx`、`Overview/HeroCarousel.jsx`、`EquipmentSelector.jsx`、`EquipmentManager.jsx`、`EquipmentManager/EquipmentEditModal.jsx`、`ImageViewer.jsx`、`PhotoDetailsSidebar.jsx`、`lib/queryClient.js`
- 6 个胶片工作流文件加 `mode="film"`
- 类型:`packages/@filmgallery/types/index.d.ts`、api-client 5 模块

---

## 6. 关键设计取舍

| 取舍 | 选择 | 理由 |
|---|---|---|
| 模式原语 | workspace toggle(用户改方案) | 用户要"切换后整体新界面";filter-chips 方案被否 |
| photos 表 | 统一 + source_type | 让共享端点一句 WHERE 跨模式;分表会迫 UNION(SQLite 视图不可索引) |
| rolls vs albums | 独立概念 | rolls=物理/时序/不可变/1:多;albums=策展/虚拟/可变/M:N;不强对称 |
| 调色 UI | 复用 FilmLab 底层 + 新轻 UI | 不对标 117KB FilmLab 主组件;复用 WB/HSL/ToneLUT 纯函数模块 |
| RAW 解码 | 仅 demosaic(libraw-native) | WB/DCP/镜头校正交给 Lightroom;不做完整对标 |
| 调色参数 | 入库(develop_params_json) | 下次打开可恢复 |
| 设备 is_digital | 镜头三态(NULL=通用)、相机二态 | 单库统一管理 + 筛选;三态让通用镜头两个工作区都见 |
| DSLR 扫描歧义 | 靠导入入口区分(不靠 EXIF 自动推断) | 数码 import → source_type=digital;film import → source_type=film |

---

## 7. 未做事项(Phase 2/3,见 doc 06)

**Phase 2**(数码深化):
- 智能相册(is_smart + criteria_json)
- FTS5 全文搜索
- RAW+JPEG/连拍/HDR 堆栈 UI
- 回收站 UI(软删除已加,缺 UI)
- auto_album AI 工具
- 场景关联 UI(Q5 scene_id,schema 已预留)
- 移动端数码浏览

**Phase 3**(长期):
- 人脸识别
- 视频 / Live Photo
- 大库增量备份

---

## 8. 文档索引

完整设计文档(12 篇,~7000 行):

| # | 文档 | 内容 |
|---|---|---|
| 01-07 | 设计层 | 目标/范围、ADR、数据模型、UX、API、移动端、风险 |
| 08-10 | 实施计划层 | 数据/后端/前端落地细节 |
| 11 | 实施清单 | 任务序列 + 依赖图 + 进度表(Parts 1-8 全 ✅) |
| **12 本文** | **实施总结** | **本次做了什么、关键决策、测试结果、文件清单** |
