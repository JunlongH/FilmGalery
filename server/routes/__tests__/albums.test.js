/**
 * GET /api/albums?photo_id= coverage.
 *
 * Wave 3-B digital-mode: the albums list endpoint can be filtered by photo
 * membership (albums containing a given photo) for the digital sidebar's
 * 所在相册 section. These tests mock the db layer and assert the join SQL
 * and params, plus that legacy params (parent_id / include_deleted) and the
 * prepared-statement path stay intact.
 */
const request = require('supertest');
const { buildApp } = require('./_helpers');

jest.mock('../../utils/prepared-statements', () => ({
  allAsync: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../utils/db-helpers', () => ({
  allAsync: jest.fn().mockResolvedValue([]),
  getAsync: jest.fn().mockResolvedValue(null),
  runAsync: jest.fn().mockResolvedValue({}),
}));

const albumsRouter = require('../albums');
const PreparedStmt = require('../../utils/prepared-statements');
const { allAsync } = require('../../utils/db-helpers');

const lastAllSql = () => allAsync.mock.calls[allAsync.mock.calls.length - 1][0];
const lastAllParams = () => allAsync.mock.calls[allAsync.mock.calls.length - 1][1];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/albums?photo_id= — photo membership filter', () => {
  test('photo_id joins album_photos and filters by membership', async () => {
    const app = buildApp((a) => a.use('/api/albums', albumsRouter));
    const res = await request(app).get('/api/albums?photo_id=123');
    expect(res.status).toBe(200);
    const sql = lastAllSql();
    expect(sql).toContain('album_photos');
    expect(sql).toContain('ap.photo_id = ?');
    expect(lastAllParams()[0]).toBe(123);
    expect(PreparedStmt.allAsync).not.toHaveBeenCalled();
  });

  test('photo_id excludes soft-deleted albums by default, honors include_deleted', async () => {
    const app = buildApp((a) => a.use('/api/albums', albumsRouter));
    let res = await request(app).get('/api/albums?photo_id=7');
    expect(res.status).toBe(200);
    expect(lastAllSql()).toContain('a.deleted_at IS NULL');
    expect(lastAllParams()[1]).toBe(0);

    res = await request(app).get('/api/albums?photo_id=7&include_deleted=true');
    expect(res.status).toBe(200);
    expect(lastAllParams()[1]).toBe(1);
  });

  test('photo_id composes with parent_id filter', async () => {
    const app = buildApp((a) => a.use('/api/albums', albumsRouter));
    const res = await request(app).get('/api/albums?photo_id=7&parent_id=3');
    expect(res.status).toBe(200);
    expect(lastAllSql()).toContain('a.parent_id = ?');
    expect(lastAllParams()).toEqual([7, 0, 3, 3]);
  });

  test('non-numeric photo_id → 400', async () => {
    const app = buildApp((a) => a.use('/api/albums', albumsRouter));
    const res = await request(app).get('/api/albums?photo_id=abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/photo_id/);
    expect(allAsync).not.toHaveBeenCalled();
  });

  test('no photo_id → legacy prepared-statement path (unchanged)', async () => {
    const app = buildApp((a) => a.use('/api/albums', albumsRouter));
    const res = await request(app).get('/api/albums');
    expect(res.status).toBe(200);
    expect(PreparedStmt.allAsync).toHaveBeenCalledWith('albums.list', [0, null, null]);
    expect(allAsync).not.toHaveBeenCalled();
  });
});
