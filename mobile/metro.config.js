// Learn more https://docs.expo.dev/guides/customizing-metro/
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Monorepo support: workspace packages (@filmgallery/shared, api-client, types)
// are symlinked into node_modules but live OUTSIDE mobile/ (at the repo root's
// packages/). Metro's default watchFolders only cover the project root, so it
// cannot follow those symlinks. Add the workspace root as a watch folder and
// teach the resolver to follow symlinks + read package `exports` conditions.
// (Established for the 2A.4-T1 TS migration's Layer E metro-bundle gate.)
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;
// Avoid watching huge non-source trees (crashes metro with ENOSPC once the
// inotify watch limit is hit). All mobile deps resolve from mobile/node_modules
// and packages/*, so the other workspace trees are excluded.
const repoRoot = path.resolve(projectRoot, '..').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [
  new RegExp(`^${repoRoot}/node_modules/.*`),
  new RegExp(`^${repoRoot}/(dist_v9|docker|tmp|docs|tests|tools|server|client|electron-gpu|watch-app|assets)/.*`),
  /.*\/android\/\.gradle\/.*/,
  /.*\/android\/app\/build\/.*/,
];
// Condition names used when resolving package `exports` maps. `react-native`
// first (RN-specific entry), then generic ones.
config.resolver.conditionNames = ['react-native', 'browser', 'require', 'import', 'default'];

// Enable Worklets support
config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true,
    },
  }),
};

module.exports = config;
