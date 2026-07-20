import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Vite configuration — replaces CRA + CRACO (Phase 2D.3).
//
// Why:
//   - CRA is unmaintained; react-scripts 5 + craco 7 was the holding pattern.
//   - The codebase already used React.lazy + Suspense for route-level code
//     splitting (App.js:23-36). Vite preserves that and adds: faster dev
//     startup (esbuild), ESM-native graph, more aggressive tree-shaking.
//
// Aliases mirror the previous craco.config.js so existing import paths
// ('@filmgallery/shared', '@ui', '@providers') continue to resolve.
//
// The dev server runs on port 3000 to match what electron-main.js:582
// expects (http://localhost:3000 in dev mode).
//
// `base: './'` matches the previous `homepage: "./"` setting in
// client/package.json — required for Electron's file:// loading in
// production (electron-main.js:592-593 loads client/build/index.html).

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    alias: {
      '@filmgallery/shared': path.resolve(__dirname, '../packages/shared'),
      '@ui': path.resolve(__dirname, 'src/components/ui'),
      '@providers': path.resolve(__dirname, 'src/providers'),
    },
    extensions: ['.js', '.mjs', '.jsx', '.ts', '.tsx', '.json'],
  },
  server: {
    port: 3000,
    strictPort: true, // electron-main.js:582 hard-references :3000
  },
  build: {
    outDir: 'build',
    sourcemap: false,
    chunkSizeWarningLimit: 2000, // three.js/globe routes are large by design
  },
});
