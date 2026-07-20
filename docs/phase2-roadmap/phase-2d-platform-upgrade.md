# Phase 2D · 平台升级层

> **范围**: #2 Electron 大版本升级 · #3 CRA→Vite 迁移 · #8 GPU worker contextIsolation 重构
> **定位**: 高风险平台升级。每项独立分支、独立验收、失败可即时回退（不引入 env 全局开关——分支即 feature flag）。
> **前置**: 2A #10（测试护栏）✅；2C #4/#5/#6 ✅（**383 tests / 35 suites 是 #2/#8 native 重编的回归基线**）；2B #7 HTTPS（macOS 签名要求前置）🟨。
> **状态**: ⬜ 未开始
> **本文件在 2D 开工前对照真实仓库重写**；原版（见 git 历史）约 50% 任务基于错位诊断（详见 §0）。重写依据：对 electron-main.js / electron-preload.js / electron-gpu/* / client/src/App.js / client/build/ 的实地勘探。
> **执行原则（贯穿全程）**：从本质出发，不做过多的兜底。分支即回退通道，env flag 仅留给"阈值调节"（如 worker pool），不做"启用/禁用某工程"的全局开关。env 一旦引入必须有量化阈值与文档。

---

## 0. 设计验证（原版为何不本质）

原版 2D 与原版 2C 同病：**事实底座停留在 FOLLOWUPS 原始记忆**，未对照真实仓库。逐条核对后，三项工程均有错位。

### 0.1 #2 Electron 升级

| # | 原版主张 | 真实现状（证据） | 判定 |
|---|---|---|---|
| 1 | 「26 已 EOL，升级到当前 stable」 | 当前 stable = **43.1.1**（17 个大版本跨度）；Node 内嵌 22.x 与 `.nvmrc`(20)/`engines.node>=20` 兼容 | ⚠️ 跨度被低估（17 major） |
| 2 | 「native 重编三个模块」 | `@filmgallery/libraw-native`（N-API v8，已有 `prebuildify` + `bin/` 兜底）、`sharp@0.34.5`（prebuilt 二进制）、`sqlite3@5.1.7`（prebuilt）；**仅 libraw 需自维护矩阵**，sharp/sqlite3 跟官方 | ⚠️ 范围笼统 |
| 3 | 「`electron-updater` + publish + 签名」一句话 | macOS notarization 自 Electron 35+ 强制；Windows code signing 需证书；自建源 `publish` 是独立运维产物——**这是三项独立子工程，不是一行** | ❌ 严重低估 |
| 4 | 「每 major changelog 审查」 | 真正的破坏点：28+ sandbox 默认 true；`webContents.on('crashed')` 在 22+ deprecated（main.js:524 已用 render-process-gone 双保险）；`nativeImage.createFromData` 签名变化；`BrowserWindow` `enableLargerThanScreen`/`backgroundThrottling` 语义微调 | ⚠️ 风险点未列 |
| 5 | 「保留旧 Electron 构建通道」 | `electron-builder` 配置已无 fallback 路径；分支即回退（不引入双 build matrix） | ⚠️ 表述含糊 |

### 0.2 #3 CRA→Vite 迁移

| # | 原版主张 | 真实现状（证据） | 判定 |
|---|---|---|---|
| 1 | **「`lazyRoutes.js` 被删，迁移后即可启用，首屏包大幅下降」** | `client/src/App.js:23-36` 已直接 `React.lazy + Suspense` 14 个页面；`client/build/static/js/` 实测 ~60 个路由 chunk（如 `245.61a09fe7.chunk.js` = 390KB 是 three.js+globe，独立加载）；main = 693KB。**代码分割早已生效，`lazyRoutes.js` 是被清理的重复造物，不是"待挂载"** | ❌ **核心主张错位** |
| 2 | 「移除 CRACO/Terser workaround」 | `client/craco.config.js` 实际只剩 ① alias `@filmgallery/shared`/`@ui`/`@providers` ② 删 ModuleScopePlugin ③ PostCSS mode=file；**Terser workaround 已注释为"代码库经静态分析无循环依赖，已恢复默认优化"**——无实际 workaround 待移除 | ❌ 诊断错位 |
| 3 | 「`REACT_APP_*` → `VITE_*`（全局替换）」 | 全仓库仅 2 处：`client/src/api/core.js:11`（`process.env.REACT_APP_API_BASE`，且 `window.__electron?.API_BASE` 已是首选）；`client/package.json:53` 的 `start` 脚本；root `package.json:18` 的 `dev:client` 脚本——**3 处替换，不是"全局"** | ⚠️ 数量级错 |
| 4 | 「Electron dev server 与主进程协作（HMR + file:// 产物加载）」 | 主进程 `electron-main.js:582` 走 `http://localhost:3000` dev URL，生产走 `loadFile(client/build/index.html)`——Vite dev server default port 5173，需协调；CSP（`electron-main.js:458-469`）允许 `connect-src *` 不需改 | ⚠️ 部分对 |
| 5 | 「Electron 场景 `VITE_*` 运行时注入需特殊处理」 | `core.js:9-11` 已优先消费 `window.__electron.API_BASE`（preload 注入），`VITE_*` 仅是 web 模式 dev fallback——**无需"运行时注入特殊处理"** | ❌ 过度设计 |
| 6 | 「首屏包预计大幅下降」 | 已实现懒加载，main=693KB 主要是 react/react-router/react-query/hero-ui/framer-motion 共享层；Vite 改进主要来自 ① dev 启动加速（esbuild）② ESM 原生 ③ 更激进的 tree-shaking——**预期 main ↓ 5–15%，非"大幅"** | ❌ 量化错 |

### 0.3 #8 GPU worker contextIsolation 重构

| # | 原版主张 | 真实现状（证据） | 判al |
|---|---|---|---|
| 1 | 「`gpu-renderer.js` 当前在页面内 `require('electron')`」 | 属实：`electron-gpu/gpu-renderer.js:2`；但**仅 GPU worker 一个窗口如此**——mainWindow 早已 `contextIsolation:true + nodeIntegration:false + preload`（`electron-main.js:444-450`）；GPU window 在 `electron-main.js:657-661` 显式 `nodeIntegration:true, contextIsolation:false` | ⚠️ 描述以偏概全 |
| 2 | 「SSRF 白名单迁入 preload 侧校验」 | **白名单已经在主进程**：`electron-main.js:712-723` 在 `ipcMain.handle('filmlab-gpu:process')` 内强制校验 `allowedHosts`（loopback + 配置的 apiBase host）；渲染层不参与 fetch——**白名单不需要"迁入 preload"，它本就不在渲染层** | ❌ 诊断错位 |
| 3 | 「拆为 preload（contextBridge）+ 渲染层（消费白名单 API）」 | 思路对，但漏判 **2 处硬依赖**：① `gpu-renderer.js:12` `require('../packages/shared/filmLabWhiteBalance')`（纯 JS 模块，可经 bundling 解决）；② `gpu-renderer.js:457` `Buffer.from(arrBuf)`（Node 全局，sandbox 后爆掉，需改 `new Uint8Array(reader.result)`） | ❌ 漏判关键阻断点 |
| 4 | 「`sandbox: true` 评估 GPU 访问兼容性」 | WebGL 走 GPU 进程，与 renderer sandbox **不冲突**；但 sandbox 下 `require()` 完全禁用（不只 ipcRenderer）——**preload 必须 bundling** | ⚠️ 部分对 |
| 5 | 「逐函数迁移并位等价验证」 | 正确思路，但需**量化基线**（PSNR ≥ 99dB 仿 2C #5）——原计划无 | ⚠️ 缺量化 |

### 0.4 跨工程横切（原版完全未覆盖）

| # | 缺口 | 影响 |
|---|---|---|
| 1 | **#2 与 #8 的强耦合**：gpuWindow 的 `webPreferences`（`nodeIntegration/contextIsolation/sandbox`）在新 Electron 下默认行为变了（28+ sandbox=true），#8 必须在 #2 稳定后才做 | #2↔#8 必须串行，不能并行 |
| 2 | **#2 与 #3 的弱耦合**：两者都改 root `package.json` devDeps 与 `dev:client`/`build-client` 脚本；无 server/native 路径重叠 | 文件级冲突，需协调提交顺序 |
| 3 | **#3 与 #8 零耦合**：Vite 改 `client/`，GPU preload 改 `electron-gpu/`；可完全并行 | 并行机会 |
| 4 | **2C 的 `render-worker-pool`（server 侧）在 `ELECTRON_RUN_AS_NODE=1` 子进程跑**（`electron-main.js:175`）——Electron 升级后 worker_threads ABI 需重新验证 | #2 回归必须包含 server worker 路径 |
| 5 | **2C 383 tests 是 #2 的硬回归基线**——没有 2C 完成就盲改 #2 等于裸奔 | 已满足，但 2D 必须确认 2C 已合入 |
| 6 | **`electron-builder` 版本可能需协同升级**：root `package.json` `electron-builder@24` 在 Electron 35+ 下 publish/notarize 流程需 ≥ 25；`@electron/rebuild@3.7` 满足 | #2 的隐性依赖 |
| 7 | **CI 通道（`.github/workflows/build-desktop.yml`）**：当前脚本 `npx @electron/rebuild -v 26.6.10`（`package.json:26`）——升级后版本号硬编码要清掉 | #2 必扫 |
| 8 | **回退预案过度承诺**：原版「保留旧 Electron 构建通道」不现实（双 build matrix 复杂度爆炸）；**分支即回退**才是本质（见 §1 原则 3） | 计划过承诺 |

### 0.5 根因诊断（真正的「本质」）

原版 2D 的问题同原版 2C：**事实底座停留在 FOLLOWUPS**。真正的本质：

- **(A) 误判"已生效为未生效"**：#3 以为代码分割未启用（实际已 `React.lazy`），#8 以为 SSRF 白名单在渲染层（实际在主进程）——把"已解决"当"待解决"是最大的浪费。
- **(B) 范围描述笼统**：#2「Electron 升级」是 17 个大版本跨度 × 3 个 native × 3 平台 × 2 架构 + 签名 + updater + CI 协同——是 6 项子工程，原版当成 1 项。
- **(C) 量化基线缺失**：#8 必须有 PSNR/位等价基线（仿 2C #5）；#3 必须有 main bundle 量化对比；#2 必须有 native ABI 验证矩阵——原版均无。
- **(D) 耦合关系未画清**：#2→#8 强耦合（webPreferences 默认值变化），#2↔#3 弱耦合（共享 devDeps），#3∥#8 零耦合——排序应由耦合决定，不由"EOL 紧迫感"决定。

---

## 1. 重写原则（对照「不过多兜底」）

1. **分支即 feature flag**：每项独立分支、独立 PR、独立验收；**不引入 `FG_ELECTRON_NEW`/`FG_VITE_ENABLED`/`FG_GPU_CONTEXT_ISOLATION` 等全局开关**——这些是缝补，不是工程。
2. **阈值开关例外**：仅在 #2 的 `FG_NATIVE_FALLBACK_VERBOSE`（prebuilt 加载失败时日志详尽度，默认 silent）等**真有阈值调节价值**处保留，文档化。
3. **不重复造物**：#3 不重写 `lazyRoutes`（代码分割已生效）；#8 不重写 SSRF 白名单（已在主进程）；#2 不重写 `electron-preload.js`（mainWindow 已安全）。
4. **量化优先**：每个工程开工前先采基线（main bundle 大小、GPU 渲染 PSNR、native prebuilt 矩阵维度、CI 三平台产物大小），改完前后对比归档。
5. **排序由耦合决定**：#2 先于 #8（webPreferences 跨版本默认值变化）；#3 可与 #2/#8 完全并行（文件零重叠）；不按"EOL 紧迫感"排序——EOL 是动机不是依赖。
6. **测试护栏前置**：开工前确认 2A/2C 输出（383 tests）在 main 上 green；#2/#8 每步必须 `npm test` + 三平台 smoke。
7. **不透传 Buffer 进 IPC**：#8 重构后 ipcRenderer 传递的 `jpegBytes` 必须是 `Uint8Array`（跨 contextBridge 安全）；main 侧 `Buffer.from(uint8)` 转换。
8. **CI 是产物的一部分**：#2 升级后必须同步改 `build-desktop.yml`/`ci.yml` 的 `rebuild:electron` 版本号；不做"先合再修 CI"。

---

## 2. 真实现状基线（计划的事实底座）

| 面 | 现状 |
|---|---|
| Electron 版本 | `26.6.10`（`package.json:38`，已 EOL）；stable = `43.1.1`；跨度 17 major |
| `electron-builder` | `24.6.0`（root + server `package.json`）；Electron 35+ 需 ≥ 25 |
| `@electron/rebuild` | `3.7.1`（满足；命令在 `package.json:26` 硬编码 `-v 26.6.10`） |
| mainWindow 安全态 | `electron-main.js:444-450`：`nodeIntegration:false, contextIsolation:true, preload:electron-preload.js, webSecurity:true` ✅ |
| GPU window 不安全态 | `electron-main.js:657-661`：`nodeIntegration:true, contextIsolation:false, backgroundThrottling:false` ❌（仅此一处需重构） |
| GPU renderer 硬依赖 | `gpu-renderer.js:2` `require('electron').ipcRenderer`；`:12` `require('../packages/shared/filmLabWhiteBalance')`；`:13` `require('./glsl-shared')`；`:457` `Buffer.from(arrBuf)`（Node 全局） |
| SSRF 白名单位置 | `electron-main.js:712-723` 在 `ipcMain.handle('filmlab-gpu:process')` 主进程内校验 ✅ |
| CSP | `electron-main.js:458-469`：default-src self+unsafe-inline+data+blob、img-src *、connect-src *、worker-src self blob、object-src none、base-uri self、frame-ancestors none ✅ |
| CRA 配置 | `client/craco.config.js`：3 项 alias + ModuleScopePlugin 删除 + postcss mode=file；**无 Terser 实际 workaround**（仅注释保留历史） |
| 代码分割现状 | `client/src/App.js:23-36`：14 个 `React.lazy` 路由组件 + 2 处 `Suspense`；`client/build/static/js/` 实测 main=`21f64764.js`(693KB) + ~60 个路由 chunk；最大的 `245.61a09fe7.chunk.js`=390KB 是 react-globe.gl+three.js 单独 chunk ✅ |
| REACT_APP_ 用量 | 全仓库 3 处：`client/src/api/core.js:11`、`client/package.json:53` `start` 脚本、root `package.json:18` `dev:client` 脚本 |
| Tailwind v4 | `client/package.json:11-14`：`@tailwindcss/postcss@4.1.18` + `tailwindcss@4.1.18`；`postcss.config.js` 独立配置文件；Vite 下用 `@tailwindcss/vite` 替代 |
| 入口约定 | `client/public/index.html` 11 行（CRA 约定）；Vite 要 `<script type="module" src="/src/index.jsx">`；`client/src/index.js` 是 CRA 入口 |
| native 模块 | `libraw-native`：N-API v8，已有 `prebuildify --napi --strip` + `bin/` 兜底（Phase 0–1）；`sharp@0.34.5`：官方 prebuilt；`sqlite3@5.1.7`：官方 prebuilt（SQLite 3.44.2，远超 3.25 窗口函数门槛，2C 已验证） |
| 三平台构建矩阵 | `.github/workflows/build-desktop.yml`：windows-2022 + macos-latest + ubuntu-latest；client-only 与 full 双通道 |
| `electron-updater` | 未集成；`build.publish` 未配置（`package.json:46-122` 无 publish 块） |
| 签名 | mac 未配 notarize；Windows 无 cert；Linux 无需 |
| 测试护栏 | 2C 输出 383 tests / 35 suites（root jest）；mobile 33 tests / 4 suites（jest-expo）；CI `ci.yml` + `build-desktop.yml` 双通道 |
| 2C 遗产 | `render-worker-pool.js`（server worker_thread）在 `ELECTRON_RUN_AS_NODE=1` 子进程跑（`electron-main.js:175`）——Electron 升级后需重验 |

---

## 3. 工程拆分

> 顺序：**2D.0 基线采集 → 2D.1 #2 Electron 升级（最重，阻塞 #8）→ 2D.2 #8 GPU 重构（依赖 #2 稳定）→ 2D.3 #3 Vite（与 #2/#8 并行）**。
> #3 可与 #2/#8 完全并行；#2 与 #8 串行；#2 与 #3 协调 root `package.json` 提交顺序（合并时二选一先 rebase）。

### 2D.0 前置：基线采集（不写代码，只测）

**产出**：`docs/phase2-roadmap/2d-baselines.md`，归档 4 类基线数据。

**采集项**
1. **构建基线**：`cd client && npm run build` → 记录 main bundle 大小、chunk 数量、总产物体积；`electron-builder --dir` 三平台产物大小（dev 通道即可）。
2. **GPU 渲染基线**：固定 5 张样本（含 1 张 RW2 170MP、1 张 TIFF 16-bit、1 张 JPEG 普通），跑 `filmlabGpuProcess` 路径，记录 JPEG 输出 PSNR（自对比，验证稳定性）；耗时 p50/p95。
3. **启动时基线**：dev `dev:full` 从 `npm run dev` 到窗口 ready 的时间（p50/p95，5 次）；生产 packaged 启动到 ready。
4. **CI 基线**：`ci.yml` 通过时长；`build-desktop.yml` 三平台产物大小。

**验收**
- [ ] 基线文档存在，含至少 4 类指标的 5 次取样 p50/p95。
- [ ] 基线写入 `2d-baselines.md` 并 git commit；后续每个工程结束后回写"基线 / 改写后 / 增益%"对比。

**风险**：无（只读不改）。

---

### 2D.1 #2 Electron 大版本升级（最重，阻塞 #8）

**性质**：跨 17 个 major 的 native 重编 + API 兼容审查 + 三平台产物验证 + 签名/updater 子工程拆分。

**核心动作（按"分支即回退"原则）**：独立分支 `phase-2d/electron-upgrade`，全程不改 main 直到三平台 smoke 通过。

#### 2D.1.1 目标版本选定

- **目标**：当前 stable major（决策时复核最新 stable + Node 内嵌版本与 `.nvmrc`(20) 兼容；2026-07 实测 = `43.x`）。
- **不跳目标**：不一次跨到 beta/nightly；选 stable major 最新 patch 版。
- **文档化**：在 `2d-baselines.md` 追加「决策时点 stable 版本 + Node 内嵌版本 + 与 `.nvmrc` 兼容矩阵」。

#### 2D.1.2 跨 major changelog 审查（一次性）

**改动（文档级）**：`docs/phase2-roadmap/2d-electron-changelog-audit.md`，逐 major 抽取影响本仓库的点：

| 重大变化区间 | 影响点 | 本仓库对应位置 |
|---|---|---|
| 28+ sandbox 默认 true | mainWindow webPreferences | `electron-main.js:444-450`（显式声明 sandbox 值，不靠默认） |
| 22+ `crashed` deprecated | crash 恢复 | `electron-main.js:524` 已用 render-process-gone 双保险 ✅ |
| 35+ mac notarize 强制 | mac 打包 | `electron-builder-client-only.json` `mac` 块（需加 notarize 配置） |
| `webContents.on('dom-ready')` 语义 | 启动日志 | `electron-main.js:556` |
| `nativeImage.createFromData(Buffer)` | tray 兜底 | `electron-main.js:369`（参数类型变化） |
| `app.setAppUserModelId` 早调 | Windows taskbar | `electron-main.js:12` ✅ 已早调 |

**验收**
- [ ] 文档存在，覆盖 ≥10 条具体 API 行为变化。
- [ ] 每条标注「已对齐 / 需改动 / 不影响」三态。

#### 2D.1.3 native 重编矩阵

**改动（文件级）**
1. `packages/@filmgallery/libraw-native`：
   - 跑 `npm run prebuildify:all`（已存在的脚本，`package.json:21`）生成 win32-x64 / darwin-x64+arm64 / linux-x64 prebuilt。
   - **加 `darwin-arm64`**（macOS Apple Silicon，当前矩阵缺失）。
   - 验证 `bin/` 兜底加载（Phase 0–1 已加）在新 Electron ABI 下仍生效。
2. `sharp@0.34.5`：跟随官方 prebuilt，无需自维护；`electron-main.js:60-78` 的 `getSharp()` 4 候选路径不变。
3. `sqlite3@5.1.7`：跟随官方 prebuilt；验证 `server/node_modules/sqlite3` 在新 Electron 下能 require（worker_threads 路径 + 主路径双测）。
4. `@electron/rebuild` 命令：清掉 root `package.json:26` 与 server `package.json:11` 的 `-v 26.6.10` 硬编码，改为读取 `electron` 包版本：

   ```json
   "rebuild:electron": "cd server && npm run rebuild:electron && cd ../packages/@filmgallery/libraw-native && npx @electron/rebuild"
   ```

   （`@electron/rebuild` 默认从 `node_modules/electron/package.json` 读 version，无需传 `-v`）

**验收**
- [ ] prebuilt 矩阵覆盖：win32-x64、darwin-x64、darwin-arm64、linux-x64 共 4 维。
- [ ] `npm run rebuild:electron` 在三平台本地通过（CI 验证）。
- [ ] `node -e "require('@filmgallery/libraw-native')"` / `require('sharp')` / `require('sqlite3')` 在新 Electron 下加载成功（main 进程 + ELECTRON_RUN_AS_NODE=1 双测）。
- [ ] **2C 的 render-worker-pool（server worker_thread）回归绿**（依赖 ELECTRON_RUN_AS_NODE 子进程 ABI）。

#### 2D.1.4 electron-updater + publish + 签名（拆三子任务）

**性质**：原版一句话，实际是三项独立运维工程。**默认 DEFER 到 2D.1.5 之后**——若团队尚无证书，仅做「配置就绪、publish 暂留 disabled」。

**改动（文件级）**
- `package.json` build 块加 `publish` 配置（GitHub release 默认；提供 `provider: 'github'` + `repo`/`owner`）。
- `electron-builder-client-only.json` 同步。
- mac：`mac.notarize: { teamId: process.env.APPLE_TEAM_ID }`，CI 加 secrets（`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`/`CSC_LINK`/`CSC_KEY_PASSWORD`）。
- Windows：`win.certificateSubjectName` 或 `win.certificateFile` + secrets（`CSC_LINK`/`CSC_KEY_PASSWORD`）。
- 加 `electron-updater` 依赖（root）+ 主进程启动时 `autoUpdater.checkForUpdatesAndNotify()`（受 `appConfig.autoUpdate !== false` 开关）。

**子任务拆分**
- **2D.1.4a 配置就绪**：`publish` 块 + `electron-updater` 集成 + 受控开关；不真签。
- **2D.1.4b macOS 签名**：需 Apple Dev 证书 + App-specific password（运维项，非代码）。
- **2D.1.4c Windows 签名**：需 code signing cert（同上）。
- **2D.1.4d 升级端到端验证**：模拟旧→新版本升级流程（自建 release 频道）。

**验收**（仅 2D.1.4a 必做；4b/c/d 视证书可用性）
- [ ] `publish` 配置存在，`provider: 'github'` 默认。
- [ ] 主进程在 `app.on('ready')` 后调用 `autoUpdater.checkForUpdatesAndNotify()`，受 `appConfig.autoUpdate` 控制（默认 true）。
- [ ] 失败不影响启动（autoUpdater error 仅日志）。

#### 2D.1.5 回归（阻塞合入）

**回归项**
- 三平台本地 `npm run pack` 产物启动正常（窗口出来、server 启动、API 通）。
- **2C 的 383 tests 在新 Electron 下绿**（root jest 跑两次：系统 Node + Electron 内嵌 Node via `ELECTRON_RUN_AS_NODE`）。
- FilmLab GPU 路径（5 张样本，依赖 §2D.0 基线）PSNR ≥ 99dB。
- 导入/导出/批量下载/地图瓦片/地理编码跨平台 smoke。
- `electron-updater` 升级链路（如 2D.1.4a 已做，跑模拟）。

**验收**
- [ ] 三平台产物可用（win/mac/linux 各启动一次）。
- [ ] 383 tests 在 Electron 内嵌 Node 下绿（`ELECTRON_RUN_AS_NODE=1 electron .` 跑 server.js）。
- [ ] GPU 路径 PSNR ≥ 99dB。
- [ ] 基线对比：启动时间、bundle 体积、CI 时长任一劣化 ≥10% 触发回滚决策。

**风险**
- **native ABI 不兼容**：缓解——prebuilt 矩阵覆盖 4 维；`bin/` 兜底；CI 三平台验证。
- **macOS notarize 失败**：缓解——签名独立子任务（2D.1.4b），不阻塞核心升级。
- **Electron API 破坏**：缓解——changelog 审查（2D.1.2）+ 测试护栏（2C 383 tests）。

---

### 2D.2 #8 GPU worker contextIsolation 重构（依赖 #2 稳定）

**性质**：把 `electron-gpu/gpu-renderer.js` 从 nodeIntegration 模式改为 contextBridge 模式。**只改一个隐藏窗口，不动 mainWindow。**

**前置**：2D.1 已合入 main（Electron 版本稳定）；新 Electron 下 sandbox 默认行为已确定。

#### 2D.2.1 硬依赖梳理

**当前 `gpu-renderer.js` 的 Node 依赖（grep 全文）**
1. `require('electron').ipcRenderer`（行 2、451、458、461、466、483、490、492）—— 替换为 `window.__gpu.sendResult(payload)`。
2. `require('../packages/shared/filmLabWhiteBalance')`（行 12）—— 纯 JS 模块，**经 Vite/esbuild bundling 进 gpu-renderer.js**（消除 require）。
3. `require('./glsl-shared')`（行 13）—— 同上。
4. `Buffer.from(arrBuf)`（行 457）—— 改为 `new Uint8Array(reader.result)`（跨 contextBridge 安全）。

#### 2D.2.2 架构重写

**改动（文件级）**

1. **新建 `electron-gpu/gpu-preload.js`**：
   ```js
   const { contextBridge, ipcRenderer } = require('electron');
   contextBridge.exposeInMainWorld('__gpu', {
     onRun: (handler) => ipcRenderer.on('filmlab-gpu:run', (_e, job) => handler(job)),
     sendResult: (payload) => ipcRenderer.send('filmlab-gpu:result', payload),
   });
   ```
   - 仅暴露 2 个 API；`payload` 类型受限（`{jobId, ok, width?, height?, jpegBytes?, error?}`），`jpegBytes` 必须是 `Uint8Array`（不是 Buffer）——结构化克隆安全。

2. **`electron-gpu/gpu-renderer.js`**：
   - 删除 `require('electron')`（行 2）。
   - 删除 `require('../packages/shared/filmLabWhiteBalance')`（行 12）+ `require('./glsl-shared')`（行 13）——改由构建步骤 bundling（见 2D.2.3）。
   - 所有 `ipcRenderer.send('filmlab-gpu:result', {...})` → `window.__gpu.sendResult({...})`。
   - 行 457 `Buffer.from(arrBuf)` → `new Uint8Array(reader.result)`。
   - 行 488-494 `DOMContentLoaded` + `ipcRenderer.on('filmlab-gpu:run')` → `window.__gpu.onRun(handler)`。

3. **`electron-main.js:651-662`（gpuWindow 创建）**：
   - `nodeIntegration: true` → `false`。
   - `contextIsolation: false` → `true`。
   - 加 `sandbox: true`（评估 WebGL 兼容；Electron 28+ 默认即 true，显式声明防漂移）。
   - 加 `preload: path.join(__dirname, 'electron-gpu', 'gpu-preload.js')`。
   - **保留 `backgroundThrottling: false`**（GPU 任务不应被节流）。

4. **`electron-main.js:879-957`（result handler）**：
   - `result.jpegBytes` 现在是 `Uint8Array` 而非 Buffer。
   - `Buffer.from(result.jpegBytes)` 改为 `Buffer.from(result.jpegBytes.buffer ?? result.jpegBytes)`（兼容 Uint8Array 与 Buffer 两种来源；Uint8Array 有 `.buffer` 而 Buffer 也有，等价）。
   - 实际上 `Buffer.from(uint8)` 即可正确处理，无需特殊兼容代码——保持简单。

5. **SSRF 白名单**：**不动**。`electron-main.js:712-723` 的白名单已在主进程校验，渲染层碰不到。原计划"迁入 preload"是误判。

#### 2D.2.3 bundling 策略

**改动**
- `electron-gpu/` 加最小 `esbuild` 构建脚本（不入 Vite，独立）：
  ```js
  // electron-gpu/build.js（dev dependency，仅打包用）
  require('esbuild').build({
    entryPoints: ['gpu-renderer.js'],
    bundle: true,
    outfile: 'gpu-renderer.bundle.js',
    platform: 'browser',
    format: 'iife',
    loader: { '.js': 'js' },
  });
  ```
- `gpu.html` 引用 `gpu-renderer.bundle.js`（而非 `gpu-renderer.js`）。
- 加 `electron-gpu/package.json`（独立，含 esbuild devDep）或在 root devDeps 加 esbuild（推荐——避免子包 lockfile）。
- `package.json` scripts 加 `"build:gpu": "node electron-gpu/build.js"`；`pack`/`dist` 串入。

**理由**：preload/renderer 不能 `require`，但 shared 模块（filmLabWhiteBalance / glsl-shared）必须能引；最小成本是 esbuild 一次性 bundling，不引入 Vite（Vite 是 2D.3 的事，#8 不依赖它）。

#### 2D.2.4 位等价验证

**性质**：gpu-renderer.js 的算法逻辑不动（仅替换 IPC/require），位等价应结构性保证；但实际跑一次基线对比以防 WebGL 状态机差异。

**改动**
- 复用 §2D.0 的 5 张 GPU 样本，跑重构前后双路径（旧 `electron@26 + nodeIntegration` vs 新 `electron@43 + contextBridge`），输出 JPEG 的 PSNR ≥ 99dB。
- 归档到 `2d-baselines.md` 的 #8 节。

**验收**
- [ ] `rg "require\\('electron'\\)" electron-gpu/` 返回 0（仅 preload 文件允许）。
- [ ] `electron-main.js` 的 `gpuWindow` 创建处显式 `contextIsolation:true, nodeIntegration:false, sandbox:true, preload`。
- [ ] 注入测试：在 renderer console 跑 `require('electron')` → 抛 ReferenceError（nodeIntegration 关闭）。
- [ ] GPU 路径 PSNR ≥ 99dB（5 样本）。
- [ ] GPU 渲染耗时 p95 不劣化（与 §2D.0 基线对比，劣化 < 10%）。

**风险**
- **esbuild bundling 引入新问题**：缓解——bundling 仅 shared 纯 JS 模块（无 native），风险低；预 validate `node electron-gpu/build.js` 后产物能被 `<script>` 加载。
- **Uint8Array 跨 contextBridge**：结构化克隆支持 Uint8Array，零拷贝（不像 Buffer 是 Node 私有类）。
- **sandbox 限制 WebGL**：理论上不限制（GPU 进程独立）；若发现限制，降级为 `sandbox:false`（仍 contextIsolation:true）并文档化。

---

### 2D.3 #3 CRA→Vite 迁移（与 #2/#8 完全并行）

**性质**：构建工具切换。**不引入新功能**——代码分割已生效、Tailwind v4 已配置；只是去 CRA + 去 CRACO。

**核心动作**：独立分支 `phase-2d/cra-to-vite`，与 2D.1/2D.2 零文件重叠。

#### 2D.3.1 构建工具切换

**改动（文件级）**

1. `client/package.json`：
   - 移除：`react-scripts`、`@craco/craco`。
   - 加入：`vite`、`@vitejs/plugin-react`、`@tailwindcss/vite`。
   - 脚本：
     ```json
     "start": "vite",
     "build": "vite build",
     "preview": "vite preview"
     ```
   - 删 `eslintConfig` 块（CRA 残留；ESLint flat config 已在 root `eslint.config.mjs` 管）。

2. 新建 `client/vite.config.js`：
   ```js
   import { defineConfig } from 'vite';
   import react from '@vitejs/plugin-react';
   import tailwindcss from '@tailwindcss/vite';
   import path from 'node:path';

   export default defineConfig({
     plugins: [react(), tailwindcss()],
     resolve: {
       alias: {
         '@filmgallery/shared': path.resolve(__dirname, '../packages/shared'),
         '@ui': path.resolve(__dirname, 'src/components/ui'),
         '@providers': path.resolve(__dirname, 'src/providers'),
       },
     },
     server: { port: 3000 }, // 与 electron-main.js:582 dev URL 一致
     build: {
       outDir: 'build', // 与 electron-main.js:592-593 生产路径一致
       sourcemap: false,
     },
   });
   ```

3. `client/index.html`（**移到 client/ 根**，Vite 约定）：
   - `<script type="module" src="/src/index.jsx"></script>`（注意 `.jsx` 后缀，Vite 默认支持）。
   - 保留 `<div id="root">`。

4. `client/src/index.js` → `client/src/index.jsx`（重命名；Vite 对 JSX 后缀更友好）。

5. 删 `client/craco.config.js`、`client/postcss.config.js`（Tailwind v4 用 Vite 插件，不再需 PostCSS config）。

#### 2D.3.2 环境变量迁移

**改动（3 处，机械替换）**
- `client/src/api/core.js:11`：`process.env.REACT_APP_API_BASE` → `import.meta.env.VITE_API_BASE`。
- `client/package.json`（已删 start 脚本的 env，移到 `.env.development`）：
  - 新建 `client/.env.development`：`VITE_API_BASE=http://localhost:4000`。
- root `package.json:18` `dev:client` 脚本：`REACT_APP_API_BASE=...` → 去掉（dev server 内部已处理）或 `VITE_API_BASE=...`。

**理由**：仅 3 处实际用量（已在 §0.2 #3 列出），不是"全局替换"。

#### 2D.3.3 Electron 集成（dev + 生产）

**改动**
- `electron-main.js:582`（dev URL）：保持 `http://localhost:3000`（Vite 默认 5173，已在 vite.config 设 port:3000 对齐）。
- `electron-main.js:592-593`（生产路径）：`client/build/index.html` 不变（Vite outDir 设为 build）。
- `electron-main.js:458-469` CSP：保持现状（Vite dev/prod 产物均符合当前 CSP）。

#### 2D.3.4 性能对比与回归

**改动**
- 复用 §2D.0 的构建基线，跑 Vite 改完后对比：main bundle、chunk 数量、总产物体积、dev 启动时间。
- 关键 UI smoke：14 个懒加载路由各打开一次，验证 chunk 按需加载（Network 面板）。
- Electron dev + 生产打包均正常启动。

**验收**
- [ ] `client/` 下无 `react-scripts`、`craco`、`postcss.config.js` 残留（grep 验证）。
- [ ] `vite.config.js` 存在，alias 3 项与原 CRACO 一致。
- [ ] main bundle 大小不劣化（容忍 ±5%；预期 ↓ 5–15%）。
- [ ] dev 启动时间 ↓ 显著（Vite/esbuild 通常比 CRA 快 5–10×；记录实际数据）。
- [ ] 14 路由懒加载验证（Network 面板见 chunk 加载）。
- [ ] Electron dev + 生产打包启动正常。

**风险**
- **`process.env.NODE_ENV` 在浏览器代码中的残留**：CRA 注入；Vite 用 `import.meta.env.MODE`/`PROD`/`DEV`。grep `client/src` 全清。
- **HeroUI/Framer Motion 等库对 ESM/CJS 双解析**：Vite 预 bundling 解决；遇到 `Cannot use import statement outside a module` 加 `optimizeDeps.include`。
- **`window.__electron` 注入时序**：preload 在 DOMContentLoaded 前注入，Vite 入口在 `<script type="module">` 后跑；core.js 读取 `window.__electron?.API_BASE` 时序无变化（preload 一定先）。

---

## 4. 排序与并行

```
2D.0 基线采集（一次性，无代码）
  │
  ├─→ 2D.1 #2 Electron 升级 ──────┐（阻塞 #8：webPreferences 默认值随版本变）
  │   (独立分支, 最重)             │
  │                                ▼
  │                              2D.2 #8 GPU 重构
  │                                (依赖 #2 稳定)
  │
  └─→ 2D.3 #3 Vite ─────────────────────────────── (与 #2/#8 完全并行)
      (独立分支, 文件零重叠)
```

**理由**
1. **#2 先于 #8**：#8 改 `gpuWindow.webPreferences`，Electron 28+ sandbox 默认 true、contextBridge 行为微调——必须先稳定 Electron 版本。
2. **#3 完全并行**：`client/` 与 `electron-main.js`/`electron-gpu/` 文件零重叠；只需协调 root `package.json` 提交顺序（任一先 rebase）。
3. **#2 与 #3 的 root `package.json` 冲突**：合并时 git rebase 一边即可，无语义冲突。

**并行机会**
- 2D.1.2 changelog 审查可与 2D.1.3 native prebuilt 并行（不同文件：docs vs prebuilt 矩阵）。
- 2D.1.4a/2D.1.4b/2D.1.4c/2D.1.4d 子任务可分给不同人（配置/证书/验证）。
- 2D.2.3（esbuild bundling）可与 2D.2.2（gpu-renderer 重写）并行（不同文件）。

---

## 5. 出口条件（按 2D.0 → 2D.1 → 2D.2 → 2D.3 验收）

1. **2D.0**：基线文档 `2d-baselines.md` 存在，4 类指标各 5 次取样 p50/p95 归档。
2. **2D.1 #2**：
   - Electron 版本为当前 stable major（决策时点的最新 patch）。
   - libraw-native prebuilt 矩阵 4 维齐（win32-x64 / darwin-x64 / darwin-arm64 / linux-x64）。
   - `npm run rebuild:electron` 三平台本地 + CI 通过。
   - **2C 的 383 tests 在新 Electron（ELECTRON_RUN_AS_NODE=1）下绿**。
   - 三平台 packaged 产物启动 smoke 通过。
   - GPU 路径 PSNR ≥ 99dB（与 2D.0 基线对比）。
   - `FOLLOWUPS.md` #2 标记 ✅。
   - `electron-updater` 配置就绪（2D.1.4a 必做；4b/c/d 视证书）。
3. **2D.2 #8**：
   - `rg "require\\('electron'\\)" electron-gpu/gpu-renderer.js` 返回 0。
   - `electron-main.js` gpuWindow 显式 `contextIsolation:true, nodeIntegration:false, sandbox:true, preload`。
   - 注入测试：renderer console `require('electron')` → ReferenceError。
   - GPU 5 样本 PSNR ≥ 99dB；p95 不劣化。
   - `FOLLOWUPS.md` #8 标记 ✅。
4. **2D.3 #3**：
   - `client/` 无 `react-scripts`/`craco`/`postcss.config.js` 残留。
   - main bundle 不劣化（容忍 ±5%）；dev 启动时间显著下降（记录数据）。
   - Electron dev + 生产打包启动正常。
   - 14 路由懒加载 chunk 验证。
   - `FOLLOWUPS.md` #3 标记 ✅。
5. **全局**：
   - 每项独立分支 + 独立 PR + 独立验收。
   - `2d-baselines.md` 各工程结束后回写"基线 / 改写后 / 增益%"。
   - 任一指标劣化 ≥10% 触发回滚决策（不合入 main）。
   - 不保留无用 env 全局开关（仅 `appConfig.autoUpdate` 等业务控制）。

---

## 6. 待定决策（需在对应子任务开工前定）

- [ ] **D1**：Electron 目标版本（建议：决策时点 stable major 最新 patch；2026-07 = `43.x`）。
- [ ] **D2**：是否在 #2 一并做 macOS notarize + Windows signing（**推荐 DEFER**：证书是运维项，不阻塞核心升级；2D.1.4a 仅做配置就绪）。
- [ ] **D3**：`electron-updater` publish 目标（**推荐 GitHub release**：已有 `GITHUB_TOKEN` 基础设施；自建源需运维）。
- [ ] **D4**：`darwin-arm64` prebuilt 是否纳入矩阵（**推荐是**：Apple Silicon 占比 >50%）。
- [ ] **D5**：#8 的 GPU renderer bundling 工具（**推荐 esbuild**：最小、与 Vite 无关；不引入 Vite 是为保持 #3/#8 独立）。
- [ ] **D6**：sandbox 是否在 #8 一并启用（**推荐是**：但保留 `sandbox:false` 降级路径文档化；WebGL 实测不限制）。
- [ ] **D7**：#3 是否在迁移同时去掉 `eslintConfig` 块（**推荐是**：root `eslint.config.mjs` 已管）。
- [ ] **D8**：#3 的 `client/src/index.js` 是否重命名为 `.jsx`（**推荐是**：Vite 默认认 `.jsx`，避免 JSX-in-.js 警告）。
- [ ] **D9**：是否在 #2 一并清理 `electron-main.js` 中废弃的 `webContents.on('crashed')`（**推荐否**：render-process-gone 双保险已存在，crashed 是无害冗余；不在 #2 范围）。

---

## 附录 A · 与原版差异对照

| 节 | 原版 | 重写版 | 理由 |
|---|---|---|---|
| §0 | 无 | 新增「设计验证」 | 仿 2C §0，校准事实底座 |
| 工程一 #2 | 「当前 stable」一句话 | 拆 1.1–1.5（版本/changelog/native/updater/回归） | 17 major 跨度被低估 |
| 工程一 #2 | 「保留旧 Electron 构建通道」 | 「分支即回退，不双 matrix」 | 双 matrix 复杂度爆炸 |
| 工程一 #2 | 「签名一句话」 | 拆 1.4a/b/c/d 四子任务 | 签名是运维项，独立 |
| 工程二 #3 | 「`lazyRoutes.js` 迁移后挂载，首屏包大幅下降」 | 「代码分割已生效，Vite 仅工具切换」 | `App.js` 已 `React.lazy`；main=693KB |
| 工程二 #3 | 「全局替换 REACT_APP_」 | 「3 处机械替换」 | grep 实测 |
| 工程二 #3 | 「Electron 场景 VITE_* 运行时注入特殊处理」 | 「无需——preload 注入已是首选」 | `core.js:9` 优先 window.__electron |
| 工程三 #8 | 「全应用 contextIsolation 重构」 | 「仅 GPU worker window 一处」 | mainWindow 早已安全 |
| 工程三 #8 | 「SSRF 白名单迁入 preload」 | 「白名单不动，已在主进程」 | `electron-main.js:712-723` |
| 工程三 #8 | 未提 `require(shared/*)` + `Buffer.from` | 显式列 2 处硬依赖 + esbuild bundling | sandbox 下 require 全禁 |
| 新增 | — | §2D.0 基线采集 | 量化优先 |
| 新增 | — | §2D.1.2 changelog 审查 | 17 major 跨度 |
| 新增 | — | §2D.2.4 位等价 PSNR ≥ 99dB | 仿 2C #5 量化 |
| 新增 | — | §0.4 跨工程横切 8 项 | 排序依据 |
| 排序 | 「EOL 紧迫感」 | 「耦合决定：#2→#8 串行，#3 并行」 | 依赖关系本质 |
