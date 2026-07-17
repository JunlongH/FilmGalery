/**
 * Jest Configuration for FilmLab Rendering Consistency Tests
 * 
 * 测试范围：
 * - 共享着色器模块完整性 (GLSL 构建)
 * - Uniform 一致性 (类型、命名)
 * - 渲染流水线顺序
 * - 算法数值一致性 (CPU vs GPU GLSL)
 * - 跨路径集成 (WebGL1/2, glsl-shared, RenderCore)
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: '..',
  // Single node environment; covers shared (tests/) + server unit tests.
  // Split into `projects` only when a suite needs a different environment
  // (e.g. jsdom for client component tests after the Vite migration).
  testMatch: [
    '<rootDir>/tests/**/*.test.js',
    '<rootDir>/server/**/__tests__/**/*.test.js',
    '<rootDir>/packages/**/__tests__/**/*.test.js',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist_v9/', '/build/'],
  // 排除 dist 和 build 目录 (避免 Haste 模块命名冲突)
  modulePathIgnorePatterns: [
    '<rootDir>/dist_v9/',
    '<rootDir>/dist_v9_client/',
    '<rootDir>/client/build/',
  ],
  verbose: true,
  // 超时 30s（某些着色器解析测试较慢）
  testTimeout: 30000,
};
