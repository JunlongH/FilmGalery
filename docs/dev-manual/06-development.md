# 6. 开发指南

## 6.1 环境准备

### 6.1.1 系统要求
- **操作系统：** Windows 10/11, macOS, Linux
- **Node.js：** 18.x 或更高
- **包管理器：** npm 或 yarn
- **Git：** 用于版本控制

### 6.1.2 必需工具
```bash
# 检查 Node.js 版本
node --version  # 应显示 v18.x.x 或更高

# 检查 npm 版本
npm --version

# 安装全局工具（可选）
npm install -g nodemon  # 自动重启服务器
```

### 6.1.3 移动端额外要求
- **Android Studio** - Android 开发（可选，用于本地构建）
- **Java JDK 11** - Android 编译
- **Expo CLI** - `npx expo` 命令

## 6.2 项目初始化

### 6.2.1 克隆仓库
```bash
git clone <repository-url>
cd FilmGalery
```

### 6.2.2 安装依赖
```bash
# 根目录（Electron 依赖）
npm install

# 服务器端
cd server
npm install

# 桌面端
cd ../client
npm install

# 移动端
cd ../mobile
npm install
```

### 6.2.3 数据库初始化
```bash
cd server

# 初始化数据库（自动创建 film.db）
node init-db.js

# 可选：导入测试数据
sqlite3 film.db < seed.sql
```

## 6.3 开发工作流

### 6.3.1 启动后端服务器
```bash
cd server
npm start
# 或使用 nodemon 自动重启
nodemon server.js

# 服务器运行在 http://localhost:4000
```

### 6.3.2 启动桌面端
```bash
cd client
npm start

# 浏览器自动打开 http://localhost:3000
# 配置环境变量（可选）
REACT_APP_API_BASE=http://localhost:4000 npm start
```

### 6.3.3 启动移动端
```bash
cd mobile
npm start

# 选项：
# - 按 'a' 启动 Android 模拟器
# - 扫描二维码在真机上运行（需安装 Expo Go）
# - 按 'w' 在浏览器中运行
```

### 6.3.4 Electron 桌面应用
```bash
# 在根目录
npm run dev  # 同时启动服务器、客户端和 Electron

# 或分别启动
npm run dev:server    # 启动后端
npm run dev:client    # 启动前端
npm run dev:electron  # 启动 Electron
```

## 6.4 代码规范

### 6.4.1 文件命名
- **组件：** PascalCase（如 `RollDetail.jsx`）
- **工具函数：** camelCase（如 `dbHelpers.js`）
- **常量文件：** kebab-case（如 `api-client.js`）

### 6.4.2 变量命名
```javascript
// 组件名：PascalCase
function PhotoGrid() {}

// 函数名：camelCase
function calculateTotal() {}

// 常量：UPPER_SNAKE_CASE
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// 私有变量：下划线前缀
const _cache = new Map();
```

### 6.4.3 数据库命名
- **表名：** snake_case 复数（`film_items`, `photo_tags`）
- **列名：** snake_case（`created_at`, `location_id`）
- **外键：** `表名_id`（如 `roll_id`, `film_id`）

### 6.4.4 API 路由命名
```javascript
// RESTful 风格
GET    /api/rolls           # 列表
GET    /api/rolls/:id       # 详情
POST   /api/rolls           # 创建
PUT    /api/rolls/:id       # 更新
DELETE /api/rolls/:id       # 删除

// 特殊操作：动词后缀
PUT    /api/rolls/:id/resequence
POST   /api/film-items/batch-status
```

## 6.5 调试技巧

### 6.5.1 后端调试
```javascript
// 添加日志
console.log('[TAG] savePhotoTags called:', photoId, tags);

// 查看 SQL 语句
console.log('[DB] Executing:', sql, params);

// 性能分析
console.time('savePhotoTags');
await savePhotoTags(photoId, tags);
console.timeEnd('savePhotoTags');
```

### 6.5.2 前端调试
```javascript
// React Query Devtools
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

<QueryClientProvider client={queryClient}>
  <App />
  <ReactQueryDevtools initialIsOpen={false} />
</QueryClientProvider>

// 组件调试
useEffect(() => {
  console.log('[RollDetail] Props:', { id, data });
}, [id, data]);
```

### 6.5.3 数据库调试
```bash
# 打开数据库
sqlite3 server/film.db

# 查看表结构
.schema photos

# 执行查询
SELECT * FROM photos WHERE roll_id = 1;

# 查看索引
.indexes photos

# 导出数据
.output photos.sql
.dump photos
```

### 6.5.4 网络调试
```javascript
// 移动端：查看 Axios 请求
axios.interceptors.request.use(req => {
  console.log('[Axios] Request:', req.method, req.url);
  return req;
});

axios.interceptors.response.use(res => {
  console.log('[Axios] Response:', res.status, res.data);
  return res;
});
```

## 6.6 常见开发任务

### 6.6.1 添加新 API 端点
```javascript
// 1. 创建路由文件
// server/routes/my-feature.js
const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const data = await myService.getData();
    res.json(data);
  } catch (err) {
    console.error('[API] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// 2. 注册路由
// server/server.js
app.use('/api/my-feature', require('./routes/my-feature'));

// 3. 添加客户端函数
// client/src/api.js
export async function getMyFeature() {
  const res = await fetch(`${baseUrl}/api/my-feature`);
  return res.json();
}
```

### 6.6.2 添加数据库列
```javascript
// 1. 创建迁移文件
// server/migrations/2025-12-03-add-my-column.js
const { runAsync } = require('../utils/db-helpers');

async function up() {
  await runAsync('ALTER TABLE photos ADD COLUMN my_field TEXT');
  console.log('Added my_field column');
}

async function down() {
  // SQLite 不支持 DROP COLUMN
  console.log('Rollback not supported');
}

module.exports = { up, down };

// 2. 运行迁移
node server.js  # 启动时自动执行
```

### 6.6.3 添加 Prepared Statement
```javascript
// server/utils/prepared-statements.js
const STATEMENTS = {
  // 添加新语句
  'my-feature.getById': 'SELECT * FROM my_table WHERE id = ?',
  'my-feature.insert': 'INSERT INTO my_table (name) VALUES (?)'
};

// 使用
const data = await PreparedStmt.getAsync('my-feature.getById', [id]);
```

### 6.6.4 添加前端页面
```jsx
// 1. 创建组件
// client/src/components/MyFeature.jsx
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMyFeature } from '../api';

export default function MyFeature() {
  const { data, isLoading } = useQuery({
    queryKey: ['myFeature'],
    queryFn: getMyFeature
  });

  if (isLoading) return <div>加载中...</div>;
  return <div>{/* 渲染内容 */}</div>;
}

// 2. 添加路由
// client/src/App.js
<Route path="/my-feature" element={<MyFeature />} />
```

## 6.7 测试

### 6.7.1 手动测试
```bash
# 测试 API
curl http://localhost:4000/api/health

# 测试数据库
node server/check-real-db.js

# 测试迁移
node server/run-schema-fix.js
```

### 6.7.2 端到端测试
1. 启动服务器
2. 创建新胶卷
3. 上传照片
4. 添加标签
5. 检查统计数据

### 6.7.3 性能测试
```javascript
// 查看 Prepared Statements 统计
GET http://localhost:4000/api/_prepared-statements

// 查看请求性能分析
GET http://localhost:4000/api/_profiler
```

## 6.8 Git 工作流

### 6.8.1 分支策略
```bash
main           # 稳定版本
├── dev        # 开发分支
├── feature/x  # 功能分支
└── bugfix/y   # 修复分支
```

### 6.8.2 提交规范
```bash
# 功能
git commit -m "feat: 添加标签批量编辑功能"

# 修复
git commit -m "fix: 修复标签大小写重复问题"

# 文档
git commit -m "docs: 更新开发手册"

# 性能
git commit -m "perf: 优化照片查询性能"

# 重构
git commit -m "refactor: 重构 tag-service"
```

### 6.8.3 常用命令
```bash
# 查看状态
git status

# 暂存更改
git add .

# 提交
git commit -m "描述"

# 推送
git push origin main

# 拉取
git pull origin main

# 创建分支
git checkout -b feature/my-feature
```

## 6.9 故障排查

### 6.9.1 服务器无法启动
```bash
# 检查端口占用
netstat -ano | findstr :4000

# 删除数据库锁
rm server/film.db-shm server/film.db-wal

# 重新初始化
cd server && node init-db.js
```

### 6.9.2 数据库错误
```bash
# SQLITE_CONSTRAINT: 检查唯一约束
# SQLITE_BUSY: 检查并发访问，增加重试

# 备份数据库
cp server/film.db server/film.db.backup

# 检查完整性
sqlite3 server/film.db "PRAGMA integrity_check;"
```

### 6.9.3 移动端连接失败
```javascript
// 检查 IP 配置
console.log('Primary URL:', primaryUrl);
console.log('Backup URL:', backupUrl);

// 测试连接
curl http://192.168.1.100:4000/api/health

// 检查防火墙
# Windows: 允许 Node.js 入站连接
```

### 6.9.4 图片无法加载
```bash
# 检查文件权限
ls -la server/uploads/

# 检查路径
# 确保 thumb_rel_path 以 /uploads/ 开头

# 检查 Sharp 安装
npm rebuild sharp
```
