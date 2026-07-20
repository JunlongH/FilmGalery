# 2D.1.2 · Electron 26 → 43 跨 major changelog 审查

> **范围**: 17 个 major（27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43）。
> **方法**: 按 Electron 官方 breaking-changes 文档 + 本仓库代码 grep，逐条标注「已对齐 / 需改动 / 不影响」三态。
> **代码索引**: 主要扫描 `electron-main.js`、`electron-preload.js`、`electron-gpu/*`。

---

## 1. 已对齐（无需改动，但需在 PR 中验证）

| Major | 变化 | 本仓库位置 | 状态 |
|---|---|---|---|
| 22+ | `webContents.on('crashed')` deprecated（保留别名） | `electron-main.js:524` | ✅ 已用 `render-process-gone`（行 536）双保险 |
| 早 | `app.setAppUserModelId` 必须早调 | `electron-main.js:12` | ✅ 已在 require 后立即调 |
| 早 | `contextIsolation` 与 `nodeIntegration` 显式声明 | `electron-main.js:444-450`（mainWindow） | ✅ 已显式 |
| 早 | `webSecurity: true` 显式 | `electron-main.js:448` | ✅ 已显式 |
| 28+ | `process.contextIsolated` 检测 | `electron-preload.js` | ✅ preload 始终用 contextBridge（contextIsolation:true 下唯一合法路径） |

## 2. 需改动（阻塞升级）

| Major | 变化 | 本仓库位置 | 改动方案 | 优先级 |
|---|---|---|---|---|
| 28+ | `sandbox` 默认 true（renderer）；当 `sandbox:true` 时 `nodeIntegration` 必须为 false（已对齐），但 `preload` 脚本可访问的 API 收紧 | `electron-main.js:444-450`（main）+ `:657-661`（gpu） | mainWindow 显式 `sandbox: true`；gpuWindow 待 #8 改完后显式 `sandbox: true`（#8 范围） | P0（#2）+ P0（#8） |
| 32 | macOS 最低版本 10.15 → 11（Big Sur） | `electron-builder-client-only.json` `mac.target` | 加 `mac.target.dmg.minimum` 或不指定（默认随 Electron） | P1 |
| 33 | macOS 最低 11 → 12（Monterey） | 同上 | 同上 | P1 |
| 35 | macOS App Store / 分发外渠道要求 notarization；自建渠道也强烈推荐 | `electron-builder-client-only.json` | 加 `mac.notarize: { teamId: process.env.APPLE_TEAM_ID }` + CI secrets；无证书则 DEFER | P2（DEFER） |
| 36+ | `webContents.on('did-configure-dom-ready')` / `dom-ready` 时序微调 | `electron-main.js:556` | 实测验证；不改代码 | P3 |
| 早 | `nativeImage.createFromBuffer(buffer, options)` 在 E32+ options.hsl 或 scaleFactor 行为收紧 | `electron-main.js:369`（实际是 `createFromData`） | 不影响（`createFromData` 调用未使用 options） | ✅ 不影响 |
| 30+ | `ses.storage` 替代 `ses.clearStorageData` 部分语义 | 未使用 | ✅ 不影响 |
| 36+ | PDF 查看器（`plugins`）移除 | 未使用 | ✅ 不影响 |

## 3. nativeImage / Tray 相关（需实测）

| Major | 变化 | 本仓库位置 | 风险 |
|---|---|---|---|
| 早 | `nativeImage.resize(options)` 在 macOS 行为略有差异（异步 hint） | `electron-main.js:353-360` | 低（已有 try/catch） |
| 早 | `Tray.setContextMenu` 在 Linux GNOME 主题变化时行为 | `electron-main.js:394` | 低 |
| 早 | `nativeImage.createFromPath` 对 SVG 不支持（旧已知） | `electron-main.js:351` | ✅ assets 是 PNG |

## 4. electron-builder 协同

| 版本 | 变化 | 影响 |
|---|---|---|
| 24 → 25 | Node 最低 18；macOS 11+；fpm 选项 | ✅ 与 Electron 33+ 对齐 |
| 25 → 26 | `@electron/rebuild` 集成；dmg 格式更新；Linux 写入 /usr 需 root 行为 | 需测 NSIS 配置 |
| 当前 24.6.0 → 26.15.3 | 跨 2 major | 必须协同升级 |

## 5. @electron/rebuild 协同

| 版本 | 变化 |
|---|---|
| 3.7 → 4.0 | 支持 Electron 30+ 的新的 ABI 表；CLI 参数兼容 |
| 4.0 → 4.2 | 修复 Apple Silicon 的预编译识别 |
| 当前 3.7.1 → 4.2.0 | 升级（与 E43 对齐） |

## 6. 渲染端时序（dev/prod）

| 项 | E26 行为 | E43 行为 | 影响 |
|---|---|---|---|
| `loadURL` Promise resolve 时点 | load 渲染进程启动 | 一致 | ✅ |
| `loadFile` 与 `preload` 注入顺序 | preload 先 | 一致 | ✅ |
| `did-fail-load` 触发条件 | HTTP 错误、连接失败 | 一致 | ✅ |
| `dom-ready` 触发 | DOMContentLoaded 后 | 一致 | ✅ |

## 7. 总结：本次需改动的代码点

1. **`electron-main.js:444-450`**（mainWindow webPreferences）：加 `sandbox: true`（显式）。
2. **`electron-main.js:657-661`**（gpuWindow webPreferences）：本工程 #2 阶段保持现状（#8 才改），但需在 #2 smoke 时验证 gpu 路径仍工作（即 E43 下 `nodeIntegration:true, contextIsolation:false` 仍能跑 GPU renderer——预期可以，因为这是显式 opt-out）。
3. **`package.json:26` + `server/package.json:11`**：删 `-v 26.6.10` 硬编码。
4. **`electron-builder-client-only.json` + root `package.json` build 块**：mac 最低版本（默认随 Electron）；可加 `mac.notarize` 占位（DEFER 实际签名）。
5. **`package.json` devDeps**：`electron@43.1.1`、`electron-builder@^26.15.3`、`@electron/rebuild@^4.2.0`。

## 8. 不需改动但需验证的点

- `webContents.on('crashed')` 在 E43 仍可用（deprecated 但保留）；现有双保险已就绪。
- `ipcMain.handle` / `ipcMain.on` API 无变化。
- `contextBridge.exposeInMainWorld` 无变化。
- `app.getPath('userData')` 无变化。
- `spawn(process.execPath, [...], { env: { ELECTRON_RUN_AS_NODE: '1' } })` 在 E43 仍受支持。

---

## 附录 · 决策时参考的官方 breaking-changes 链

- https://www.electronjs.org/docs/latest/breaking-changes
- https://www.electronjs.org/blog/electron-28-0（sandbox default）
- https://www.electronjs.org/blog/electron-33-0（macOS 12）
- https://www.electronjs.org/blog/electron-35-0（notarization）
