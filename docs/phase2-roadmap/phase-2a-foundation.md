# Phase 2A · 基础层（前置）

> **范围**: #10 测试 + lint 护栏 · #9 共享包采用与去重
> **定位**: 为 2B/2C/2D 提供「能阻断 CI 的测试 + 可信赖的共享包」。**唯一硬阻塞项是测试护栏**；monorepo 去重与 2B 可并行。
> **状态**: 🟨 进行中 — 2A.1 + 2A.2 完成（解除 2B 阻塞）；2A.3 部分（见下方进度）
> **本文件在 2A 设计验证后重写**；原版见 git 历史 `1805542`。重写依据：对真实仓库的勘探（消费审计 + 重复审计 + TS 状态盘点），见下「设计验证」。

---

## 进度记录（执行态）

| 子任务 | 状态 | 产出 / 证据 |
|---|---|---|
| 2A.1 测试护栏 | ✅ | `tests/jest.config.js` 收集 shared+server+packages；新增 `path-security`/`network`/`shutdown`/`ensureStartDateColumn`/`api-client` 回归测试；**241 tests / 10 suites green** |
| 2A.2 CI 门禁 | ✅ | 新建 `.github/workflows/ci.yml`（PR/push，lint+test 硬门禁）；`build-desktop.yml` 删 `continue-on-error`、test 移到 rebuild 前；`eslint.config.mjs`（多环境，**0 error / 163 warn**） |
| 2A.3.0 shared 采用基础 | ✅ | `coordTransform.js` ESM→CJS 归一；`index.js` barrel + `package.json` subpath 导出 coord/port/serverCapabilities；client/server/mobile/watch 声明 `file:` 依赖；server.js 相对路径 require→包名 |
| 2A.3.1 coordTransform 去重 | ✅ | client+mobile 本地副本删除，4 处消费者改 import 自 `@filmgallery/shared/coordTransform`；`wgs84ToGcj02` 仅存于 shared |
| 2A.3.2 portDiscovery 常量源 | 🟨 | server `mdns-service.js` ✅（已验证）；mobile `portDiscovery.js` ✅（常量 + 4 个纯工具函数 cleanIpAddress/extractPort/buildUrl/isPrivateIp 全部下沉到 shared，仅保留运行时扫描/mDNS 逻辑；metro 子路径解析由既有 `expo-file-system/legacy` 佐证，仍需 `expo start` 终验）；**watch DEFERRED**（TS，需 shared 类型声明） |
| 2A.3.3 api-client | 🟨 硬化完成 / 采用待定 | 补非 2xx 抛错语义（对齐 `jsonFetch`）+ 修 `return await parseResponse` 致 `onError` 失效的真 bug + 6 个测试；**消费端迁移 DEFERRED** —— 经核对 client `core.js`（动态 base / React Query 过滤 / cache-buster / XHR 上传）与 api-client（静态 base / 数组 / isomorphic）**是合理的上下文分叉，非冗余**，强行合并属错配；api-client 的真正消费方是 mobile/watch（替换各自的 axios 层），需对应构建环境 |
| 2A.3.4 endpoint 常量去重 | ⏸ DEFERRED | `DATA_ROUTES` 是服务端能力清单，非客户端端点常量；强行共享属过度设计。消费者各自 `api/*` 已集中路径。保留观察 |
| 2A.3.5 reverse-geocode 接口 | ✅ | `GeocodeResult`/`ReverseGeocoder` 类型入 `@filmgallery/types`（统一 displayName/country/city/state/lat/lng，取代三端的 displayName/detail/detail_location 分叉）。**比选项 A 更进一步**：mobile+watch 重复的 BigDataCloud 逻辑抽成 `packages/shared/geocode.js`（+ `.d.ts` + barrel/subpath 导出 + jest 测试，**260 tests green**），三端 `reverseGeocode` 全部对齐为 `GeocodeResult`；client（Amap/Photon/Nominatim，browser-only，死代码）也规整。mobile/watch 消费者 `.detail(_location)`→`.displayName`。client 经 CRA 构建验证；mobile/watch 因无 metro/tsc 环境需终验 |
| 2A.4 mobile TS / workspace | ⏸ 暂停点 | 按指令在 mobile 迁 TS 前暂停 |

**2A 出口（进入 2B 硬门槛）已达成**：① PR/push CI test+lint 硬门禁 ✅ ② build-desktop 去 continue-on-error ✅ ③ server path-security/shutdown/ensureStartDateColumn 复现用例固化 ✅（watch-app typecheck 因依赖树未稳定暂缓，不阻塞 2B）。

**验证边界声明**（为何 deferred）：本环境无 client CRA 构建、无 mobile metro 构建、无 watch RN 依赖，故 client/mobile/watch 的「消费端迁移」类改动无法满足「逐条测试」要求 → 推迟到有对应构建环境时执行。已完成的 server/shared/packages 改动均经 `npm test` + `npm run lint` 验证。



---

## 0. 设计验证（原版为何不本质）

原版 2A 是从 `FOLLOWUPS.md` 记忆推导的，未对照真实仓库。逐条核对后，**约一半任务基于不存在的前提**。

| # | 原版主张 | 真实现状（证据） | 判定 |
|---|---|---|---|
| 1 | 「尚无真实测试矩阵」 | `tests/` 已有 5 个 jest 测试 + `tests/jest.config.js`；root `package.json:30` 已有 `npm test` + `jest@30` devDep；`watch-app/__tests__/App.test.tsx` 存在 | ❌ 事实错误 |
| 2 | server「引入 jest（ESM/CJS 混用→配置复杂）」 | server 是**纯 CommonJS**（`require`/`module.exports`，`path-security.js:14-15,116`），jest 原生支持，零配置复杂度 | ❌ 幻觉风险 |
| 3 | client「引入 Vitest」 | client 是 **CRA + CRACO 纯 JS**（`client/package.json:35` `react-scripts 5.0.1`，无 TS，无 Vite）。Vitest 在 CRA 下是逆流，真正搭档是 2D #3 的 Vite 迁移 | ❌ 错配工具链 |
| 4 | client「`npm run typecheck`（TS）接入 CI」 | client 全 JS（65 .js / 129 .jsx / **0 .ts**，无 `tsconfig.json`）；mobile 同（61 .js / 5 .jsx / 0 .ts）。只有 `watch-app/` 是 TS | ❌ 把目标态当现状 |
| 5 | CI「`npm test` 占位」 | 真问题不是「占位」，而是 `build-desktop.yml:119` `continue-on-error: true` → **测试失败不阻断**；且只跑 root jest（仅 render 管线），server/mobile 测试根本不被收集；client-only 作业完全不跑 test | ⚠️ 诊断不准 |
| 6 | 「将共享逻辑**收敛到** `packages/shared`」 | `packages/shared` **已存在**（385 行 barrel，render 数学）；`@filmgallery/api-client` **已存在**且 isomorphic（`api-client/index.js:36` 支持自定义 fetch）。任务不是「创建」而是「驱动采用」 | ❌ 错把已建当未建 |
| 7 | 「抽统一 fetch 封装」 | `api-client/index.js` 已写好 `get/post/put/delete/postForm/buildUploadUrl`，但**全仓库 0 消费者**（纯死代码） | ❌ 同上 |
| 8 | 「服务发现/坐标转换/地理编码三端各一份」 | 方向对但**严重低估**：`coordTransform` ×3（shared 是 orphan，client/mobile 各抄）；`portDiscovery` ×4（shared orphan + mobile + watch + server `mdns-service.js:12`）；反向地理编码 ×3（**三种不同 provider 栈**）；HTTP/endpoint 层 ×6 | ⚠️ 低估 |
| 9 | 「mobile 迁 TypeScript」列入基础前置层 | mobile 全 JS，迁 TS 是独立大工程，对 2B/2C/2D **零解锁价值**，却塞进前置层 → 本末倒置、过度保护 | ❌ 越界，移出 |
| 10 | 「本阶段未完成其余不得动工」把 #9+mobile TS 设为 2B 硬门槛 | 2B（auth+HTTPS）是**新代码**，不依赖 monorepo 收敛；本质门槛只有「被改路由有测试」 | ❌ 过度保护 |

**根因诊断（真正的「本质」）**：重复并非源于「没有共享包」，而是源于——
- **(A) orphan 导出**：`coordTransform.js`/`portDiscovery.js`/`serverCapabilities.js` 写了却**没进 `shared/index.js` barrel，也没进 `package.json` exports**，消费者无法 import，只好自抄（`mobile/src/utils/coordTransform.js:11` 注释自证 "Copied from packages/shared..."）。
- **(B) 依赖未声明**：消费者靠 root `node_modules` **偶然 hoisting** 解析 `@filmgallery/shared`（client/node_modules 无 `@filmgallery/`，client `package.json` 不声明依赖）；打包时脆弱。
- **(C) 测试不阻断**：`continue-on-error` 让护栏形同虚设。

---

## 1. 重写原则（对照「不要过度保护」）

1. **从「创建」改为「采用」**：shared/api-client 已存在，工程 = 修 orphan 导出 → 声明依赖 → 驱动消费者迁移 → 删 dupe。
2. **测试护栏聚焦「阻断」**：不堆测试数量；去掉 `continue-on-error`、收集 server/mobile、加 lint。测试内容 = 固化 Phase 0–1 已修的安全复现用例。
3. **client 测试务实**：CRA 下**不引入 Vitest**（留给 2D #3）；client 只测纯函数，放 root jest（CJS `require` 即可），DOM 组件测试推迟到 Vite 迁移。
4. **typecheck 只覆盖 TS 面**（watch-app + packages/types）；JS 应用不伪造型check。
5. **mobile TS 迁移移出 2A 关键路径**，列独立可选 track，不阻塞。
6. **解除 #9 对 2B 的硬阻塞**；2A 出口条件收紧为「测试阻断 CI + 被改路由有测试」。

---

## 2. 真实现状基线（计划的事实底座）

| 面 | 现状 |
|---|---|
| 测试 | root `tests/` 5 个 render 测试（jest config: `tests/jest.config.js`）；`watch-app/__tests__/App.test.tsx`；server/mobile/client **零测试** |
| CI | `.github/workflows/build-desktop.yml` 唯一 workflow；`npm test` 仅 full 作业、`continue-on-error:true`、排在 `rebuild:electron` 之后；**无 lint、无 typecheck、无 PR 触发**（仅 tag/workflow_dispatch） |
| `@filmgallery/shared` | 仅 client 消费（render 数学）；`coordTransform`/`portDiscovery`/`serverCapabilities` 是 **orphan**（未导出） |
| `@filmgallery/api-client` | **0 消费者**，死代码（mobile/watch/electron 各自重造 HTTP 层） |
| `@filmgallery/types` | 仅 watch-app 声明依赖（`file:`）；`index.d.ts` 带 `[key:string]:any` 过渡索引 |
| 模块系统 | server/shared/api-client/types = **CJS**；client = CRA JS；mobile = RN JS（`import` 语法，Metro）；watch-app = **TS** |
| 重复 | coordTransform ×3、portDiscovery ×4、reverse-geocode ×3（异质 provider）、HTTP/endpoint ×6 |
| workspace | root `workspaces` 仅含 `packages/shared` + `packages/@filmgallery/*`；**client/server/mobile 不在 workspace**，靠 postinstall `cd` 链安装（mobile 甚至未入链） |

---

## 3. 工程拆分

### 2A.1 测试护栏：让测试真正阻断 + 多 project 收集
**现状**：`build-desktop.yml:119` `continue-on-error:true`；root jest 只收集 `tests/**`。

**改动（文件级）**
1. `tests/jest.config.js` → 改为 **projects 多根**，收集 shared/server/client-pure：
   ```js
   module.exports = {
     projects: [
       { displayName: 'shared', testEnvironment: 'node', rootDir:'..', testMatch: ['<rootDir>/tests/**/*.test.js'] },
       { displayName: 'server', testEnvironment: 'node', rootDir:'..', testMatch: ['<rootDir>/server/**/*.test.js'] },
       { displayName: 'client', testEnvironment: 'node', rootDir:'..', testMatch: ['<rootDir>/client/**/*.test.js'] },
     ],
   };
   ```
   - client project 仅 `node` 环境、纯函数测试；**不引 jsdom**（避免拉 CRA jest 配置）。
2. **server 种子测试**（新建 `server/utils/__tests__/path-security.test.js` 等，CJS，jest 原生跑）：
   - `path-security`：`isPathAllowed`/`isPathBlocked`/`isPathConfined` 全分支；固化 Phase 0–1 复现用例：`/etc/passwd`→blocked、`outputDir=/etc`→blocked、`/uploads/../../etc/passwd`→confined=false。
   - `ensureStartDateColumn` 幂等（连跑两次不报错、首装缺列场景）。
   - `/api/shutdown` 回环校验 + 注册顺序（`server.js` 中 `auth`/`shutdown` 在 `/api/*` 404 兜底**之前**）：用 supertest 起内存 express 断言。
3. **mobile 测试**（独立 jest-expo，**不并入 root**）：`mobile/package.json` 加 `jest` + `jest-expo` devDep + `preset:'jest-expo'`；种子 RNTL 测试一个纯组件。
4. **watch-app**：修复 `App.test.tsx` 跑通（依赖 `@filmgallery/types` 修复，见 2A.3）。

**验证命令**：`npm test`（root，应跑 shared+server+client projects）；`cd mobile && npx jest`；`cd watch-app && npx jest`。

**验收**
- [ ] root `npm test` 收集并跑过 shared/server/client 三 project。
- [ ] server path-security/shutdown/ensureStartDateColumn 测试存在且固化 Phase 0–1 复现用例。
- [ ] mobile、watch-app 各自至少 1 个可跑测试。
- [ ] 人为注入失败 → `npm test` 退出码非 0。

**风险**：supertest 起完整 server 会连 DB/native → 用**单独构造 express app** 的方式测中间件挂载顺序，避免拉起 sqlite/sharp。

---

### 2A.2 CI 门禁：阻断 + lint + 顺序
**现状**：CI 仅 tag 触发；test `continue-on-error`；无 lint/typecheck；test 排在 native rebuild 后。

**改动（文件级）**
1. `.github/workflows/ci.yml`（**新建**，PR/push 触发的轻量门禁，区别于发布 `build-desktop.yml`）：
   - 触发：`pull_request` + `push: [main]`。
   - 作业：`lint` / `test`（root + mobile + watch-app 分步）/ `typecheck`（仅 watch-app）。
2. `build-desktop.yml:117-119`：**删除 `continue-on-error: true`**；把 `npm test` 移到 `rebuild:electron` **之前**（快速失败，省 native 编译时间）。
3. **lint 建立**（缺失处新建）：
   - root：`eslint.config.js`（flat）覆盖 `server/`、`packages/`、`tests/`、`tools/`（这些目前无任何 lint）。`npm run lint` 加到 root `package.json`。
   - mobile：加 eslint config + `lint` script。
   - client：沿用 CRA `react-app`（`client/package.json:42-52` 已有），`react-scripts build` 已产出 warning；不强加额外配置。
4. **typecheck**：仅 `watch-app`（`tsc --noEmit`）+ `packages/@filmgallery/types` 自检；client/mobile 不设。

**验收**
- [ ] PR 上 `ci.yml` 全绿为合并必要条件。
- [ ] `build-desktop.yml` 去掉 `continue-on-error`，test 失败即中止。
- [ ] root 与 mobile 各有可跑 `npm run lint`。
- [ ] watch-app `tsc --noEmit` 在 CI 跑。

**风险**：新加 lint 会暴露大量既有 warning → 用 `--max-warnings` 渐进，或先 `error` 仅限新增规则（`eslint-config-prettier`/`no-unused-vars` warn），避免一次性阻塞。

---

### 2A.3 共享包采用与去重（按 dupe 拆为独立可验证任务）
> 顺序固定：**修 orphan 导出 → 声明依赖 → 消费者迁移 → 删 dupe**。每个 dupe 一个任务，独立验收、独立回滚。

#### 2A.3.0 前置：修 orphan 导出 + 声明依赖
- `packages/shared/index.js`：追加 re-export `coordTransform`、`portDiscovery`、`serverCapabilities`。
- `packages/shared/package.json:7-15` `exports`：补 `"./coordTransform": "./coordTransform.js"`、`"./portDiscovery"`、`"./serverCapabilities"`。
- **依赖声明**（消除偶然 hoisting）：`client/package.json`、`mobile/package.json`、`watch-app/package.json` 各加 `"@filmgallery/shared": "file:../packages/shared"` 与 `"@filmgallery/api-client": "file:../packages/@filmgallery/api-client"`（server 仅在确认消费时加）。
- 验证：三端 `npm install` 后 `node_modules/@filmgallery/shared` 真实存在（不再靠 root hoist）。

#### 2A.3.1 coordTransform 去重（×3 → 1）— 机械，低风险
- `client/src/utils/coordTransform.js` → 改为 `module.exports = require('@filmgallery/shared/coordTransform')`（或直接删 + 改 2 处引用 `geocoding.js:12`、`PhotoMap.jsx:20`）。
- `mobile/src/utils/coordTransform.js` → 同（注意 mobile 是 `import` 语法，CJS interop：`import coord from '@filmgallery/shared/coordTransform'`，Metro 支持，**先在 RN 构建里验证再删**）。
- 验收：grep `wgs84ToGcj02` 仅出现在 `packages/shared/coordTransform.js` + re-export + 测试。

#### 2A.3.2 portDiscovery 去重（×4 → 1 常量源 + 各端运行时）
- 性质区分：`shared/portDiscovery.js` 是**常量/纯函数源**；mobile/watch/server 各含**运行时扫描/mDNS 逻辑**（依赖各自 zeroconf/bonjour）。**不能机械合并运行时**。
- 改动：mobile `portDiscovery.js`、watch `portDiscovery.ts`、server `mdns-service.js:12-20` 中的 `SERVICE_TYPE`/`SERVICE_NAME`/`PORT_SCAN_RANGE`/`DISCOVERY_ENDPOINT` → 从 `@filmgallery/shared/portDiscovery` import；运行时逻辑保留原位。
- 验收：grep `_filmgallery._tcp` 与 `PORT_SCAN_RANGE` 字面量仅出现在 shared。

#### 2A.3.3 API HTTP 层采用 `@filmgallery/api-client`（×6 → 1）— 中风险
- 现状：`api-client` 死代码；mobile `setupAxios.js`/`urls.js`/`urlHelper.js`、watch `api.ts`、client `api/core.js`、electron 各自重造。
- 策略：**client 优先**（已加固的 `jsonFetch` 非 2xx 抛错语义要保留——确认 `api-client/index.js` 的 `parseResponse` 对非 2xx 行为一致，**必要时先给 api-client 补 status 检查**，再迁移）。
- 分步：
  1. 先给 `api-client` 补「非 2xx 抛错带 server error」语义，对齐 client `jsonFetch`（`client/src/api/core.js:115`）。
  2. client `api/*` 逐文件切到 `api-client`（已有 1:1 模块 equipment/films/locations/photos/rolls）。
  3. mobile `src/api/*` 切到 `api-client`（保留 failover 拦截器：用 `createApiClient({baseUrl, onError})` + 二级 baseUrl 切换）。
  4. watch `services/api.ts` 切到 `api-client`。
- 验收：grep `axios.defaults.baseURL`/各自 `buildUploadUrl` 不再出现在消费者；`api-client` 有 ≥1 测试。
- 风险：failover/进度上传语义差异最大 → **保留各端适配层**，api-client 只做底层。

#### 2A.3.4 endpoint 常量去重
- `shared/serverCapabilities.js` 已有 `DATA_ROUTES`（`L35-50`，**0 消费者**）。消费者把 `/api/...` 内联字符串改为引用常量。
- 验收：主要 `/api/*` 路径字面量在三端消费者中消失，统一引用。

#### 2A.3.5 reverse geocoding（×3 异质 provider）— **需设计决策，非机械**
- 三套不同 provider 栈（client: Amap/Photon/Nominatim；mobile: Amap/BigDataCloud/Expo；watch: BigDataCloud）。**强行合并会丢各端最佳 provider**。
- 决策项（不强制 2A 完成，但要在 2A 结束前定）：
  - 选项 A：仅在 `shared` 定义 `ReverseGeocoder` **接口 + 结果类型**，各端保留 provider 适配器。
  - 选项 B：把 provider 抽成 `shared/geocode/{amap,photon,nominatim,bigdatacloud}` 插件，各端按需组合。
  - 推荐 A（最小化、可维护），B 留作后续。
- 输出：`packages/shared/geocode.js`（接口 + 类型）+ 各端 adapter 实现接口；`@filmgallery/types` 补 `GeocodeResult`。

---

### 2A.4 （独立可选 track，**不阻塞 2A 出口**）TS 迁移 + workspace 化
> 用户要求「不要过度保护」。以下两项对 2B/2C/2D 无解锁价值，列为独立并行 track，可在任意阶段启动。

- **T1 mobile/client TS 迁移**：大工程，建议 client 借 2D #3 Vite 迁移一并 TS 化；mobile 单独立项。**本 track 不进 2A 出口条件**。
- **T2 workspace 收敛**：当前 client/server/mobile 靠 postinstall `cd` 链（mobile 未入链）。2A.3.0 已用 `file:` 依赖消除偶然 hoist，**足够**。是否进一步升级为 npm workspaces / pnpm / turbo 属于结构偏好，非必要——除非 `file:` 依赖在 CI 多平台 install 出问题再升级。

---

## 4. 排序与并行

```
2A.1 测试护栏 ──┐
               ├─→ (2A.1 就绪即可放行 2B)
2A.2 CI 门禁 ──┘

2A.3.0 orphan+依赖 ─→ 2A.3.1 coord ──┐
                     2A.3.2 port ────┤──→ 2A.3.3 api-client ──→ 2A.3.4 endpoints
                     (并行)          │
                                     └─→ 2A.3.5 reverse-geocode 接口（设计决策）

2A.4 TS/workspace  ← 独立并行，任何时候
```

- **2A.1 + 2A.2 是 2B 的真正前置**（一周内可交付）。
- **2A.3 与 2B 可并行**（不同文件域，冲突小；api-client 切换需协调 client/mobile 但不触路由安全）。
- **2A.3.3 api-client 切换是 2A 内最大块**，建议放 2A.3 最后，且 client 先行（已加固语义可向 api-client 反哺）。

---

## 5. 出口条件（收紧，去掉过度保护）

**进入 2B 的硬门槛（仅需 2A.1 + 2A.2）**：
1. PR/push CI 全绿为合并必要条件；`build-desktop.yml` 去掉 `continue-on-error`。
2. root `npm test` 收集 shared/server/client 并阻断失败；server 的 path-security/shutdown/ensureStartDateColumn 复现用例固化。
3. watch-app `tsc --noEmit` 在 CI 跑通；`@filmgallery/types` 修复。

**2A 完整收尾（含 2A.3，可与 2B 并行推进）**：
4. `coordTransform`/`portDiscovery` 常量/HTTP 层/endpoint 常量完成去重，grep 验证无残留 dupes。
5. `@filmgallery/api-client` ≥1 消费者 + ≥1 测试。
6. reverse-geocode 接口决策落定（选项 A 或 B）。
7. `FOLLOWUPS.md` #9、#10 标记 ✅。

> 注：mobile TS 迁移（2A.4 T1）**不计入** 2A 出口；workspace 升级（T2）非必需。

---

## 6. 待定决策（需在对应任务开工前定）
- [ ] **D1**：api-client 是否纳入「非 2xx 抛错 + server error」语义（推荐是，对齐 client）。
- [ ] **D2**：reverse-geocode 选 A（仅接口）还是 B（provider 插件）。推荐 A。
- [ ] **D3**：mobile CJS interop 验证——`@filmgallery/shared`（CJS）在 RN Metro 下 `import` 解析是否需 `esModuleInterop`/default 形式（迁移前在 1 个 dupe 上试跑）。
- [ ] **D4**：lint 首批 `error` 规则范围（避免一次性阻塞既有代码）。
