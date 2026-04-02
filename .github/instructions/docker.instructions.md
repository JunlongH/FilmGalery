---
description: "Use when working on Docker deployment, NAS configuration, docker-compose, or release packaging. Covers multi-platform builds and deployment modes."
applyTo: "docker/**"
---
# Docker 部署规范

## 构建

```bash
./build-image.sh              # 多平台构建（amd64 + arm64）
./create-release-package.sh   # 生成发布包
```

- 版本号从 `server/package.json` 自动获取
- 镜像推送到 Docker Hub: `filmgallery/server:VERSION` 和 `:latest`
- 需要 `docker buildx` 支持交叉编译

## 部署模式

| 模式 | SERVER_MODE | 用途 |
|------|------------|------|
| standalone | standalone | 本地独立运行 |
| nas | nas | NAS 数据服务（无 GPU） |
| hybrid | hybrid | NAS 数据 + PC GPU 计算 |

## docker-compose.yml 模板

```yaml
services:
  filmgallery:
    image: filmgallery/server:latest
    ports:
      - "4000:4000"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
    environment:
      - SERVER_MODE=nas
      - DATA_ROOT=/app/data
      - UPLOADS_ROOT=/app/uploads
```

## 目录结构

```
部署目录/
├── docker-compose.yml
├── data/              # SQLite 数据库
└── uploads/           # 照片文件
```
