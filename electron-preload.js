// electron-preload.js
const { contextBridge, ipcRenderer, shell } = require('electron');

// 暴露安全的 API 到前端（如果需要）
contextBridge.exposeInMainWorld('__electron', {
  platform: process.platform,
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  // Settings/config
  getConfig: () => ipcRenderer.invoke('config-get'),
  pickUploadsRoot: () => ipcRenderer.invoke('pick-uploads-root'),
  setUploadsRoot: (dir) => ipcRenderer.invoke('config-set-uploads-root', dir),
  pickDataRoot: () => ipcRenderer.invoke('pick-data-root'),
  setDataRoot: (dir) => ipcRenderer.invoke('config-set-data-root', dir),
  // FilmLab GPU processing (offscreen worker)
  filmlabGpuProcess: (payload) => ipcRenderer.invoke('filmlab-gpu:process', payload),
  filmLabSaveAs: async ({ blob, defaultName }) => {
    try {
      if (!blob) return { ok:false, error:'no_blob' };
      const arrBuf = await blob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(arrBuf));
      return ipcRenderer.invoke('filmlab-save-as', { defaultName, bytes });
    } catch (e) {
      return { ok:false, error: e && e.message };
    }
  },
  showInFolder: (filePath) => { try { if (filePath) shell.showItemInFolder(filePath); } catch(_){} }
});