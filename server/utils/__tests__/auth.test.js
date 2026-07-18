/**
 * Integration tests for the Phase 2B #1 auth middleware.
 *
 * Locks the 7 acceptance cases from
 * docs/phase2-roadmap/phase-2b-security.md §「测试用例」:
 *   1. remote without Authorization → 401 (write + read routes)
 *   2. loopback passes any route (zero-friction desktop UX)
 *   3. OPTIONS preflight → 204 (handled before auth, never gated)
 *   4. pairing lockout after 3 wrong codes → 423 even with correct code
 *   5. revoked token → 401 immediately (negative path never cached)
 *   6. expired token → 401
 *   7. malformed Authorization → 401 without throwing
 *
 * Strategy: in-memory mock sessions store + supertest minimal express app.
 * Mirrors the shutdown.test.js pattern: we control req.ip via a pre-route
 * shim so we can exercise the loopback-vs-remote branch deterministically.
 */

const express = require('express');
const request = require('supertest');
const { createAuthMiddleware } = require('../auth');
const { createPairingRouter, CODE_TTL_MS, MAX_FAILURES } = require('../../routes/pairing');

// Build a fake store backed by a Map. The real store's verify() returns the
// session row on hit and null on miss/revoked/expired — we mirror that.
// Tokens use hex-only format to match the real `crypto.randomBytes(32).toString('hex')`
// output (the auth middleware's Bearer regex rejects other characters).
function createMockStore({ revokedIds = new Set(), expiredIds = new Set() } = {}) {
  const tokens = new Map(); // token -> { id, device_name, ... }
  let nextId = 1;
  function hexToken() {
    // 16 hex chars is enough for test uniqueness; real tokens are 64.
    return Array.from({ length: 16 }, () =>
      '0123456789abcdef'[Math.floor(Math.random() * 16)]
    ).join('');
  }
  return {
    issue({ deviceName, deviceKind = 'mobile', deviceFp, issuedBy = null }) {
      const id = nextId++;
      const token = hexToken();
      const row = {
        id,
        device_name: deviceName,
        device_kind: deviceKind,
        device_fp: deviceFp,
        issued_at: Date.now(),
        expires_at: null,
        last_seen_at: Date.now(),
        revoked_at: null,
        issued_by: issuedBy,
      };
      tokens.set(token, row);
      return Promise.resolve({ token, id: row.id });
    },
    verify(token) {
      for (const [tok, row] of tokens) {
        if (tok === token) {
          if (revokedIds.has(row.id)) return Promise.resolve(null);
          if (expiredIds.has(row.id)) return Promise.resolve(null);
          return Promise.resolve(row);
        }
      }
      return Promise.resolve(null);
    },
    touch() {},
    list() {
      return Promise.resolve(Array.from(tokens.values()));
    },
    revoke(id) {
      let count = 0;
      for (const [, row] of tokens) {
        if (row.id === id || row.issued_by === id) {
          row.revoked_at = Date.now();
          revokedIds.add(row.id);
          count++;
        }
      }
      return Promise.resolve({ revoked: count });
    },
    // helper for tests
    _revokeById(id) { revokedIds.add(id); },
    _expireById(id) { expiredIds.add(id); },
    _tokens: tokens,
  };
}

function buildApp({
  store,
  softMode = false,
  forceIp = null,
  withPairing = false,
} = {}) {
  const app = express();
  app.use(express.json());
  // Preflight short-circuit — mirrors server.js top-level mount.
  app.options('*', (_req, res) => res.sendStatus(204));

  if (forceIp) {
    app.use((req, _res, next) => {
      Object.defineProperty(req, 'ip', { value: forceIp });
      next();
    });
  }

  app.use(createAuthMiddleware({ sessionsStore: store, softMode }));

  if (withPairing) {
    app.use('/api/pairing', createPairingRouter({ sessionsStore: store }));
  }

  // Sample routes for read/write coverage.
  app.get('/api/rolls', (req, res) => res.json({ ok: true, session: req.session || null }));
  app.post('/api/rolls', (req, res) => res.json({ ok: true, session: req.session || null }));
  // 404 catch-all (must be after auth + routes, per the plan).
  app.use('/api/*', (_req, res) => res.status(404).json({ ok: false, error: 'not found' }));
  return app;
}

// helper: pair a device via the mock app and return the issued token.
async function pairToken(app, code) {
  const res = await request(app)
    .post('/api/pairing/verify')
    .send({ code, deviceName: 'Juno iPhone', deviceFp: 'fp-test-1' });
  return res.body.token;
}

describe('auth middleware — the 7 acceptance cases', () => {
  test('1. remote without Authorization → 401 (read & write)', async () => {
    const store = createMockStore();
    const app = buildApp({ store, forceIp: '203.0.113.5' });
    const getRes = await request(app).get('/api/rolls');
    expect(getRes.status).toBe(401);
    const postRes = await request(app).post('/api/rolls');
    expect(postRes.status).toBe(401);
  });

  test('2. loopback passes without a token (desktop zero-friction)', async () => {
    const store = createMockStore();
    const app = buildApp({ store, forceIp: '127.0.0.1' });
    const res = await request(app).get('/api/rolls');
    expect(res.status).toBe(200);
    expect(res.body.session).toBeNull(); // loopback does not attach session
  });

  test('3. OPTIONS preflight short-circuits before auth (204)', async () => {
    const store = createMockStore();
    const app = buildApp({ store, forceIp: '203.0.113.5' });
    const res = await request(app).options('/api/rolls');
    expect(res.status).toBe(204);
  });

  test('4. pairing lockout after MAX_FAILURES attempts (423 even with correct code)', async () => {
    const store = createMockStore();
    // Pairing state lives inside the router instance, so /code and /verify
    // must hit the SAME app. Use loopback (the /code endpoint's gate).
    const app = buildApp({
      store, forceIp: '127.0.0.1', withPairing: true,
    });
    const codeRes = await request(app).post('/api/pairing/code');
    expect(codeRes.status).toBe(200);
    const code = codeRes.body.code;

    // Three wrong attempts.
    for (let i = 0; i < MAX_FAILURES; i++) {
      const r = await request(app).post('/api/pairing/verify').send({
        code: '000000', deviceName: 'X', deviceFp: 'fp-x',
      });
      expect(r.status).toBe(401);
    }
    // Fourth attempt with the correct code → locked.
    const r = await request(app).post('/api/pairing/verify').send({
      code, deviceName: 'X', deviceFp: 'fp-x',
    });
    expect(r.status).toBe(423);
    expect(r.body.error).toMatch(/locked/i);
  });

  test('5. revoked token → 401 immediately (no cache poisoning)', async () => {
    const store = createMockStore();
    // Pre-issue a token, then revoke.
    const issued = await store.issue({
      deviceName: 'X', deviceFp: 'fp-1',
    });
    // First use succeeds (populates the cache).
    const app1 = buildApp({ store, forceIp: '203.0.113.5' });
    const ok = await request(app1).get('/api/rolls').set('Authorization', `Bearer ${issued.token}`);
    expect(ok.status).toBe(200);

    // Revoke at the store level (simulating an admin revoke via /api/sessions).
    store._revokeById(issued.id);

    // A fresh app (cold cache) must reject the revoked token immediately.
    const app2 = buildApp({ store, forceIp: '203.0.113.5' });
    const rejected = await request(app2).get('/api/rolls').set('Authorization', `Bearer ${issued.token}`);
    expect(rejected.status).toBe(401);
  });

  test('6. expired token → 401', async () => {
    const store = createMockStore();
    const issued = await store.issue({
      deviceName: 'X', deviceFp: 'fp-1',
    });
    store._expireById(issued.id);
    const app = buildApp({ store, forceIp: '203.0.113.5' });
    const res = await request(app).get('/api/rolls').set('Authorization', `Bearer ${issued.token}`);
    expect(res.status).toBe(401);
  });

  test('7. malformed Authorization header → 401 without throwing', async () => {
    const store = createMockStore();
    const app = buildApp({ store, forceIp: '203.0.113.5' });
    for (const header of ['Bearer', 'Bearer ', 'Bearer xxx yyy', 'Bearer    ', 'Token abc']) {
      const res = await request(app).get('/api/rolls').set('Authorization', header);
      expect(res.status).toBe(401); // never 500
    }
  });
});

describe('auth middleware — whitelist + soft mode', () => {
  test('whitelisted paths pass without a token, remote or loopback', async () => {
    const store = createMockStore();
    const app = buildApp({ store, forceIp: '203.0.113.5' });
    // /api/discover and /api/health are whitelisted by the regex list.
    const a = await request(app).get('/api/discover');
    expect(a.status).toBe(404); // route not registered, but auth did not block
    const b = await request(app).get('/api/health');
    expect(b.status).toBe(404);
    const c = await request(app).get('/api/health/database');
    expect(c.status).toBe(404);
  });

  test('soft mode: remote without token → 200 + X-Auth-Soft-Mode header', async () => {
    const store = createMockStore();
    const app = buildApp({ store, forceIp: '203.0.113.5', softMode: true });
    const res = await request(app).get('/api/rolls');
    expect(res.status).toBe(200);
    expect(res.headers['x-auth-soft-mode']).toBe('warn');
  });

  test('soft mode does NOT whitelist remote — soft mode still authenticates valid tokens', async () => {
    const store = createMockStore();
    const issued = await store.issue({ deviceName: 'X', deviceFp: 'fp-1' });
    const app = buildApp({ store, forceIp: '203.0.113.5', softMode: true });
    const res = await request(app).get('/api/rolls').set('Authorization', `Bearer ${issued.token}`);
    expect(res.status).toBe(200);
    expect(res.headers['x-auth-soft-mode']).toBeUndefined();
    expect(res.body.session).not.toBeNull();
  });

  test('valid remote token: 200 and session attached', async () => {
    const store = createMockStore();
    const issued = await store.issue({ deviceName: 'iPhone', deviceFp: 'fp-1' });
    const app = buildApp({ store, forceIp: '203.0.113.5' });
    const res = await request(app).get('/api/rolls').set('Authorization', `Bearer ${issued.token}`);
    expect(res.status).toBe(200);
    expect(res.body.session.device_name).toBe('iPhone');
  });

  test('loopback gate accepts IPv4-mapped IPv6 (::ffff:127.0.0.1)', async () => {
    const store = createMockStore();
    const app = buildApp({ store, forceIp: '::ffff:127.0.0.1' });
    const res = await request(app).get('/api/rolls');
    expect(res.status).toBe(200);
  });
});

describe('auth middleware — LRU cache behaviour', () => {
  test('positive verify result is cached (DB hit on first call only)', async () => {
    const store = createMockStore();
    const issued = await store.issue({ deviceName: 'X', deviceFp: 'fp-1' });
    let verifyCalls = 0;
    const origVerify = store.verify.bind(store);
    store.verify = (token) => { verifyCalls++; return origVerify(token); };

    const app = buildApp({ store, forceIp: '203.0.113.5' });
    for (let i = 0; i < 5; i++) {
      const r = await request(app).get('/api/rolls').set('Authorization', `Bearer ${issued.token}`);
      expect(r.status).toBe(200);
    }
    expect(verifyCalls).toBe(1); // only the first call hit the DB
  });

  test('regression: invalidateBySessionId drops the revoked session + its derived chain', () => {
    // Reproduces the original bug: a token verified once stayed in the cache
    // for 60s even after admin revoke, so the next request still authenticated.
    // The fix is authMiddleware.invalidateBySessionId(id), wired to the
    // sessions DELETE route via the onRevoke hook (see server.js).
    const store = createMockStore();
    const auth = createAuthMiddleware({ sessionsStore: store });

    const future = Date.now() + 99999;
    auth._cache.set('mobileTok', { session: { id: 1, issued_by: null }, expiresAt: future });
    auth._cache.set('watchTok',  { session: { id: 2, issued_by: 1    }, expiresAt: future });
    auth._cache.set('otherTok',  { session: { id: 3, issued_by: null }, expiresAt: future });

    auth.invalidateBySessionId(1);

    expect(auth._cache.has('mobileTok')).toBe(false); // the revoked session itself
    expect(auth._cache.has('watchTok')).toBe(false);  // derived watch (issued_by=1) cascades
    expect(auth._cache.has('otherTok')).toBe(true);   // unrelated session untouched
  });
});

describe('server wiring — sessions route onRevoke hook', () => {
  test('DELETE /api/sessions/:id invokes onRevoke with the id', async () => {
    // Locks the wiring in server.js: the auth middleware's invalidateBySessionId
    // must be called as onRevoke(id) when a session is revoked, otherwise the
    // 60s positive cache would keep serving the revoked token.
    const express = require('express');
    const request = require('supertest');
    const { createSessionsRouter } = require('../../routes/sessions');
    const store = createMockStore();
    const issued = await store.issue({ deviceName: 'X', deviceFp: 'fp-1' });
    const onRevoke = jest.fn();
    const app = express();
    app.use(express.json());
    // Loopback force — desktop admin (the realistic revoke caller).
    app.use((req, _res, next) => {
      Object.defineProperty(req, 'ip', { value: '127.0.0.1' });
      next();
    });
    app.use('/api/sessions', createSessionsRouter({ sessionsStore: store, onRevoke }));

    const res = await request(app).delete(`/api/sessions/${issued.id}`);
    expect(res.status).toBe(200);
    expect(onRevoke).toHaveBeenCalledWith(issued.id);
  });
});
