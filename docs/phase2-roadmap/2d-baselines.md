# Phase 2D · 基线与回归对比

> **采集时点**: 2026-07-20，2C 完成（449 tests green）后、2D 开工前。
> **环境**: Linux x64，Node `v22.16.0`（与 Electron 43 内嵌 Node 对齐），系统原 Node 18.19 已切到 22。
> **方法**: 每项 5 次取样（除非另注），记录 p50/p95；最终每工程结束后回写「基线 / 改写后 / 增益%」。

---

## 0. 系统基线（决策时点）

| 项 | 决策时值 | 备注 |
|---|---|---|
| Electron stable major | `43.1.1` | 当前 stable；Node 22.16 内嵌 |
| Electron 43 engines.node | `>= 22.12.0` | 项目 `.nvmrc` 同步升 `20 → 22` |
| Electron 42 engines.node | `>= 22.12.0` | 42+ 强制 Node 22 |
| Electron 41 engines.node | `>= 12.20.55` | 41 是支持 Node 20 的最后稳定 major（已被 42 取代） |
| electron-builder stable | `26.15.3` | 当前用 24.6.0；需协同升级 |
| @electron/rebuild stable | `4.2.0` | 当前用 3.7.1 |
| Electron 维护窗 | latest 3 major（43/42/41）| 40 及以下 EOL |

**目标**：Electron `43.1.1`（最新 stable，Node 22 强制对齐）。

---

## 1. 构建基线（CRA + Electron 26）

### 1.1 前端 bundle 体积（`client/build/`）

| 项 | 值 |
|---|---|
| main bundle | `main.21f64764.js` = **693,819 B** (678 KB) |
| main css | `main.ed0d797d.css` = **321,861 B** (314 KB) |
| chunk 数量 | **42 个** `.chunk.js` |
| 最大 chunk | `852.4644afb3.chunk.js` = **1,987,224 B** (1.9 MB；three.js+globe 路由) |
| 第二大 chunk | `245.61a09fe7.chunk.js` = **390,321 B** (381 KB) |
| 总产物 `client/build/` | **5.0 MB** |

**结论**：路由级代码分割已生效；首屏仅加载 main+css ≈ 992 KB（gzip 后约 320 KB）。

### 1.2 三平台 packaged 产物体积

> 待 2D.1.5 三平台本地打包后回填（Linux 本机可测；Win/mac 在 CI 测）。

| 平台 | 基线（E26） | 改写后（E43） | 增益% |
|---|---|---|---|
| Linux AppImage | _TBD_ | _TBD_ | _TBD_ |
| Windows nsis exe | _TBD (CI)_ | _TBD (CI)_ | _TBD_ |
| macOS dmg | _TBD (CI)_ | _TBD (CI)_ | _TBD_ |

---

## 2. 测试基线（2C 输出）

| 项 | 值 |
|---|---|
| root jest 测试数 | **449 tests / 41 suites** |
| 通过率 | 449/449 ✅ |
| 耗时（cold） | ~21s（首次）/ ~16s（cache hit） |
| 测试运行时 Node | `v22.16.0`（2D 切换后）；`v18.19.1` 下亦绿（旧基线） |

**关键回归集**（必跑）：
- `tests/01..06` shader/uniform/pipeline/algorithm/integration/contracts
- `server/routes/__tests__/*` 13 路由错误路径
- `server/services/__tests__/render-worker-pool.test.js`（worker ABI）
- `server/services/__tests__/roll-service.test.js`（DB 窗口函数）
- `server/middleware/__tests__/error-handler.test.js` + `mount-order.test.js`

---

## 3. 启动时基线

> 待 2D.1.5 后回填。当前仅在 dev 模式下估算：
> - `dev:full`（server + client + electron）从命令到窗口 ready ≈ **15–25s**（取决于 npm install 状态）。
> - 生产 packaged 启动 ≈ **2–5s**（待测）。

| 项 | 基线（E26） | 改写后（E43） | 增益% |
|---|---|---|---|
| dev `dev:full` 到 ready | _TBD_ | _TBD_ | _TBD_ |
| prod packaged 到 ready | _TBD_ | _TBD_ | _TBD_ |

---

## 4. GPU 渲染基线

> 待 2D.2.3 后回填。当前样本集（5 张）：

| 样本 | 类型 | 大小 | 备注 |
|---|---|---|---|
| S1 | JPEG 8-bit | _TBD_ | 普通照片基线 |
| S2 | TIFF 16-bit | _TBD_ | 16-bit 管线 |
| S3 | RW2 170MP | _TBD_ | 大尺寸 stress |
| S4 | RGBA raw pixels | _TBD_ | 直通路径 |
| S5 | PNG | _TBD_ | 兼容性 |

**位等价验收**：每个样本经 #8 重构后输出 JPEG PSNR ≥ 99 dB（自对比，重构前后比对）。

---

## 5. CI 基线

| workflow | 时长（基线） | 改写后 | 备注 |
|---|---|---|---|
| `ci.yml` (lint + test) | _TBD_ | _TBD_ | ubuntu-latest |
| `build-desktop.yml` (Linux) | _TBD_ | _TBD_ | 含 libraw rebuild |
| `build-desktop.yml` (Win) | _TBD_ | _TBD_ | windows-2022 |
| `build-desktop.yml` (mac) | _TBD_ | _TBD_ | macos-latest |

---

## 6. 2D 工程结束回写

| 工程 | main bundle | 测试数 | GPU PSNR | 备注 |
|---|---|---|---|---|
| 2D.1 #2 Electron 43 | _TBD_ | _TBD_ | _TBD_ | native ABI 全部重编 |
| 2D.2 #8 GPU 重构 | _TBD_ | _TBD_ | _TBD_ | contextBridge |
| 2D.3 #3 Vite | _TBD_ | _TBD_ | n/a | 仅前端构建工具切换 |

---

## 附录 · 取样方法

- 体积：`ls -la` 单次（确定性，不需多次取样）。
- 耗时：5 次取样去 max/min 后取中位数（p50）与 95 百分位（p95）。
- PSNR：`sharp` 双图对比，`{ mean: ..., min: ... }` 形式记录 mean。
- 所有 TBD 项在对应工程结束后即时回填，并提交单独 commit 标记 `[2d-baseline]`。
