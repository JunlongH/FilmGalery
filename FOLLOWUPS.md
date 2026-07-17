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
2. **Electron 大版本升级**（26→当前稳定，已 EOL）+ `electron-updater`/`publish`。需重编全部 native（libraw-native/sharp/sqlite3）并全量回归 FilmLab/GPU 管线。
3. **CRA→Vite 迁移**：启用真·路由级代码分割（`lazyRoutes.js` 已就绪，迁移后挂载），移除 CRACO/Terser workaround，首屏包预计大幅下降。
4. **错误处理统一**：把 `routes/*` 中 100+ 处 `res.status(500).json({error: err.message})` 机械替换为 `next(err)`，汇入集中 `errorHandler`。（本次仅处理安全敏感路由；全量替换建议在有测试后做。）
5. **像素管线下沉**：`routes/photos.js:886-986` 的 per-pixel JS 循环移入 worker thread 或全交 Sharp/LibRaw；请求路径去 `fs.*Sync`。
6. **DB schema 收敛**：启用单一迁移 runner，补 `CREATE INDEX`（photos.roll_id/location_id/date_taken/photo_tags 等），多步写操作包事务，`recomputeRollSequence` 改窗口函数。
7. **移动端明文流量**：根因是服务端无 TLS。需 server 加 HTTPS（混合模式必需），随后将 `usesCleartextTraffic`/`network_security_config` 收窄为服务器域 `domain-config`。
8. **GPU worker `contextIsolation` 重构**：需重写 `electron-gpu/gpu-renderer.js`（当前页面内 `require('electron')`），改 preload 暴露，本次仅以 imageUrl 白名单堵 SSRF。
9. **monorepo 收敛**：服务发现/坐标转换/反向地理编码/API 端点统一到 `packages/shared` + `@filmgallery/api-client`，三端共用；mobile 迁 TS 并消费 `@filmgallery/types`。
   - **进度（Phase 2A）**：shared/api-client 已存在（非新建）。`coordTransform`（ESM→CJS 归一）+ `portDiscovery`/`serverCapabilities` 已接入 barrel 与 subpath 导出；client/server/mobile/watch 声明 `file:` 依赖，消除偶然 hoisting。`coordTransform` 三端去重完成；`portDiscovery` 常量源统一到 server+mobile。api-client 硬化（非 2xx 抛错 + 修 `onError` 失效 bug）。详见 `docs/phase2-roadmap/phase-2a-foundation.md`。
   - **待办**：watch portDiscovery（需 shared 类型声明）；api-client 消费端迁移（client/mobile，需构建环境）；reverse-geocode 接口（选项 A）；mobile 迁 TS（暂停点）。
10. **测试 + lint/typecheck 护栏**：前端 Vitest、后端 jest、移动 RNTL 种子测试；CI 跑 `npm test` + lint。
   - **进度（Phase 2A）**：✅ 测试护栏与 CI 门禁已落地——`build-desktop.yml` 删除 `continue-on-error`（真问题），新增 PR/push 触发的 `ci.yml`（test+lint 硬门禁）；root jest 收集 shared+server+packages，固化 Phase 0–1 安全复现用例（path-security / shutdown 注册顺序 / ensureStartDateColumn 幂等）；ESLint flat config（0 error）。**241 tests / 10 suites green**。
   - **修正原假设**：原描述「前端 Vitest」错配（client 是 CRA 纯 JS，Vitest 属 2D #3 Vite 迁移）；client/mobile/watch 的专用测试器因各自构建/依赖树未就绪而暂缓，不阻塞 2B。
