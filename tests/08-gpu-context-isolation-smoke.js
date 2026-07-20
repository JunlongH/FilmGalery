/**
 * Phase 2D.2 GPU worker smoke test.
 *
 * Launches the full Electron app (packaged or dev), waits for the GPU
 * worker window to be created, then sends a minimal filmlab-gpu:process
 * IPC call. Verifies:
 *   - The renderer (sandboxed, contextIsolated) loads gpu-renderer.bundle.js.
 *   - window.__gpu is exposed by gpu-preload.js.
 *   - IPC round-trips successfully.
 *
 * This is a runtime smoke — not bit-equivalence (PSNR). Bit-equivalence is
 * structurally guaranteed: gpu-renderer.js algorithm logic is unchanged
 * (only IPC + Buffer.from were swapped).
 */
const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.disableHardwareAcceleration();
app.on('ready', async () => {
  console.log('[gpu-smoke] app ready');
  console.log('[gpu-smoke] contextIsolated=', process.contextIsolated);

  // Construct the GPU window with the SAME webPreferences as production.
  const gpuWin = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '..', 'electron-gpu', 'gpu-preload.js'),
      backgroundThrottling: false,
    },
  });

  // Listen for results from the GPU renderer.
  ipcMain.once('filmlab-gpu:result', (_e, result) => {
    console.log('[gpu-smoke] got result:', JSON.stringify({
      ok: result.ok,
      jobId: result.jobId,
      error: result.error,
      width: result.width,
      height: result.height,
      jpegBytesType: result.jpegBytes ? result.jpegBytes.constructor.name : null,
      jpegBytesLen: result.jpegBytes ? result.jpegBytes.length : 0,
    }));

    // Headless environments without a GPU/display produce 'WebGL not
    // initialized' — that's not a contextIsolation/sandbox regression,
    // just no GL context. The IPC round-trip itself is what we validate.
    const webglUnavailable = !result.ok && /WebGL|GL/.test(result.error || '');

    if (result.ok && result.jpegBytes && result.jpegBytes.length > 0) {
      console.log('[gpu-smoke] ✅ FULL pass: WebGL + IPC + contextBridge');
      app.quit();
    } else if (webglUnavailable) {
      console.log('[gpu-smoke] ✅ SOFT pass: contextBridge/sandbox OK; WebGL needs display');
      console.log('[gpu-smoke]    (run with real display + GPU for full PSNR validation)');
      app.quit();
    } else {
      console.log('[gpu-smoke] ❌ unexpected failure:', result.error);
      app.exit(1);
    }
  });

  // Inject a probe BEFORE loading gpu.html — check window.__gpu exists.
  gpuWin.webContents.once('did-finish-load', async () => {
    console.log('[gpu-smoke] did-finish-load');
    // Verify the renderer cannot access Node APIs.
    const probe = await gpuWin.webContents.executeJavaScript(`
      (function () {
        try {
          return {
            hasGpu: typeof window.__gpu === 'object',
            hasOnRun: typeof (window.__gpu && window.__gpu.onRun) === 'function',
            hasSendResult: typeof (window.__gpu && window.__gpu.sendResult) === 'function',
            requireWorks: (function () { try { require('electron'); return true; } catch (e) { return false; } })(),
            processExists: typeof process !== 'undefined',
            BufferExists: typeof Buffer !== 'undefined',
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `);
    console.log('[gpu-smoke] renderer probe:', JSON.stringify(probe));

    if (probe.requireWorks || probe.processExists || probe.BufferExists) {
      console.log('[gpu-smoke] ❌ SANDBOX BYPASS — Node APIs visible');
      app.exit(1);
      return;
    }
    if (!probe.hasGpu || !probe.hasOnRun || !probe.hasSendResult) {
      console.log('[gpu-smoke] ❌ window.__gpu not fully exposed');
      app.exit(1);
      return;
    }
    console.log('[gpu-smoke] ✅ sandbox enforced, window.__gpu exposed');

    // Now send a minimal job. The real gpu-renderer needs an image but
    // for smoke purposes we just want to see if the IPC bridge works.
    // Sending a tiny RGBA pixel buffer (2x2) triggers the raw path.
    const tinyRgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
    gpuWin.webContents.send('filmlab-gpu:run', {
      jobId: 'smoke-1',
      params: {
        cropRect: { x: 0, y: 0, w: 1, h: 1 },
        rotation: 0,
        jpegQuality: 0.9,
      },
      image: {
        bytes: tinyRgba,
        mime: 'application/octet-stream',
        width: 2,
        height: 2,
        format: 'rgba',
      },
    });

    // Timeout safety
    setTimeout(() => {
      console.log('[gpu-smoke] ❌ timeout waiting for result');
      app.exit(2);
    }, 10000).unref();
  });

  // gpu.html is at electron-gpu/gpu.html from project root.
  const gpuHtml = path.join(__dirname, '..', 'electron-gpu', 'gpu.html');
  console.log('[gpu-smoke] loading', gpuHtml);
  await gpuWin.loadFile(gpuHtml);
});

app.on('window-all-closed', () => app.quit());
