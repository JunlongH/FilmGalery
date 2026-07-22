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

// Vite plugin: convert CJS files in packages/shared/ to ESM at serve time.
// Vite serves /@fs/ CJS files as-is, but the browser's ESM loader can't do
// named imports from `module.exports`.
//
// This plugin does a lightweight text-based CJS→ESM transform:
//   1. `const { X, Y } = require('./path')` → `import { X, Y } from './path'`
//   2. `const X = require('./path')` → `import X from './path'`
//   3. Strip `module.exports = { ... }` and extract export names
//   4. Append `export { name1, name2, ... }` at the end
//
// This works because the shared modules use a simple pattern: top-level
// function declarations + `const { ... } = require(...)` + `module.exports = { ... }`.
// The transform preserves the function declarations at top level and converts
// the import/export syntax.
function cjsToEsmPlugin() {
  const sharedDir = path.resolve(__dirname, '../packages/shared');
  return {
    name: 'cjs-to-esm-shared',
    enforce: 'pre',
    transform(code, id) {
      if (!id.startsWith(sharedDir) || !id.endsWith('.js')) return null;
      if (!code.includes('module.exports') && !code.includes('require(')) return null;

      let transformed = code;

      // 1. Replace `const { X, Y: Z } = require('./path')` → `import { X, Y as Z } from './path'`
      //    Handles both bare names (X) and aliases (Y: Z → Y as Z).
      transformed = transformed.replace(
        /const\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g,
        (match, names, modPath) => {
          // Convert CJS alias syntax `name: alias` → ESM `name as alias`
          const esmNames = names.replace(/(\w+)\s*:\s*(\w+)/g, '$1 as $2');
          return `import { ${esmNames.trim()} } from ${JSON.stringify(modPath)};`;
        }
      );

      // 2. Replace `const X = require('./path')` → `import X from './path'`
      transformed = transformed.replace(
        /const\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g,
        (match, name, modPath) => `import ${name} from ${JSON.stringify(modPath)};`
      );

      // 3. Extract export names from `module.exports = { ... }`
      //    Handles both shorthand (`name`) and property syntax (`name: expr`).
      const exportNames = [];
      const exportMatch = transformed.match(/module\.exports\s*=\s*\{([\s\S]*?)\}\s*;?\s*$/);
      if (exportMatch) {
        const body = exportMatch[1];
        // Strip line comments first (// ... to end of line)
        const cleaned = body.replace(/\/\/[^\n]*/g, '');
        for (const part of cleaned.split(',')) {
          let name = part.trim();
          // Handle property syntax: `keyName: someExpr` → take `keyName`
          if (name.includes(':')) {
            name = name.split(':')[0].trim();
          }
          // Strip surrounding quotes if present (e.g., `"key": expr`)
          name = name.replace(/^['"]|['"]$/g, '');
          if (name && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
            exportNames.push(name);
          }
        }
        // Remove the module.exports line
        transformed = transformed.replace(
          /module\.exports\s*=\s*\{[\s\S]*?\}\s*;?\s*$/,
          ''
        );
      }

      // 4. Append named exports
      if (exportNames.length > 0) {
        transformed += `\nexport { ${exportNames.join(', ')} };\n`;
      }

      return { code: transformed, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cjsToEsmPlugin()],
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'process.env.REACT_APP_API_BASE': JSON.stringify('http://127.0.0.1:4001'),
  },
  resolve: {
    alias: {
      '@filmgallery/shared': path.resolve(__dirname, '../packages/shared'),
      '@ui': path.resolve(__dirname, 'src/components/ui'),
      '@providers': path.resolve(__dirname, 'src/providers'),
    },
    extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json'],
  },
  server: {
    port: 3000,
    strictPort: true, // electron-main.js:582 hard-references :3000
  },
  optimizeDeps: {
    include: [
      '@filmgallery/shared',
    ],
  },
  build: {
    outDir: 'build',
    sourcemap: false,
    chunkSizeWarningLimit: 2000, // three.js/globe routes are large by design
  },
});
