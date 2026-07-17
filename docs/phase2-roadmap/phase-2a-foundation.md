# Phase 2A · 基础层（前置）

> **范围**: #10 测试 + lint/typecheck 护栏 · #9 monorepo 收敛
> **定位**: 阻塞 2B/2C/2D 的前置层。本阶段未完成，其余阶段不得动工。
> **状态**: ⬜ 未开始

---

## 工程一 · #10 测试与 lint/typecheck 护栏

### 背景
FOLLOWUPS 显式声明：错误处理统一、像素管线、DB schema、Electron 升级等**均建议「在有测试后做」**。Phase 0–1 仅在 `build-desktop.yml` full 作业补了 `npm test` 占位，尚无真实测试矩阵。

### 目标
为三端建立可运行、可阻断 CI 的最小测试集 + 统一 lint/typecheck 门禁。

### 任务拆解

**前端（client）**
- 引入 **Vitest**（与 2D #3 Vite 迁移天然兼容）。
- 种子测试覆盖：`utils/path-security` 对应前端镜像（如有）、`jsonFetch` 非 2xx 抛错路径、关键 UI 组件纯函数（如 curve/LUT 构建）。
- `npm run typecheck`（TypeScript）接入 CI。

**后端（server）**
- 引入 **jest**（优先 `--experimental-vm-modules` 支持 ESM，或迁 CommonJS 测试入口）。
- 种子测试覆盖：
  - `utils/path-security.js`：`isPathAllowed`/`isPathBlocked`/`isPathConfined` 全分支（含 `/etc/passwd`、`outputDir=/etc`、`/uploads/../../etc/passwd` 复现用例固化）。
  - `/api/shutdown` 回环校验 + 注册顺序（不被 `/api/*` 404 兜底拦截）。
  - `ensureStartDateColumn` 幂等性。
  - helmet / rate-limit 中间件挂载顺序。

**移动端（mobile）**
- 引入 **React Native Testing Library (RNTL)** 种子测试。
- 迁 TypeScript（与 #9 联动），消费 `@filmgallery/types`。

**CI 门禁**
- `.github/workflows/` 所有 build 作业强制 `npm test` + `npm run lint` + `npm run typecheck`，失败即阻断合并。
- PR 模板加入测试/lint 检查项。

### 验收标准
- [ ] 三端各至少 1 个可运行测试套件，CI 上真实执行。
- [ ] `path-security.js` 测试覆盖所有 Phase 0–1 修复的复现用例。
- [ ] lint + typecheck 在 CI 中作为必需检查。
- [ ] README/DEVELOPER-MANUAL 补「如何本地跑测试」一节。

### 风险
- 后端 ESM/CJS 混用可能导致 jest 配置复杂——必要时先建独立测试入口文件规避。

---

## 工程二 · #9 monorepo 收敛

### 背景
服务发现、坐标转换、反向地理编码、API 端点在三端（client/mobile/watch）各有一份实现，漂移风险高。`@filmgallery/types` 在 Phase 0–1 才补上桩。

### 目标
将共享逻辑收敛到 `packages/shared` + `@filmgallery/api-client`，三端共用；mobile 迁 TS。

### 任务拆解

**packages/shared 收口范围**
- 服务发现（mDNS/Zeroconf 服务名、端口常量）。
- 坐标转换（GPS 度/分秒/EXIF 互转）。
- 反向地理编码（端点、缓存策略）。
- API 端点常量与路径模板。

**packages/api-client**
- 抽出统一 `fetch` 封装（复用前端已加固的 `jsonFetch` 非 2xx 抛错语义）。
- 三端共享类型来自 `@filmgallery/types`。

**mobile 迁 TS**
- 借 Phase 0–1 删除的 ~1500 行死代码后的干净基线迁 TS。
- 替换裸 `locationService` 为 `@filmgallery/api-client`。

### 验收标准
- [ ] `packages/shared` 导出上述 4 类逻辑，三端不再有重复实现（grep 验证）。
- [ ] `@filmgallery/api-client` 被三端实际 import。
- [ ] mobile `tsconfig.json` 存在且 `npm run typecheck` 通过。
- [ ] 无运行时回归（依赖 2A #10 的测试兜底）。

### 风险
- mobile 迁 TS 体量大，可拆为「先接入 shared/api-client（保持 JS）」+「后逐文件迁 TS」两步。

---

## 阶段出口条件（进入 2B 的硬门槛）
1. 三端 CI 上 `test + lint + typecheck` 全绿且为必需检查。
2. `packages/shared` + `@filmgallery/api-client` 可被消费。
3. `FOLLOWUPS.md` 中 #9、#10 标记 ✅。
