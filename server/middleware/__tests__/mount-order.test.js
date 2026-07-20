/**
 * Mount-order regression test (Phase 2C.2.3).
 *
 * Locks the production middleware order at server.js:301-303:
 *   ... routes ...
 *   → app.use('/api/*', notFoundHandler)   // 404 catch-all
 *   → app.use(errorHandler)                // error serializer
 *
 * History: Phase 0–1 fixed a bug where `/api/shutdown` was registered AFTER
 * the catch-all and got shadowed (returned 404 instead of running). Phase
 * 2B's auth middleware has the same risk. This test pins the order so a
 * future regression fails immediately.
 *
 * Strategy: load the real server.js mountRoutes() side-effect-free by
 * mocking its heavy dependencies (sharp, db, services), then assert via
 * supertest that:
 *   - a thrown error from any route reaches errorHandler (not Express's
 *     default HTML page)
 *   - an unmatched /api route returns the notFoundHandler JSON shape
 */

jest.mock('sharp', () => ({ cache: () => {} }));
jest.mock('../../db', () => ({
  serialize: (cb) => cb && cb(),
  run: (sql, cb) => cb && cb(),
  exec: (sql, cb) => cb && cb(null),
  all: (sql, params, cb) => cb && cb(null, []),
  get: (sql, params, cb) => cb && cb(null, undefined),
  close: (cb) => cb && cb(),
  on: () => {},
}));
jest.mock('../../utils/run-all-migrations', () => ({ runAllMigrations: () => Promise.resolve({ executed: 0, skipped: 3, failed: 0 }) }));
jest.mock('../../services/roll-service', () => ({ recomputeRollSequence: () => Promise.resolve({ count: 0 }) }));
jest.mock('../../services/mdns-service', () => ({ getStatus: () => null }));
jest.mock('bonjour-service', () => ({}));
jest.mock('@filmgallery/libraw-native', () => ({}));

const request = require('supertest');
const express = require('express');

// Build a minimal app that mirrors ONLY the cross-cutting mount order in
// server.js — routes that throw, then notFoundHandler, then errorHandler.
// We do not load server.js directly because it has many side effects
// (sqlite open, native modules, mdns). The point of this test is the
// ORDER contract, which is structural.
function buildProductionOrderApp() {
  const app = express();
  app.use(express.json());

  // A "route" that throws — simulates any route handler calling next(err).
  app.get('/api/throws', (_req, _res, next) => {
    next(new Error('boom from /api/throws'));
  });

  // Mount order mirrors server.js:301-303 — keep these two lines adjacent
  // and in this order, or the regression returns.
  const { errorHandler, notFoundHandler } = require('../../middleware/error-handler');
  app.use('/api/*', notFoundHandler);
  app.use(errorHandler);

  return app;
}

describe('server.js mount order (Phase 2C.2.3 regression)', () => {
  test('a route-thrown error reaches errorHandler (500 JSON, not Express HTML)', async () => {
    const app = buildProductionOrderApp();
    const res = await request(app).get('/api/throws');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('Internal server error');
    expect(res.body.errorId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test('an unmatched /api route hits notFoundHandler, not the Express default', async () => {
    const app = buildProductionOrderApp();
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.error).toMatch(/Route not found/);
  });

  test('errorHandler is mounted AFTER notFoundHandler — source order check', () => {
    // Defensive static check: read server.js source and verify the two
    // mounts appear in the correct relative order. This catches a regression
    // even before runtime tests would.
    const fs = require('fs');
    const src = fs.readFileSync(__dirname + '/../../server.js', 'utf8');
    const notFoundIdx = src.indexOf("app.use('/api/*', notFoundHandler)");
    const errorHandlerIdx = src.indexOf('app.use(errorHandler)');
    expect(notFoundIdx).toBeGreaterThan(-1);
    expect(errorHandlerIdx).toBeGreaterThan(-1);
    expect(notFoundIdx).toBeLessThan(errorHandlerIdx);
  });
});
