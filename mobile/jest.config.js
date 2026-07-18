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
};
