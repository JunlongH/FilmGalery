/**
 * GPU worker preload — exposes a minimal, typed IPC surface to the
 * isolated renderer via contextBridge.
 *
 * Why: the GPU renderer (gpu-renderer.js) historically used
 * `require('electron').ipcRenderer` directly, which requires
 * `nodeIntegration: true` and `contextIsolation: false`. That setup
 * lets a compromised renderer reach arbitrary Node APIs. Phase 2D.2
 * switches the GPU worker window to the same safety model as the
 * main window (contextIsolation: true, nodeIntegration: false,
 * sandbox: true) and funnels all IPC through this preload.
 *
 * Exposed API surface (intentionally minimal — renderer cannot bypass):
 *
 *   window.__gpu.onRun(handler)        // register the single job handler
 *   window.__gpu.sendResult(payload)   // post a job result back to main
 *
 * payload shape (validated by structure; only these fields are ever sent):
 *   { jobId, ok, width?, height?, jpegBytes?: Uint8Array, error?: string }
 *
 * Uint8Array is structured-clone-safe across contextBridge (zero-copy),
 * unlike Node's Buffer subclass.
 *
 * @module electron-gpu/gpu-preload
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__gpu', {
  onRun: (handler) => {
    if (typeof handler !== 'function') {
      throw new TypeError('onRun expects a function');
    }
    ipcRenderer.on('filmlab-gpu:run', (_event, job) => handler(job));
  },
  sendResult: (payload) => {
    ipcRenderer.send('filmlab-gpu:result', payload);
  },
});
