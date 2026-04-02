# FilmGallery 项目指南

## 项目概览

FilmGallery 是一个专业的胶片摄影数字化管理系统，采用 monorepo 架构，包含 4 个平台：
- **server/** — Express + SQLite 后端 API 服务
- **client/** — React 18 桌面端 (Electron 封装)
- **mobile/** — React Native + Expo 手机端
- **watch-app/** — React Native Wear OS 手表端
- **packages/shared/** — 跨平台共享渲染引擎和胶片处理模块

## 基本原则

- 不要假设我清楚自己想要什么，或者我已经完全理解了问题。动机或目标不明确时，先帮我澄清和定义问题，再进行分析。
- 目标清晰但路径不是最短的，直接告诉我并建议更合理的分析路径。不要为了迎合我而走弯路。
- 遇到问题追求根本原因，不要停留在表面现象或症状上。分析时不断问“为什么”，直到找到最底层的机制。不打补丁。


## 技术栈

| 平台 | 框架 | UI | 状态管理 | 样式 |
|------|------|-----|---------|------|
| Server | Express 4.18 | — | — | — |
| Desktop | React 18 + Electron 26 | HeroUI 2.8 | React Query 5 | Tailwind CSS 4 |
| Mobile | React Native 0.81 + Expo 54 | React Native Paper 5 | Context API | NativeWind 4.2 |
| Watch | React Native 0.83 | React Native Paper 5 | — | StyleSheet |

## 代码风格

- **变量/函数**: camelCase (`photoId`, `getRolls()`)
- **组件/类**: PascalCase (`PhotoGrid`, `RenderCore`)
- **常量**: UPPER_SNAKE_CASE (`CACHE_STRATEGIES`, `MAX_FILE_SIZE`)
- **数据库字段/表**: snake_case (`photo_id`, `film_items`)
- **API 路由**: kebab-case (`/api/film-items`, `/api/batch-render`)
- **文件名**: React 组件用 PascalCase.jsx，其它用 camelCase.js
- **Watch 端**: TypeScript (.tsx/.ts)

## 架构原则

1. **路由 → 服务 → 数据库** 三层分离（server）
2. **模块化 API 客户端** — `client/src/api/` 按资源拆分，通过 `index.js` 聚合导出
3. **React Query 缓存策略** — STATIC/SEMI_STATIC/DYNAMIC/REALTIME 四级，见 `queryClient.js`
4. **共享渲染管线** — `packages/shared/render/RenderCore.js` 统一 CPU/GPU 处理流程
5. **运行时 API_BASE** — 桌面端通过 `window.__electron.API_BASE` 配置，移动端通过 `ApiContext`

## 关键路径

- API 客户端: `client/src/api/core.js` 导出 `API_BASE`, `jsonFetch()`, `buildUploadUrl()`
- 缓存配置: `client/src/lib/queryClient.js` 的 `CACHE_STRATEGIES` 和 `DATA_CACHE_MAP`
- 渲染管线: `packages/shared/render/RenderCore.js` 的 Float32 管线
- 数据库: `server/db.js`（WAL 模式 + OneDrive 兼容）
- 迁移: `server/utils/migration.js`（启动时自动执行）
- Electron IPC: `electron-preload.js` 暴露 `window.__electron`

## 构建与运行

```bash
# 开发
npm run dev:full        # Server + Client + Electron 完整开发环境
npm run dev:web         # Server + Client 仅 Web 模式
cd mobile && npm run android  # 手机端
cd watch-app && npm run android  # 手表端

# 生产构建
npm run build-client    # React 生产构建
npm run dist            # Electron 安装包
cd docker && ./build-image.sh  # Docker 镜像

# 测试
npm test                # Jest 渲染一致性测试
```

## 部署模式

- **standalone** — 本地独立运行（默认）
- **nas** — NAS Docker 部署（数据服务器，无 GPU 计算）
- **hybrid** — NAS 数据 + PC GPU 计算
- **client-only** — 纯客户端连接远程服务器

## 重要约定

- 图片 URL 使用 `buildUploadUrl()` 构建，不要手拼路径
- 数据库使用预编译语句 (`PreparedStmt`)，禁止字符串拼接 SQL
- Express 路由中始终使用 `async/await` + try-catch 错误处理
- React 组件使用 `useCallback` 包装事件处理器，`useMemo` 包装计算
- 新增 API 需同时更新 server 路由 + client API 模块 + 对应 React Query hook
- 移动端 API 请求使用 axios + failover 机制（见 `setupAxios.js`）
- 详见 `docs/DEVELOPER-MANUAL.md` 获取完整开发文档

## 大文件写入
- 创建较长文档（>200行）时，先用 `create_file` 创建包含骨架结构（标题、章节号）的文件，然后用 `replace_string_in_file` 逐节追加内容
- 每次追加时，以文件末尾的 2–3 行已有文本作为 `oldString` 锚点，替换为原文本加新内容
- 禁止在单次工具调用中一次性写入超过 300 行的内容，分步写入更可靠