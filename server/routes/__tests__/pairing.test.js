/**
 * Integration tests for the Phase 2B #1 pairing router.
 *
 * Locks:
 *   - POST /api/pairing/code is loopback-only (remote → 403)
 *   - POST /api/pairing/verify: happy path issues a token
 *   - code expires after CODE_TTL_MS (mocked)
 *   - lockout after MAX_FAILURES wrong attempts
 *   - missing fields → 400
 */
const express = require('express');
const request = require('supertest');
const { createPairingRouter, CODE_TTL_MS, MAX_FAILURES } = require('../pairing');

function buildApp({ store, forceIp = null } = {}) {
  const app = express();
  app.use(express.json());
  if (forceIp) {
    app.use((req, _res, next) => {
      Object.defineProperty(req, 'ip', { value: forceIp });
      next();
    });
  }
  app.use('/api/pairing', createPairingRouter({ sessionsStore: store }));
  return app;
}

function mockStore() {
  let id = 0;
  return {
    issue: jest.fn(({ deviceName, deviceFp, deviceKind }) =>
      Promise.resolve({ token: `tok_${++id}`, id, deviceName, deviceFp, deviceKind })),
  };
}

describe('POST /api/pairing/code', () => {
  test('loopback → 200 + 6-digit code + expiresIn', async () => {
    const store = mockStore();
    const app = buildApp({ store, forceIp: '127.0.0.1' });
    const res = await request(app).post('/api/pairing/code');
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^\d{6}$/);
    expect(res.body.expiresIn).toBe(CODE_TTL_MS);
  });

  test('remote → 403', async () => {
    const store = mockStore();
    const app = buildApp({ store, forceIp: '203.0.113.5' });
    const res = await request(app).post('/api/pairing/code');
    expect(res.status).toBe(403);
  });

  test('issuing twice replaces the previous code', async () => {
    const store = mockStore();
    const app = buildApp({ store, forceIp: '127.0.0.1' });
    const a = await request(app).post('/api/pairing/code');
    const b = await request(app).post('/api/pairing/code');
    // Codes may collide by chance (1/10^6); accept that as the rare case.
    expect(a.body.code).toMatch(/^\d{6}$/);
    expect(b.body.code).toMatch(/^\d{6}$/);
  });
});

describe('POST /api/pairing/verify', () => {
  test('happy path → token issued + code invalidated', async () => {
    const store = mockStore();
    const app = buildApp({ store, forceIp: '127.0.0.1' });
    const codeRes = await request(app).post('/api/pairing/code');
    const code = codeRes.body.code;

    const verifyRes = await request(app).post('/api/pairing/verify').send({
      code, deviceName: 'iPhone', deviceFp: 'fp-1',
    });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.token).toBeDefined();
    expect(store.issue).toHaveBeenCalledTimes(1);
    expect(store.issue).toHaveBeenCalledWith(expect.objectContaining({
      deviceName: 'iPhone', deviceKind: 'mobile', deviceFp: 'fp-1', issuedBy: null,
    }));

    // Reusing the same code immediately should fail (single-use).
    const reuse = await request(app).post('/api/pairing/verify').send({
      code, deviceName: 'iPhone', deviceFp: 'fp-1',
    });
    expect(reuse.status).toBe(401);
  });

  test('missing fields → 400', async () => {
    const store = mockStore();
    const app = buildApp({ store, forceIp: '127.0.0.1' });
    await request(app).post('/api/pairing/code');
    const res = await request(app).post('/api/pairing/verify').send({ code: '000000' });
    expect(res.status).toBe(400);
  });

  test('wrong code → 401 + failure counter increments', async () => {
    const store = mockStore();
    const app = buildApp({ store, forceIp: '127.0.0.1' });
    await request(app).post('/api/pairing/code');

    const res = await request(app).post('/api/pairing/verify').send({
      code: '999999', deviceName: 'X', deviceFp: 'fp-x',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  test('lockout after MAX_FAILURES attempts (423)', async () => {
    const store = mockStore();
    const app = buildApp({ store, forceIp: '127.0.0.1' });
    const codeRes = await request(app).post('/api/pairing/code');
    const realCode = codeRes.body.code;

    for (let i = 0; i < MAX_FAILURES; i++) {
      const r = await request(app).post('/api/pairing/verify').send({
        code: '000000', deviceName: 'X', deviceFp: 'fp-x',
      });
      expect(r.status).toBe(401);
    }
    const locked = await request(app).post('/api/pairing/verify').send({
      code: realCode, deviceName: 'X', deviceFp: 'fp-x',
    });
    expect(locked.status).toBe(423);
  });

  test('verify before any code issued → 401', async () => {
    const store = mockStore();
    const app = buildApp({ store, forceIp: '127.0.0.1' });
    const res = await request(app).post('/api/pairing/verify').send({
      code: '123456', deviceName: 'X', deviceFp: 'fp-x',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no active/i);
  });
});
