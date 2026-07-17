# Phase 2B · 安全闭环层

> **范围**: #1 完整认证体系 · #7 HTTPS / 移动明文流量收窄
> **定位**: 偿还 Phase 1 显式 deferred 的安全债。Phase 1 的 CORS 决策（保留 `origin:true` + Private-Network）明确把远端防御整体押在「认证」上——本阶段是该承诺的兑现。
> **前置**: 2A（#10 测试护栏就位，认证路由必须有测试兜底）
> **状态**: ⬜ 未开始

---

## 工程一 · #1 完整认证体系

### 背景
Phase 1 决策原文：「非凭据请求下 CORS 并非真正安全边界；任意网站仍可发起 CSRF。**真正的防护是认证**」。

当前现状：
- 所有 `/api/*` 路由对任意来源放行（仅靠路径白名单 + 限流）。
- `/api/shutdown` 仅做本机回环校验，其余写路由无任何身份校验。
- 多端场景：Electron `file://`（origin=null）、dev `localhost:3000`、移动端、混合模式远端浏览器。

### 目标
配对码 / token + session 双层认证；client/mobile/watch 三端联动；server 加 `auth` 中间件。

### 设计要点

**策略：本机放行，远端强制**
- `auth` 中间件默认对 loopback（`127.0.0.1`/`::1`/`localhost`）放行，保持桌面端单机体验零摩擦。
- 对远端来源（非 loopback）强制 token；缺失/失效 → 401。

**配对流程（首绑）**
1. 桌面端首启生成短 TTL 配对码（6 位，本地显示）。
2. 移动端输入配对码 → server 校验 → 下发长效 token（绑定设备指纹）。
3. token 存 mobile keychain/keystore；后续请求带 `Authorization: Bearer <token>`。
4. session 表（DB）记录：token hash、设备、签发/过期、最后活跃。

**中间件挂载点**
- 全局 `auth` 在 `mountRoutes()` 内、具体路由之前注册（吸取 Phase 1 shutdown 被 404 兜底拦截的教训，注意顺序）。
- 例外白名单：配对码签发端点、健康检查。

**撤销与轮换**
- 桌面端「已配对设备」列表，支持单设备撤销。
- token 过期轮换（refresh 机制或重新配对，二选一，设计阶段定）。

### 任务拆解
1. DB：`sessions`/`devices` 表 + 迁移。
2. server：`auth` 中间件、配对码签发/校验端点、token 签发/校验/撤销。
3. client（Electron）：配对码 UI、设备管理面板。
4. mobile：配对码输入、token 安全存储、请求拦截器注入 header（走 `@filmgallery/api-client`，依赖 2A #9）。
5. watch：联动（如需）。

### 验收标准
- [ ] 远端无 token 访问写路由 → 401（测试固化）。
- [ ] loopback 访问 → 200，无额外步骤（保持单机体验）。
- [ ] 配对流程在三端跑通；token 撤销即时生效。
- [ ] `/api/shutdown` 等高危路由在远端必须 401。
- [ ] 认证相关路由 100% 测试覆盖（依赖 2A #10）。

### 风险
- **破坏现有单机体验**：必须严格保证 loopback 放行，否则桌面端回归。
- **配对码被暴力枚举**：限流（复用 Phase 1 的 rate-limit）+ 短 TTL + 失败次数锁定。
- **token 泄露**：只存 hash，明文不落盘；移动端用平台安全存储。

---

## 工程二 · #7 HTTPS / 移动明文流量收窄

### 背景
移动端当前依赖 `usesCleartextTraffic` / `network_security_config` 放行明文。FOLLOWUPS 指出**根因是服务端无 TLS**：混合模式（web→localhost 访问、远端访问）在明文下 token 可被窃听，使 #1 认证形同虚设。

### 目标
服务端启用 HTTPS → 移动端明文放行收窄为「仅服务器域」`domain-config`。

### 任务拆解

**server HTTPS**
- 启用 TLS：本机自签证书（桌面端场景，证书预置信任）+ 远端场景支持自定义证书路径。
- HTTP→HTTPS 重定向；保留 loopback 明文以兼容桌面单机（或全量 HTTPS，设计阶段定）。
- 凭证管理：证书生成脚本、过期检测、续期路径。

**移动端配置收窄**
- `network_security_config.xml`：`domain-config` 仅对服务器域信任（或用户证书）。
- 移除全局 `usesCleartextTraffic="true"`。
- React Native 网络层确认走系统信任链。

**桌面端**
- Electron `fetch`/`imageUrl` 白名单协议升级（配合 2D #8 GPU worker 的 SSRF 白名单）。
- 自签证书的信任流程（首次安装引导）。

### 验收标准
- [ ] server 默认 HTTPS；旧 HTTP 路径有明确迁移/重定向。
- [ ] 移动端不再有全局明文放行；抓包验证非服务器域明文请求被拒。
- [ ] 与 #1 的 token 在传输层加密保护。
- [ ] 桌面端自签证书首次安装流程文档化。

### 风险
- **现有部署断裂**：必须提供 HTTP 兼容期 + 迁移指南。
- **自签证书 UX**：远端浏览器会有警告——需文档引导或预置 CA。
- **依赖 #1**：HTTPS 是 #1 token 安全的必要条件，两者**必须配套上线**，不可单飞。

---

## 阶段出口条件（进入 2C/2D 的参考门槛）
1. 远端写路由无有效 token 必拒。
2. server 默认 HTTPS，移动端明文收窄完成。
3. #1 与 #7 同批次发布（强耦合）。
4. `FOLLOWUPS.md` 中 #1、#7 标记 ✅。

> 注：2B 与 2C/2D 无强阻塞依赖；如资源允许，#2 Electron 升级（2D）可与 2B 并行启动，但须 #10 先行。
