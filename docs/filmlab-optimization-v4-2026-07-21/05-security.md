# 05 · 安全问题（5 项）

4 路 agent 报告 + 1 个专门的安全审查。

---

## HIGH（2 项）

### Auth soft-mode 默认 ON — 命令行未设 AUTH_SOFT_MODE=0

- **server.js:210, electron-main.js:184**
- soft-mode 仅在 `AUTH_SOFT_MODE !== '0'` 时启用（即默认 ON）。electron-main.js spawn 服务器时不设此变量。LAN 内任意设备可无认证访问：
  - 全部 CRUD 端点（film/roll/photo/preset 修改删除）
  - AI config（含 API key 修改）
  - 文件系统 mkdir
  - LUT 上传/删除
  - RAW 文件上传
- 唯一提示是 `X-Auth-Soft-Mode: warn` 响应头。
- **修复**：将默认值改为 OFF（`AUTH_SOFT_MODE=0`），或设置过期机制 + UI 警告。启动时加 `env: { AUTH_SOFT_MODE: '0' }`。

### GPU 隐藏窗口 nodeIntegration:true + contextIsolation:false

- **electron-main.js:677-687**
- GPU 渲染窗口加载 `gpu.html` 时有完整 Node.js 权限。硬件加速 bug / WebGL 驱动漏洞 / 依赖供应链攻击可通过此窗口升级到文件系统访问 + 命令执行。
- 开发团队已写好 `gpu-preload.js` 做安全迁移，但 **electron-main.js 未接线**。
- **修复**：`nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'electron-gpu/gpu-preload.js')`。更新 `gpu.html` 加载 `gpu-renderer.bundle.js`。

---

## MEDIUM（2 项）

### 文件上传类型验证仅限扩展名

- **luts.js:42-43, raw.js:37-38, multer.js（无 fileFilter）**
- 所有上传点仅检查文件扩展名，不验证 magic byte。`malware.cube` 含二进制可过验证。`uploadDefault`（默认照片上传）**无 fileFilter**——任意内容可上传。
- **修复**：对图片用 sharp 验证可解码，对 LUT 验证文本内容结构，对 RAW 验证相机头。

### Film 硬删除无路径约束

- **films.js:60-67**
- `row.thumbPath.replace(/^\/uploads\//, '')` → `path.join(uploadsDir, rel)` → `fs.unlink(filePath)`。若 thumbPath DB 值被篡改为 `../../etc/critical`，不匹配 `/^\/uploads\//` 前缀 → replace 无操作 → `path.join` 可逃逸。
- 同样模式在 films.js:131-134 (soft delete thumb 替换) 和 photos.js:1125 (legacy filename)。
- **修复**：所有 `fs.unlink` 前加 `isPathConfined(uploadsDir, relPath)`。

---

## LOW（1 项）

### Bearer Token 存储于 JavaScript 可读位置

- **server/utils/auth.js:86-87**
- 认证 Token 作为 `Authorization: Bearer` header 传递，经 Electron IPC 存储/检索。有 `unsafe-inline` 的 CSP 存在理论上的 token 泄露风险。
- CSP 整体强悍（`script-src 'self' 'unsafe-inline'`，无 `unsafe-eval`）——风险低。若 CSP 未来加强（移除 `unsafe-inline` 用 nonce-based），token 安全会进一步提升。

---

## 干净项（已验证）

| 类别 | 结果 |
|---|---|
| SQL 注入 | 全部用参数化 `?` 占位符 |
| XSS（服务端） | 无 dangerouslySetInnerHTML / eval / innerHTML |
| XSS（客户端） | 无 dangerouslySetInnerHTML |
| 硬编码秘钥 | 全部在 `.env` 中，源码无 |
| CSRF | Bearer token 无 cookie，CORS credentials:false |
| 关机端点 | loopback-only + auth middleware 前挂载 |
| 路径遍历 — LUT | `resolved.startsWith(LUT_DIR)` |
| 路径遍历 — 文件系统浏览 | `isPathAllowed()` + 敏感路径黑名单 |
| 路径遍历 — Import | `filterAllowedPaths()` → `isPathAllowed()` |
| 文件大小限制 | 全部 multer 有 limits（50MB LUT / 500MB RAW / 10MB film） |
| Express CVE | 4.21.2 — patched |
| Electron CVE | 43.1.1 — current |
| SQLite 版本 | 5.1.7 — current |
| Token 处理 | sha256 hashed → DB；撤销即时失效 |
| Electron Preload 主窗口 | `contextBridge.exposeInMainWorld` + 仅 `ipcRenderer.invoke` |
| Express Static | `isPathConfined` 包裹 `express.static` |
