# Film Gallery

### *A Film management software developed all by AI tools using vibe coding.*

一款AI Vibe Coding的胶片摄影管理系统，支持多平台部署和混合算力架构。

***桌面端支持 Windows / Linux（deb、AppImage），移动端支持 Android（含 Wear OS 手表端）***

---

## ✨ 核心特性

- 🎞️ **胶片管理** - 胶卷信息管理、拍摄记录、设备档案
- 🖼️ **FilmLab 处理** - GPU 加速的胶片负片转正、色彩校正
- 📱 **多平台支持** - 桌面端、Android、Apple Watch
- 🏠 **NAS 部署** - Docker 一键部署到群晖/威联通等 NAS
- ⚡ **混合算力** - NAS 存储 + PC GPU 处理的最佳组合

---

## 🎯 部署模式

| 模式 | 数据存储 | FilmLab 处理 | 适用场景 |
|------|----------|--------------|---------|
| **本地模式** | PC 本地 | PC GPU | 单机使用 |
| **远程模式** | NAS Docker | ❌ 禁用 | 仅数据同步 |
| **混合模式** ⭐ | NAS Docker | PC GPU | 多设备 + FilmLab |

### 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      混合模式架构                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐         ┌──────────────┐         ┌──────────┐   │
│   │  手机/   │ ◄─────► │  NAS Docker  │ ◄─────► │  桌面端  │   │
│   │  手表    │         │  (数据存储)   │         │ (GPU算力)│   │
│   └──────────┘         └──────────────┘         └──────────┘   │
│                               ▲                       │         │
│                               │     FilmLab 渲染      │         │
│                               └───────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📦 项目结构

```
FilmGallery/
├── client/              # React 前端
├── server/              # Express 后端
├── electron-main.js     # Electron 主进程
├── docker/              # Docker 部署配置
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── README.md        # Docker 部署指南
├── mobile/              # Android 应用
├── watch-app/           # Apple Watch 应用
└── docs/                # 开发文档
```

---

## 🚀 快速开始

### 方式一：桌面端完整版（推荐新手）

下载安装包，双击运行，开箱即用：（请直接下载NAS版本里的安装包）

```
FilmGallery Setup x.x.x.exe
```

内置服务器自动启动，无需额外配置。

### 方式二：NAS Docker 部署（推荐多设备）

详见 [docker/README.md](./docker/README.md)

```bash
# 1. 加载镜像
docker load -i filmgallery-nas-latest.tar

# 2. 创建配置
cat > docker-compose.yml << EOF
version: '3.8'
services:
  filmgallery:
    image: filmgallery-nas:latest
    ports:
      - "4000:4000"
    environment:
      - SERVER_MODE=nas
      - DATA_ROOT=/mnt/photos/FilmGallery
      - ALLOW_ALL_MOUNTED_PATHS=true
    volumes:
      - /volume1/photos:/mnt/photos
EOF

# 3. 启动
docker-compose up -d
```

### 方式三：从源码运行（开发者）

```bash
# 安装依赖
npm install
cd client && npm install
cd ../server && npm install

# 开发模式
npm run dev

# 构建桌面应用（打包当前平台）
npm run dist
# 仅打包不发布：npm run pack
# 重新编译 Electron native 模块：npm run rebuild:electron
```

---

## 📱 客户端

### 桌面端 (Electron)

| 版本 | 说明 | 下载 |
|------|------|------|
| **完整版** | 内置服务器 + 客户端 | `dist_v9/FilmGallery Setup x.x.x.exe` |
| **轻量版** | 仅客户端 | `dist_v9_client/FilmGallery-Client Setup x.x.x.exe` |

### Android 应用

- 位置：`mobile/`
- 功能：浏览照片、查看拍摄记录、同步数据
- 要求：连接到 FilmGallery 服务器

### Wear OS 手表应用

- 位置：`watch-app/`
- 技术栈：React Native for Wear OS（非 SwiftUI）
- 功能：快速查看拍摄参数、拍摄计数
- 要求：与 Android 手机配对（开发中）

---

## 🐳 Docker 部署

### 支持的 NAS

- 群晖 Synology
- 威联通 QNAP
- 华硕 ASUS NAS
- 通用 Linux 服务器
- Windows Docker Desktop

### 快速配置

```yaml
environment:
  - SERVER_MODE=nas              # NAS 模式
  - DATA_ROOT=/mnt/photos/FilmGallery  # 数据存储路径
  - ALLOW_ALL_MOUNTED_PATHS=true # 允许浏览挂载目录

volumes:
  - /volume1/photos:/mnt/photos  # NAS 本地路径
```

### 文档

- [Docker 部署指南](./docker/README.md)
- [混合算力架构](./docs/hybrid-compute-architecture.md)
- [API 文档](./docs/DEVELOPER-MANUAL.md)

---

## 🔧 开发

### 技术栈

| 组件 | 技术 |
|------|------|
| 前端 | React, CRACO, Ant Design |
| 后端 | Express, SQLite, Better-sqlite3 |
| 桌面 | Electron |
| 移动 | React Native |
| 手表 | SwiftUI (WatchKit) |
| 部署 | Docker, Docker Compose |

### 开发命令

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建客户端
cd client && npm run build

# 构建 Docker 镜像
docker build -t filmgallery-nas -f docker/Dockerfile .

# 运行测试
npm test
```

### 项目配置

- `package.json` - 主项目配置（含内联的 electron-builder `build` 字段）
- `electron-builder-client-only.json` - 仅客户端轻量版打包配置
- `client/package.json` - 前端配置
- `server/package.json` - 后端配置
- `docker/docker-compose.yml` - Docker 配置

---

## 📖 文档

| 文档 | 说明 |
|------|------|
| [Docker 部署](./docker/README.md) | NAS Docker 部署完整指南 |
| [混合架构](./docs/hybrid-compute-architecture.md) | 混合算力架构设计 |
| [开发手册](./docs/DEVELOPER-MANUAL.md) | API 和开发指南 |
| [Docker 构建](./docs/DOCKER-BUILD-GUIDE.md) | Docker 镜像构建 |

---

## 🆘 故障排查

### 服务器无法启动

```bash
# 检查端口占用
netstat -tlnp | grep 4000

# 查看日志
docker logs filmgallery-server
```

### 客户端无法连接

1. 确认服务器地址正确
2. 检查防火墙设置
3. 测试 API：`curl http://<IP>:4000/api/discover`

### FilmLab 处理失败

1. 确认使用混合模式
2. 确认本地算力已启用
3. 检查 GPU 驱动

---

## 📄 License

MIT License

---

## 🙏 致谢

本项目完全由 AI 工具辅助开发，使用 Vibe Coding 方式构建。
