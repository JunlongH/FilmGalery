/**
 * Bundle the GPU renderer for the contextIsolation / sandbox model.
 *
 * Why: when the hidden GPU worker window runs with `nodeIntegration: false`
 * (Phase 2D.2), the renderer cannot use `require()`. The renderer still
 * needs the shared GLSL builder and the WB gains from packages/shared, so
 * we bundle them ahead-of-time into a single IIFE that the renderer loads
 * via <script>.
 *
 * Output: electron-gpu/gpu-renderer.bundle.js
 * Inputs: electron-gpu/gpu-renderer.js + glsl-shared.js + packages/shared
 *
 * The 'electron' import is treated as external — the new renderer uses
 * window.__gpu (exposed by gpu-preload.js via contextBridge) instead.
 *
 * @module electron-gpu/build
 */
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(__dirname, 'gpu-renderer.js');
const OUT = path.join(__dirname, 'gpu-renderer.bundle.js');

const result = esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUT,
  platform: 'browser',
  format: 'iife',
  target: ['chrome130'], // Electron 43 ≈ Chrome 150; drop to 130 for safety margin
  loader: { '.js': 'js' },
  // 'electron' is external — replaced by window.__gpu via gpu-preload.js.
  external: ['electron'],
  // Keep readable for crash forensics; minification gain here is negligible
  // (the GLSL sources dominate the size and are already minified strings).
  minify: false,
  sourcemap: false,
  logLevel: 'info',
  // Shared modules resolve relative to the entry file's directory by default;
  // we pass absWorkingDir to keep node_modules lookup rooted at the monorepo.
  absWorkingDir: ROOT,
});

if (result.errors && result.errors.length) {
  for (const e of result.errors) console.error(e.text);
  process.exit(1);
}

const size = fs.statSync(OUT).size;
console.log(`[build:gpu] ${path.relative(ROOT, OUT)} (${(size / 1024).toFixed(1)} KB)`);
