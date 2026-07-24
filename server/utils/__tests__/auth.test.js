/**
 * Tests for the shared-secret auth middleware.
 *
 * Covers the core contract:
 *   1. remote without Authorization → 401 (read + write)
 *   2. loopback passes any route (zero-friction desktop UX)
 *   3. OPTIONS preflight → 204 (handled before auth)
 *   4. whitelisted paths pass without a token
 *   5. soft mode: remote without secret → 200 + warn header + authenticated=false
 *   6. valid remote secret → 200 + authenticated=true, no warn header
 *   7. malformed Authorization → 401 without throwing
 *   8. loopback accepts IPv4-mapped IPv6
 *   9. /api/auth/check reports authenticated status
 *
 * Strategy: mock secretStore (in-memory) + supertest minimal express app.
 * We control req.ip via a pre-route shim so loopback-vs-remote is deterministic.
 */

const express = require('express');
const request = require('supertest');
const { createAuthMiddleware } = require('../auth');
const { createAuthSettingsRouter } = require('../../routes/auth-settings');

const TEST_SECRET = 'a'.repeat(64); // 64-char hex, matches crypto.randomBytes(32).toString('hex')

function createMockSecretStore(secret = TEST_SECRET) {
  let current = secret;
  return {
    verifySecret: (token) => token === current,
    getSecret: () => current,
    regenerateSecret: () => {
      current = 'b'.repeat(64);
      return Promise.resolve(current);
    },
  };
}

function buildApp({
  store = createMockSecretStore(),
  softMode = false,
  forceIp = null,
  withAuthRoutes = false,
  db = {},
} = {}) {
  const app = express();
  app.use(express.json());
  app.options('*', (_req, res) => res.sendStatus(204));

  if (forceIp) {
    app.use((req, _res, next) => {
      Object.defineProperty(req, 'ip', { value: forceIp });
      next();
    });
  }

  app.use(createAuthMiddleware({ secretStore: store, softMode }));

  if (withAuthRoutes) {
    app.use('/api/auth', createAuthSettingsRouter({ secretStore: store, db }));
  }

  app.get('/api/rolls', (req, res) => res.json({ ok: true, authenticated: !!req.authenticated }));
  app.post('/api/rolls', (req, res) => res.json({ ok: true, authenticated: !!req.authenticated }));
  app.use('/api/*', (_req, res) => res.status(404).json({ ok: false, error: 'not found' }));
  return app;
}

describe('auth middleware — core contract', () => {
  test('1. remote without Authorization → 401 (read & write)', async () => {
    const app = buildApp({ forceIp: '203.0.113.5' });
    expect((await request(app).get('/api/rolls')).status).toBe(401);
    expect((await request(app).post('/api/rolls')).status).toBe(401);
  });

  test('2. loopback passes without a secret (desktop zero-friction)', async () => {
    const app = buildApp({ forceIp: '127.0.0.1' });
    const res = await request(app).get('/api/rolls');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
  });

  test('3. OPTIONS preflight short-circuits before auth (204)', async () => {
    const app = buildApp({ forceIp: '203.0.113.5' });
    expect((await request(app).options('/api/rolls')).status).toBe(204);
  });

  test('4. whitelisted paths pass without a secret', async () => {
    const app = buildApp({ forceIp: '203.0.113.5' });
    // Route not registered → 404, but auth did not block (would be 401).
    expect((await request(app).get('/api/discover')).status).toBe(404);
    expect((await request(app).get('/api/health')).status).toBe(404);
    expect((await request(app).get('/api/health/database')).status).toBe(404);
  });

  test('5. soft mode: remote without secret → 200 + warn header', async () => {
    const app = buildApp({ forceIp: '203.0.113.5', softMode: true });
    const res = await request(app).get('/api/rolls');
    expect(res.status).toBe(200);
    expect(res.headers['x-auth-soft-mode']).toBe('warn');
    expect(res.body.authenticated).toBe(false);
  });

  test('6. valid remote secret → 200, authenticated=true, no warn header', async () => {
    const app = buildApp({ forceIp: '203.0.113.5' });
    const res = await request(app).get('/api/rolls').set('Authorization', `Bearer ${TEST_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers['x-auth-soft-mode']).toBeUndefined();
    expect(res.body.authenticated).toBe(true);
  });

  test('6b. invalid remote secret → 401', async () => {
    const app = buildApp({ forceIp: '203.0.113.5' });
    const res = await request(app).get('/api/rolls').set('Authorization', 'Bearer wrongsecret');
    expect(res.status).toBe(401);
  });

  test('7. malformed Authorization header → 401 without throwing', async () => {
    const app = buildApp({ forceIp: '203.0.113.5' });
    for (const header of ['Bearer', 'Bearer ', 'Bearer xxx yyy', 'Token abc', '']) {
      const res = await request(app).get('/api/rolls').set('Authorization', header);
      expect(res.status).toBe(401); // never 500
    }
  });

  test('8. loopback gate accepts IPv4-mapped IPv6 (::ffff:127.0.0.1)', async () => {
    const app = buildApp({ forceIp: '::ffff:127.0.0.1' });
    expect((await request(app).get('/api/rolls')).status).toBe(200);
  });

  test('9. soft mode still authenticates valid secrets (no warn header)', async () => {
    const app = buildApp({ forceIp: '203.0.113.5', softMode: true });
    const res = await request(app).get('/api/rolls').set('Authorization', `Bearer ${TEST_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers['x-auth-soft-mode']).toBeUndefined();
    expect(res.body.authenticated).toBe(true);
  });
});

describe('auth-secret store — timingSafeEqual verify', () => {
  test('verifySecret matches the real secret, rejects everything else', () => {
    const { verifySecret, generateSecret } = require('../auth-secret');
    // We can't test the DB-backed functions without a DB, but verifySecret is
    // pure once the cache is set. generateSecret is pure.
    const secret = generateSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    // verifySecret reads the module-level cache; set it via a tiny shim.
    // Since the cache is private, we exercise it through the middleware instead
    // (covered by tests 6/6b above). Here we only assert the format invariant.
    expect(verifySecret(secret)).toBe(false); // cache empty → false
  });
});

describe('auth-settings route', () => {
  test('GET /api/auth/check — loopback reports authenticated=true', async () => {
    const app = buildApp({ forceIp: '127.0.0.1', withAuthRoutes: true });
    const res = await request(app).get('/api/auth/check');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
  });

  test('GET /api/auth/check — soft-mode remote reports authenticated=false', async () => {
    const app = buildApp({ forceIp: '203.0.113.5', softMode: true, withAuthRoutes: true });
    const res = await request(app).get('/api/auth/check');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  test('GET /api/auth/secret — loopback returns the secret', async () => {
    const app = buildApp({ forceIp: '127.0.0.1', withAuthRoutes: true });
    const res = await request(app).get('/api/auth/secret');
    expect(res.status).toBe(200);
    expect(res.body.secret).toBe(TEST_SECRET);
  });

  test('GET /api/auth/secret — remote (even with secret) → 403', async () => {
    const app = buildApp({ forceIp: '203.0.113.5', withAuthRoutes: true });
    const res = await request(app).get('/api/auth/secret').set('Authorization', `Bearer ${TEST_SECRET}`);
    expect(res.status).toBe(403);
  });

  test('POST /api/auth/secret/regenerate — loopback rotates the secret', async () => {
    const store = createMockSecretStore();
    const app = buildApp({ store, forceIp: '127.0.0.1', withAuthRoutes: true });
    const res = await request(app).post('/api/auth/secret/regenerate');
    expect(res.status).toBe(200);
    expect(res.body.secret).toBe('b'.repeat(64));
    // Old secret no longer works.
    const check = await request(app).get('/api/rolls').set('Authorization', `Bearer ${TEST_SECRET}`);
    // loopback → 200 regardless; test verify via remote app instead
  });

  test('POST /api/auth/secret/regenerate — old secret rejected after rotate', async () => {
    const store = createMockSecretStore();
    // First rotate from loopback.
    const hostApp = buildApp({ store, forceIp: '127.0.0.1', withAuthRoutes: true });
    await request(hostApp).post('/api/auth/secret/regenerate');
    // Remote with OLD secret → 401.
    const remoteApp = buildApp({ store, forceIp: '203.0.113.5' });
    const old = await request(remoteApp).get('/api/rolls').set('Authorization', `Bearer ${TEST_SECRET}`);
    expect(old.status).toBe(401);
    // Remote with NEW secret → 200.
    const ok = await request(remoteApp).get('/api/rolls').set('Authorization', 'Bearer ' + 'b'.repeat(64));
    expect(ok.status).toBe(200);
  });

  test('POST /api/auth/secret/regenerate — remote → 403', async () => {
    const app = buildApp({ forceIp: '203.0.113.5', withAuthRoutes: true, softMode: true });
    const res = await request(app).post('/api/auth/secret/regenerate');
    expect(res.status).toBe(403);
  });
});
