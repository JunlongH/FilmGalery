# 修复总结 - 2025-12-02

## 已完成的修复

### 1. 后台进程残留问题 ✅

**问题**：关闭应用后，任务管理器中仍有隐藏的后台进程（node.exe 和 FilmGallery.exe）。

**原因**：
- `electron-main.js` 中有重复的 `before-quit` 事件监听器
- GPU 渲染窗口未正确关闭

**解决方案**：
- 删除了 `createWindow()` 函数内部重复的 `app.on('before-quit')` 监听器
- 在主 `before-quit` 处理器中添加了 GPU 窗口关闭逻辑
- 确保进程清理顺序：GPU 窗口 → 后端服务器 → 应用退出

**修改文件**：
- `electron-main.js` (第 422 行和第 827 行)

### 2. Film Inventory 默认显示问题 ✅

**问题**：点击 Film Inventory 时默认显示 "in stock" 而不是 "all"。

**原因**：
- `FilmInventory.jsx` 组件初始状态 `filters.status` 设置为空字符串 `''`
- 下拉框的默认选项逻辑不正确

**解决方案**：
- 将初始状态改为 `{ status: 'all' }`
- 更新查询逻辑，当状态为 'all' 或空时不传递 status 参数
- 修正下拉框的 value 和 default option 为 "all"

**修改文件**：
- `client/src/components/FilmInventory.jsx` (第 26、61、82、186 行)

### 3. 开发模式改为生产模式 ✅

**问题**：
- 前端后端使用开发 URL (localhost:3000 和 4000)
- 移动端无法连接到桌面端服务器
- 打包后的应用仍然尝试连接 localhost

**解决方案**：

#### 桌面端配置
1. **electron-preload.js**：
   - 添加 `API_BASE: 'http://127.0.0.1:4000'` 到 `window.__electron` 对象
   - 前端通过 preload 脚本获取正确的 API 地址

2. **client/src/api.js**：
   - 更新 API_BASE 逻辑：优先使用 `window.__electron.API_BASE`
   - 开发模式下使用 `REACT_APP_API_BASE` 环境变量
   - 默认 fallback 为 `http://127.0.0.1:4000`

3. **client/package.json**：
   - 移除 build 脚本中的 `PUBLIC_URL` 设置
   - 保持 start 脚本用于开发模式

4. **其他组件**：
   - `ConflictBanner.jsx`：所有 localhost 改为 127.0.0.1

#### 移动端配置
- 移动端已有完整的配置机制：
  - 通过 Settings 页面设置 API Base URL
  - 支持保存到 AsyncStorage
  - 用户需要输入桌面端的局域网 IP（如 `http://192.168.1.100:4000`）

**修改文件**：
- `electron-preload.js`
- `client/src/api.js`
- `client/src/components/ConflictBanner.jsx`
- `client/package.json`

## 新增文档

### PRODUCTION-SETUP.md
完整的生产环境配置指南，包括：
- 桌面端构建和部署说明
- 移动端连接配置步骤
- 获取局域网 IP 的方法
- 防火墙配置指南
- 常见问题排查
- PowerShell 快速脚本

## 构建说明

### 重新构建前端
```powershell
cd "d:\Program Files\FilmGalery\client"
npm run build
```

### 打包桌面应用
```powershell
cd "d:\Program Files\FilmGalery"
npm run dist
```

安装包将生成在 `dist_v9` 目录。

## 测试验证

### 桌面端测试
1. 安装新的安装包
2. 启动应用，确认正常运行
3. 关闭窗口（最小化到托盘）
4. 右键托盘图标 → 退出
5. 检查任务管理器，确认没有残留进程

### Film Inventory 测试
1. 点击 Film Inventory 导航项
2. 确认默认显示 "All" 选项
3. 确认可以看到所有胶片条目
4. 测试切换到其他状态（in_stock, loaded 等）

### 移动端连接测试
1. 确保桌面端应用正在运行
2. 获取电脑 IP：`ipconfig` (Windows)
3. 在移动端 Settings 中输入：`http://YOUR_IP:4000`
4. 保存并返回，确认数据加载正常

## 注意事项

1. **防火墙**：确保端口 4000 在 Windows 防火墙中开放
2. **网络**：移动端和桌面端必须在同一局域网
3. **IP 变化**：路由器 DHCP 可能导致 IP 变化，建议配置静态 IP
4. **开发模式**：开发时使用 `npm run dev`，会启动 localhost:3000 和 4000
5. **生产模式**：安装包会自动使用 127.0.0.1:4000，无需配置

## 版本更新

当前版本：**1.6.0**

建议在发布说明中包含这些修复内容。
