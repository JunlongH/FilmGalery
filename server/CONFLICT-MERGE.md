# 数据库冲突自动合并功能

## 功能概述

当使用OneDrive等云同步服务时，如果多台设备同时修改数据库，会产生冲突副本（如 `film-DESKTOP-XXX.db`）。本系统实现了智能检测和自动合并功能。

## 工作原理

### 1. 冲突检测（启动时自动）
- 扫描数据目录，查找 `film-*.db` 模式的文件
- 识别冲突副本的计算机名和修改时间

### 2. 智能对比
对比主数据库和冲突副本的关键表（rolls、photos、tags）：
- **只在冲突DB中的记录** → 标记为"需要导入"
- **两边都有的记录** → 比较 `updated_at` 时间戳
  - 冲突副本更新 → 标记为"需要更新"
  - 主DB更新 → 保持不变

### 3. 自动合并策略

#### 情况A：冲突副本无新数据
```
主DB: [1,2,3,4,5]
冲突: [1,2,3]
→ 判断：冲突副本是旧的/子集
→ 操作：重命名为 .bak，可安全删除
```

#### 情况B：冲突副本有新数据
```
主DB: [1,2,3,4,5]
冲突: [1,2,3,6,7]
→ 判断：冲突副本有新记录 6,7
→ 操作：
  1. 导入新记录 6,7 到主DB
  2. 比较共同记录的时间戳，保留最新版本
  3. 成功后重命名冲突文件为 .merged
```

#### 情况C：合并失败
```
→ 保留冲突文件
→ 控制台警告
→ 前端显示UI提示
```

## 时间戳合并逻辑

```javascript
for each 共同记录:
  main_time = 主DB记录的 updated_at
  conflict_time = 冲突DB记录的 updated_at
  
  if conflict_time > main_time:
    更新主DB为冲突版本  // 冲突副本更新
  else:
    保持主DB不变        // 主DB已是最新
```

## 使用方式

### 自动模式（推荐）
启动应用时自动检测并合并：
```bash
# 无需任何操作，后台自动处理
node server.js
```

日志输出：
```
[CONFLICT-RESOLVER] Found 1 conflict(s): film-DESKTOP-XXX.db
[CONFLICT-RESOLVER] Analyzing film-DESKTOP-XXX.db...
[CONFLICT-RESOLVER] Auto-merging 3 records...
[CONFLICT-RESOLVER] Merge complete: 3 records merged, 0 failed
[CONFLICT-RESOLVER] Conflict file backed up to .../.../film-DESKTOP-XXX.db.merged
```

### UI提示
前端顶部会显示橙色横幅：
```
⚠️ 检测到数据库冲突副本
   发现 1 个OneDrive同步冲突文件 (包含 3 条新记录)
   [自动合并] [暂时忽略]
```

点击"自动合并"触发合并操作。

### 手动命令行
```bash
# 仅分析，不合并
cd server
node conflict-resolver.js /path/to/data

# API方式
curl http://localhost:4000/api/conflicts
curl -X POST http://localhost:4000/api/conflicts/resolve
```

## 安全保障

1. ✅ **事务保护**：所有合并操作在SQLite事务中执行
2. ✅ **备份保留**：
   - 安全冲突 → 重命名为 `.bak`
   - 成功合并 → 重命名为 `.merged`
   - 失败 → 保留原文件
3. ✅ **只读检测**：对比阶段以只读模式打开
4. ✅ **详细日志**：每步操作都记录到控制台
5. ✅ **失败回滚**：合并失败自动回滚事务

## API端点

### GET /api/conflicts
获取当前冲突状态（不修改数据）

响应：
```json
{
  "hasConflicts": true,
  "conflicts": [
    {
      "filename": "film-DESKTOP-XXX.db",
      "hostname": "DESKTOP-XXX",
      "mtime": "2025-11-29T22:05:13.000Z",
      "size": 126976,
      "analysis": [
        {
          "table": "photos",
          "toImport": 2,
          "toUpdate": 1,
          "needsMerge": true
        }
      ],
      "needsMerge": true
    }
  ]
}
```

### POST /api/conflicts/resolve
触发自动合并

响应：
```json
{
  "ok": true,
  "conflictsProcessed": 1
}
```

## 限制和注意事项

### 不会自动合并的情况
- 冲突文件损坏无法打开
- 事务执行失败（如外键约束冲突）
- 文件权限不足

### ID冲突处理
新记录导入时使用 `INSERT`，让SQLite自动分配新ID，避免主键冲突。

### 文件路径引用
合并后，如果记录包含文件路径（如 `thumb_rel_path`），需要确保对应文件也已同步。

## 最佳实践

1. **定期检查**：前端每5分钟自动检查一次
2. **及时处理**：看到UI提示后尽快点击合并
3. **避免同时编辑**：尽量不要在多台设备同时修改同一胶卷
4. **使用服务器模式**：如频繁多设备使用，建议改用服务器-客户端架构

## 故障排除

### 合并失败
1. 检查控制台日志中的具体错误
2. 手动备份 `film.db` 和冲突文件
3. 使用SQLite工具比对两个文件
4. 根据需要手动导入缺失记录

### 冲突持续出现
可能原因：
- 多台设备仍在同时运行
- OneDrive同步延迟
- 一台设备使用旧版代码（未更新journal模式）

解决：
1. 确保所有设备都更新到最新代码
2. 暂时只在一台设备上运行
3. 等待OneDrive完全同步后再启动其他设备
