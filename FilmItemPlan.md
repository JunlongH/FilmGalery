## Plan: 引入 FilmItem 库并细化 Film/Roll 工作流

下面是根据你偏好（详细状态、批量录入、多片种一次采购、购买/冲洗信息集中在 FilmItem 上、不拆卷）整理的一份系统化、可维护的改造方案。

---

### Steps

1. **数据库设计与迁移方案**

2. **后端业务层（services）与路由设计**

3. **前端：FilmItem 批量购买录入 UI**

4. **前端：Create Roll 流程改造（从库存选卷并记录 loaded 相机）**

5. **统计与其他受影响逻辑的适配**

6. **迁移/兼容策略与后续扩展预留**

---

### 1. 数据库设计与迁移方案

1. **新增表 `film_items`（核心库存表）**

   存储你实际手上的每一卷胶片，购买与冲洗信息集中在这里。

   - 基本信息：
     - `id INTEGER PRIMARY KEY AUTOINCREMENT`
     - `film_id INTEGER NOT NULL` — 关联 `films.id`（胶片类型，如 Portra 400）
     - `roll_id INTEGER` — 可为空，用于关联拍摄完成后对应的 `rolls.id`
     - `status TEXT NOT NULL` — 枚举：`'in_stock' | 'loaded' | 'shot' | 'sent_to_lab' | 'developed' | 'archived'`
     - `label TEXT` — 可用于给每卷起个标记（如“P400-2025春节-01”），预留 UI 用。
   - 购买信息（集中在 FilmItem）：
     - `purchase_channel TEXT` — 平台/渠道（淘宝、京东、实体店等）
     - `purchase_vendor TEXT` — 店铺名/卖家名
     - `purchase_order_id TEXT` — 订单号（预留）
     - `purchase_price REAL` — 单卷价格（支持货币）
     - `purchase_currency TEXT` — 例如 CNY, USD
     - `purchase_date TEXT` — 购买日期
     - `expiry_date TEXT` — 有效期（到期日）
     - `batch_number TEXT` — 批次号（与 rolls 上同名可兼容统计）
     - `purchase_shipping_share REAL` — 分摊到该卷上的运费
     - `purchase_note TEXT` — 购买备注
   - 冲洗信息（集中在 FilmItem）：
     - `develop_lab TEXT`
     - `develop_process TEXT` — 工艺（C-41 等）
     - `develop_price REAL`
     - `develop_shipping REAL`
     - `develop_date TEXT`
     - `develop_channel TEXT` — 冲洗寄送方式或平台（快递公司/实验室网站）
     - `develop_note TEXT`
   - 状态/元信息：
     - `loaded_camera TEXT` — 在 `loaded` 时记录所用相机
     - `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`
     - `updated_at DATETIME`
     - `deleted_at DATETIME` — 软删除预留
     - `tags TEXT` or 单独 `film_item_tags`（可后续扩展）

2. **在 `rolls` 中增加关联字段和轻量冗余**

   - 新增字段：
     - `film_item_id INTEGER` — 指向 `film_items.id`，可为空。
   - 保留现有与购买/冲洗相关的字段（如 `purchase_cost`, `develop_cost`, `purchase_channel`, `develop_lab` 等），作为冗余缓存：
     - 新逻辑：当 Roll 来自 FilmItem 时，创建/更新 Roll 时同步一份 FilmItem 数据到这些字段，方便统计和兼容旧接口。
     - 旧逻辑：无 FilmItem 时，依然可以直接写入这些字段。

3. **状态机定义（详细粒度）**

   - 状态枚举：
     - `in_stock` — 购买后未装入相机。
     - `loaded` — 已经装入某台相机，记录 `loaded_camera`。
     - `shot` — 已经拍完，从相机中取出。
     - `sent_to_lab` — 已寄往冲洗。
     - `developed` — 冲洗完成。
     - `archived` — 存档状态（例如扫描完成并确认）。
   - 典型流转：
     - `in_stock -> loaded -> shot -> sent_to_lab -> developed -> archived`
     - 中间可允许略过部分（如个人工作流只用到 `in_stock -> shot -> developed`），但服务层统一管理规则。

4. **迁移脚本设计**

   - 新增 `server/migrations/2025-12-add-film-items.js`（示例命名）：
     - 创建 `film_items` 表。
     - `ALTER TABLE rolls ADD COLUMN film_item_id INTEGER`。
   - 暂不对旧数据强行创建 FilmItem，只预留后续“从 Roll 反推 FilmItem”的工具。

---

### 2. 后端业务层（services）与路由设计

1. **新增 `film-item-service.js`**

   定义统一的业务操作，避免逻辑散落在多处：

   - `createFilmItemsFromPurchase(purchasePayload)`：
     - 参数包含：购买日期、总运费、若干行条目（每行：`film_id`, `quantity`, 每卷单价、每卷备注等）。
     - 逻辑：
       - 先统计所有行的总卷数 `totalCount`。
       - 将总运费 `total_shipping` 按卷平均分配得到 `perItemShipping`（可保留小数，或对最后一卷做补差）。
       - 为每一行、每一卷创建一条 `film_items` 记录：
         - 每条记录写入 `purchase_price`, `purchase_shipping_share`, `purchase_channel`, `purchase_vendor`, `purchase_date`, `batch_number`, `expiry_date`, `status='in_stock'` 等。
   - `listFilmItems(filters)`：
     - 支持按 `status`, `film_id`, `expiry_date` 范围等过滤，对库存列表 / 选择器使用。
   - `updateFilmItem(id, payload)`：
     - 更新购买信息 / 冲洗信息 / 状态等。
   - `linkFilmItemToRoll({ filmItemId, rollId, loadedCamera? })`：
     - 核心逻辑：
       - 校验 FilmItem 状态为 `in_stock` 或 `loaded`。
       - 若是创建 Roll 且用户在此刻指定 loaded 相机：
         - 将 `status` 更新为 `loaded` 或 `shot`（推荐：创建 Roll 时设为 `shot`，若你在“装入相机”时就标记，则那一刻设 `loaded`，创建 Roll 时再变 `shot`）。
         - 写 `loaded_camera` 字段。
       - 设置 `roll_id = rollId` 和 `film_item_id` 回写到 `rolls`。
       - 将 FilmItem 上的购买/冲洗字段同步到 Rolls（冗余存储）。
   - `transitionFilmItemStatus(id, newStatus, extraFields)`：
     - 统一做状态合法性检查和更新（例如只允许特定顺序转换）。

2. **新增路由 `server/routes/film-items.js`**

   - `POST /film-items/purchase-batch`：
     - 请求体结构：
       - `purchase_date`, `purchase_channel`, `purchase_vendor`, `purchase_order_id`, `total_shipping`, `currency`, `note` 等“本次订单级别”的信息。
       - `items: [ { film_id, quantity, unit_price, expiry_date, batch_number, note_purchase }, ... ]`
     - 调用 `createFilmItemsFromPurchase`，返回创建出的 FilmItem 列表。
   - `GET /film-items`：
     - 支持 query 参数：`status`, `film_id`, `page`, `pageSize`, `sort` 等。
   - `GET /film-items/:id`：
     - 返回单条 FilmItem 详情。
   - `PUT /film-items/:id`：
     - 更新购买信息、冲洗信息、状态等。
   - `DELETE /film-items/:id`：
     - 软删除（写 `deleted_at`），不物理删除。

3. **改造 `rolls` 路由与 `roll-service`**

   - 在 `POST /rolls`（rolls.js）中：
     - 接收可选字段 `film_item_id`。
     - 流程：
       - 若提供 `film_item_id`：
         - 查询 FilmItem 确认状态为 `in_stock` 或 `loaded`。
         - 确定 `film_id`：优先使用 FilmItem 的 `film_id`，覆盖请求体中的 `filmId`（如存在）。
         - 先插入 Roll 基本信息，得到 `rollId`。
         - 调用 `linkFilmItemToRoll({ filmItemId, rollId, loadedCamera })`：
           - 更新 FilmItem 状态、`loaded_camera` 等。
           - 更新 `rolls.film_item_id` 及冗余字段。
       - 若未提供 `film_item_id`：
         - 保持原逻辑，兼容老用法。
   - 为“加载胶卷时记录相机”预留接口：
     - 可新增 `POST /film-items/:id/load`：
       - 设置状态为 `loaded`，并写入 `loaded_camera` 和 `load_date`（可新增字段）。
     - Create Roll 可选择：
       - 从 `in_stock` 直接到 `shot`，或者
       - 从 `loaded` 到 `shot`，视你的使用习惯。

---

### 3. 前端：FilmItem 批量购买录入 UI

1. **入口位置设计**

   - 在 `Film` 列表 / 详情页中增加一个入口：“新增库存 / 录入购买”。
   - 也可以在全局导航里增加“胶片库存”页，包含“新建购买批次”按钮。

2. **“新建购买批次”对话框 / 页面结构**

   - 顶部为“订单级信息”：
     - 购买日期（默认今天，可改）
     - 购买渠道（下拉：淘宝、京东、闲鱼、实体店、自定义）
     - 卖家 / 店铺名
     - 订单号（可选）
     - 总运费（必填，用于分摊）
     - 货币（默认 CNY）
     - 本次购买备注
   - 下方为“多行胶片条目表格”，支持 Add 按钮动态添加行：
     - 每行字段：
       - Film 选择器：从 `films` 列表选择（下拉或搜索）
       - 数量 `quantity`（整数，默认为 1）
       - 单价 `unit_price`（每卷价格）
       - 有效期 `expiry_date`（可为空）
       - 批次号 `batch_number`（文本）
       - 每行备注 `note_purchase`（可选）
     - UI 交互：
       - Add 按钮：新增一行，默认继承上一行的渠道 / 卖家等上层字段。
       - 删除行按钮（若某行误加）。
   - 提交时：
     - 前端先根据所有行计算总卷数，显示“总共 X 卷，将把总运费 Y 均分为每卷 Z 运费”给用户确认。
     - 点击提交后调用 `POST /film-items/purchase-batch`，后端按卷拆分。

3. **库存列表 UI**

   - 独立“胶片库存”页面：
     - 顶部过滤：状态（默认只看 `in_stock`）、Film 类型、即将过期（例如 3 个月内）等。
     - 列：
       - Film 名称
       - 状态
       - 有效期
       - 购买价格 + 分摊运费（合计成本）
       - 购买渠道/商家
       - 批次号
       - 关联 Roll（如有则显示链接）
   - 支持在此页面点击某条，查看/编辑 FilmItem 详情（编辑购买、冲洗信息、状态等）。

---

### 4. 前端：Create Roll 流程改造

1. **“从库存选择胶片”交互**

   - 在现有 Create Roll 表单中增加一个块，例如：
     - “选择胶片来源”：
       - 选项 A：从库存选择（推荐）。
       - 选项 B：手动输入胶片信息（兼容旧数据/临时使用）。
   - 当选择“从库存选择”时：
     - 显示一个选择器（弹窗或下拉），列出 `status='in_stock'`（以及可选 `loaded`）的 FilmItem：
       - 展示：Film 名称、有效期、批次号、购买渠道、每卷成本、标签等。
     - 选中后：
       - 将 `film_item_id` 写入表单状态。
       - 自动在 UI 中显示该 FilmItem 的关键信息（只读），并隐藏手动选择 Film 类型的输入（避免冲突）。

2. **记录 loaded 相机**

   - 你的需求：在 `loaded` 时可以选择并记录相机。
   - 两种操作点（可同时支持）：
     1. 在 FilmItem 详情页有一个“标记为已装入相机”动作：
        - 弹出对话框，选择相机（文本或从已有相机列表中选择），填 `loaded_camera`，状态改为 `loaded`。
     2. 在创建 Roll 时：
        - 若选择的 FilmItem 仍为 `in_stock`，则表单中增加“装入相机”选择（直接用你现在 Create Roll 中的相机字段）：
          - 在提交时，将该相机写入 FilmItem 的 `loaded_camera`。
          - 状态改为 `shot`（因为已经在创建 Roll，表示卷已拍完）。
   - UI 要点：
     - 在 Create Roll 时，当选择了 FilmItem：
       - 相机字段变成“本卷拍摄相机”（对应更新 Roll 自身的 `camera` 字段，同时写入 FilmItem 的 `loaded_camera`）。

3. **Create Roll 请求体调整**

   - 若有 `film_item_id`：
     - 前端发送：
       - `film_item_id`
       - `camera`（拍摄的相机）
       - 其他现有 Roll 字段（start_date, end_date, notes 等）
   - Old path 保持不变，未选 FilmItem 时不发送该字段。

---

### 5. 统计与其他逻辑适配

1. **统计接口调整**

   - 检查 stats.js（或相关）内的统计代码：
     - 若只从 `rolls` 表读取成本和实验室信息：
       - 当 Roll 关联 FilmItem 时，优先从 FilmItem 读取（或使用已同步的冗余字段）。
   - 新增可选统计维度：
     - 基于 FilmItem 的：
       - 库存总体价值（`purchase_price + purchase_shipping_share` 的总和）。
       - 按购买渠道统计成本（比如哪个平台更便宜）。
       - 即将过期库存数量。
       - 冲洗总成本（`develop_price + develop_shipping`）。

2. **兼容旧数据**

   - 若 Roll 没有 `film_item_id`：
     - 统计上继续沿用原字段。
   - 后续可新增一个后台工具或脚本：
     - 扫描已有 Rolls，给每个 Roll 自动补一个 FilmItem（`status='shot'` 或 `developed`），以便未来所有统计统一走 FilmItem 逻辑（可作为第二阶段）。

---

### 6. 迁移/兼容策略与后续扩展预留

1. **迁移顺序建议**

   1. 编写并运行 `film_items`/`rolls.film_item_id` 迁移脚本。
   2. 实现 `film-item-service.js` 与 `film-items` 路由。
   3. 改造 `rolls` 路由支持 `film_item_id`。
   4. 前端实现批量购买 UI 与 FilmItem 库列表。
   5. 前端整合 Create Roll 与 FilmItem 流程。
   6. 最后调整/扩展统计接口。

2. **扩展预留**

   - 不拆卷的前提下仍预留字段：
     - 将来如有“半卷装入相机”需要，可以通过 `quantity` > 1 + 自定义拆分逻辑扩展。
   - 状态机可以加上状态时间戳（如 `loaded_at`, `shot_at`, `sent_to_lab_at`）：
     - 可在当前计划中预留字段或在下一次迁移加入。

---

如果你觉得这套计划整体方向和细节都合适，下一步我可以帮你细化到：

- 精确字段定义（SQL 级别）和迁移脚本草案。
- 后端 `film-items` 路由与 `film-item-service` 的接口签名。
- 前端批量购买表单和“从库存选择”对话框的字段布局示意。