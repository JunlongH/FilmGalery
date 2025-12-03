# FilmGallery 生产环境配置指南

## 概述

本文档说明如何在生产环境中使用 FilmGallery，以及如何配置移动端连接到桌面端服务器。

## 桌面端（Electron）

### 构建安装包

```powershell
# 安装依赖（首次）
npm install

# 构建前端
npm run build

# 打包成可执行文件
npm run dist
```

安装包将生成在 `dist_v9` 目录中。

### 生产模式配置

桌面应用在生产模式下会：
- 使用打包后的静态文件（不再依赖 localhost:3000）
- 自动启动后端服务器在 `127.0.0.1:4000`
- 前端通过 `window.__electron.API_BASE` 获取正确的 API 地址

### 进程管理

应用已配置正确的进程清理逻辑：
- 关闭窗口时会最小化到系统托盘（不退出）
- 通过托盘菜单"退出"时会：
  1. 关闭 GPU 渲染窗口
  2. 优雅停止后端服务器
  3. 清理所有子进程
  4. 退出应用

如果发现后台仍有进程残留，可以手动在任务管理器中结束 `FilmGallery.exe` 和 `node.exe`（端口 4000）。

## 移动端（React Native Expo）

### 获取桌面端 IP 地址

移动端需要连接到桌面端的服务器。首先获取运行桌面应用的电脑的局域网 IP：

#### Windows 系统

1. 打开 PowerShell 或命令提示符
2. 运行命令：
   ```powershell
   ipconfig
   ```
3. 找到"无线局域网适配器 WLAN"或"以太网适配器"部分
4. 记录 IPv4 地址，例如：`192.168.1.100`

#### 快速获取 IP（PowerShell）

```powershell
# 获取活动网络适配器的 IPv4 地址
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -like '*Wi-Fi*' -or $_.InterfaceAlias -like '*以太网*'} | Select-Object -First 1).IPAddress
```

### 配置移动端连接

1. 确保桌面端应用正在运行（后端服务器在端口 4000）
2. 确保手机和电脑在同一个局域网
3. 打开移动端应用
4. 进入 **Settings** 页面
5. 在 "API Base URL" 输入框中输入：`http://YOUR_IP:4000`
   - 例如：`http://192.168.1.100:4000`
6. 点击 Save
7. 返回主界面，数据应该开始加载

### 防火墙配置

如果移动端无法连接，需要确保 Windows 防火墙允许端口 4000：

```powershell
# 在管理员权限的 PowerShell 中运行
New-NetFirewallRule -DisplayName "FilmGallery API" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow
```

或者通过 Windows 防火墙界面手动添加入站规则：
1. 打开"Windows Defender 防火墙"
2. 点击"高级设置"
3. 选择"入站规则" → "新建规则"
4. 选择"端口" → TCP → 特定本地端口 4000
5. 允许连接

### 移动端开发

如果需要开发移动端：

```bash
cd mobile
npm install

# 启动开发服务器
npm start

# 或使用 Expo Go
npm run ios  # iOS
npm run android  # Android
```

## 服务器 API 端点

后端服务器提供以下主要端点：

- `GET /api/rolls` - 获取所有胶卷
- `GET /api/photos` - 获取照片列表
- `GET /api/films` - 获取胶片库存
- `POST /api/rolls` - 创建新胶卷
- `GET /uploads/*` - 静态文件访问

完整 API 文档请参考 `server/routes/` 目录。

## 故障排查

### 桌面端无法启动

1. 检查日志文件：
   - `%APPDATA%/FilmGallery/electron-main.log`
   - `%APPDATA%/FilmGallery/server-out.log`
   - `%APPDATA%/FilmGallery/server-err.log`

2. 确保端口 4000 未被占用：
   ```powershell
   netstat -ano | findstr :4000
   ```

3. 如果端口被占用，终止进程：
   ```powershell
   # 找到 PID 后
   taskkill /F /PID <PID>
   ```

### 移动端连接失败

1. 确认桌面端正在运行
2. 确认 IP 地址正确
3. 测试连接：
   ```powershell
   # 在桌面端运行
   curl http://localhost:4000/api/rolls
   
   # 在手机浏览器访问
   http://YOUR_IP:4000/api/rolls
   ```

4. 检查防火墙设置
5. 尝试关闭 VPN 或代理

### 后台进程残留

如果关闭应用后发现任务管理器仍有进程：

```powershell
# 查找并终止 FilmGallery 相关进程
Get-Process | Where-Object {$_.ProcessName -like '*FilmGallery*' -or ($_.ProcessName -eq 'node' -and $_.MainWindowTitle -like '*FilmGallery*')} | Stop-Process -Force

# 终止占用 4000 端口的进程
$pid = (Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue).OwningProcess
if ($pid) { Stop-Process -Id $pid -Force }
```

## 版本信息

- 当前版本：1.6.0
- Electron: 26.6.10
- Node.js: （随 Electron 内置）
- React: 18.2.0

## 更新日志

### v1.6.0 (2025-12-02)
- 修复：关闭应用后后台进程不退出的问题
- 修复：Film Inventory 默认显示 "all" 而不是 "in stock"
- 改进：生产模式配置，支持移动端连接
- 改进：进程清理逻辑，确保 GPU 窗口和后端服务器正确关闭
