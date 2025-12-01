const { app, BrowserWindow, dialog, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');

const isDev = process.env.ELECTRON_DEV === 'true' || !app.isPackaged;

// Ensure Windows uses our packaged icon for taskbar/start shortcuts
// Must be set before any BrowserWindow is created
try { app.setAppUserModelId('com.yourorg.filmgallery'); } catch (_) {}
let mainWindow = null;
let tray = null;
let isQuitting = false;
let serverProcess = null;
let appConfig = {};
let gpuWindow = null;
let gpuJobs = new Map();

// Helper to load sharp reliably in both Dev and Prod environments
const getSharp = () => {
  const candidates = [
    'sharp', // Standard resolution
    path.join(__dirname, 'server', 'node_modules', 'sharp'), // Dev: sibling server folder
    path.join(process.resourcesPath, 'server', 'node_modules', 'sharp'), // Prod: resources/server
    path.join(app.getAppPath(), 'server', 'node_modules', 'sharp') // Fallback
  ];
  
  for (const p of candidates) {
    try {
      const s = require(p);
      if (s) {
        s.cache(false); // Disable cache to prevent file locking
        return s;
      }
    } catch (e) {
      // continue
    }
  }
  return null;
};

const LOG = (...args) => {
  try {
    const logDir = app.getPath ? app.getPath('userData') : __dirname;
    const p = path.join(logDir, 'electron-main.log');
    fs.appendFileSync(p, `[${new Date().toISOString()}] ${args.join(' ')}\n`);
  } catch (e) {
    // ignore
  }
};

function startServer() {
  const serverDir = path.join(process.resourcesPath || __dirname, 'server');
  LOG('startServer, serverDir=', serverDir);

  const serverEntry = path.join(serverDir, 'server.js');
  if (!fs.existsSync(serverEntry)) {
    LOG('server entry not found', serverEntry);
    return;
  }

  const outLog = path.join(app.getPath('userData'), 'server-out.log');
  const errLog = path.join(app.getPath('userData'), 'server-err.log');
  LOG('server logs', outLog, errLog);

  // Always use Electron's embedded Node to avoid native module ABI mismatch
  try {
    const cmd = process.execPath;
    const args = [serverEntry];
    LOG('attempt spawn', cmd, args.join(' '));
    const env = {
      ...process.env,
      USER_DATA: app.getPath('userData'),
      DATA_ROOT: (appConfig && appConfig.dataRoot) ? appConfig.dataRoot : undefined,
      UPLOADS_ROOT: (appConfig && appConfig.uploadsRoot) ? appConfig.uploadsRoot : undefined,
      ELECTRON_RUN_AS_NODE: '1'
    };
    serverProcess = spawn(cmd, args, {
      cwd: serverDir,
      shell: false,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    serverProcess.stdout && serverProcess.stdout.on('data', d => fs.appendFileSync(outLog, d));
    serverProcess.stderr && serverProcess.stderr.on('data', d => fs.appendFileSync(errLog, d));
    serverProcess.on('error', e => {
      LOG('server spawn error', cmd, e && e.message);
      fs.appendFileSync(errLog, `spawn error ${e && e.message}\n`);
    });
    serverProcess.on('exit', (code, sig) => {
      LOG('server process exit', code, sig);
      fs.appendFileSync(errLog, `process exit ${code} ${sig}\n`);
      serverProcess = null;
    });
    LOG('spawned, pid=', serverProcess.pid);
    fs.appendFileSync(outLog, `spawned ${cmd} ${args.join(' ')} pid=${serverProcess.pid}\n`);
  } catch (e) {
    LOG('Failed to start server', e && e.message);
    fs.appendFileSync(errLog, `Failed to start server ${e && e.message}\n`);
  }
}



function stopServer() {
  return new Promise((resolve) => {
    if (!serverProcess || serverProcess.killed) {
      return resolve();
    }
    
    LOG('[stopServer] Requesting graceful shutdown...');
    
    // Try graceful shutdown via HTTP endpoint
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4000,
      path: '/api/shutdown',
      method: 'POST',
      timeout: 2000
    }, (res) => {
      LOG('[stopServer] Shutdown endpoint responded:', res.statusCode);
      res.resume(); // consume response
      
      // Wait for process to exit naturally
      const gracefulTimeout = setTimeout(() => {
        LOG('[stopServer] Graceful timeout, force killing...');
        if (serverProcess && !serverProcess.killed) {
          try { serverProcess.kill('SIGKILL'); } catch (e) {}
        }
        serverProcess = null;
        resolve();
      }, 3000);
      
      if (serverProcess) {
        serverProcess.once('exit', () => {
          clearTimeout(gracefulTimeout);
          LOG('[stopServer] Server process exited gracefully');
          serverProcess = null;
          resolve();
        });
      }
    });
    
    req.on('error', (e) => {
      LOG('[stopServer] Shutdown endpoint error:', e.message, '- force killing');
      if (serverProcess && !serverProcess.killed) {
        try { serverProcess.kill('SIGKILL'); } catch (e) {}
      }
      serverProcess = null;
      resolve();
    });
    
    req.end();
  });
}

function waitForUrl(url, timeout = 10000, interval = 300) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function check() {
      const req = http.get(url, res => {
        res.destroy();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(check, interval);
      });
      req.setTimeout(2000, () => { req.destroy(); if (Date.now() - start > timeout) return reject(new Error('timeout')); setTimeout(check, interval); });
    })();
  });
}

function createTray() {
  if (tray) return tray;
  try {
    const iconCandidates = [
      // buildResources (electron-builder) copies icons to buildResources dir (assets) or build
      path.join(process.resourcesPath || __dirname, 'assets', 'icon.png'),
      path.join(process.resourcesPath || __dirname, 'build', 'icon.png'),
      path.join(process.resourcesPath || __dirname, 'app.asar.unpacked', 'assets', 'icon.png'),
      path.join(__dirname, 'assets', 'icon.png'),
      path.join(__dirname, 'build', 'icon.png')
    ];
    const iconPath = iconCandidates.find(p => fs.existsSync(p));
    let image = undefined;
    if (iconPath) {
      image = nativeImage.createFromPath(iconPath);
      // On Windows tray prefers a small (16x16 or 24x24) icon; downscale if large
      try {
        const size = image.getSize();
        if (size.width > 64) {
          image = image.resize({ width: 24, height: 24 });
        } else if (size.width > 32) {
          image = image.resize({ width: 24, height: 24 });
        } else if (size.width > 24) {
          image = image.resize({ width: 24, height: 24 });
        }
      } catch (e) {
        LOG('tray resize error', e && e.message);
      }
    } else {
      LOG('Tray icon not found. Checked:', iconCandidates.join(' | '));
      // Fallback: embed a small base64 PNG
      const base64 = 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAHUlEQVRIS+3OIQEAAAgDINc/9K3hKBk0MBm0MBm0MBm0MJvgAqJBA4TGAAAAAElFTkSuQmCC';
      image = nativeImage.createFromData(Buffer.from(base64, 'base64')).resize({ width:24, height:24 });
    }
    tray = new Tray(image || nativeImage.createEmpty());
    const contextMenu = Menu.buildFromTemplate([
      { label: '显示窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { label: '重启后端', click: async () => { await stopServer(); startServer(); } },
      { type: 'separator' },
      { label: '退出', click: async () => { isQuitting = true; await stopServer(); app.quit(); } }
    ]);
    tray.setToolTip('Film Gallery');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => { if (mainWindow) { mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(); } });
    LOG('Tray created using iconPath=', iconPath || 'none');
  } catch (e) {
    LOG('createTray error', e && e.message);
  }
  return tray;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    // titleBarStyle: 'hidden', // Removed to prevent conflict with frame: false on Windows
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js'),
    },
  });

  ipcMain.handle('window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  // Change close to hide (minimize-to-tray behavior)
  ipcMain.handle('window-close', () => {
    if (mainWindow) {
      mainWindow.hide();
    }
  });
  // Save As dialog for FilmLab
  ipcMain.handle('filmlab-save-as', async (_e, { defaultName, bytes, filters }) => {
    try {
      const res = await dialog.showSaveDialog(mainWindow, {
        title: '保存处理结果',
        defaultPath: defaultName || 'film-lab-output',
        filters: filters || [
          { name: 'Images', extensions: ['jpg','jpeg','tiff','png'] }
        ]
      });
      if (res.canceled || !res.filePath) return { ok:false, canceled:true };
      if (!bytes) return { ok:false, error:'no_bytes' };
      fs.writeFileSync(res.filePath, Buffer.from(bytes));
      return { ok:true, filePath: res.filePath };
    } catch (err) {
      return { ok:false, error: err && err.message };
    }
  });
  // Provide explicit exit IPC if needed later
  ipcMain.handle('app-exit', async () => { isQuitting = true; await stopServer(); app.quit(); });

  // debug helpers and logging
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.on('did-fail-load', (e, errorCode, errorDescription, validatedURL) => {
    LOG('did-fail-load', errorCode, errorDescription, validatedURL);
  });
  mainWindow.webContents.on('crashed', () => {
    LOG('renderer crashed');
  });
  mainWindow.webContents.on('dom-ready', () => {
    LOG('dom-ready url=', mainWindow.webContents.getURL());
  });

  const showAndLog = () => {
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });
  };

  // Intercept close to hide instead of quit
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWindow.hide();
    createTray();
  });

  if (isDev) {
    // dev server
    const devUrl = 'http://localhost:3000';
    mainWindow.loadURL(devUrl).then(showAndLog).catch(err => {
      LOG('loadURL dev failed', err && err.message);
    });
    return;
  }

  // production: static files packaged in resources
  // When packaged by electron-builder, resources are under process.resourcesPath (app.asar or resources/app.asar)
  const indexHtmlCandidates = [
    path.join(process.resourcesPath || process.cwd(), 'client', 'build', 'index.html'),
    path.join(__dirname, 'client', 'build', 'index.html'), // fallback
  ];

  const indexHtml = indexHtmlCandidates.find(p => fs.existsSync(p));
  if (!indexHtml) {
    const p = indexHtmlCandidates.join(' | ');
    LOG('index.html not found. candidates=', p);
    dialog.showErrorBox('启动失败', `找不到前端资源 (index.html)。查阅日志：${path.join(app.getPath('userData'), 'electron-main.log')}`);
    return;
  }

  // If app needs backend API, ensure server is started and ready before loading UI
  const apiHealthUrl = 'http://localhost:4000/api/rolls'; // 如果没有 health 路由可以改成 /api/rolls 或根
  const needsBackend = true; // set to true if front-end calls local API

  (async () => {
    try {
      if (needsBackend) {
        startServer();
        LOG('waiting for backend', apiHealthUrl);
        // wait for backend up (10s), if no health endpoint change to a reachable endpoint
        await waitForUrl(apiHealthUrl, 15000).catch(() => {
          LOG('backend did not respond in time; continuing to load UI anyway');
        });
      }
    } catch (e) {
      LOG('error while waiting backend', e && e.message);
    }

    mainWindow.loadFile(indexHtml).then(showAndLog).catch(err => {
      LOG('loadFile failed', err && err.message);
      dialog.showErrorBox('加载前端失败', `loadFile 失败: ${err && err.message}\n请检查 ${indexHtml}`);
    });
  })();
}

// --- GPU Worker (Offscreen hidden window) ---
async function ensureGpuWindow() {
  if (gpuWindow && !gpuWindow.isDestroyed()) return gpuWindow;
  gpuWindow = new BrowserWindow({
    width: 320,
    height: 240,
    show: false,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  const gpuHtmlCandidates = [
    path.join(process.resourcesPath || __dirname, 'electron-gpu', 'gpu.html'),
    path.join(__dirname, 'electron-gpu', 'gpu.html'),
    path.join(app.getAppPath ? app.getAppPath() : __dirname, 'electron-gpu', 'gpu.html'),
    path.join(process.cwd(), 'electron-gpu', 'gpu.html'),
    path.resolve('electron-gpu', 'gpu.html')
  ];
  const gpuHtml = gpuHtmlCandidates.find(p => fs.existsSync(p));
  if (!gpuHtml) {
    LOG('gpu.html not found, candidates=', gpuHtmlCandidates.join(' | '));
    throw new Error('GPU worker UI not found');
  }
  await gpuWindow.loadFile(gpuHtml).catch(e => LOG('gpuWindow loadFile error', e && e.message));
  gpuWindow.on('closed', () => { gpuWindow = null; });
  return gpuWindow;
}

ipcMain.handle('filmlab-gpu:process', async (_e, payload) => {
  const jobId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await ensureGpuWindow();
  const ensureDir = (dir) => { try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch(_){} };
  const exportDir = path.join(app.getPath('userData'), 'gpu-exports');
  ensureDir(exportDir);

  // Helper to fetch a URL into a Buffer
  const fetchBuffer = (url) => new Promise((resolve, reject) => {
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
    } catch (e) { reject(e); }
  });

  // Prepare image data (either provided directly or fetched from URL)
  let imageBuffer = payload && payload.imageBytes ? Buffer.from(payload.imageBytes) : null;
  let mime = (payload && payload.mime) || 'image/jpeg';
  if (!imageBuffer && payload && payload.imageUrl) {
    try {
      // Normalize localhost to IPv4 to avoid ::1 resolution on Windows/Node
      let fetchUrl = String(payload.imageUrl || '');
      fetchUrl = fetchUrl.replace('://localhost', '://127.0.0.1').replace('://[::1]', '://127.0.0.1');
      imageBuffer = await fetchBuffer(fetchUrl);
      // rudimentary mime by extension (robust check)
      try {
        // Try to parse as URL to handle query params and case sensitivity
        const u = new URL(fetchUrl);
        const ext = path.extname(u.pathname).toLowerCase();
        if (ext === '.png') mime = 'image/png';
        else if (ext === '.bmp') mime = 'image/bmp';
        else if (ext === '.webp') mime = 'image/webp';
        else mime = 'image/jpeg';
      } catch (e) {
        // Fallback for non-URL strings
        const lower = fetchUrl.toLowerCase();
        if (lower.endsWith('.png')) mime = 'image/png';
        else if (lower.endsWith('.bmp')) mime = 'image/bmp';
        else if (lower.endsWith('.webp')) mime = 'image/webp';
        else mime = 'image/jpeg';
      }
    } catch (e) {
      return { ok:false, error: 'fetch_failed: ' + (e && e.message) };
    }
  }

  if (!imageBuffer) {
    return { ok:false, error:'no_image_data' };
  }

  // Check for TIFF and convert if necessary (Browser/GPU cannot decode TIFF)
  const isTiff = (buf) => {
    if (!buf || buf.length < 4) return false;
    // Little endian II*. (49 49 2A 00) or Big endian MM.* (4D 4D 00 2A)
    return (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2A && buf[3] === 0x00) ||
           (buf[0] === 0x4D && buf[1] === 0x4D && buf[2] === 0x00 && buf[3] === 0x2A);
  };

  let rawWidth = 0;
  let rawHeight = 0;
  let rawFormat = null;

  if (isTiff(imageBuffer)) {
    const sharp = getSharp();
    if (sharp) {
      try {
        // Optimization: Decode to raw RGBA pixels directly to avoid PNG encode/decode overhead
        // This is the "direct" path the user requested (skipping browser decoding)
        // Force 8-bit output (uchar) to ensure compatibility with WebGL UNSIGNED_BYTE
        const { data, info } = await sharp(imageBuffer)
          .ensureAlpha()
          .toFormat('raw') // Explicitly request raw format
          .toBuffer({ resolveWithObject: true });
        
        imageBuffer = data;
        rawWidth = info.width;
        rawHeight = info.height;
        rawFormat = 'rgba';
        mime = 'application/octet-stream'; // Generic binary
      } catch (e) {
        return { ok:false, error: 'tiff_conversion_failed: ' + e.message };
      }
    } else {
      return { ok:false, error: 'tiff_not_supported_no_sharp' };
    }
  }

  return new Promise((resolve) => {
    gpuJobs.set(jobId, { resolve, meta: { photoId: payload && payload.photoId } });
    try {
      gpuWindow.webContents.send('filmlab-gpu:run', { 
        jobId, 
        params: payload && payload.params, 
        image: { 
          bytes: imageBuffer, 
          mime,
          width: rawWidth,
          height: rawHeight,
          format: rawFormat
        } 
      });
      // add timeout safety
      setTimeout(() => {
        if (gpuJobs.has(jobId)) {
          gpuJobs.delete(jobId);
          resolve({ ok:false, error:'gpu_timeout' });
        }
      }, 30000);
    } catch (err) {
      gpuJobs.delete(jobId);
      resolve({ ok:false, error: (err && err.message) || String(err) });
    }
  });
});

// Robust multipart upload helper to avoid fetch/FormData quirks in Node environment
const uploadBuffer = (url, buffer, filename) => {
  return new Promise((resolve, reject) => {
    LOG('[uploadBuffer] Start upload to', url, 'size=', buffer.length);
    const { URL } = require('url');
    const target = new URL(url);
    const boundary = '----ElectronMultipartBoundary' + Math.random().toString(36).slice(2);
    const httpMod = target.protocol === 'https:' ? require('https') : require('http');
    
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    
    const options = {
      method: 'POST',
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(header) + buffer.length + Buffer.byteLength(footer)
      }
    };
    
    LOG('[uploadBuffer] Request options:', JSON.stringify(options));
    
    const req = httpMod.request(options, (res) => {
      LOG('[uploadBuffer] Response status:', res.statusCode);
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        LOG('[uploadBuffer] Response body:', body.substring(0, 200));
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { 
            const json = JSON.parse(body);
            LOG('[uploadBuffer] Success:', JSON.stringify(json));
            resolve(json);
          } catch(e) { 
            LOG('[uploadBuffer] Non-JSON response, treating as success');
            resolve({ ok: true, text: body }); 
          }
        } else {
          const err = new Error(`HTTP ${res.statusCode}: ${body}`);
          LOG('[uploadBuffer] Error:', err.message);
          reject(err);
        }
      });
    });
    
    req.on('error', (e) => {
      LOG('[uploadBuffer] Request error:', e.message);
      reject(e);
    });
    
    req.write(header);
    req.write(buffer);
    req.write(footer);
    req.end();
  });
};

// Receive results from gpu renderer
const { ipcMain: _ipcMainAlias } = require('electron');
_ipcMainAlias.on('filmlab-gpu:result', async (_e, result) => {
  const { jobId } = result || {};
  LOG('[GPU-RESULT] Received result for jobId:', jobId, 'ok:', result && result.ok);
  const entry = jobId && gpuJobs.get(jobId);
  if (!entry) {
    LOG('[GPU-RESULT] No job entry found for', jobId);
    return;
  }
  const done = entry.resolve;
  const meta = (entry && entry.meta) || {};
  gpuJobs.delete(jobId);
  try {
    if (!result || !result.ok) {
      LOG('[GPU-RESULT] Result not ok:', result && result.error);
      return done(result);
    }
    const buf = result.jpegBytes ? Buffer.from(result.jpegBytes) : null;
    if (!buf) {
      LOG('[GPU-RESULT] No jpegBytes in result');
      return done({ ok:false, error:'no_jpeg_bytes' });
    }
    LOG('[GPU-RESULT] JPEG buffer size:', buf.length);

    // If we have a target photoId, upload to backend to ingest into roll storage
    const photoId = meta.photoId;
    if (photoId) {
      LOG('[GPU-RESULT] Uploading to backend for photoId:', photoId);
      try {
        const API_BASE = 'http://127.0.0.1:4000';
        // Use robust upload instead of fetch+FormData
        const data = await uploadBuffer(`${API_BASE}/api/photos/${photoId}/ingest-positive`, buf, 'gpu_export.jpg');
        
        LOG('[GPU-RESULT] Backend response:', JSON.stringify(data));
        if (data && (data.ok || data.photo)) {
          LOG('[GPU-RESULT] Upload successful, filePath:', data.positive_rel_path);
          return done({ ok: true, stored: true, photo: data.photo || null, filePath: data.positive_rel_path });
        } else {
           // If backend returned error, propagate it
           LOG('[GPU-RESULT] Backend returned error:', data.error);
           return done({ ok: false, error: data.error || 'backend_ingest_failed' });
        }
      } catch (e) {
        // If network error, return error
        LOG('[GPU-RESULT] Backend connection error:', e.message);
        return done({ ok: false, error: 'backend_connect_failed: ' + e.message });
      }
    }

    // Fallback: write to userData/gpu-exports
    LOG('[GPU-RESULT] No photoId, writing to local export folder');
    const outName = `gpu_${Date.now()}.jpg`;
    const outDir = path.join(app.getPath('userData'), 'gpu-exports');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, outName);
    LOG('[GPU-RESULT] Writing to:', outPath);
    fs.writeFile(outPath, buf, (err) => {
      if (err) {
        LOG('[GPU-RESULT] Write error:', err.message);
        return done({ ok:false, error: err.message });
      }
      LOG('[GPU-RESULT] Write successful');
      done({ ok:true, filePath: outPath, width: result.width, height: result.height });
    });
  } catch (e) {
    LOG('[GPU-RESULT] Exception:', e.message);
    done({ ok:false, error: e && e.message });
  }
});

// --- Simple config persistence ---
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf-8')); } catch { return {}; }
}
function saveConfig(next) {
  appConfig = { ...(appConfig||{}), ...(next||{}) };
  try { fs.writeFileSync(CONFIG_PATH(), JSON.stringify(appConfig, null, 2)); } catch(e) { LOG('saveConfig error', e && e.message); }
}

// IPC for settings
ipcMain.handle('config-get', () => appConfig);
ipcMain.handle('pick-uploads-root', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory']});
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return null;
  return res.filePaths[0];
});
ipcMain.handle('config-set-uploads-root', async (e, dir) => {
  if (!dir || typeof dir !== 'string') return { ok:false, error:'invalid_dir' };
  saveConfig({ uploadsRoot: dir });
  // restart backend server with new env so static mounts change
  await stopServer();
  startServer();
  return { ok:true, config: appConfig };
});

ipcMain.handle('pick-data-root', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory']});
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return null;
  return res.filePaths[0];
});
ipcMain.handle('config-set-data-root', async (e, dir) => {
  if (!dir || typeof dir !== 'string') return { ok:false, error:'invalid_dir' };
  saveConfig({ dataRoot: dir });
  // restart backend server with new env
  await stopServer();
  startServer();
  return { ok:true, config: appConfig };
});

app.on('ready', async () => {
  LOG('app ready, isDev=', isDev);
  appConfig = loadConfig();
  createWindow();
  createTray();
  // Ensure backend starts when Electron launches (dev and prod)
  try {
    startServer();
  } catch (e) {
    LOG('startServer on ready failed', e && e.message);
  }
});

app.on('window-all-closed', async () => {
  // Do not quit if tray exists (keep backend alive)
  if (!tray) {
    await stopServer();
    if (process.platform !== 'darwin') app.quit();
  }
});

app.on('before-quit', async (e) => {
  if (!isQuitting) {
    e.preventDefault();
    isQuitting = true;
    await stopServer();
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});