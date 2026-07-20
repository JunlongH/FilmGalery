# FilmGallery 修复后续与决策记录

本文件记录第一轮安全/卫生修复（Phase 0–1）所做的决策，以及需独立推进的大工程（Phase 2+）。

## 第一轮已完成（已验证）
见 `CODE_REVIEW_REPORT.md` 与本次 git diff。要点：

### 后端安全
- 新增 `server/utils/path-security.js` 作为路径访问控制单一真相源（`isPathAllowed`/`isPathBlocked`/`isPathConfined`）。
- `/api/import/preview`、`/api/import/execute`、`/api/batch-download` 全部接入白名单校验（验证：`/etc/passwd`→403、`outputDir=/etc`→403）。
- `caseInsensitiveStatic` 加根目录钳制（验证：`/uploads/../../etc/passwd`→404，不再穿越）。
- `/api/shutdown` 改为本机回环校验，并修复其被 `/api/*` 404 兜底**拦截**的既有 bug（注册顺序移到 `mountRoutes()` 之前）。
- 引入 `helmet`（关闭 CSP 与 CORP 以兼容图片跨域加载）+ 全局 `express-rate-limit`（2000/15min）+ AI 专项限流（30/min）。
- 修复**首次安装即崩溃**：`recomputeRollSequence` 依赖的 `start_date` 列在迁移被禁用时不存在 → 新增幂等 `ensureStartDateColumn`（从 `date_loaded` 回填）。

### CORS 决策（保留，非收紧）
保留 `cors({origin:true})` 与 `Access-Control-Allow-Private-Network: true`，理由：
- 应用存在多 origin 场景：Electron `file://`（origin=null）、dev `localhost:3000`、移动端、混合模式远端浏览器。
- 非凭据请求下 CORS 并非真正安全边界；任意网站仍可发起 CSRF。**真正的防护是认证**（见 Phase 2+）。
- 删除 Private-Network 头会破坏混合模式（web→localhost 访问）。

### 桌面壳
- CSP 从「运行时删除」改为「设置存在且带关键限制的策略」：保留应用所需（内联脚本/样式、任意 img/connect 以支持地图瓦片与地理编码），新增 `object-src 'none'`、`base-uri 'self'`、`frame-ancestors 'none'`。
- `setApiBase` 校验必须为合法 `http(s)` URL（阻断 `javascript:`/`data:`/`file:` 协议注入）。
- GPU worker 的 `fetchBuffer` 加 `imageUrl` 主机白名单（loopback + 配置的 API base 主机），堵 SSRF。

### 卫生
- 删除前端死代码 ~3460 行（`api-legacy.js`、`FilmInverter.jsx`、`FilmInventory.jsx`、`utils/lazyRoutes.js`、`common/VirtualPhotoGrid.jsx`、根 `old_*`）。
- 删除后端死代码（`raw-decoder-new.js`、`ai-tools.js.bak`）。
- 删除移动端死代码 ~1500 行（`locationService.js`/`.v2.js`、4 个 exposure hooks、`generate-shot-modal.js`、7 个调试 md）。
- `jsonFetch` 改为非 2xx 抛错（携带服务端 error）。
- 修复 `@filmgallery/types`（补 `index.d.ts` + 桩 `index.js`）。
- 删除 `server/package.json` 重复 build 块与失效脚本；dist_v9 陈旧 Dockerfile。
- 修复损坏的 `react-native-zeroconf` patch（移除伪 blob 哈希）。
- `@filmgallery/libraw-native` loader 加 `bin/` 预构建回退。
- `.nvmrc`(20) + `engines`（根/client/server）；修正 README 漂移；占位 author→`FilmGallery`。
- CI `build-desktop.yml` full 作业补 `rebuild:electron` + `npm test` + Linux libraw-dev。
- 移动端 release 签名改为标准 `keystore.properties`（gitignored）+ 生成脚本；`versionCode` 对齐为 9。

## 需独立推进的大工程（Phase 2+）

> 这些是跨数周、需架构决策、且当前**无测试护栏**的工程，不宜盲改。建议在补齐测试后逐项推进。

1. **完整认证体系**：配对码/token + session。需联动 client/mobile/watch 三端，是混合模式安全的真正解。设计后先在 server 加 `auth` 中间件（默认放行 localhost，对远端强制 token）。
   - **进度（Phase 2B）**：🟨 server + `@filmgallery/api-client` 已落地（loopback 放行 + Bearer 强制 + LRU 缓存 + soft 升级模式；pairing/sessions 路由 + 限流 + 3 失败锁定；revoke 级联；sessions 表合一 D1；7 验收用例固化）。**330 tests / 19 suites green，eslint 0 error，真实 server boot smoke 通过**。详见 `docs/phase2-roadmap/phase-2b-security.md`。
   - **待办**：mobile 配对 UI + secure-store 接线（需 metro）；client（Electron）配对码面板 + 设备管理（需 CRA）；watch 派生 token 接收（需 RN 环境）。
2. **Electron 大版本升级**（26→当前稳定，已 EOL）+ `electron-updater`/`publish`。需重编全部 native（libraw-native/sharp/sqlite3）并全量回归 FilmLab/GPU 管线。
3. **CRA→Vite 迁移**：启用真·路由级代码分割（`lazyRoutes.js` 已就绪，迁移后挂载），移除 CRACO/Terser workaround，首屏包预计大幅下降。
4. **错误处理统一**：把 `routes/*` 中 100+ 处 `res.status(500).json({error: err.message})` 机械替换为 `next(err)`，汇入集中 `errorHandler`。（本次仅处理安全敏感路由；全量替换建议在有测试后做。）
   - **进度（Phase 2C）**：✅ 完成。详见 `docs/phase2-roadmap/phase-2c-refactor.md`。
   - **关键产出**：`server/middleware/error-handler.js` 重写围绕 `expose` 属性（OperationalError/ProgrammerError 基类 + ValidationError/NotFoundError 继承），`errorId` 改 `crypto.randomUUID()`，响应体规范 `{ok,error,code?,details?,errorId}`；`server/utils/auth.js:119` inline `res.status` 删除改为 `next(err)`；`server/utils/async-handler.js` 共享包装器（equipment.js 本地副本收编）；**13 路由文件 + 5 补漏 = ~157 处 `res.status(500).json(...)` → `next(catchVar)`**；handler 签名统一加 `next`；photos.js:128 latent bug 修复（首个 await 移入 try）；新增 `error-handler.test.js`（16 用例）+ `mount-order.test.js`（3 用例）。
5. **像素管线下沉**：`routes/photos.js:886-986` 的 per-pixel JS 循环移入 worker thread 或全交 Sharp/LibRaw；请求路径去 `fs.*Sync`。
   - **进度（Phase 2C）**：✅ 完成。详见 `docs/phase2-roadmap/phase-2c-refactor.md`。
   - **关键产出**：抽共享 `packages/shared/render/render-buffer.js`（消除 photos.js 10 处重复 for-loop）；`server/services/render-worker.js`（worker_thread 入口，零数学重复）+ `render-worker-pool.js`（lazy 池，threshold 2MP，崩溃自动重启）；photos.js export-positive 6 循环 + render-positive 4 循环全部下沉到 pool；photos.js 请求路径 20+ 处 `fs.*Sync` → `fsPromises`；性能基线归档 `docs/phase2-roadmap/2c-perf-baseline.md`（24MP 渲染期间 `GET /api/health` p99 < 50ms）；`packages/shared` 仍无 `worker_threads` 引用（浏览器 bundle 不污染）。
6. **DB schema 收敛**：启用单一迁移 runner，补 `CREATE INDEX`（photos.roll_id/location_id/date_taken/photo_tags 等），多步写操作包事务，`recomputeRollSequence` 改窗口函数。
   - **进度（Phase 2C）**：✅ 完成。详见 `docs/phase2-roadmap/phase-2c-refactor.md`。
   - **关键产出**：激活 `runAllMigrations`（删 `MIGRATIONS DISABLED` 注释块）；**删 10 个 orphan + 3 个 wrapper script + `utils/migration.js`**（schema-migration.js 完整覆盖，2 个特殊 orphan 收编：`positive_source` 列入清单 + `original_rel_path` backfill 函数化）；备份策略 `backupDatabaseIfNeeded()`（仅 pending 时备份，轮换 3 份）；`roll-service.js` 删 `ensureDisplaySeqColumn`/`ensureStartDateColumn` 运行时兜底（schema-migration 已覆盖）；`recomputeRollSequence` 简化为单条 `ROW_NUMBER() OVER(...)` 窗口函数（事务内）；`schema-migration.js` 加 `idx_photos_location` 索引；顺手修 `db.js:258` WAL 定时器未 `.unref()`；roll-service.test.js 重写（4 用例锁定新契约）。
   - **测试期发现的真实 bug（已修）**：(a) `schema-migration.js` 把 indexes 放在 ALTER ADD COLUMN 之前 → `idx_photos_date_taken`/`idx_photos_location` 等引用后加列的索引**静默失败**（`run` helper 吞错），重排为 tables → columns → indexes；(b) `backupDatabaseIfNeeded` 硬编码 `film.db.backup-${stamp}` → 自定义 `DB_PATH` 下备份文件名错误，改用 `path.basename(getDbPath())`。
7. **移动端明文流量**：根因是服务端无 TLS。需 server 加 HTTPS（混合模式必需），随后将 `usesCleartextTraffic`/`network_security_config` 收窄为服务器域 `domain-config`。
   - **进度（Phase 2B）**：🟨 server HTTPS 已落地（`utils/tls.js` 加载 `FG_TLS_CERT/KEY` 或自签生成 + loopback HTTP 兼容桌面单机；启动时双协议）。mobile Android 配置已收窄（删 `usesCleartextTraffic`；`network_security_config` base=false + 仅 localhost/10.0.2.2 放行；debug/debugOptimized manifest 清理 `tools:replace`）。boot smoke 通过。
   - **待办**：mobile RN 端 `baseUrl` 默认改 `https://`（需 metro）；Electron `certificate-error` 处理（需 Electron runtime）；release 构建移除 `<certificates src="user"/>`（已在 main 配置完成，无 debug override 需求）。
8. **GPU worker `contextIsolation` 重构**：需重写 `electron-gpu/gpu-renderer.js`（当前页面内 `require('electron')`），改 preload 暴露，本次仅以 imageUrl 白名单堵 SSRF。
9. **monorepo 收敛**：服务发现/坐标转换/反向地理编码/API 端点统一到 `packages/shared` + `@filmgallery/api-client`，三端共用；mobile 迁 TS 并消费 `@filmgallery/types`。
   - **进度（Phase 2A）**：✅ 完成。`coordTransform`/`portDiscovery`/`serverCapabilities` 三端去重完成（常量源下沉 `@filmgallery/shared`）。api-client 硬化（retry + failover + timeout + setBaseUrl）+ mobile/watch 双端消费 + 6 个测试。reverse-geocode 超出选项 A（BigDataCloud 逻辑抽成 `packages/shared/geocode.js`），三端 `GeocodeResult` 对齐。**mobile 全量 TS 迁移完成**：67/67 文件 .ts/.tsx，`strict: true` 全开，0 类型错误，0 `@ts-nocheck`，33 个 jest 测试，metro bundle 7.8M green。RootStackParamList 全局声明 + NativeStackScreenProps 类型化。configureApi 时序竞争修复。Layer D emulator 运行时验证通过（app 连通测试 server 渲染真实数据）。详见 `docs/phase2-roadmap/phase-2a-mobile-ts-migration.md`。
   - **剩余非阻塞项**：endpoint 常量去重（2A.3.4，设计决策 DEFERRED）；`any` → 正式 interface 的渐进收紧（~30 处，可在后续改动中 just-in-time 替换）。
10. **测试 + lint/typecheck 护栏**：前端 Vitest、后端 jest、移动 RNTL 种子测试；CI 跑 `npm test` + lint。
   - **进度（Phase 2A）**：✅ 完成。`build-desktop.yml` 删除 `continue-on-error`（真问题），新增 PR/push 触发的 `ci.yml`（test+lint 硬门禁 + mobile typecheck/jest/metro-bundle 三步）；root jest 收集 shared+server+packages，固化 Phase 0–1 安全复现用例；ESLint flat config（0 error）。**332 tests / 13 suites green**（root）+ **33 tests / 4 suites green**（mobile jest-expo）。
   - **修正原假设**：原描述「前端 Vitest」错配（client 是 CRA 纯 JS，Vitest 属 2D #3 Vite 迁移）；watch-app typecheck 因 `react-native-zeroconf` 缺 @types + `@filmgallery/types` 严格性 2 个预先存在错误暂缓（属 2C 范畴，不阻塞 2B）。
