/**
 * CRACO (Create React App Configuration Override)
 * 
 * 配置目的:
 * 1. 允许从 src/ 外部导入 packages/shared 模块
 * 2. 配置 @filmgallery/shared 别名指向共享模块
 * 3. 解决 CRA 的 ModuleScopePlugin 限制
 * 4. 配置 PostCSS/Tailwind CSS 支持
 */

const path = require('path');

module.exports = {
  // 样式配置 - PostCSS 使用独立配置文件
  style: {
    postcss: {
      mode: 'file', // 使用 postcss.config.js
    },
  },
  webpack: {
    alias: {
      // 统一共享模块的导入路径
      '@filmgallery/shared': path.resolve(__dirname, '../packages/shared'),
      // UI 组件别名
      '@ui': path.resolve(__dirname, 'src/components/ui'),
      '@providers': path.resolve(__dirname, 'src/providers'),
    },
    configure: (webpackConfig) => {
      // 移除 ModuleScopePlugin，允许从 src/ 外部导入
      const scopePluginIndex = webpackConfig.resolve.plugins.findIndex(
        ({ constructor }) => constructor && constructor.name === 'ModuleScopePlugin'
      );
      if (scopePluginIndex >= 0) {
        webpackConfig.resolve.plugins.splice(scopePluginIndex, 1);
      }
      
      // 确保 .js 和 .mjs 文件都能正确解析
      webpackConfig.resolve.extensions = [
        '.js', '.mjs', '.jsx', '.ts', '.tsx', '.json'
      ];
      
      // TDZ workaround (历史遗留，见 git 历史)：
      // 早期版本在开启 scope hoisting + collapse_vars 时遇到 TDZ 错误。
      // 当前代码库经静态分析无循环依赖，已恢复默认优化；
      // 若运行时再现 "Cannot access 'X' before initialization"，可回退以下两项：
      //   terserOpts.compress.collapse_vars = false / reduce_vars = false
      //   webpackConfig.optimization.concatenateModules = false

      return webpackConfig;
    },
  },
};
