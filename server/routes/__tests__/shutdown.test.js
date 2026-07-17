/**
 * Integration tests for server/routes/shutdown.js
 *
 * Two concerns locked here (the Phase 0–1 shutdown fix):
 *   1. SECURITY: a non-loopback peer is rejected with 403.
 *   2. REACHABILITY: the route is not shadowed by a trailing /api/* catch-all
 *      (the original bug — shutdown returned 404 because it was registered
 *      after the catch-all).
 *
 * The factory accepts an injectable onShutdown so mounting the real router in
 * tests never triggers process.exit.
 */

const express = require('express');
const request = require('supertest');
const { createShutdownRouter } = require('../shutdown');

// Build an app that mirrors the server.js ordering: shutdown router mounted
// BEFORE the /api/* catch-all. Per-test overrides for the peer address.
function buildApp({ onShutdown, forceIp } = {}) {
  const app = express();
  app.use(express.json());
  if (forceIp) {
    // Simulate a non-loopback peer by pinning req.ip before the router runs.
    app.use('/api/shutdown', (req, _res, next) => {
      Object.defineProperty(req, 'ip', { value: forceIp });
      next();
    });
  }
  app.use('/api/shutdown', createShutdownRouter({ onShutdown }));
  app.use('/api/*', (_req, res) => res.status(404).json({ error: 'not found' }));
  return app;
}

describe('createShutdownRouter — loopback gate (security)', () => {
  test('rejects a non-loopback peer with 403', async () => {
    const onShutdown = jest.fn();
    const app = buildApp({ onShutdown, forceIp: '203.0.113.5' });
    const res = await request(app).post('/api/shutdown');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ ok: false, error: 'Forbidden' });
    expect(onShutdown).not.toHaveBeenCalled();
  });

  test('accepts a loopback peer and schedules graceful exit', async () => {
    const onShutdown = jest.fn();
    const app = buildApp({ onShutdown });
    const res = await request(app).post('/api/shutdown');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: 'Shutting down...' });
    // onShutdown is deferred ~100ms after the response is flushed.
    await new Promise((r) => setTimeout(r, 150));
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });
});

describe('createShutdownRouter — reachability before catch-all (Phase 0–1 bug)', () => {
  test('POST /api/shutdown reaches the handler, not the 404 catch-all', async () => {
    // No forceIp → peer defaults to loopback (supertest runs locally).
    const app = buildApp({ onShutdown: jest.fn() });
    const res = await request(app).post('/api/shutdown');
    expect(res.status).toBe(200); // would be 404 if registered after catch-all
  });

  test('an unmatched /api route still falls through to the catch-all', async () => {
    const app = buildApp({ onShutdown: jest.fn() });
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
  });
});
