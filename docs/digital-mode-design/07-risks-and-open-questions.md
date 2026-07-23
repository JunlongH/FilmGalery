# 07 — 风险与未决问题

## 7.1 风险登记

### R1. JOIN 审计执行不彻底 [致命]

**描述**:13 处 `INNER JOIN rolls` 改 `LEFT JOIN` 漏掉一两处,或新加的 `WHERE source_type=?` 过滤条件错放位置导致数码照片在某些视图中"消失"。用户会以为导入失败或照片丢失。

**影响**:致命——用户失去对应用的信任

**缓解**:
- 写集成测试:导入一张测试数码照片 → 验证它出现在 `/api/photos`、`/api/photos/geo`、`/api/photos/favorites`、`/api/photos/random`、`/api/tags/:id/photos`、`/api/stats/temporal`、`/api/stats/locations`、`/api/stats/themes`、`/api/stats/ratings`
- 自定义 ESLint 规则:禁止 `JOIN rolls r ON p.roll_id`(必须 `LEFT JOIN`),违规 fail CI
- Code review checklist:任何修改 photos 查询的 PR 必须验证数码照片仍能返回

**残留风险**:中——靠测试覆盖,但 SQLite 查询变体多,可能仍有遗漏

---

### R2. 范围爬升到 Lightroom 领域 [高]

**描述**:开发过程中或 MVP 上线后,范围逐渐扩张到 DCP/镜头校正/编辑历史/虚拟副本——每个"小特性"都合理,但累加起来等于再造一个 Lightroom,工作量爆炸。即使 D6 已决定只做轻量 DigitalDevelop,后续仍可能在用户反馈下逐步滑向完整 Lightroom 对标。

**影响**:高——MVP 永远 ship 不出,或 ship 出后维护成本失控

**缓解**:
- D6/D7 决策明确:DigitalDevelop 只复用 FilmLab 底层 WB/HSL/Tone/Curves/SplitTone,**不做** DCP/镜头校正/编辑历史/虚拟副本
- D9 调色参数入库,但不做版本历史(单 JSON 字段,最新覆盖)
- 每个 Phase 2/3 候选项都要有"触发条件"——用户反馈明确才做,不主动规划
- 用户每次提"再加一个数码特性"时,问"这是 Lightroom 已经能做的吗?如果是,为什么不在 Lightroom 做?"

**残留风险**:中——产品边界最难守住,需要持续纪律。DigitalDevelop UI 已存在后,"再加 DCP"的诱惑会持续

---

### R2b. DigitalDevelop UI 范围控制 [中]

**描述**:复用 FilmLab 底层模块容易,但新 UI 在开发中容易膨胀——加一个"曲线拟合"按钮、加一个"AI 自动调色"按钮、加一个"局部调整"按钮……每个都合理,累加起来 DigitalDevelop 从 ~25KB 膨胀到 ~80KB+,接近 FilmLab 体量。

**影响**:中——MVP 工作量超支,UI 复杂度上升

**缓解**:
- D6 明确 UI 范围:仅 WB/曝光/对比/高光/阴影/HSL/Tone Curve/SplitTone/LUT 应用 9 类控件
- 不做:局部调整(笔刷/渐变/径向)、AI 自动调色、曲线拟合、HDR 合成、 panoramas 拼接
- PR review checklist:DigitalDevelop UI 改动必须说明属于 9 类控件之一,否则拒绝
- 每月回顾 DigitalDevelop 组件文件大小,>50KB 时触发"瘦身"重构

**残留风险**:低——范围明确,有量化指标

---

### R3. DSLR 扫描归类歧义 [中]

**描述**:用户用数码相机(Sony A7IV + 微距镜头)翻拍胶片底片,产出 .RAF 文件。这个 .RAF 归数码还是胶片?

- 归数码:数码模式出现一堆"胶片底片翻拍",语义混乱
- 归胶片:胶片模式出现"数码相机拍的 RAW",也奇怪

**影响**:中——边界场景,但胶片摄影师 DSLR 扫描很常见(Negative Lab Pro 流程)

**决策**:归**胶片**。理由:DSLR 扫描的 RAW 是"胶片照片的衍生资产",类比 negative scan——它服务于胶片照片的呈现,不是独立的数码作品。FilmLab 已有 DSLR 扫描支持(`server/services/scan-exif-service.js:228` 提到 DSLR Scan Rig)。

**实现**:
- 导入胶片卷时,允许上传 RAW 文件作为"原件"(`original_rel_path`),`source_type='film'`
- 现有 `source_type` 取值:`'film'`、`'digital'`。不引入第三个值 `'dslr_scan'`(避免复杂化)
- 若需区分扫描方式,用现有 `photos.scanner_equip_id` 字段(可指向一个 DSLR 扫描装备)+ `scan_software` 字段(如 "Negative Lab Pro")

**残留风险**:低——决策已明确,实现成本零

---

### R4. 50k+ 照片性能 [中]

**描述**:胶片库典型 2k 照片,数码库可能 50k+。现有 VirtualPhotoGrid 只虚拟化渲染,不虚拟化数据获取——一次拉 50k 行到客户端会卡死。

**影响**:中——MVP 阶段(<5k)无影响,但库增长后会出现

**缓解**:
- MVP 阶段不解决,文档明确"MVP 推荐 < 5k 数码照片"
- Phase 2 加服务端 keyset 分页(`WHERE date_taken < ? ORDER BY date_taken DESC LIMIT 100`)
- Phase 2 加 FTS5 全文搜索(替代 LIKE 全表扫描)
- 文件存储已用年月分片(`uploads/digital/{year}/{month}/`),避免单目录 50k 文件
- SQLite 本身 50k 行无压力(有索引);瓶颈在 HTTP 传输和客户端渲染

**残留风险**:低——SQLite 不是瓶颈,分页方案明确

---

### R5. 迁移破坏现有胶片流程 [中]

**描述**:迁移脚本有 bug 导致现有胶片照片的 `roll_id` 被改 NULL,或新列默认值不当导致胶片照片在数码视图中错误出现。

**影响**:中——可能影响所有现有用户

**缓解**:
- 迁移幂等 + 纯增量(无 DROP/RENAME/MODIFY)
- 迁移前自动备份(`migration-tracker.js:21` 已有,保留最近 3 份)
- Backfill `source_type='film'` 只针对 NULL 行(`UPDATE photos SET source_type='film' WHERE source_type IS NULL`),不动已有值
- 测试清单:在真实 `film.db` 副本上跑迁移 → 跑全部胶片流程 → 验证零回归
- CI 加迁移测试:在测试 DB 上跑迁移 → 跑全套现有测试套件 → 全绿才合并

**残留风险**:低——迁移是增量的,可回滚

---

### R6. EXIF 提取覆盖率不足 [低]

**描述**:不同相机/手机的 EXIF 字段差异大(佳能 CR3、索尼 ARW、苹果 HEIC Live Photo、谷歌 Pixel 动态照片),exiftool 覆盖率未必 100%。

**影响**:低——缺字段的照片仍能导入,只是元数据不全

**缓解**:
- 复用 `server/services/exif-service.js` 已有的 piexifjs + exiftool-vendored 组合,覆盖主流相机
- 缺字段时用文件 mtime / "未知" 兜底,不阻塞导入
- 导入向导显示"EXIF 解析率: 89/124 完整",让用户知道哪些照片缺元数据
- Phase 2 视实际缺失率再加相机专属解析器

**残留风险**:低——降级路径明确

---

### R7. 命名混乱 "albums" vs "rolls" [低]

**描述**:用户可能混淆"相册"(虚拟策展)和"卷"(物理批次),尤其在跨模式策展时("这张胶片照片我能加到数码相册吗?")。

**影响**:低——UX 问题,不影响数据正确性

**缓解**:
- 文档和 UI 文案明确区分:卷(胶片,物理)/ 相册(虚拟,跨模式)
- 允许胶片照片加入相册(M2M),但 UI 上明确标注("此相册包含 N 张胶片照片、M 张数码照片")
- Onboarding 引导解释概念差异

**残留风险**:低

---

### R8. 移动端数码延迟 [低]

**描述**:用户在桌面启用数码模式后,期望移动端也能看数码照片,但 MVP 移动端不实现。

**影响**:低——用户预期管理即可

**缓解**:
- 移动端 Settings 显示"数码模式已在桌面端启用,移动端浏览将在 Phase 2 上线"
- 文档明确 MVP 移动端是纯胶片
- Phase 2 优先做移动端数码只读浏览(优先级高于智能相册等)

**残留风险**:低

---

## 7.2 未决问题(需用户决策)

### Q1. 打印件扫描的归类

**场景**:用户扫描了一张胶片放大的打印件(不是底片),得到 JPEG。这归胶片还是数码?

**用户决策(2026-07-23)**:**不自动判断,靠导入入口自然区分**。胶片导入入口(`POST /api/rolls`)上传的归胶片,数码导入入口(`POST /api/digital/import`)上传的归数码。用户在选入口时已自行决定。

**实现**:零额外逻辑,不做 EXIF 扫描软件检测弹窗。胶片导入设 `source_type='film'`,数码导入设 `source_type='digital'`。

---

### Q2. 数码照片能否加入"卷"?

**场景**:用户拍了数码照片,想把它和某卷胶片"放一起"(比如同一场景的胶片+数码对比)。

**选项**:
- A. 不允许——数码照片无 roll_id,只能通过相册或标签关联
- B. 允许——把数码照片的 roll_id 设为某卷的 id,让它在 RollDetail 中显示

**推荐**:**A(不允许)**。理由:roll 是物理概念(一卷胶卷),把数码照片塞进 roll 破坏语义。跨模式关联用相册(如"2024-04-12 东京银座对比")或标签(如"东京银座")实现。

**实现**:应用层校验:`INSERT photos` 时,若 `source_type='digital'`,强制 `roll_id=NULL`;若 `source_type='film'`,强制 `roll_id` 非空。

---

### Q3. 数码模式的"成本"追踪

**场景**:用户可能想知道数码摄影的"成本"(相机购买、镜头购买、存储卡等)。

**用户决策(2026-07-23)**:**MVP 不做,Phase 2 评估**。

理由:数码没有 film_items 库存生命周期表,成本概念不同(相机/镜头是器材投资;存储卡/硬盘一次性;Lightroom 订阅)。Phase 2 若用户提需求,可加跨模式"器材投资"统计(复用 equip_cameras/equip_lenses 的 purchase_price 字段汇总)。

---

### Q4. 胶片照片能加入数码相册吗?

**场景**:用户创建相册"东京 2024",想把胶片卷里的照片和数码照片都加进去。

**选项**:
- A. 允许——相册是跨模式策展单元
- B. 不允许——相册是数码专属
- C. 默认不允许,但用户可在设置开启"跨模式相册"

**推荐**:**A(允许)**。理由:跨模式策展是双模式应用的核心价值;`album_photos` M2M 表 schema 不限制 source_type;实现成本零。

**实现**:
- AlbumDetail 的"添加照片"模态默认显示数码照片,但提供"显示胶片照片"切换
- AlbumDetail 头部显示成员构成:"124 张(89 数码 + 35 胶片)"
- 相册本身不限定模式(`albums` 表无 source_type 字段)

---

### Q5. 胶片-数码对应物(场景关联)概念

**场景**:用户在同一物理瞬间拍了胶片+数码(如 Portra 400 + Sony A7IV),想建立"这两张是同一场景的对应物"关系,用于并排对比(色彩验证、场景记忆、教学展示)。

**用户决策(2026-07-23,经深入分析后确认)**:**方案 B(scene_id 字段)+ MVP 预留 schema,Phase 2 实现 UI**。

#### 真实使用场景(按频率)
1. **色彩验证对比**(最常见):同机位同构图拍胶片+数码,后期并排看"胶片色 vs 数码色"。通常 1:1
2. **多机位场景**:活动用 2 胶片 + 1 数码同瞬间多角度。N:M
3. **场景记忆**:旅行同景点胶片+数码都拍了。1:1 居多
4. **教学展示**:"Portra 400 vs 数码后期"对比。1:1

#### 5 个方案对比

| 方案 | Schema 改动 | 灵活性 | 工作量 | 语义清晰度 | MVP 建议 |
|---|---|---|---|---|---|
| A. `companion_photo_id`(1:1) | +1 字段 | 低(只能 1:1) | +1 人天 | 高 | ❌ 多机位失效 |
| **B. `scene_id` 字段(1:N)** | +1 字段 | 中(N 张共享 UUID) | +2 人天 | 高 | ✅ 推荐 |
| C. `scenes` 表 + M2M | +2 表 | 高(场景有元数据) | +5 人天 | 最高 | ❌ 过重 |
| D. 复用 albums(`is_scene`) | 0 | 中 | +1 人天 | 低(相册≠场景) | ❌ 语义错位 |
| E. 复用 tags | 0 | 低 | 0 | 低(标签≠场景) | ❌ 语义错位 |

#### 推荐:方案 B(`scene_id` 字段)+ MVP 预留 schema,Phase 2 实现 UI

**推荐理由**:
- 真实场景多为 1:N(多机位),方案 A 的 1:1 局限
- 方案 C 独立 scenes 表过重——用户不需要场景元数据(标题/备注),只需"这组照片一起看"
- 方案 D/E 语义错位:**相册**是策展集合(可含多场景),**标签**是主题分类,**场景**是"同一物理瞬间的多照片分组"。三者不同概念,混用会污染
- 方案 B 最轻:一个 UUID 字段,同场景共享,查询简单,UI 最小

**具体设计**:
- photos 加 `scene_id TEXT`(nullable,默认 NULL)
- 创建场景:PhotoView 点"关联到场景" → 生成 UUID → 当前照片 + 选中的其他照片共享此 `scene_id`
- 查看:PhotoView 显示"本场景其他 N 张"缩略图条;点击进入场景并排视图
- 跨模式:`source_type` 不限制,胶片+数码可同 `scene_id`
- 排序:`ORDER BY source_type, date_taken`(胶片在前数码在后,便于对比)

**MVP 处理**:
- **Schema 预留**:MVP 迁移就加 `scene_id` 字段(零成本,避免二次迁移)
- **UI 推迟到 Phase 2**:用户说"还没想好",说明非核心;MVP 用 albums 兜底;Phase 2 视反馈再做关联 UI 和并排视图

**决策状态**:已确认(2026-07-23)

---

### Q6. Library 视图与 Overview 的关系

**场景**:Overview(`client/src/components/Overview/`)现有 HeroCarousel + QuickStats + BrowseSection。新增 Library 视图后,两者关系如何?

**选项**:
- A. 保留 Overview 不变,Library 独立——Overview 是仪表盘,Library 是网格
- B. 合并 Overview 到 Library——Library 加一个"今日/本月概览"区
- C. Overview 升级为"模式仪表盘"(胶片模式显示胶片仪表盘,数码模式显示数码仪表盘)

**推荐**:**A(保留独立)**。理由:Overview 是"概览"(少而精),Library 是"全量浏览"(多而全),职责不同。Overview 的 HeroCarousel 可以加 mode 过滤(显示当日胶片或数码 best)。

---

### Q7. 数码模式的 AI 调色顾问模板

**场景**:现有 AI 模板有"FilmLab 调色顾问"。数码模式需要类似模板吗?

**选项**:
- A. 不做——数码无调色
- B. 做"数码整理顾问"模板——帮助组织、识别重复、建议相册
- C. Phase 2 再做

**推荐**:**B(MVP 做"数码整理顾问"模板) / C(实际工具 Phase 2)**。理由:模板本身是 prompt 字符串,成本极低;但 `auto_album`/`duplicate_detect` 工具在 Phase 2 才有真实实现。MVP 阶段模板先放,工具未实现时 AI 会回复"该功能将在后续版本上线"。

---

## 7.3 备选方案对比(完整记录)

### Schema 方案对比

| 方案 | 描述 | 优点 | 缺点 | 决策 |
|---|---|---|---|---|
| **A. 统一 photos 表** | source_type 字段区分,roll_id nullable | 共享视图一句 WHERE 过滤;tags/locations M2M 零改动;移动端 timeline 单流 | 必须 JOIN 审计(13 处);photos 表变宽 | ✅ 选定 |
| B. 分离 digital_photos 表 | 数码照片独立表 | 零胶片回归风险 | 共享视图需 UNION ALL;SQLite 视图不可索引;M2M 表需多态 FK | ❌ |
| C. 多态 containers | rolls 和 digital_albums 都指向 container | 抽象干净 | 迁移面广;rolls 有大量胶片专属字段不适用 | ❌ |

### 模式 UX 方案对比

| 方案 | 描述 | 优点 | 缺点 | 决策 |
|---|---|---|---|---|
| A. Workspace switcher | 顶部下拉切换 film/digital workspace | 切换感强 | 共享视图要实现两份;单用户不需要 workspace 隔离 | ❌ |
| B. 全局模式开关 + mode-guard | 单一 toggle + 中间件 404 | 简单 | 杀死跨模式视图(Calendar 看不到合流) | ❌ |
| **C. 过滤器** | 侧边栏模式章节始终可见 + per-view 过滤芯片 | 跨模式视图可用;无切换 chrome | 每个共享视图要加过滤芯片 | ✅ 选定 |

### DigitalDevelop 方案对比

| 方案 | 描述 | 优点 | 缺点 | 决策 |
|---|---|---|---|---|
| A. MVP 做完整 DigitalDevelop | 对标 FilmLab,从零做新面板 | 数码模式"完整" | 等于再造 FilmLab;范围爆炸 | ❌ |
| B. 复用 FilmLab 主组件加分支 | 在 117KB 主组件内加 source_type 分支 | 零新组件 | 胶片残留控件污染数码语境 | ❌ |
| **C. 复用底层 + 新轻 UI** | 复用 filmLab* 底层模块 + 新 ~25KB UI | 范围可控;底层零改动;UI 数码语境干净 | 新增 ~10 人天 | ✅ 选定 |
| D. MVP 不做,Phase 2 视反馈 | 保守 | 范围最小 | 用户已明确要复用 FilmLab 调色 | ❌ |
| E. 永远不做 | 拒绝任何 develop | 最保守 | 与用户决策冲突 | ❌ |

### RAW 处理方案对比

| 方案 | 描述 | 优点 | 缺点 | 决策 |
|---|---|---|---|---|
| A. 完整 RAW 解码 | libraw + WB/DCP/镜头校正 | 完整 RAW 工作流 | 另一个 FilmLab 体量 | ❌ |
| B. 内嵌 JPEG 预览 + RAW 存档 | exiftool 提取内嵌 JPEG | 不依赖完整解码管线 | 不能在 app 内调色 RAW | ❌(用户选 D6 调色后此方案矛盾) |
| **C. 仅 demosaic** | libraw-native 只做 demosaic,WB/HSL/Tone 交给 DigitalDevelop | 零新依赖;可调色 RAW | 不做 DCP/镜头校正 | ✅ 选定 |
| D. 不支持 RAW | 只接受 JPEG | 最简单 | 用户想归档 RAW 时双库管理 | ❌ |

### 调色参数存储方案对比

| 方案 | 描述 | 优点 | 缺点 | 决策 |
|---|---|---|---|---|
| **A. 入库 photos.develop_params_json** | 单字段 JSON,最新覆盖 | 简单;类比胶片 params_json;可保存为预设 | 不支持编辑历史(只最新) | ✅ 选定 |
| B. 调后导出覆盖 | 调色后导出新 JPEG 覆盖 positive_rel_path,参数丢弃 | 最简单 | 破坏性,不可回退 | ❌ |
| C. 推迟 | MVP 不调色 | 范围最小 | 与用户决策冲突 | ❌ |
| D. 完整编辑历史 | 每次调色存一个版本 | 可回退任意版本 | Lightroom 领地,工作量大 | ❌ |

## 7.4 决策日志

| 日期 | 决策 | 决策者 | 备注 |
|---|---|---|---|
| 2026-07-23 | 整体方案采用"过滤器 + 统一 photos 表" | 综合 explore + 两位子 agent 评审 | 见 02 ADR D1/D3 |
| 2026-07-23 | DSLR 扫描归胶片(source_type='film') | 设计决策 | 见 R3 |
| 2026-07-23 | 数码照片不能加入 rolls(Q2) | 设计决策 | 见 Q2 |
| 2026-07-23 | 胶片照片可加入相册(Q4) | 设计决策 | 见 Q4 |
| 2026-07-23 | **D6 调色 UI = 复用 FilmLab 底层 + 新轻 UI** | 用户两轮问答锁定 | 见 D6;原"MVP 不做"被推翻 |
| 2026-07-23 | **D7 RAW 解码 = 仅 demosaic** | 用户两轮问答锁定 | 见 D7;原"内嵌 JPEG"被推翻 |
| 2026-07-23 | **D9 调色参数入库** | 用户问答锁定 | photos 加 `develop_params_json` 字段 |
| 2026-07-23 | 模式 UX = 过滤器芯片(D1) | 用户问答锁定 | |
| 2026-07-23 | 移动端 = 桌面优先(D8) | 用户问答锁定 | |
| 2026-07-23 | 定位 = 存档+轻调色(D2) | 用户问答锁定 | "主要做存档,RAW 解码和调色复用 FilmLab" |
| 2026-07-23 | **Q1 打印件归类 = 靠导入入口自然区分** | 用户问答锁定 | 不做 EXIF 自动判断 |
| 2026-07-23 | **Q3 数码成本 = MVP 不做** | 用户问答锁定 | Phase 2 评估器材投资统计 |
| 2026-07-23 | **D10 DigitalDevelop 控件 = 9 类 + 裁剪/旋转** | 用户问答锁定 | UI ~32KB;+3 人天 vs 纯 9 类 |
| 2026-07-23 | **D11 DigitalDevelop 入口 = 只从 PhotoView** | 用户问答锁定 | 与 FilmLab 一致,无侧栏入口 |
| 2026-07-23 | **Q5 场景关联 = scene_id 字段(schema预留, UI Phase 2)** | 用户确认方案 B | 见 Q5;所有决策锁定 |

## 7.5 用户决策请求清单

**所有设计决策已锁定**(经三轮问答,2026-07-23)。

完整决策清单见 7.4 决策日志。可直接进入 MVP 实施(见 06 §6.2 工作项清单,**~52 人天,单人全时约 10-11 周**)。

### 锁定的 12 项核心决策

| ID | 决策 |
|---|---|
| D1 | 模式 UX = 过滤器芯片(非 workspace/全局开关) |
| D2 | 数码范围 = 存档 + 轻调色(非 Lightroom 替代) |
| D3 | photos 表 = 统一 + source_type 字段 |
| D4 | rolls vs albums = 独立概念,不对等映射 |
| D5 | roll_id nullable + 13 处 JOIN 审计(必做) |
| D6 | 调色 UI = 复用 FilmLab 底层 + 新轻 UI(~32KB) |
| D7 | RAW 解码 = 仅 demosaic(用现有 libraw-native) |
| D8 | 移动端 = 桌面优先(MVP 纯胶片) |
| D9 | 调色参数入库(photos.develop_params_json) |
| D10 | DigitalDevelop 控件 = 9 类核心 + 裁剪/旋转 |
| D11 | DigitalDevelop 入口 = 只从 PhotoView |
| Q5 | 场景关联 = scene_id 字段(schema 预留, UI Phase 2) |

下一步:基于此文档启动 MVP Phase 1 实施工作。
