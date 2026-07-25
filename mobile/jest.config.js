// Jest configuration for the mobile app.
//
// Uses the jest-expo preset which wires up:
//   - babel-jest transform via babel-preset-expo (handles .ts/.tsx)
//   - native-module mocks (AsyncStorage, etc.) so tests run under Node
//   - a sensible default transformIgnorePatterns whitelist
//
// transformIgnorePatterns is intentionally NOT overridden here: the Wave 0
// smoke test imports only pure-logic modules, so no React Native packages are
// pulled through the transformer. When Wave 3 adds component tests that
// transitively import RN packages needing ESM->CJS transform, extend the
// whitelist here (see watch-app/jest.config.js for the canonical pattern).

module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  // Workspace file: deps (e.g. @filmgallery/api-client at
  // packages/@filmgallery/api-client/) are loaded from their source path, not
  // from mobile/node_modules. When babel-jest transpiles them and injects
  // @babel/runtime helpers, the require resolves relative to the SOURCE file,
  // not mobile/. modulePaths makes jest ALSO search mobile/node_modules for
  // any require, so @babel/runtime is found regardless of where the requiring
  // file lives.
  modulePaths: ['<rootDir>/node_modules'],
  // M2-C3: component tests under __tests__/digital/ pull in i18n which imports
  // AsyncStorage. Map to the package's official jest mock so node-only test
  // runs don't hit the native-module null check.
  moduleNameMapper: {
    '@react-native-async-storage/async-storage':
      '<rootDir>/node_modules/@react-native-async-storage/async-storage/jest/async-storage-mock.js',
  },
};
