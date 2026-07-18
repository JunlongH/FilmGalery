/**
 * Integration tests for the Phase 2B #1 sessions store.
 *
 * Uses an in-memory sqlite3 DB (no file) so tests are deterministic and fast.
 * Locks: issuance, re-pair overwrite (UNIQUE device_fp+kind), verify (positive
 * / revoked / expired), revoke cascade to derived watch tokens.
 */
const sqlite3 = require('sqlite3').verbose();
const { createSessionsStore, hashToken } = require('../sessions-store');

function openDb() {
  const db = new sqlite3.Database(':memory:');
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        device_name TEXT NOT NULL,
        device_kind TEXT NOT NULL,
        device_fp TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER,
        last_seen_at INTEGER NOT NULL,
        revoked_at INTEGER,
        issued_by INTEGER
      )`);
      db.run(`CREATE INDEX idx_sessions_token_hash ON sessions(token_hash)`);
      db.run(`CREATE INDEX idx_sessions_device_fp ON sessions(device_fp, device_kind)`, (err) => {
        if (err) reject(err); else resolve(db);
      });
    });
  });
}

test('hashToken is stable + sha256 hex', () => {
  expect(hashToken('abc')).toBe(hashToken('abc'));
  expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  expect(hashToken('abc')).not.toBe(hashToken('abd'));
});

test('issue() returns plaintext token; verify() resolves the row', async () => {
  const db = await openDb();
  const store = createSessionsStore(db);
  const issued = await store.issue({
    deviceName: 'iPhone', deviceKind: 'mobile', deviceFp: 'fp-1',
  });
  expect(issued.token).toMatch(/^[0-9a-f]{64}$/);
  const row = await store.verify(issued.token);
  expect(row.device_name).toBe('iPhone');
  db.close();
});

test('verify() returns null for unknown token', async () => {
  const db = await openDb();
  const store = createSessionsStore(db);
  const row = await store.verify('not-a-real-token');
  expect(row).toBeNull();
  db.close();
});

test('verify() returns null for empty/non-string input', async () => {
  const db = await openDb();
  const store = createSessionsStore(db);
  expect(await store.verify('')).toBeNull();
  expect(await store.verify(null)).toBeNull();
  expect(await store.verify(undefined)).toBeNull();
  db.close();
});

test('re-pairing the same device overwrites the old token (UNIQUE fp+kind)', async () => {
  const db = await openDb();
  const store = createSessionsStore(db);
  const a = await store.issue({ deviceName: 'iPhone', deviceFp: 'fp-1' });
  const b = await store.issue({ deviceName: 'iPhone (renamed)', deviceFp: 'fp-1' });
  expect(a.token).not.toBe(b.token);
  // The first token is gone (row deleted, not revoked — re-pair replaces).
  expect(await store.verify(a.token)).toBeNull();
  // The new one works.
  const row = await store.verify(b.token);
  expect(row.device_name).toBe('iPhone (renamed)');
  db.close();
});

test('revoke() flips revoked_at; verify() then returns null', async () => {
  const db = await openDb();
  const store = createSessionsStore(db);
  const issued = await store.issue({ deviceName: 'X', deviceFp: 'fp-1' });
  const result = await store.revoke(issued.id);
  expect(result.revoked).toBe(1);
  expect(await store.verify(issued.token)).toBeNull();
  db.close();
});

test('revoke() cascades to derived watch tokens (issued_by chain)', async () => {
  const db = await openDb();
  const store = createSessionsStore(db);
  // Parent mobile session.
  const mobile = await store.issue({
    deviceName: 'iPhone', deviceKind: 'mobile', deviceFp: 'fp-mobile',
  });
  // Watch token derived from the mobile session.
  const watch = await store.issue({
    deviceName: 'Apple Watch', deviceKind: 'watch', deviceFp: 'fp-watch',
    issuedBy: mobile.id,
  });
  // Sanity: both verify.
  expect((await store.verify(mobile.token)).device_kind).toBe('mobile');
  expect((await store.verify(watch.token)).device_kind).toBe('watch');
  // Revoke mobile → watch cascade-revoked in the same UPDATE.
  const result = await store.revoke(mobile.id);
  expect(result.revoked).toBe(2);
  expect(await store.verify(mobile.token)).toBeNull();
  expect(await store.verify(watch.token)).toBeNull();
  db.close();
});

test('expired token (expires_at in the past) → verify returns null', async () => {
  const db = await openDb();
  const store = createSessionsStore(db);
  const issued = await store.issue({ deviceName: 'X', deviceFp: 'fp-1' });
  // Manually expire.
  await new Promise((res, rej) => db.run(
    'UPDATE sessions SET expires_at = ? WHERE id = ?',
    [Date.now() - 1000, issued.id],
    (e) => e ? rej(e) : res()
  ));
  expect(await store.verify(issued.token)).toBeNull();
  db.close();
});

test('list() returns rows newest-first', async () => {
  const db = await openDb();
  const store = createSessionsStore(db);
  await store.issue({ deviceName: 'first', deviceFp: 'fp-1' });
  await store.issue({ deviceName: 'second', deviceFp: 'fp-2' });
  await store.issue({ deviceName: 'third', deviceFp: 'fp-3' });
  const rows = await store.list();
  expect(rows.map((r) => r.device_name)).toEqual(['third', 'second', 'first']);
  db.close();
});

test('deviceKind is normalized (mobile/watch only)', async () => {
  const db = await openDb();
  const store = createSessionsStore(db);
  const weird = await store.issue({
    deviceName: 'X', deviceKind: 'tablet', deviceFp: 'fp-1',
  });
  const row = await store.verify(weird.token);
  expect(row.device_kind).toBe('mobile'); // normalized
  db.close();
});
