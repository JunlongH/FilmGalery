// Minimal ESLint flat config.
//
// Scope: server, packages, tests, tools — the surfaces that have no other
// linter. The client keeps CRA's built-in eslint (react-app); mobile is JS but
// out of scope for this pass.
//
// Goal: a clean *hard* gate (errors fail, warnings do not). Only rules that
// catch real bugs are errors (undefined globals, redeclaration). Stylistic
// issues are warnings so legacy code is surfaced, not blocked. Tighten the
// warning rules incrementally once the baseline is clean.
//
// Environments are declared per surface (node for the server, jest for tests,
// browser for the isomorphic api-client, module for the ESM coordTransform)
// rather than silencing no-undef, so the rule keeps its value.

import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      '**/node_modules/**',
      'dist*/**',
      '**/build/**',
      '**/dist/**',
      '**/*.min.js',
    ],
  },
  {
    files: ['server/**/*.js', 'packages/**/*.js', 'tests/**/*.js', 'tools/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Jest test files get the jest globals (describe/test/expect/jest/...).
    files: ['**/__tests__/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
  {
    // api-client is isomorphic — also runs in the browser (XMLHttpRequest/fetch).
    files: ['packages/@filmgallery/api-client/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
];
