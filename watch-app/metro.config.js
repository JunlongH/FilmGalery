const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

// Monorepo support: workspace packages (@filmgallery/shared, api-client, types)
// are symlinked into node_modules but live OUTSIDE watch-app/ (at the repo root's
// packages/). Metro's default watchFolders only cover the project root, so it
// cannot follow those symlinks. Add the workspace root as a watch folder and
// teach the resolver to follow symlinks + read package `exports` conditions.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    unstable_enableSymlinks: true,
    unstable_enablePackageExports: true,
    // Avoid watching huge non-source trees (ENOSPC at the inotify limit).
    // All watch deps resolve from watch-app/node_modules and packages/*.
    blockList: [
      new RegExp(`^${workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/node_modules/.*`),
      new RegExp(`^${workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(dist_v9|docker|tmp|docs|tests|tools|server|client|electron-gpu|mobile|assets)/.*`),
      /.*\/android\/\.gradle\/.*/,
      /.*\/android\/app\/build\/.*/,
    ],
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(defaultConfig, config);
