# FilmGallery 全栈代码审查报告

> 审查范围：前端 `client/`、后端 `server/`、移动端 `mobile/` + `watch-app/`、桌面壳 Electron/原生包/构建/Docker/测试
> 审查日期：2026-07-16
> 性质：基于证据的分层级静态审查，所有发现均附 `file:line` 引用

---

## 0. 执行摘要

FilmGallery 是一个「Vibe Coding」产物——功能覆盖广（胶片管理、FilmLab GPU 处理、地图、AI、多端），但在**工程质量护栏上几乎空白**：无认证、无测试、无 CI 质量门、大量死代码、依赖陈旧且有安全风险。整体可运行，但**安全 posture 极弱**，且多处**架构漂移/重复实现**使维护成本偏高。

### 严重程度分布（关键项）

| 等级 | 数量 | 代表性问题 |
|------|------|-----------|
| 🔴 Critical | 8 | 后端零认证、文件任意读写、Electron 已 EOL、移动端 release 用 debug 签名 |
| 🟠 High | ~20 | 像素级 JS 阻塞事件循环、CSP 被运行时移除、CI 不重编 native、共享包损坏 |
| 🟡 Medium | ~30 | 4.65MB 单包无代码分割、死代码泛滥、依赖陈旧、文档与实现漂移 |
| 🟢 Low | ~15 | 命名/风格、缺失 .nvmrc/engines 等 |

### 三件事如果只能做三件事
1. **给后端加认证 + 收紧 CORS + 修复路径穿越/任意文件读写**（一次安全 sprint）。
2. **升级 Electron（已 EOL）并接入自动更新**（消除已公开 Chromium 漏洞的唯一路径）。
3. **建立测试 + CI 质量门**（哪怕是冒烟级），并清理约 **5000+ 行死代码**。

---

## 1. 系统全景与架构

```
FilmGallery (monorepo，无统一工作区约束)
├── client/        React 18 + CRA/CRACO + Tailwind v4 + HeroUI  (前端，214 文件)
├── server/        Express 4 + sqlite3 + Sharp + LibRaw + OpenAI (后端，134 JS)
├── electron-main.js / electron-preload.js / electron-gpu/      (桌面壳)
├── packages/
│   ├── shared/                              (✅ 被使用)
│   ├── @filmgallery/libraw-native/          (原生 RAW 解码，N-API 8)
│   ├── @filmgallery/api-client/             (❌ 死代码，无人消费)
│   └── @filmgallery/types/                  (❌ 损坏，无源码，watch-app 引用即崩)
├── mobile/        RN (Bare/Prebuilt Expo) + JS（非 TS，与文档声称不符）  (98 文件)
├── watch-app/     RN for Wear OS（非文档声称的 Apple Watch/SwiftUI）
├── docker/        4 个 Dockerfile，质量参差
└── tests/ + tools/  仅覆盖 GLSL 着色器一致性
```

**核心架构问题**：缺乏真正的 monorepo 治理。`packages/` 下的共享包一半损坏/无人用，而 mobile/watch/client 各自重复实现了服务发现、坐标转换、API 封装——**单一真相源缺失**。

---

## 2. 安全审查（最高优先级，跨端汇总）

### 2.1 🔴 后端：零认证 + 全开放 CORS（Critical）
- 全代码库无任何 auth/session/token/jwt/passport/helmet/rate-limit 中间件（grep 0 命中）。
- `server.js:56-64`：`cors({ origin: true })` + 无条件下发 `Access-Control-Allow-Private-Network: true` + `app.options('*')` 短路预检——**任意网页均可驱动全部 API**，包括 `POST /api/shutdown`（`server.js:458-478`，可被远程关机）。
- 任何人可 `PUT /api/ai/config` 读写/替换 OpenAI Key，或 `POST /api/ai/models/configured`（`routes/ai-chat.js:459-490`）把模型指向攻击者 URL 窃取后续 prompt。

### 2.2 🔴 后端：任意文件读 / 任意文件写（Critical）
- `/api/import/preview`、`/api/import/execute`：`req.body.filePaths` 直接喂给 `fs.stat`/`fs.createReadStream`/`scanDirectory`，无根目录约束（`routes/import.js:42-58` → `services/import-service.js:324-351,496-521`）。**任意文件可被读取并拷入 uploads/**。
- `/api/batch-download`：`req.body.outputDir` 直接作为目标，`fs.mkdirSync(outputDir,{recursive:true})` + `fs.copyFileSync(...)`（`routes/batch-download.js:63-80` → `services/download-service.js:312-365`）。**任意路径可写**。
- 自定义静态中间件 `caseInsensitiveStatic`：`path.join(root, decodedPath)` 后 `res.sendFile(absolutePath)` 无根目录钳制（`server.js:83-136`）→ `..` 可逃逸 `uploads/`。

### 2.3 🔴 移动端：明文 HTTP + release 用 debug 签名（Critical）
- 三处强制开启明文流量：`mobile/app.json:24`、`mobile/app.json:44`、`mobile/plugins/withNetworkSecurityConfig.js:8`（`cleartextTrafficPermitted="true"` 对**所有**域名生效，而非仅服务器域）。照片/API/AI Key 全走 `http://`。
- `mobile/android/app/build.gradle:104-114`：release 构建复用 debug keystore，且明文提交密码（`storePassword 'android'`）。任何人可冒充签名更新。
- 无任何 token/登录/`Authorization`，敏感信息存 `AsyncStorage` 明文（`App.js:150`、`SettingsScreen.js:113`）；高德 Key 明文存 AsyncStorage（`SettingsScreen.js:128`）。

### 2.4 🟠 桌面壳：CSP 被运行时移除 + GPU 窗口过权（High）
- 主窗口 webPreferences 为现代安全默认（`nodeIntegration:false`、`contextIsolation:true`、`webSecurity:true`，`electron-main.js:444-449`）✅。
- 但 `electron-main.js:452-462` 主动删除响应中的 `Content-Security-Policy` 头。注释自承是「为了地图/globe/地理编码」——应改为**量身定制 CSP**（仅允许 `127.0.0.1:*`、配置的远端、特定 CDN），而非整体移除。
- GPU worker 窗口：`nodeIntegration:true, contextIsolation:false`（`electron-main.js:641-645`），且 `fetchBuffer` 会 GET 任意传入的 `payload.imageUrl`（`electron-main.js:671-716`）——潜在 SSRF/逃逸面。
- `setApiBase(url)`（`electron-preload.js:43` → `electron-main.js:999-1007`）仅校验非空字符串，无 URL 白名单——被攻破的渲染进程可把全部 API 流量（含上传）重定向到攻击者主机。

### 2.5 安全建议（一处不漏）
1. 引入认证层（本地首选用配对码/token + `helmet` + `express-rate-limit`，至少给 `shutdown`/AI/写操作加门）。
2. CORS 收紧为显式白名单，移除 `Access-Control-Allow-Private-Network`。
3. `/api/import`、`/api/batch-download` 全部接入 `routes/filesystem.js` 已有的 `isPathAllowed` 白名单；静态服务改用 `express.static`（已重复挂载）或在 `sendFile` 前做根目录校验。
4. 移动端生成正式 release keystore、密码移出版本库；`versionCode` 对齐（`app.json:23`=7 vs `build.gradle:95`=9）；明文流量改为「仅服务器域 `domain-config`」。
5. 桌面壳用真实 CSP 替代移除；GPU 窗口加 `contextIsolation:true`+preload，校验 `imageUrl` 主机；`setApiBase` 加白名单。

---

## 3. 前端审查（client/）

### 3.1 🟡 性能：4.65MB 单包，代码分割被写好却从未启用（Critical→性能）
- 产物仅 `main.388d5c04.js`（4,651,789 B）+ 367 B chunk。`src/utils/lazyRoutes.js`（197 行）已实现 `Lazy*` 路由包装 + `prefetchCommonRoutes()`，但**全仓库无人 import**；`App.js:6-20` 静态导入全部页面组件，导致 three.js/react-globe.gl/recharts/leaflet/framer-motion 全进首屏包。
- `craco.config.js:42-64` 关闭了 Terser 的 `collapse_vars`/`reduce_vars`/`concatenateModules`（绕 TDZ/minifier bug），进一步弱化摇树与体积优化。
- 虚拟化不完整：`PhotoGrid.jsx:28` 仅在 `photos>400` 时切 `react-window`；`VirtualPhotoGrid.jsx:30-39` 把 `Cell` 定义在渲染内（每次新建，抵消优化）。

### 3.2 🟠 数据层不一致 + jsonFetch 吞错（High）
- `api/core.js:113-118` 的 `jsonFetch` **不检查 `res.ok`**，非 2xx 被当数据返回；仅 `exportPositive`/`renderPositive`/`sendChatMessage` 自检 `res.ok`。调用方无法区分成功与服务器错误。
- TanStack Query 策略设计良好（`lib/queryClient.js:29-152` 的 STATIC/SEMI_STATIC/DYNAMIC/REALTIME 分级），但 `Settings.jsx`、`AISettings.jsx`、`ConflictBanner.jsx`、`Statistics.jsx:25-31` 仍手写 `useEffect+fetch`，绕过缓存/重试/超时。
- 全仓库 ~125 处内联 `fetch(...)` 绕过 `jsonFetch`。
- `buildUploadUrl`（`core.js:80-98`）启发式在 DB 字符串里搜 `"uploads"` 子串重建 URL，含 Windows 盘符 basename 回退——脆弱且是潜在路径穿越面。

### 3.3 🟠 大量死代码（High）
经 grep 验证零引用：
- `src/api-legacy.js`（**1749 行**）、`components/FilmInverter.jsx`（**1711 行**）、`components/FilmInventory.jsx`（361）、`utils/lazyRoutes.js`（197）、`components/common/VirtualPhotoGrid.jsx`（与 `components/VirtualPhotoGrid.jsx` 内容不同的重复件）。
- 仓库根 `old_FilmLibrary.jsx`（72KB）+ `old_FilmInventory.css`（12KB）——仅被 `FilmInventoryCard.jsx:4` 注释引用。

### 3.4 🟡 超大文件（>500 行，节选）
`FilmLab.jsx` **2666**、`ShotLogModal.jsx` **1667**、`styles.css` **1579**、`EquipmentEditModal.jsx` **1263**、`FilmLabControls.jsx` **1174**、`NewRollForm.jsx` **890**、`BatchRenderModal.jsx` **865**、`AISettings.jsx` **844**、`ComputeService.js` **803**……`FilmLab.jsx` 单文件 ~40 个 `useState`，强烈应拆 reducer 或复用已存在的 `FilmLab/hooks/useFilmLabState.js`。

### 3.5 🟡 依赖与工具链
- `react-scripts` 5.0.1（CRA）**已废弃**，靠 CRACO + `patches/react-dev-utils+12.0.1.patch`（修 `fs.F_OK`）苟活，且该 patch **未挂 `patch-package`**，静默漂移。
- `react-router-dom ^7.9.6` 却用 v6 的 `<Routes>/<Route>`，且 v7 需 Node≥20（仓库无 `engines` 约束）。
- 两套地图系统并存（leaflet + globe.gl）、两套懒加载库、`framer-motion` 在 Electron 中据注释被规避却仍依赖。
- 无任何前端测试、无测试运行器、无 lint 钩子。

### 3.6 ✅ 做得好的地方
- AI markdown 渲染安全：`MessageBubble.jsx:82-84` 用 `ReactMarkdown`+`remarkGfm`，无 `rehype-raw`，模型原始 HTML 被转义。
- `LazyImage.jsx` 渐进式加载（IntersectionObserver、blur-up、`decoding=async`、`memo`）质量高。
- `lib/dataPrefetch.js` 与 `FileAccessService` LRU 缓存设计良好。

---

## 4. 后端审查（server/）

### 4.1 🔴 路由 raw.js 完全损坏（High，运行即抛）
`routes/raw.js` 读取 `result.outputPath`/`result.metadata`/`result.processingInfo`、调用 `rawDecoder.decodePreview`/`cleanup`，但 `services/raw-decoder.js` 只返回裸 `Buffer`，根本无这些成员。每个 `/api/raw/*` 处理器都会在 `path.basename(result.outputPath)`（`routes/raw.js:134,178`，`outputPath` 为 `undefined`）处抛错。说明该路由从未被集成测试覆盖。

### 4.2 🟠 像素级 JS 阻塞事件循环（High）
`routes/photos.js:886-986` 的 `export-positive` 分配原始 buffer 并对每个像素手写 `for` 循环（8/16 位三分支），`both`/`tiff16` 还跑两遍——多兆像素图会阻塞唯一事件循环数秒，饿死所有其他请求；且 3× 图像大小常驻内存，无流式/背压。应下沉到 Sharp/LibRaw 或 worker thread。

### 4.3 🟠 错误处理：内部信息全量外泄（High）
100+ 处 `res.status(500).json({ error: err.message })`（遍布 `routes/*`）绕过集中式 `errorHandler`（`middleware/error-handler.js`），向客户端泄露堆栈信息、文件路径、SQL 错误。该 handler 仅在 `NODE_ENV!=='development'` 才脱敏（`:70-74`）。

### 4.4 🟡 数据库层
- 驱动：仅 `sqlite3` 5.1.7（异步/回调），**无** better-sqlite3，故无同步阻塞风险。✅
- 注入面：基本全参数化（`utils/db-helpers.js`/`prepared-statements.js` 用 `?` 绑定，AI 工具列名走硬编码白名单）——注入风险**低**。唯一动态标识符在 `ai-tools/photo-tools.js:164,169`（`orderCol` 从硬编码二选一，安全但脆弱）。
- **迁移被禁用**：`server.js:411-431` 注释掉全部迁移 runner，仅内联 `schemaSQL`（`server.js:223-397`）执行；schema 在 `db.js:143-216`、`utils/schema-migration.js:41-90` 重复定义第三/四遍。`schema-migration.js:25-30` 把错误当值 resolve（静默失败）。
- **无索引**：三处 schema 定义均无 `CREATE INDEX`；`photos` 查询 `routes/photos.js:130-177` join 7 表，`photos.roll_id`/`location_id`/`date_taken`/`photo_tags` 等无索引 → 全表扫描。
- 多步更新（photo+tag+gear，`routes/photos.js:448-490`）无事务 → 部分失败风险。
- `recomputeRollSequence`（`roll-service.js:32-63`）每次启动 + 每次增删改都对每个 roll 发一条 `UPDATE`，O(N) 写，应改窗口函数单条 UPDATE。

### 4.5 🟡 请求路径上的同步 I/O
`caseInsensitiveStatic` 每请求 `fs.existsSync/statSync/readdirSync`（`server.js:95-119`）；`routes/filesystem.js:184,190,214`、`routes/photos.js`（多处 `*Sync`）均有同步阻塞。

### 4.6 🟡 死代码 / 重复
- `services/raw-decoder-new.js`（471 行，零引用）、`services/ai-tools.js.bak`（提交进源码的备份）。
- `dbAll/dbRun/dbGet` 在 `import-service.js`/`download-service.js` 各重写一遍，未复用 `utils/db-helpers.js`。
- `body-parser` 与 Express 内置 `express.json()` 重复；`caseInsensitiveStatic` 与原生 `express.static` 双重挂载（`server.js:151-154`）。
- 7 个 `test-libraw-*.js`/`test-*.js` 是手动探测脚本，非测试，且引用了未在依赖中的 `libraw-wasm`。

### 4.7 🟡 依赖
- `multer 1.4.5-lts.2`：1.x 仅维护，有 CVE 历史，应升 2.x。
- `express ^4.18.2`：Express 4 已过维护期，应迁 5。
- `exiftool-vendored ^35` 需 Node≥20，但 Dockerfile 用 node:18——引擎错配。
- `lightdrift-libraw ^1.0.0-beta.1`：beta、低下载量、与自研 `libraw-native` 功能重复，倍增 CVE 面 + 迫使 Docker 装 libraw-dev。

---

## 5. 移动端审查（mobile/ + watch-app/）

### 5.1 关键纠正
- mobile 是 **纯 JS（非 TS）**，与项目头宣称的 TypeScript 不符；无 `tsconfig`。
- 工作流为 **Bare/Prebuilt Expo**（有真实 `android/`），非纯托管。
- `watch-app` 是 **RN for Wear OS**，非 README 宣称的「Apple Watch/SwiftUI WatchKit」。

### 5.2 🟠 死代码 ~1500+ 行（High）
- `services/locationService.js`（653）+ `locationService.v2.js`（486）均零引用，仅 `.native.js` 被用（1139 行死代码）。
- `hooks/useExposurePolling.js`(134)、`useExposureMonitorPolling.js`(77)、`useExposureMonitorSimple.js`(53)、`components/camera/useExposureCalculator.js`(79) 均零引用。
- `generate-shot-modal.js`（900 行，仓库根）是脚手架化石，模板串里含旧版 `ShotModeModal.js`。
- 6 个调试日志 md（`EMERGENCY-DIAGNOSIS-v2.md` 等）提交进 app 根。

### 5.3 🟠 mobile↔watch 大规模重复（High）
- `mobile/src/utils/portDiscovery.js`(452) ≅ `watch-app/src/utils/portDiscovery.ts`(461)，逐字移植。
- `coordTransform.js` 注释自承「从 packages/shared 复制」——三份 WGS84↔GCJ02。
- 反向地理编码（BigDataCloud）mobile/watch 各一份。
- **已有 `@filmgallery/api-client`（isomorphic，写得不错）却无人消费**；mobile 在 `src/api/*` 重新发明同样端点。应把发现/坐标/地理编码/API 端点提升到 `packages/shared` 与 `@filmgallery/api-client`，两端共用。

### 5.4 🟠 网络层：全局 axios 被运行时改写 + 每错弹窗（High）
- `setupAxios.js:15,19` 改写 `axios.defaults.baseURL` 并 `interceptors.response.handlers=[]` 重置；`src/api/*` 依赖此隐式全局，而多个 screen 又绕过它直接 `axios.get(\`${baseUrl}/...\`)`（`HomeScreen.js:53`、`MapScreen.js:72`、`RollDetailScreen.js:31`、`PhotoViewScreen.js:37`）——两套调用约定并存。
- `setupAxios.js:76-79`：**每次请求失败都 `Alert.alert`**，断网即弹窗风暴，无去抖/无错误边界/无全局 toast。
- 完全无离线行为（无队列、无本地缓存、无乐观 UI）。

### 5.5 🟡 性能
- `MapScreen.js:205-261`：**O(n²) 聚类**在 `useMemo([photos, mapRegion?.latitudeDelta])`，每次平移触发全配对距离循环，跑在 JS 线程。
- `ExposureMonitor.js:30-85,391-396`：手写 base64 EXIF 解析，整张 JPEG 解码进 `Uint8Array` 逐字节走（~500ms 周期）——应改原生 EXIF reader。
- `useCachedImage.js:4` 的 `loadedCache = new Set()` 永不清理 → 无界内存增长。
- FlatList 无 `getItemLayout`/`maxToRenderPerBatch`/`windowSize`；`renderItem` 每渲染新建（`HomeScreen.js:94`），吃掉 `memo` 收益。

### 5.6 🟡 未使用依赖（增 APK 体积/构建时间）
- NativeWind + Tailwind 全套配置却**零 `className=` 使用**（死重）。
- `react-native-maps` + `react-native-map-clustering`（地图其实是 WebView/Leaflet）、`react-native-vector-icons`、`react-native-worklets`（仅 `-core` 被用）均未被 import 却仍链原生代码。
- `patches/react-native-zeroconf+0.9.0.patch` **损坏**（伪 git blob 哈希 `1234567..abcdefg`，上下文不匹配），patch-package 静默失败 → mDNS 原生模块以未修补的旧 gradle 配置构建。

### 5.7 🟡 版本错配
- mobile RN 0.81.5 vs watch RN 0.83.1；mobile React 19.1.0 vs watch 19.2.0；`@react-navigation` mobile 6.x vs watch 7.x。
- `mobile/package.json:13-15` 的 `eas:*`/`build:*` 脚本用 `spawn('cmd',['/c',...])`——**仅 Windows 可用**，Linux/mac 无法运行。
- `versionCode`：`app.json:23`=7 vs `build.gradle:95`=9，EAS 与本地构建会分叉。

### 5.8 watch-app
- 单个快照测试 `__tests__/App.test.tsx`，TS 项目却无 `ts-jest`/babel-preset 串接，大概率编译失败。
- 依赖 `@filmgallery/types`（`watch-app/src/types/index.ts:17`），但该包**只有 package.json 无源码** → 构建即崩。

---

## 6. 桌面壳 / 原生包 / 构建 / Docker（跨切面）

### 6.1 🔴 Electron 26.6.10 已 EOL（Critical）
发布于 2023-08，EOL 约 2024-04，**无安全回溯**。`package.json:34`。且**无自动更新**（无 `electron-updater`/`autoUpdater`/`publish`）——已安装用户无法收到安全修复。

### 6.2 🟠 缺单实例锁 + 嵌入式 server 崩溃不重启（High）
- 全文件无 `app.requestSingleInstanceLock()`：二次启动会再起一个嵌入式 server 抢端口 4000（`electron-main.js:110-113`）。
- server 子进程 `exit` 处理器（`electron-main.js:225-229`）仅置空 + log，**不重启**——会话中途崩溃则 UI 失活，只能托盘「重启后端」（`:382`）。
- server 健康检查失败时仍加载 UI（`electron-main.js:603-605`），无用户可见错误。

### 6.3 🟠 CI 桌面构建漏重编 native（High）
`.github/workflows/build-desktop.yml:102-111` 的 full 作业跑 `npm run build` + `electron-builder` 但**从不调用 `rebuild:electron`**，配合 `npmRebuild:false`（`package.json:54`）→ Win/Mac full 产物里的 native 模块是 Node ABI 而非 Electron ABI，打包后 `sharp`/`sqlite3`/libraw 加载即抛。仅 `build-linux.yml:44` 做了重编。**CI 不跑 `npm test`。**

### 6.4 🟠 @filmgallery/types 损坏 + api-client 死代码（High/Medium）
- `packages/@filmgallery/types/` 仅有 `package.json`，`main` 指 `dist/index.js` 不存在，watch-app 引用即崩。
- `packages/@filmgallery/api-client/` 写得不错（isomorphic），但**全仓库零消费**——死代码。

### 6.5 🟡 libraw-native 预构建策略失效（High）
- README 宣称「Prebuilt Binaries / Cross-platform」，但无 `prebuilds/` 目录；提交的二进制在 `bin/linux-x64-116/`、`bin/win32-x64-116/`，**不在 node-gyp-build 解析路径上**（它只看 `prebuilds/` 和 `build/Release/`）。实际所有平台都从源码编译 ~80 个 LibRaw C++ 文件——预构建形同虚设。
- `install` 脚本 `node-gyp-build || echo '...'` 静默吞构建失败，延迟到运行时才报错。

### 6.6 🟡 Docker（4 个 Dockerfile 质量参差）
- `docker/Dockerfile`：多阶段、node:20、建非 root 用户、HEALTHCHECK ✅——最佳。
- `docker/Dockerfile_cn`：node:**18**、**不装 libraw-dev** → lightdrift-libraw 加载失败，且 builder 阶段不重编 native → RAW 支持损坏。
- `server/Dockerfile`：node:18、`npm install --production --force`（废弃组合）、不装 libraw-dev、**以 root 运行**（无 `USER`）。
- `dist_v9/.../server/Dockerfile`：旧构建产物里的陈旧副本，应排除。

### 6.7 🟡 文档与实现严重漂移
| 文档声称 | 现实 |
|---|---|
| 「仅 Windows + Android」`README.md:7` | 实际产出 deb/AppImage/dmg，CI 在 Linux/Mac 矩阵构建 |
| `npm run build:electron` `README.md:118` | **无此脚本**（实际是 `build`/`dist`/`pack`/`rebuild:electron`） |
| `electron-builder.json5` `README.md:213` | **文件不存在**（配置内联在 package.json + client-only.json） |
| watch-app「Apple Watch/SwiftUI」`README.md:140,186` | 实为 RN for Wear OS |
| libraw-native「Prebuilt/Cross-platform」 | 预构建不在加载路径，全平台需源码编译 |
| `docs/DOCKER-BUILD-GUIDE.md` 链 `docs/QUICKSTART.md` | 不存在（DEPLOYMENT 仅在 docker/） |

### 6.8 🟡 根 package.json 占位元数据
`author:"Your Name"`、`appId:"com.yourorg.filmgallery"` 随 v3.0.0 一起发布（`package.json:7,40`）。

### 6.9 ✅ 做得好的地方
- 主窗口安全默认；`ELECTRON_RUN_AS_NODE:1` 启动嵌入式 server（`electron-main.js:170-202`）巧妙规避 native ABI 不匹配。
- 动态端口握手（`SERVER_PORT:NNNN` stdout 标记，`:190-235`）消除「端口占用」类痛点。
- 详尽日志到 `userData/electron-main.log` + `server-out/err.log`（`:81-89,166-168`）。
- 优雅关停（SIGINT/SIGTERM → 关 HTTP → finalize prepared statements → WAL checkpoint → 关 DB，10s 强制退出，`server.js:565-635`）。

---

## 7. 跨端共性主题

### 7.1 测试近乎为零（全端 High）
- 前端：0 测试、0 运行器。
- 后端：0 自动化测试；`test-*.js` 是手动探测脚本。
- 移动：0 测试；watch 仅 1 个大概率编译失败的快照。
- 根 `tests/`：仅覆盖 GLSL/着色器一致性（5 个文件）。
- **CI 不跑任何测试**；`build`/`dist` 不依赖 `test`。
- 风险最高的代码（多进程编排、原生绑定、像素管线、路径白名单）覆盖最低。`routes/raw.js` 的契约断裂、`import-service.js` 的存储路径分叉（`uploads/roll_${id}` vs 他处 `uploads/rolls/${id}`）本会被一个集成测试抓住。

### 7.2 死代码泛滥（跨端 ~5000+ 行）
前端 `api-legacy.js`+`FilmInverter.jsx`≈3460 行、后端 `raw-decoder-new.js`+`.bak`、移动端 locationService×2+exposure hooks+`generate-shot-modal.js`≈1900 行、根 `old_*`≈84KB。

### 7.3 单一真相源缺失
- 服务发现、坐标转换、反向地理编码、API 端点封装在 client/mobile/watch 三处各自实现。
- schema 在后端定义 3 遍。
- 共享包一半损坏一半无人用。

### 7.4 依赖与引擎治理缺失
- 全仓库无 `.nvmrc`、无 `engines`（仅 libraw-native 有过时的 `node>=16`）；CI 用 Node 20，Docker 在 18/20 间分裂，本地无信号。
- Electron 已 EOL、multer/express 过期、React Router v7 降级用、CRA 已废弃。

---

## 8. 改造路线图（分阶段，按优先级）

### Phase 0 — 安全加固（1–2 周，Critical/High）
1. 后端引入认证（配对码/token）+ `helmet` + `express-rate-limit`；CORS 改白名单，移除 Private-Network 头；给 `shutdown`/AI/写操作加门。
2. `/api/import`、`/api/batch-download` 接入 `isPathAllowed`；静态服务换 `express.static` 或加根校验。
3. 所有错误经 `next(err)` 汇入 `errorHandler`，停止外泄 `err.message`。
4. 移动端生成正式 release keystore、移密码出库、`versionCode` 对齐、明文流量改 `domain-config`。
5. 桌面壳用真实 CSP 替代移除；GPU 窗口加 `contextIsolation`+preload + `imageUrl` 白名单；`setApiBase` 加白名单。

### Phase 1 — 止血与卫生（1 周）
6. 清理死代码（前端 ~3460 行、后端 raw-decoder-new/`.bak`、移动 ~1900 行、根 `old_*`）。
7. 删除/修复损坏的 `react-native-zeroconf` patch；删未用原生依赖（maps/vector-icons/一个 worklets/NativeWind 栈）。
8. 删除 `server/package.json:47-72` 的重复 build 块、`dist_v9` 内陈旧 Dockerfile。
9. 修 `@filmgallery/types`（补源码或从 watch-app 移除依赖）。

### Phase 2 — 平台升级（2–3 周）
10. **升级 Electron** 到当前稳定线 + 接 `electron-updater`/`publish`；同步重编 native。
11. 前端迁移 CRA→Vite（保留 Tailwind v4/HeroUI，启用真代码分割，移除 CRACO/Terser workaround）；启用 `lazyRoutes` 路由分割。
12. multer→2.x、express→5、对齐 Docker node 版本（统一 20/22）。
13. 全仓库加 `.nvmrc`(Node 20) + `engines`；README 补 native 构建前置依赖。

### Phase 3 — 架构收敛（2–4 周）
14. 把服务发现/坐标转换/反向地理编码/API 端点统一到 `packages/shared` + `@filmgallery/api-client`，client/mobile/watch 共用；mobile 改用 `@filmgallery/types`。
15. mobile 用类型化 `ApiService` 单例（仿 watch-app）替换全局 axios 改写；去掉每错弹窗。
16. 后端 schema 收敛到单一迁移 runner（重新启用并取消静默 `schema-migration.js`），补 `CREATE INDEX`；多步写操作包事务；`recomputeRollSequence` 改窗口函数。
17. 像素管线（`photos.js:886-986`）下沉 worker thread 或全交 Sharp/LibRaw；请求路径去 `fs.*Sync`。

### Phase 4 — 质量护栏（持续）
18. 前端 Vitest + Testing Library（路由/api 层冒烟 + `jsonFetch`/`buildUploadUrl`）。
19. 后端 jest/vitest：SQL 构建器参数化、文件系统白名单、原子 roll 创建/回滚、raw-decoder 契约。
20. 移动 RNTL 种子测试（portDiscovery/ExposureCalculations/coordTransform/api 模块）。
21. CI 跑 `npm test` + lint/typecheck；`pack`/`dist` 依赖 `test`；full 构建作业接入 `rebuild:electron`。
22. 加 `.editorconfig`/`.eslintrc`/`.prettierrc`/husky+lint-staged。

### Phase 5 — 文档对齐（低成本，随时）
23. 修正 README 漂移（`build:electron`、`electron-builder.json5`、「Windows+Android only」、watch-app 平台）。
24. 占位元数据改真实 author/appId；补 `CONTRIBUTING.md`/`CHANGELOG.md`。

---

## 9. 关键发现速查表

| # | 严重 | 位置 | 问题 |
|---|------|------|------|
| S1 | 🔴 | `server.js:56-64,458` | 零认证 + 全开放 CORS + 可远程关机 |
| S2 | 🔴 | `routes/import.js:42-58`, `batch-download.js:63-80` | 任意文件读/写 |
| S3 | 🔴 | `server.js:83-136` | 静态中间件路径穿越 |
| S4 | 🔴 | `mobile/.../build.gradle:104-114`, `app.json:24,44` | release debug 签名 + 全局明文流量 |
| S5 | 🔴 | `package.json:34` | Electron 26 已 EOL + 无自动更新 |
| S6 | 🟠 | `electron-main.js:452-462,641-645` | CSP 被移除 + GPU 窗口过权 |
| S7 | 🟠 | `routes/raw.js:134,178` | raw 路由契约断裂，运行即抛 |
| S8 | 🟠 | `routes/photos.js:886-986` | 像素级 JS 阻塞事件循环 |
| S9 | 🟠 | `.github/workflows/build-desktop.yml:102-111` | full 构建漏 `rebuild:electron` |
| S10 | 🟠 | `packages/@filmgallery/types/` | 包损坏，watch-app 引用即崩 |
| S11 | 🟠 | client 全端 | 0 测试 + CI 不跑测试 |
| S12 | 🟡 | `client/build/static/js/main.*.js` | 4.65MB 单包，代码分割未启用 |
| S13 | 🟡 | `api/core.js:113-118` | jsonFetch 不检查 res.ok |
| S14 | 🟡 | mobile/watch | ~1500+ 行死代码 + 大规模重复实现 |
| S15 | 🟡 | `packages/@filmgallery/libraw-native` | 预构建不在加载路径，全平台源码编译 |

---

*本报告由对 `client/`、`server/`、`mobile/`、`watch-app/`、Electron 壳与构建系统的系统性静态审查产出。建议按 Phase 0→5 推进；每阶段可独立交付价值。*
