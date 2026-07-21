# 04 · 架构问题（Critical 2 / High 4 / Medium 17 / Low 13）

全栈架构审计，覆盖构建工具链、Electron 安全、代码共享、CI/CD、测试、依赖管理。

---

## Critical（2 项）

### GPU Worker window nodeIntegration:true + contextIsolation:false

- **electron-main.js:677-687**
- 隐藏 GPU 渲染窗口拥有完整 Node.js 权限。`gpu-preload.js` 已写好用于安全迁移，但 `electron-main.js` **从未接线**。
- **修复**：启用在 electron-main.js 中设置 `nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'electron-gpu/gpu-preload.js')`。

### 零 CI/CD pipeline

- **无 `.github/workflows/`**，所有构建手动执行（`npm run dist`，`eas build`）。无自动化 lint/test gate，无 release automation。
- **修复**：设 4 条 GitHub Actions workflow：ci（lint+test on push/PR）、build-desktop（electron-builder on tag）、build-mobile（EAS build on tag）、docker（build+push Docker image on tag）。

---

## High（4 项）

### Client 有两套独立 API 层

- `client/src/api/`（13 文件，~1100 行）和 `packages/@filmgallery/api-client/`（11 文件）实现相同 REST 端点，互不引用。必然漂移。
- **修复**：client 迁移到 `@filmgallery/api-client`，留薄兼容层。

### 零 E2E 测试 + 零客户端组件测试

- 28 个测试文件全为 FilmLab 渲染管线单元/集成测试。无 Playwright/Cypress/Spectron/Detox。
- **修复**：加 Playwright+Electron E2E（import→edit→export 流程），加 vitest + @testing-library/react 组件冒烟测试。

### React 版本冲突

- Client (React 18.2.0) vs Mobile (React 19.1.0) vs Watch-app (React 19.2.0)。共用 hooks/components 使用 React 19 API（`use()`/`useOptimistic()`）会静默崩溃客户端。
- **修复**：冻结 client 到 React 18 + 文档化版本矩阵；或计划协调升级。

### Docker Node 版本分裂

- `.nvmrc` = 22、`package.json` engines ≥22.12.0、`Dockerfile` = node:20-alpine、`Dockerfile.cn` = node:18-alpine。Docker 构建会因 engines 约束失败。
- **修复**：统一到 node:22-alpine。

---

## Medium（17 项，精选）

### 构建工具链
1. Vite `optimizeDeps` 未含 `@filmgallery/shared`（CJS workspace 包可能未预打包）→ 冷启慢。
2. `legacy-peer-deps=true` 全局开启 → 掩盖真实依赖冲突。
3. `packages/shared` 超大单 barrel（31 文件）→ 无 tree-shaking 保证。

### 代码共享
4. 移动端独立 queryCache（pub/sub + TTL）vs 客户端 `@tanstack/react-query` → 并行缓存架构。
5. API 客户端创建模式三套不同配置（timeout/retry/failover）。

### 测试
6. 共享包测试面窄（http helpers 有覆盖，resource 模块无）。
7. 移动端仅 1 个 toolchain 测试。
8. Jest 配置整体干净（正面）。

### 数据/配置
9. DB 迁移 forward-only → 加 `--rollback-to=<name>` CLI。
10. 无 config.json 验证 schema → 加 JSON Schema + ajv。
11. 无崩溃报告（Sentry/Bugsnag/结构化日志）。

### i18n / 可访问性
12. 桌面端无 i18n → 移动端有框架但未共享。
13. 无 eslint-plugin-jsx-a11y。

### 性能/部署
14. Docker 构建缓存次优（全目录拷贝）。
15. `npm audit` 未集成到 CI。
16. 小状态分割（localStorage vs sessionStorage vs secure-store）未文档化。
17. `server/migrations/` 目录为空 → 迁移代码在 utils/。

---

## Low（13 项，精选）

- EAS build scripts Windows-only → 改 cross-platform
- 无 feature flag 基础设施 → 简单 env/JSON dict
- Vite cache 未显式配置 → 对当前规模 OK
- 无 offline support（Electron 自嵌 server 不急需）
- 无 quota monitoring → localStorage QuotaExceededError
- 环境变量命名不一致（FG_TLS_EXTRA_SAN vs DATA_ROOT）
- package-lock.json 分散（root/client/server/mobile/packages 各有）→ 考虑 turborepo/nx
- Docker Compose 资源限制被注释
- 无请求去重——React Query 多 observer 同一端点 → 双重 HTTP call
- Auth token 存储平台差异未文档化
- 无 API versioning 前缀 → v4 可一次性加上
- 无 semver 自动化（版本号分散在 5 个 package.json 中手动维护）

## 正面发现（11 项）

- CRA→Vite 迁移完成，无 webpack/CRACO 残留
- 三消费者架构清晰（Client / Mobile / Watch-app → shared + types + api-client）
- 无循环依赖
- Electron 主窗口安全配置优秀（sandbox + contextIsolation + 强 CSP）
- Certificate-error handler 仅接受本地 CA
- GPU image fetch 有 SSRF 保护（allowedHosts whitelist）
- DB 迁移设计良好（tracker table + auto-backup）
- 错误处理器生成 correlation UUID
- Mobile ApiErrorSnackbar 体验好
- HeroUI 内置 WAI-ARIA
- serverMode 本质上是 coarse-grained feature flag
