/**
 * Soft-delete coverage for routes/digital-sessions.js.
 *
 * Locks:
 *   - GET /:id/photos gates on a live session: a soft-deleted or missing
 *     session yields 404 { error: 'Session not found' } and the photos
 *     query is never run. The photos JOIN no longer needs its own
 *     deleted_at predicate because the gate guarantees a live session.
 *   - GET /:id (regression guard) already filters deleted_at via the
 *     digitalSessions.getById prepared statement.
 *
 * DB layer is mocked; PreparedStmt.getAsync is captured by key.
 */
const request = require('supertest');
const { buildApp } = require('./_helpers');

jest.mock('../../utils/db-helpers', () => ({
  allAsync: jest.fn().mockResolvedValue([]),
  getAsync: jest.fn().mockResolvedValue(null),
  runAsync: jest.fn().mockResolvedValue({ changes: 1 }),
}));

jest.mock('../../utils/prepared-statements', () => ({
  getAsync: jest.fn().mockResolvedValue(null),
  allAsync: jest.fn().mockResolvedValue([]),
  runAsync: jest.fn().mockResolvedValue({ changes: 1 }),
}));

const PreparedStmt = require('../../utils/prepared-statements');
const { allAsync } = require('../../utils/db-helpers');
const router = require('../digital-sessions');

const LIVE_SESSION = { id: 5, label: 'Studio', deleted_at: null };

beforeEach(() => {
  jest.clearAllMocks();
  PreparedStmt.getAsync.mockResolvedValue(null);
});

describe('GET /api/digital-sessions/:id/photos — soft-delete gate', () => {
  test('live session → 200 with its non-deleted photos', async () => {
    PreparedStmt.getAsync.mockResolvedValue(LIVE_SESSION);
    const photos = [{ id: 1, session_id: 5, deleted_at: null }];
    allAsync.mockResolvedValue(photos);

    const app = buildApp((a) => a.use('/api/digital-sessions', router));
    const res = await request(app).get('/api/digital-sessions/5/photos');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(photos);
    expect(PreparedStmt.getAsync).toHaveBeenCalledWith('digitalSessions.getById', ['5']);
    expect(allAsync).toHaveBeenCalledTimes(1);
    expect(allAsync.mock.calls[0][1]).toEqual(['5']);
  });

  test('soft-deleted session → 404 { error: "Session not found" }, photos query skipped', async () => {
    PreparedStmt.getAsync.mockResolvedValue(null);

    const app = buildApp((a) => a.use('/api/digital-sessions', router));
    const res = await request(app).get('/api/digital-sessions/5/photos');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Session not found' });
    expect(allAsync).not.toHaveBeenCalled();
  });

  test('nonexistent session → 404', async () => {
    PreparedStmt.getAsync.mockResolvedValue(null);

    const app = buildApp((a) => a.use('/api/digital-sessions', router));
    const res = await request(app).get('/api/digital-sessions/9999/photos');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Session not found' });
    expect(allAsync).not.toHaveBeenCalled();
  });
});

describe('GET /api/digital-sessions/:id — regression guard', () => {
  test('soft-deleted session → 404 (prepared statement filters deleted_at)', async () => {
    PreparedStmt.getAsync.mockResolvedValue(null);

    const app = buildApp((a) => a.use('/api/digital-sessions', router));
    const res = await request(app).get('/api/digital-sessions/5');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Session not found' });
    expect(PreparedStmt.getAsync).toHaveBeenCalledWith('digitalSessions.getById', ['5']);
  });
});
