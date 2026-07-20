/**
 * Shared helpers for route integration tests.
 *
 * buildApp() mirrors the production middleware order in server.js:301-303:
 *   route under test  →  /api/* 404 catch-all  →  errorHandler
 *
 * Tests that mount a router here exercise the FULL error path, including the
 * centralized errorHandler — so a refactor in 2C.2 that funnels errors via
 * next(err) yields the same observable contract.
 */
const express = require('express');
const { errorHandler, notFoundHandler } = require('../../middleware/error-handler');

function buildApp(mount) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  mount(app);
  app.use('/api/*', notFoundHandler);
  app.use(errorHandler);
  return app;
}

/**
 * Assert the stable error contract that holds before AND after 2C.2:
 *   - HTTP 500
 *   - JSON body
 *   - body.error is a non-empty string
 *   - no stack-trace leak
 *
 * 2C.2 is allowed to ADD fields (ok, errorId, code) without breaking this.
 */
function assertServerErrorContract(res, { status = 500 } = {}) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(typeof res.body.error).toBe('string');
  expect(res.body.error.length).toBeGreaterThan(0);
  const body = JSON.stringify(res.body);
  // Stack frames look like "    at foo (file.js:1:2)" — never acceptable in a response.
  expect(body).not.toMatch(/\bat\s+[^\s]+\s+\(/);
}

module.exports = { buildApp, assertServerErrorContract };
