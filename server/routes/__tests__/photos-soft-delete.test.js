/**
 * Soft-delete coverage for routes/photos.js (Wave 3-C).
 *
 * Locks:
 *   - DELETE /api/photos/:id (default) → soft delete: UPDATE ... SET deleted_at,
 *     files untouched, 404 for missing / already-deleted rows.
 *   - DELETE /api/photos/:id?hard=true → legacy hard delete: DELETE FROM photos.
 *   - POST /api/photos/:id/restore → clears deleted_at, 404 if not deleted.
 *   - GET /api/photos list excludes deleted rows (p.deleted_at IS NULL).
 *   - photos.checkHash ignores soft-deleted rows (dedup re-import allowed).
 *
 * DB layer is mocked; SQL handed to it is captured and asserted.
 */
const request = require('supertest');
const { buildApp } = require('./_helpers');

jest.mock('../../utils/db-helpers', () => ({
  allAsync: jest.fn().mockResolvedValue([]),
  getAsync: jest.fn(),
  runAsync: jest.fn().mockResolvedValue({ changes: 1 }),
  paginateQuery: jest.fn().mockResolvedValue({ paginated: false, rows: [] }),
  validatePhotoUpdate: jest.fn(),
}));

jest.mock('../../services/tag-service', () => ({
  attachTagsToPhotos: jest.fn((rows) => rows),
  savePhotoTags: jest.fn(),
}));

jest.mock('../../db', () => ({}));

const router = require('../photos');
const { STATEMENTS } = require('../../utils/prepared-statements');
const { getAsync, runAsync, paginateQuery } = require('../../utils/db-helpers');

const runSqls = () => runAsync.mock.calls.map((c) => c[0]);

beforeEach(() => {
  jest.clearAllMocks();
  runAsync.mockResolvedValue({ changes: 1 });
});

describe('DELETE /api/photos/:id — soft delete (default)', () => {
  test('sets deleted_at and does not remove the row', async () => {
    getAsync.mockResolvedValue({ id: 5, deleted_at: null });
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).delete('/api/photos/5');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1, soft: true });
    const sqls = runSqls();
    expect(sqls.some((s) => /UPDATE photos SET deleted_at = CURRENT_TIMESTAMP/.test(s))).toBe(true);
    expect(sqls.some((s) => /DELETE FROM photos/.test(s))).toBe(false);
  });

  test('missing photo → 404', async () => {
    getAsync.mockResolvedValue(null);
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).delete('/api/photos/999');
    expect(res.status).toBe(404);
    expect(runAsync).not.toHaveBeenCalled();
  });

  test('already soft-deleted photo → 404', async () => {
    getAsync.mockResolvedValue({ id: 5, deleted_at: '2026-07-01 00:00:00' });
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).delete('/api/photos/5');
    expect(res.status).toBe(404);
    expect(runAsync).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/photos/:id?hard=true — legacy hard delete', () => {
  test('removes the DB row', async () => {
    getAsync.mockResolvedValue({
      roll_id: 1, filename: null, full_rel_path: null, thumb_rel_path: null,
      original_rel_path: null, negative_rel_path: null, positive_rel_path: null,
      positive_thumb_rel_path: null, negative_thumb_rel_path: null,
    });
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).delete('/api/photos/5?hard=true');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
    const sqls = runSqls();
    expect(sqls.some((s) => /DELETE FROM photos WHERE id = \?/.test(s))).toBe(true);
    expect(sqls.some((s) => /SET deleted_at/.test(s))).toBe(false);
  });
});

describe('POST /api/photos/:id/restore', () => {
  test('clears deleted_at for a soft-deleted photo', async () => {
    getAsync.mockResolvedValue({ id: 5, deleted_at: '2026-07-01 00:00:00' });
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).post('/api/photos/5/restore');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ restored: true, id: 5 });
    expect(runSqls().some((s) => /UPDATE photos SET deleted_at = NULL WHERE id = \?/.test(s))).toBe(true);
  });

  test('missing photo → 404', async () => {
    getAsync.mockResolvedValue(null);
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).post('/api/photos/999/restore');
    expect(res.status).toBe(404);
    expect(runAsync).not.toHaveBeenCalled();
  });

  test('photo that is not deleted → 404', async () => {
    getAsync.mockResolvedValue({ id: 5, deleted_at: null });
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).post('/api/photos/5/restore');
    expect(res.status).toBe(404);
    expect(runAsync).not.toHaveBeenCalled();
  });
});

describe('soft-deleted rows stay out of read paths', () => {
  test('GET /api/photos list filters p.deleted_at IS NULL', async () => {
    getAsync.mockResolvedValue({ total: 0 });
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).get('/api/photos');
    expect(res.status).toBe(200);
    const sql = paginateQuery.mock.calls[paginateQuery.mock.calls.length - 1][0];
    expect(sql).toContain('p.deleted_at IS NULL');
  });

  test('photos.checkHash ignores soft-deleted rows', () => {
    expect(STATEMENTS['photos.checkHash']).toContain('deleted_at IS NULL');
  });
});
