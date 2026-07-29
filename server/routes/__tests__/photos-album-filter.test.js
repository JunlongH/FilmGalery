/**
 * GET /api/photos?album_id= filter coverage.
 *
 * Covers the M2M album_photos membership filter, including the inverse
 * "uncategorized" sentinel (`album_id=none` / `album_id=uncategorized`)
 * added so the album "add photos" picker can surface photos that are not
 * in any album. Mocks the db layer and asserts the generated SQL + params.
 */
const request = require('supertest');
const { buildApp } = require('./_helpers');

let capturedSql = null;
let capturedParams = null;

jest.mock('../../utils/db-helpers', () => ({
  allAsync: jest.fn().mockResolvedValue([]),
  getAsync: jest.fn().mockResolvedValue({ name: 'locations' }),
  runAsync: jest.fn().mockResolvedValue({}),
  validatePhotoUpdate: jest.fn(),
  paginateQuery: jest.fn(async (baseSql, params) => {
    capturedSql = baseSql;
    capturedParams = params;
    return { paginated: false, rows: [] };
  }),
}));

jest.mock('../../services/tag-service', () => ({
  attachTagsToPhotos: jest.fn((rows) => rows),
  savePhotoTags: jest.fn(),
}));

const router = require('../photos');

beforeEach(() => {
  capturedSql = null;
  capturedParams = null;
  jest.clearAllMocks();
});

describe('GET /api/photos?album_id= — membership + uncategorized filter', () => {
  test('album_id=<number> emits a positive membership EXISTS clause', async () => {
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).get('/api/photos?album_id=7');
    expect(res.status).toBe(200);
    expect(capturedSql).toContain('EXISTS');
    expect(capturedSql).toContain('album_photos');
    expect(capturedSql).toContain('ap.album_id = ?');
    expect(capturedParams).toContain(7);
    expect(capturedSql).not.toContain('NOT EXISTS');
  });

  test('album_id=none emits an inverse NOT EXISTS (uncategorized) clause with no bind', async () => {
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).get('/api/photos?album_id=none');
    expect(res.status).toBe(200);
    expect(capturedSql).toContain('NOT EXISTS');
    expect(capturedSql).toContain('album_photos');
    expect(capturedSql).toContain('ap.photo_id = p.id');
    // No album_id value should be bound for the sentinel branch.
    expect(capturedParams).not.toContain('none');
  });

  test('album_id=uncategorized behaves identically to album_id=none', async () => {
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).get('/api/photos?album_id=uncategorized');
    expect(res.status).toBe(200);
    expect(capturedSql).toContain('NOT EXISTS');
  });

  test('non-numeric, non-sentinel album_id → 400', async () => {
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).get('/api/photos?album_id=abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/album_id/);
  });
});
