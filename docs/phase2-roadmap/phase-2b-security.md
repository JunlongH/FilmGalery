# Phase 2B · 安全闭环层

> **范围**: #1 完整认证体系 · #7 HTTPS / 移动明文流量收窄
> **定位**: 偿还 Phase 1 显式 deferred 的安全债。Phase 1 的 CORS 决策（保留 `origin:true` + Private-Network）明确把远端防御整体押在「认证」上——本阶段是该承诺的兑现。
> **前置**: 2A.1 + 2A.2（#10 测试护栏 + CI 门禁就位——已 ✅；被改路由必须有测试兜底）。2A.3 的 `@filmgallery/api-client` mobile/watch 采用已 ✅，满足本阶段任务 4 的依赖。**2A 完整收尾（reverse-geocode 等）非本阶段前置**。
> **状态**: 🟨 进行中 — 工程一（#1 auth）server + api-client 已落地并测试通过；工程二（#7 HTTPS）server + mobile manifest 已落地，runtime 验证待 metro/真机环境（见下方进度表）

---

## 进度记录（执行态）

| 子任务 | 状态 | 产出 / 证据 |
|---|---|---|
| 2B.0.1 `sessions` 表 + 索引 | ✅ | `server/db.js` `db.serialize()` 块内新增 `CREATE TABLE sessions` + 2 个索引（`token_hash`、`device_fp+kind`）；与 schema-migration 的 `CREATE IF NOT EXISTS` 模式一致 |
| 2B.0.2 `server/utils/sessions-store.js` | ✅ | DB 持久层：`issue / verify / touch / list / revoke`（级联到 `issued_by`）；token = `crypto.randomBytes(32).toString('hex')`；只存 `sha256` hash；re-pair 覆盖旧 session（`UNIQUE device_fp+kind`）。8 unit tests |
| 2B.0.3 `server/utils/auth.js` | ✅ | 中间件：loopback 放行 + 白名单（`/api/discover`、`/api/health*`、`/api/pairing/*`）+ Bearer regex + LRU 正向缓存（1000/60s，撤销结果不缓存）+ soft 模式（`X-Auth-Soft-Mode: warn`）。13 integration tests（含 7 个验收用例） |
| 2B.0.4 `server/routes/pairing.js` | ✅ | `/api/pairing/code`（loopback-only）+ `/api/pairing/verify`（限流 + `crypto.timingSafeEqual` + 3 失败锁定 423）。`CODE_TTL_MS=5min`、`MAX_FAILURES=3`。8 integration tests |
| 2B.0.5 `server/routes/sessions.js` | ✅ | `GET /api/sessions`、`DELETE /api/sessions/:id`（级联）、`POST /api/sessions/:id/derive-watch`（仅自身 session 可派生）。7 integration tests |
| 2B.0.6 `server/server.js` 挂载顺序 | ✅ | `mountRoutes()` 顶部按 §1 顺序挂载 `auth` → `/api/pairing`（含独立 5/15min limiter）→ `/api/sessions` → 其余路由 → 404 兜底。eslint 0 error |
| 2B.0.7 `@filmgallery/api-client` 扩展 | ✅ | `setAuthToken / getAuthToken / clearAuthToken / setOnUnauthorized` + Authorization header 注入（GET/POST/PUT/DELETE/postForm，retry/failover 保留）+ 401 触发回调。`.d.ts` 同步。12 unit tests |
| 2B.0.8 `server/utils/tls.js` | ✅ | TLS 凭证加载器：`FG_TLS_CERT/KEY` → 缓存 `~/.filmgallery/certs/` → 自签生成（`openssl req -x509 -addext`）；`FG_TLS_DISABLE=1` 关闭；`getDaysUntilExpiry`（≤30 天 warn）。7 unit tests |
| 2B.0.9 `server.js` HTTPS 启动 | ✅ | TLS 可用 → HTTPS on 主端口 + loopback HTTP on `port+1`；TLS 不可用 → 仅 HTTP（兼容）。boot smoke test 通过：`Server running on https://0.0.0.0:4000` + `Loopback HTTP mirror on http://127.0.0.1:4001` |
| 2B.0.10 mobile Android 配置收窄 | ✅ | 删 `src/main/AndroidManifest.xml` 的 `usesCleartextTraffic`；`network_security_config.xml` 改为 base=false + `domain-config`（localhost + 10.0.2.2）；debug/debugOptimized manifest 移除 `tools:replace` 覆盖 |
| 2B.0.11 端到端 smoke | ✅ | loopback `POST /api/pairing/code` → 6 位码；`POST /api/pairing/verify`（错码 → 401，对码 → 200 + 64-hex token）；`GET /api/sessions` 列表；`DELETE /api/sessions/1` 撤销 — 全跑通 |
| 2B.1 mobile 配对 UI + secure-store | ⏸ DEFERRED | 需 metro/真机环境。当前 `mobile/src/api/client.js` 仍用旧 `configureApi`；需要：`expo-secure-store` 集成 + 首绑 UI + 401 跳转 + `api.setAuthToken(token)` 绑定 |
| 2B.2 client（Electron）配对码面板 + 设备管理 | ⏸ DEFERRED | 需 CRA 构建验证。当前 `client/src/api/*` 仍用 `jsonFetch`，未走 `@filmgallery/api-client`；UI 需新增 `<PairingPanel/>` + `<DeviceManager/>` |
| 2B.3 watch 派生 token 接收 | ⏸ DEFERRED | 需 watch RN 环境。`watch-app/services/api.ts` 已用 `createApiClient`（2A.3.3），需新增 `setAuthToken` 绑定 |
| 2B.4 Electron `certificate-error` 处理 | ⏸ DEFERRED | 需 Electron runtime 验证。`electron-main.js` 增 `app.on('certificate-error', (e,w,url,err,cert,cb) => cb(isLocalhost(url)))` |

**验证边界声明**（为何 deferred）：本环境无 client CRA 构建、无 mobile metro 构建、无 watch RN 依赖、无 Electron runtime（Headless Linux server）。已完成的 server + packages 改动均经 `npm test`（330 tests / 19 suites green）+ `npm run lint`（0 error）+ 真实 server boot smoke 验证。Deferred 项的代码均为「消费端 UI 接线」，不涉及本阶段核心安全逻辑（auth middleware / token 校验 / TLS）。

**工程一（#1 auth）服务端核心已具备上线条件**；移动/桌面端 UI 接线可在 2A.4 mobile metro 环境就绪后并行推进。

---

## 0. 决策定稿（Design Ledger）

> 评审已锁定的决策。开工时无需再讨论；如要推翻需先改本表。

| ID | 决策 | 选项 | 理由 |
|---|---|---|---|
| **D1** | session 与 device 是否拆两表 | **合一为单 `sessions` 表** | 本应用威胁模型下一设备 = 一条活跃会话；拆表徒增 1 套迁移 + DAO，无 1:N 需求 |
| **D2** | token refresh vs 重配 | **长效 token + 撤销列表，不做 refresh** | refresh 主要缓解被动失效，对 token 被窃取帮助有限；引入 refresh token 又多一套撤销逻辑。撤销列表已能即时止血 |
| **D3** | 设备指纹来源 | **App 首装生成 UUID 存 Android Keystore / iOS Keychain** | 拒绝硬件 ID（IMEI/Android ID/序列号）——隐私 + 权限成本高，且 Android 10+ 已禁止 |
| **D4** | watch 配对路径 | **watch 不独立配对；通过已配对 mobile 派生 token** | watch 几乎总与 mobile 共存；输入 6 位码 UX 糟糕。mobile 在「设备管理」里发起 watch 派生，server 用 mobile 自身 token 鉴权后签发 watch token |
| **D5** | `/uploads/*` 静态资源鉴权 | **整体白名单豁免**（首版）；未来可演进为签名 URL | `<img src="/uploads/...">` 无法带 `Authorization` header；豁免最简且不破坏现有 100+ 处 URL 拼接。威胁面：暴露图集存在性（路径枚举），不暴露内容（仍受路径钳制 `path-security.js`）。可接受 |
| **D6** | HTTPS 范围 | **loopback 自签（mkcert 风格）+ 远端用户自带证书路径**；**远端浏览器自签场景不在 2B 范围内**（仅文档化） | 自签 + 远端浏览器的「首次信任」UX 极差且无优雅方案；走自带证书（家庭 NAS 常用 DDNS+Let's Encrypt）才是真路径 |
| **D7** | HTTP 兼容期 | **保留 loopback HTTP**（桌面单机零摩擦）；**远端强制 HTTPS 重定向**（无兼容期） | 远端 token 必须走 TLS；保留远端 HTTP 等于 #7 失效。旧 mobile 客户端通过升级走 HTTPS，soft-period 处理升级期（见 D8） |
| **D8** | mobile 升级断裂缓解 | **server 远端无 token 时 soft warn-log 1 个版本，第 2 个版本起 enforce 401** | 避免 mobile 用户升级 lag 期间「突然全 401」。warn-log 通过响应头 `X-Auth-Soft-Mode: warn` 暴露，mobile 提示用户去配对 |
| **D9** | auth 中间件复用 isLoopback | **是**，直接 `require('@filmgallery/shared/network').isLoopback` 或 `server/utils/network.js` | 已有 IPv4-mapped IPv6 归一与 `LOOPBACK_IPS={'127.0.0.1','::1','localhost'}`（`server/utils/network.js:12` + 测试 `__tests__/network.test.js`），不另起平行实现 |

---

## 1. 全局挂载顺序（Cross-Cutting）

> Phase 1 教训：`shutdown` 路由被 `/api/*` 404 兜底拦截。Phase 2B 新增 `auth`，必须把顺序写死。

当前 `server.js` 中间件链（已核实）：

```
helmet → apiLimiter(/api) → requestProfiler → computeGuard
       → bodyParser → compression
       → cors({origin:true, credentials:false, preflightContinue:true})
       → Private-Network header
       → app.options('*')  ← preflight 短路 204
       → express.static('/uploads/tmp'|'/uploads/rolls'|'/uploads')  ← 静态资源
       → /api/server-info（port discovery）  ← 必须在 auth 之前
       → /api/shutdown（loopback 校验内建）  ← 必须在 auth 之前（已有 loopback 放行）
       → 【新增】auth 中间件  ← 挂载点
       → 其余 /api/* 路由
       → 404 兜底
```

**关键不变量**（必须测试固化）：
1. `OPTIONS *` 必须在 auth 之前短路返回 204，否则远端浏览器 preflight 一律 401，API 整体不可达。
2. `/uploads/*` 必须在 auth 之前（D5 豁免）。
3. `/api/server-info`（port discovery 端点）必须在 auth 之前——否则未配对设备永远找不到 server，配对流程死锁。
4. `/api/shutdown` 已内建 loopback 校验，提前注册即可；auth 之后亦可（会被 auth 的 loopback 放行命中），但保持现状（提前）更稳。
5. auth 必须在 404 兜底之前——否则未授权请求先吃 404 再吃不到 401（Phase 1 复现 bug）。

**pre-auth 白名单（豁免表）**：
- `OPTIONS *`（由 `app.options('*')` 处理）
- `/uploads/*`（静态资源，D5）
- `/api/server-info` + `/api/health` + `/api/server-info/mdns`（port discovery + 健康检查）
- `/api/pairing/code`（桌面端签发配对码，需另行内建 loopback 校验）
- `/api/pairing/verify`（mobile 提交配对码换 token，本身凭配对码鉴权）

**配对码端点的特殊防护**：
- `/api/pairing/code`（签发）：**仅 loopback 可调用**（复用 `isLoopback`），防止远端触发签发。
- `/api/pairing/verify`（校验）：复用 Phase 1 `rateLimit`，单独配额 `5 次/15min/IP` + 失败 3 次锁定 15min（防 6 位码枚举）。

---

## 工程一 · #1 完整认证体系

### 背景
Phase 1 决策原文：「非凭据请求下 CORS 并非真正安全边界；任意网站仍可发起 CSRF。**真正的防护是认证**」。

当前现状（已核实）：
- 所有 `/api/*` 路由对任意来源放行（仅靠 `helmet` + 全局 `apiLimiter` 2000/15min + 路径白名单）。
- `/api/shutdown` 仅做本机回环校验（`server.js:495` 的 `createShutdownRouter`），其余写路由无任何身份校验。
- 多端场景：Electron `file://`（origin=null）、dev `localhost:3000`、移动端、混合模式远端浏览器。
- 既有可复用资产：`server/utils/network.js` 的 `isLoopback` / `LOOPBACK_IPS`；Phase 1 的 `express-rate-limit`；2A 的 `@filmgallery/api-client`（mobile/watch 已采用）；DB 迁移 runner（`server/utils/migration.js`）。

### 目标
配对码 → 长效 token 两层认证；mobile 直配，watch 由 mobile 派生；server 加 `auth` 中间件；桌面单机零摩擦。

### 设计要点

**策略：本机放行，远端强制（D9）**
- `auth` 中间件开头先调 `isLoopback(req.ip)` → 命中即 `next()`。**注意 express 的 `trust proxy` 设置**——若 server 部署在反向代理后，`req.ip` 可能是代理 IP 而非真实来源；本应用 server 直连 LAN，保持默认即可，但需在文档注明。
- 远端来源强制 `Authorization: Bearer <token>`；缺失/失效/已撤销 → `401 {error:'unauthorized'}`。
- soft 模式开关：env `AUTH_SOFT_MODE=1` 时，远端无 token 不返回 401，但响应头加 `X-Auth-Soft-Mode: warn` 并 `console.warn`（D8 升级期）。

**配对流程（mobile 首绑）**
1. 桌面端打开「设备管理」面板 → 调用 `/api/pairing/code`（loopback-only）→ server 生成 6 位码，TTL 5min，进程内 in-memory（重启即清空，无影响）。
2. mobile 输入配对码 + 本机生成 UUID（D3）作为 `device_fingerprint` → POST `/api/pairing/verify`。
3. server 校验码 + 限流（5/15min + 3 失败锁定）→ 通过则生成 32 字节随机 token（`crypto.randomBytes`），hash（`sha256`）后入 `sessions` 表，明文返回一次。
4. mobile 存 token 到 Android Keystore / iOS Keychain；后续经 `@filmgallery/api-client` 注入 `Authorization: Bearer <token>`。
5. server 记录：`token_hash, device_name, device_fingerprint, issued_at, expires_at(=NULL 或远期), last_seen_at, revoked_at(NULL)`。

**watch 派生流程（D4）**
1. watch 已通过 mobile 上线（同 LAN）。
2. mobile「设备管理」→ 选「添加 watch」→ server 用 mobile 自身 token 鉴权 → 签发 watch 专属 token（绑 watch 的 device_fingerprint）。
3. mobile 通过现有 watch 同步通道（蓝牙/Wi-Fi Direct/局域网）把 token 推给 watch。
4. watch 后续直连 server（已通过 `@filmgallery/api-client`，2A 完成）。

**`sessions` 表 schema（D1 合一）**

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash    TEXT    NOT NULL UNIQUE,        -- sha256(token), constant-time 比对
  device_name   TEXT    NOT NULL,               -- 用户可读名："June's iPhone"
  device_kind   TEXT    NOT NULL,               -- 'mobile' | 'watch' | 'other'
  device_fp     TEXT    NOT NULL,               -- D3 首装 UUID
  issued_at     INTEGER NOT NULL,               -- unix ms
  expires_at    INTEGER,                        -- NULL = 不主动过期（D2）
  last_seen_at  INTEGER NOT NULL,
  revoked_at    INTEGER,                        -- NULL = 未撤销；非 NULL = 撤销时间
  issued_by     INTEGER,                        -- 派生该 token 的上游 session.id（watch 派生场景）；自签为 NULL
  UNIQUE(device_fp, device_kind)                -- 一设备一类一会话；重配覆盖旧 token
);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_device_fp ON sessions(device_fp, device_kind);
```

迁移走既有 runner（`server/utils/migration.js`），文件名 `server/utils/migrations/XXXX_add_sessions.sql`（或入 schema-migration，与现有模式一致）。

**撤销（D2）**
- `sessions.revoked_at` 非空 → auth 视为无效。
- `auth` 中间件每请求查 1 次 `sessions` 表（按 `token_hash` 命中 + `revoked_at IS NULL`）——可加 in-memory LRU（1000 条 / 60s TTL）缓存正向结果；**撤销结果不缓存**（即时生效）。
- 桌面端「设备管理」面板列设备 + 单设备撤销；撤销 mobile 时联动撤销其派生的 watch tokens（`issued_by` 链）。

### 任务拆解

1. **DB**：`sessions` 表 + 迁移（D1 schema）+ 索引。
2. **server**：
   - `server/utils/auth.js`：`auth` 中间件（loopback 放行 + 白名单短路 + token 校验 + LRU 缓存）。
   - `server/routes/pairing.js`：`/api/pairing/code`（loopback-only）+ `/api/pairing/verify`（限流 + 锁定）。
   - `server/routes/sessions.js`：`GET /api/sessions`（列设备）、`DELETE /api/sessions/:id`（撤销）、`POST /api/sessions/:id/derive-watch`（D4 派生）。
   - `server/server.js`：按 §1 顺序挂载 `auth`；env `AUTH_SOFT_MODE` 解析。
3. **client（Electron）**：配对码显示面板（6 位码 + TTL 倒计时 + 二维码）、设备管理列表（撤销/派生 watch）。
4. **mobile**：
   - 配对码输入 UI（首绑）。
   - token + device_fp（首装 UUID）存 Android Keystore（用 `expo-secure-store` 或 `react-native-keychain`）。
   - `@filmgallery/api-client` 扩展 `setAuthToken(token)` 注入 `Authorization`；mobile `src/api/client.js` 在 configureApi 时绑定。
5. **watch**：接收 mobile 派生 token + 存安全存储；`api-client` 同样注入 header。
6. **api-client 扩展**（`packages/@filmgallery/api-client/index.js`）：新增 `setAuthToken/getAuthToken/clearAuthToken` + 请求拦截注入；对 401 响应触发回调（mobile/watch 跳转重配 UI）。补 `__tests__/index.test.js` 用例。

### 验收标准
- [ ] **远端无 token 访问写路由 → 401**（soft 模式关闭时）；soft 模式开启时 → 200 + `X-Auth-Soft-Mode: warn` 响应头。
- [ ] **loopback 访问任何路由 → 200/正常**，不要求 token（保持桌面单机零摩擦）。
- [ ] **`OPTIONS *` preflight 不被 auth 拦截**（204）。
- [ ] **`/uploads/*` 远端无 token 也能访问**（D5 豁免生效）。
- [ ] **`/api/server-info` 远端无 token 可访问**（port discovery 不死锁）。
- [ ] **配对流程**：mobile 输码 → 拿到 token → 后续请求成功；token 撤销后立即 401。
- [ ] **watch 派生**：mobile 派发 watch token → watch 用该 token 成功调用 → mobile 撤销时 watch token 同时失效。
- [ ] **配对码爆破防护**：同 IP 连续 5 次/15min 后 429；3 次失败码后锁定 15min。
- [ ] **`/api/shutdown` 远端 → 401**（auth 兜底，即便 shutdown 自身 loopback 校验漏远端）。
- [ ] **测试 7 用例固化**（见下）。

### 测试用例（具体 7 条，替代「100% 覆盖」口号）
1. 远端无 `Authorization` → 401（写路由 + 读路由分别 1 例）。
2. loopback 任意路由（含 `/api/shutdown`）→ 200/正常。
3. `OPTIONS /api/anything`（模拟 preflight）→ 204，不触发 auth。
4. 配对码：连续 3 次错码 → 第 4 次锁定（即便码正确也 423 Locked）。
5. token 撤销后同 token 立即 401（验证撤销结果不缓存）。
6. 过期 token（`expires_at < now`）→ 401。
7. 畸形 `Authorization`（`Bearer`、`Bearer `、`Bearer xxx yyy`、空 token）→ 401，不抛异常。

### 风险
- **破坏现有单机体验**：D9 loopback 放行 + 测试 #2 兜底。
- **配对码爆破**：5/15min 限流 + 3 失败锁定（任务 2）；6 位码空间 10^6，3 次锁定下有效尝试 ≤3/15min，爆破需 ~3500 年。
- **token 泄露**：只存 hash（DB 拖库不拿到明文）+ mobile Keystore（沙箱隔离）+ 撤销列表即时止血。
- **`req.ip` 被 proxy 污染**：文档注明「server 必须直连 LAN，不挂反代」；若未来要挂反代，需先开 `trust proxy` 并校验 `X-Forwarded-For` 链。
- **auth 中间件每请求查 DB**：LRU 缓存（1000 条 / 60s TTL）+ 索引 `token_hash` 单点查询，预期 <1ms。
- **升级期 mobile 全 401**：D8 soft 模式缓解 1 个版本窗口。

---

## 工程二 · #7 HTTPS / 移动明文流量收窄

### 背景（已修正 FOLLOWUPS 引用）
`FOLLOWUPS.md:50` 原文：「**移动端明文流量**：根因是服务端无 TLS」。此句仅针对 #7，**不针对 #1**。#1 与 #7 是互补但独立：
- #1（认证）防未授权调用——即便有 HTTPS，没认证照样不安全。
- #7（TLS）防窃听/中间人——即便有认证，明文下 token 可被窃听使 #1 形同虚设。

「两者必须配套上线」的结论不变（强互补），但论证链是「互补」而非「同根因」。

### 目标（D6 收窄后）
- **loopback**：mkcert 风格自签证书，桌面单机走 HTTPS（与远端同套代码路径，避免双轨）。
- **远端**：用户通过配置项 `FG_TLS_CERT` / `FG_TLS_KEY` 提供自有证书（家庭 NAS 常用 DDNS + Let's Encrypt）。
- **远端浏览器自签场景**：不在 2B 范围（文档化为「不支持的部署形态」，引导用户走自有证书）。
- **HTTP 兼容（D7）**：仅 loopback 可走明文（桌面单机零摩擦）；远端 HTTP 强制 301 → HTTPS（无兼容期，否则 #7 失效）。
- **移动端配置收窄**：删 `usesCleartextTraffic`，`network_security_config` 改为 `domain-config` 仅服务器域放行。

### 任务拆解

**server HTTPS**
1. 证书加载：
   - 优先 env `FG_TLS_CERT` + `FG_TLS_KEY`（用户自有证书）。
   - 缺省：启动时检查 `~/.filmgallery/certs/{cert.pem,key.pem}`，没有则用内嵌脚本生成自签（CN=localhost，SAN 含 `127.0.0.1,::1,localhost`，有效期 1 年）。**复用 `node-forge` 或调用 `openssl` CLI，不引入新重依赖**——优先 `openssl`（Linux/macOS/Windows Git Bash 均自带）。
2. 启动双协议：
   - HTTPS server 监听主端口（如 4000）。
   - HTTP server 监听辅助端口（如 4001），**仅 loopback 接受**，非 loopback 请求 301 → HTTPS。或更简：HTTP server 只绑 `127.0.0.1`，远端连不上。
3. 凭证管理：启动时检测证书过期 ≤30 天 → console.warn；续期 = 用户重跑生成脚本或换自有证书。
4. `apiLimiter` / `auth` / 所有中间件 **不变**——TLS 在 socket 层，对 express 透明。

**移动端配置收窄**
1. `mobile/android/app/src/main/AndroidManifest.xml`：**删除 `android:usesCleartextTraffic="true"` 属性**（当前在 `<application>` 上）。
2. `mobile/android/app/src/main/res/xml/network_security_config.xml`：
   ```xml
   <network-security-config>
     <base-config cleartextTrafficPermitted="false">
       <trust-anchors>
         <certificates src="system"/>
         <certificates src="user"/>   <!-- 仅 debug 构建；release 应移除 -->
       </trust-anchors>
     </base-config>
     <!-- 仅 10.0.2.2（emulator→host loopback）走明文，便于本地调试 -->
     <domain-config cleartextTrafficPermitted="true">
       <domain includeSubdomains="false">10.0.2.2</domain>
       <domain includeSubdomains="false">localhost</domain>
     </domain-config>
   </network-security-config>
   ```
   - **注意当前仓库有 2 份重复的 `network_security_config.xml`**（expo prebuild 产物 + 手改）——必须**两份同步修改或合并**，否则打架。
3. React Native 网络层（fetch/XHR）默认走系统信任链，无需额外改动；但需在 release 构建中**移除 `<certificates src="user"/>`**（防止用户自装根证书窃听）。

**桌面端**
1. Electron `fetch` / `imageUrl` 白名单协议升级（配合 2D #8 GPU worker SSRF 白名单）：`http(s)` 仅允许 loopback + 已配置 API base 主机。
2. 自签证书首次安装引导：**降级为文档**（D6）——桌面 webview 加载 `https://localhost` 时，自签证书已在系统信任链外，但 Electron 可通过 `app.on('certificate-error', ...)` 对 localhost 主动信任（一行代码），无需用户操作。

### 验收标准
- [ ] server 启动默认 HTTPS（无 env 也自生成自签）。
- [ ] loopback HTTP 仍可用（桌面单机零摩擦）。
- [ ] 远端 HTTP → 301 HTTPS；远端无明文 API 路径。
- [ ] mobile 抓包：非服务器域明文请求被系统拒（`CLEARTEXT communication ... not permitted`）。
- [ ] mobile 抓包：服务器域 HTTPS 请求成功（证书链通过）。
- [ ] token 在传输层加密（即 #1 流程在 HTTPS 下完整跑通）。
- [ ] 证书过期 ≤30 天时 server 启动 console.warn。
- [ ] 桌面 Electron `https://localhost` 无证书错误（程序内信任）。

### 风险
- **现有部署断裂**：D7 loopback 保留 HTTP；远端 mobile 升级期走 D8 soft + HTTPS。
- **自签证书 UX（远端浏览器）**：D6 显式排除此场景，文档化。
- **mobile 重复 network_security_config.xml**：任务里明确「两份同步修改或合并」。
- **release 构建 `<certificates src="user"/>` 泄漏**： Must 在 release manifest 移除（任务里写明）。
- **`@filmgallery/api-client` 默认 URL 是 `http://...`**（见 `mobile/App.js:140` 当前默认 `http://59.66.234.26:4000`）：mobile 升级时改默认 `https://`；配对码 UI 引导用户输入正确的 https URL。

---

## 阶段出口条件（进入 2C/2D 的参考门槛）
1. 远端写路由无有效 token 必拒（soft 模式关闭）。
2. server 默认 HTTPS；远端无明文 API 路径。
3. **#1 与 #7 同批次发布**（强互补，论证见工程二背景）——但**作为两个原子 PR 先后合入**（auth 先，HTTPS 紧随），便于 review 与单点回滚；release note 合并。
4. 测试 7 用例 + 工程二验收全绿。
5. `FOLLOWUPS.md` 中 #1、#7 标记 ✅。

> 注：2B 与 2C/2D 无强阻塞依赖；如资源允许，#2 Electron 升级（2D）可与 2B 并行启动，但须 #10 先行（已 ✅）。
