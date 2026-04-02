---
description: "Use when working on Electron main process, preload scripts, IPC communication, window management, or desktop packaging. Covers API_BASE runtime config and electron-builder."
applyTo: "electron-main.js, electron-preload.js, electron-builder*.json"
---
# Electron 桌面封装规范

## 架构

```
electron-main.js     → 主进程（窗口管理、IPC、服务器启动）
electron-preload.js  → 预加载脚本（暴露 window.__electron）
client/build/        → 渲染进程（React 构建产物）
```

## window.__electron API

preload 脚本暴露的接口：
```javascript
window.__electron = {
  platform,              // 'win32' | 'darwin' | 'linux'
  SERVER_PORT,           // 动态分配的服务端口
  API_BASE,              // 运行时配置的 API 地址

  getServerPort(),       // Promise<number>
  setApiBase(url),       // Promise<void>
  getApiBase(),          // Promise<string>
  setServerMode(mode),   // Promise<void>
  getServerMode(),       // Promise<string>
  minimize(),
  maximize(),
}
```

## API_BASE 数据流

```
Settings UI → electron-main.js (ipcMain) → config.json 持久化
→ electron-preload.js (ipcRenderer) → window.__electron.API_BASE
→ client/src/api/core.js 读取使用
```

## 关键约束

- IPC 通信使用 `ipcMain.handle` / `ipcRenderer.invoke` 模式
- 窗口状态（位置/大小）持久化到 `userData/window-state.json`
- 生产环境 sharp 模块路径需特殊处理（dev vs packed）
- electron-builder 配置：标准版用 `package.json` 的 `build` 字段，client-only 用 `electron-builder-client-only.json`
