# 数据库迁移总结 - 2025-11-30

## 今日所有数据库变更

### 1. Photos 表新增字段
- `camera` TEXT - 拍摄使用的相机
- `lens` TEXT - 拍摄使用的镜头  
- `photographer` TEXT - 拍摄者

### 2. Rolls 表字段重命名
- `shooter` → `photographer` (统一命名，提高可维护性)

## 迁移实现方式

### 自动迁移（已实现）

服务器启动时会自动执行以下操作（`server/server.js` 中的 `ensureExtraColumns()` 函数）：

1. **检查 rolls 表的 shooter 列**
   - 如果存在 `shooter` 但不存在 `photographer`，自动调用迁移脚本重命名
   - 使用 `migrations/2025-11-30-rename-shooter-to-photographer.js`

2. **检查 photos 表缺失的列**
   - 自动添加 `camera`, `lens`, `photographer` 等缺失的列
   - 不影响现有数据

### 迁移文件

#### 已创建的迁移文件：

1. **`server/migrations/2025-11-30-add-photo-equipment.js`**
   - 添加 camera, lens, photographer 到 photos 表
   - 可独立运行

2. **`server/migrations/2025-11-30-rename-shooter-to-photographer.js`**
   - 将 rolls 表的 shooter 列重命名为 photographer
   - 保留所有现有数据
   - 使用表重建方式（SQLite 限制）

3. **`server/migrate-rename-shooter.js`**
   - 独立的迁移执行脚本
   - 已手动运行一次

## 数据库 Schema 更新

### server.js 中的 CREATE TABLE 语句已更新：

```sql
CREATE TABLE IF NOT EXISTS photos (
  ...
  camera TEXT,
  lens TEXT,
  photographer TEXT,
  ...
);

CREATE TABLE IF NOT EXISTS rolls (
  ...
  photographer TEXT,  -- 已从 shooter 改名
  ...
);
```

## Electron 桌面端运行流程

### 启动流程：
1. Electron 启动 → `electron-main.js`
2. 启动服务器进程 → `server/server.js`
3. 服务器初始化：
   - 验证表结构 → `verifySchemaTables()`
   - 运行迁移 → `ensureExtraColumns()` ✅ **自动检测并执行**
   - 初始化位置数据 → `seedLocations()`
   - 挂载路由 → `mountRoutes()`
4. 服务器就绪 → Electron 窗口加载 React 前端

### 迁移执行确认：

✅ **服务器启动时会自动：**
- 检查是否需要从 shooter 重命名为 photographer
- 添加 photos 表的 camera, lens, photographer 列
- 不会重复执行已完成的迁移
- 不会影响现有数据

## 验证方法

### 1. 查看服务器日志
启动后查看控制台输出：
```
[MIGRATION] Renaming shooter to photographer in rolls table...
[MIGRATION] Successfully renamed shooter to photographer
[MIGRATION] Added photo column camera
[MIGRATION] Added photo column lens
[MIGRATION] Added photo column photographer
```

### 2. 数据库验证
在服务器运行后，可以查询：
```sql
PRAGMA table_info(rolls);
PRAGMA table_info(photos);
```

应该看到：
- rolls 表有 `photographer` 列（没有 shooter）
- photos 表有 `camera`, `lens`, `photographer` 列

## 注意事项

1. **首次启动**：迁移会自动执行，可能需要几秒钟
2. **数据安全**：所有迁移都保留现有数据
3. **幂等性**：可以安全地多次运行，不会重复操作
4. **回滚**：迁移文件包含 down() 方法，但一般不需要使用

## 总结

✅ 所有今日数据库变更都已整合到服务器启动流程中
✅ Electron 桌面端启动时会自动完成迁移
✅ 不需要手动运行任何数据库脚本
✅ 适用于新安装和已有数据库的升级
