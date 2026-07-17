# Phase 2D · 平台升级层

> **范围**: #2 Electron 大版本升级 · #3 CRA→Vite 迁移 · #8 GPU worker contextIsolation 重构
> **定位**: 高风险平台升级，需全量回归。每项必须有 feature flag / 独立分支，失败可即时回退。
> **前置**: 2A #10（测试护栏必需）；#2/#8 涉及 native 重编，需 FilmLab/GPU 全量回归。
> **状态**: ⬜ 未开始

---

## 工程一 · #2 Electron 大版本升级（26 → 当前稳定）

### 背景
Electron 26 **已 EOL**，安全 CVE 不再 backport，是隐性定时炸弹。升级需重编全部 native（libraw-native / sharp / sqlite3）并全量回归 FilmLab/GPU 管线。

### 目标
升级到当前稳定大版本，接入 `electron-updater` / `publish`。

### 任务拆解

**版本选定**
- 选当前 stable major（决策时确认最新稳定版 + Node 内嵌版本与项目 `.nvmrc`(20) 兼容）。

**native 重编**
- `@filmgallery/libraw-native`：Phase 0–1 已加 `bin/` 预构建回退，需为新 Electron 的 ABI 重编并补 prebuilt。
- `sharp`：跟随官方 prebuilt 或源编。
- `sqlite3`：需与 #6 DB schema 收敛的窗口函数需求匹配（SQLite ≥ 3.25），重编确认。

**electron-updater / publish**
- 配置 `electron-builder` 的 publish（GitHub release / 自建源）。
- 签名（mac notarization / Windows code signing / Linux）。

**回归**
- FilmLab 渲染（CPU/GPU 双路径）。
- GPU worker（与 #8 联动）。
- 文件导入/导出、批量下载、地图瓦片、地理编码。
- 跨平台：Win/mac/Linux。

### 验收标准
- [ ] Electron 版本为当前 stable major，非 EOL。
- [ ] 三个 native 模块在新 Electron 下加载成功，prebuilt 齐全。
- [ ] `electron-updater` 端到端验证（模拟旧→新升级）。
- [ ] FilmLab/GPU 回归无画质/性能回退（基线对比，依赖 #10）。
- [ ] 三平台打包产物可用。

### 风险
- **native ABI 不兼容**：最高风险，预构建矩阵必须覆盖三平台 × 两架构。
- **API 破坏性变更**：跨多个 major 的 deprecation 累积——逐 major changelog 审查。
- **回退预案**：独立分支 + 保留旧 Electron 构建通道直到验收通过。

---

## 工程二 · #3 CRA → Vite 迁移

### 背景
CRA 已停滞，依赖 CRACO/Terser workaround。`utils/lazyRoutes.js` 在 Phase 0–1 被删（标注「已就绪，迁移后挂载」）——即路由级代码分割基础已备，迁移后即可启用，首屏包预计大幅下降。

### 目标
CRA→Vite，启用真·路由级代码分割，移除 CRACO/Terser workaround。

### 任务拆解

**构建迁移**
- `react-scripts` → `vite` + `@vitejs/plugin-react`。
- 入口 `index.html` 调整为 Vite 约定（模块脚本）。
- 环境变量：`REACT_APP_*` → `VITE_*`（全局替换 + 文档）。
- 移除 CRACO 配置与 Terser 自定义 workaround。

**代码分割**
- 挂载 `lazyRoutes`（Suspense + lazy）。
- 验证懒加载 chunk 按路由切分（`build` 产物分析）。

**Electron 集成**
- dev server 与 Electron 主进程协作（HMR + file:// 产物加载）。
- 生产构建产物路径调整。

### 验收标准
- [ ] `client` 下 `npm run build` 走 Vite，无 CRACO 残留。
- [ ] 首屏包体积分项对比，显著下降（量化指标写入文档）。
- [ ] 路由级 chunk 实际按需加载（网络面板验证）。
- [ ] Electron dev + 生产构建均正常。
- [ ] 关键 UI 回归（依赖 #10 的前端测试）。

### 风险
- **环境变量语义变化**：`VITE_*` 是静态替换，运行时注入需特殊处理（Electron 场景）。
- **依赖 #9 程度低**：可独立进行；但建议 monorepo 收敛后再做以避免重复迁移。

---

## 工程三 · #8 GPU worker contextIsolation 重构

### 背景
`electron-gpu/gpu-renderer.js` 当前在页面内 `require('electron')`，违反 `contextIsolation` 安全模型。Phase 0–1 仅以 `imageUrl` 主机白名单堵 SSRF，本工程是其正式收尾。

### 目标
重写为 preload 暴露 + contextBridge，页面上下文不直接接触 Node/Electron API。

### 任务拆解

**架构重写**
- `gpu-renderer.js` 拆为：① preload 脚本（通过 `contextBridge.exposeInMainWorld` 暴露受控 API）② 渲染层（仅消费白名单 API）。
- 移除页面内 `require('electron')`。

**SSRF 白名单正式化**
- Phase 0–1 的 `imageUrl` 主机白名单（loopback + 配置的 API base 主机）迁入 preload 侧校验，渲染层无法绕过。
- 与 2B #7 的 HTTPS 协议升级联动（白名单加协议维度）。

**安全开关**
- `contextIsolation: true` + `nodeIntegration: false` + `sandbox: true`（评估 sandbox 与 GPU 访问的兼容性）。

### 验收标准
- [ ] 渲染层无 `require('electron')`（grep 验证）。
- [ ] `contextIsolation: true` 启用，`nodeIntegration: false`。
- [ ] SSRF 白名单在 preload 侧强制，渲染层无法绕过（注入测试）。
- [ ] GPU 渲染画质/性能不回退（基线对比，依赖 #10）。

### 风险
- **sandbox vs GPU 访问**：sandbox 可能限制 WebGL/GPU 调用——需评估，必要时受控降级。
- **重写范围大**：必须逐函数迁移并位等价验证，避免 FilmLab 黑屏（见 `docs/FILMLAB-BLACK-SCREEN-DIAGNOSIS.md`）。

---

## 阶段出口条件
1. 三项验收标准达成，三平台回归通过。
2. 每项有独立分支 + 回退通道。
3. Electron 非 EOL；native prebuilt 齐全。
4. `FOLLOWUPS.md` 中 #2、#3、#8 标记 ✅。

> 推进顺序建议：#2（EOL 紧迫）→ #8（#2 回归时一并收尾 SSRF/contextIsolation）→ #3（最后，吃代码分割红利）。
