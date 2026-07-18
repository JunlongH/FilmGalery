/**
 * Integration tests for the Phase 2B #1 sessions CRUD router.
 *
 * Locks:
 *   - GET /api/sessions returns the list
 *   - DELETE /api/sessions/:id revokes (+ cascade)
 *   - POST /api/sessions/:id/derive-watch refuses cross-session derivation
 *     (only the caller's own session can spawn a watch token)
 *   - validation: non-integer :id → 400
 */
const express = require('express');
const request = require('supertest');
const { createSessionsRouter } = require('../sessions');

function mockStore() {
  let id = 0;
  const tokens = new Map();
  return {
    issue: jest.fn(({ deviceName, deviceKind = 'mobile', deviceFp, issuedBy = null }) => {
      const newId = ++id;
      tokens.set(newId, { id: newId, device_name: deviceName, device_kind: deviceKind, device_fp: deviceFp, issued_by: issuedBy });
      return Promise.resolve({ token: `tok_${newId}`, id: newId });
    }),
    list: jest.fn(() => Promise.resolve(Array.from(tokens.values()))),
    revoke: jest.fn((id) => {
      let count = 0;
      for (const [rowId, row] of tokens) {
        if (rowId === id || row.issued_by === id) { count++; }
      }
      return Promise.resolve({ revoked: count });
    }),
  };
}

function buildApp({ store, session = null }) {
  const app = express();
  app.use(express.json());
  // Simulate auth having set req.session for a token-authenticated caller.
  if (session) {
    app.use((req, _res, next) => {
      req.session = session;
      next();
    });
  }
  app.use('/api/sessions', createSessionsRouter({ sessionsStore: store }));
  return app;
}

describe('GET /api/sessions', () => {
  test('returns the list', async () => {
    const store = mockStore();
    await store.issue({ deviceName: 'iPhone', deviceFp: 'fp-1' });
    await store.issue({ deviceName: 'Watch', deviceKind: 'watch', deviceFp: 'fp-2' });
    const app = buildApp({ store });
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBe(2);
  });
});

describe('DELETE /api/sessions/:id', () => {
  test('revokes a session and returns the count', async () => {
    const store = mockStore();
    const issued = await store.issue({ deviceName: 'X', deviceFp: 'fp-1' });
    const app = buildApp({ store });
    const res = await request(app).delete(`/api/sessions/${issued.id}`);
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(1);
    expect(store.revoke).toHaveBeenCalledWith(issued.id);
  });

  test('non-integer id → 400', async () => {
    const store = mockStore();
    const app = buildApp({ store });
    const res = await request(app).delete('/api/sessions/abc');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/sessions/:id/derive-watch', () => {
  test('happy path: caller derives a watch token from their own session', async () => {
    const store = mockStore();
    const mobile = await store.issue({ deviceName: 'iPhone', deviceFp: 'fp-m' });
    const app = buildApp({ store, session: { id: mobile.id } });

    const res = await request(app)
      .post(`/api/sessions/${mobile.id}/derive-watch`)
      .send({ deviceName: 'Apple Watch', deviceFp: 'fp-w' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(store.issue).toHaveBeenCalledWith(expect.objectContaining({
      deviceKind: 'watch', deviceFp: 'fp-w', issuedBy: mobile.id,
    }));
  });

  test('refuses to derive from a session that is not the caller\'s own (403)', async () => {
    const store = mockStore();
    const mobileA = await store.issue({ deviceName: 'iPhoneA', deviceFp: 'fp-a' });
    const mobileB = await store.issue({ deviceName: 'iPhoneB', deviceFp: 'fp-b' });
    const app = buildApp({ store, session: { id: mobileA.id } });

    const res = await request(app)
      .post(`/api/sessions/${mobileB.id}/derive-watch`)
      .send({ deviceName: 'Watch', deviceFp: 'fp-w' });
    expect(res.status).toBe(403);
  });

  test('refuses when no authenticated session (no auth wired) → 403', async () => {
    const store = mockStore();
    const app = buildApp({ store }); // no req.session
    const res = await request(app)
      .post('/api/sessions/1/derive-watch')
      .send({ deviceName: 'Watch', deviceFp: 'fp-w' });
    expect(res.status).toBe(403);
  });

  test('missing deviceName/deviceFp → 400', async () => {
    const store = mockStore();
    const mobile = await store.issue({ deviceName: 'iPhone', deviceFp: 'fp-m' });
    const app = buildApp({ store, session: { id: mobile.id } });
    const res = await request(app)
      .post(`/api/sessions/${mobile.id}/derive-watch`)
      .send({ deviceName: 'Watch' });
    expect(res.status).toBe(400);
  });
});
