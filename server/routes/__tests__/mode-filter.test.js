/**
 * Mode-filter (?mode=film|digital) coverage for shared-view endpoints.
 *
 * Wave 2-B digital-mode: shared views (Calendar/Map/Favorites/Themes/
 * Statistics) now send ?mode= so film and digital workspaces stay pure.
 * These tests capture the SQL handed to the (mocked) db layer and assert
 * the source_type clause is present when mode is given and absent when not.
 */
const request = require('supertest');
const { buildApp } = require('./_helpers');

jest.mock('../../utils/db-helpers', () => ({
  allAsync: jest.fn().mockResolvedValue([]),
  getAsync: jest.fn().mockResolvedValue({ total: 0 }),
  runAsync: jest.fn().mockResolvedValue({}),
  paginateQuery: jest.fn().mockResolvedValue({ paginated: false, rows: [] }),
  validatePhotoUpdate: jest.fn(),
}));

jest.mock('../../services/tag-service', () => ({
  attachTagsToPhotos: jest.fn((rows) => rows),
  savePhotoTags: jest.fn(),
}));

const photosRouter = require('../photos');
const tagsRouter = require('../tags');
const statsRouter = require('../stats');
const { paginateQuery, allAsync, getAsync } = require('../../utils/db-helpers');

const FILM_CLAUSE = "(p.source_type = 'film' OR p.source_type IS NULL)";
const DIGITAL_CLAUSE = "p.source_type = 'digital'";

const lastPaginateSql = () => paginateQuery.mock.calls[paginateQuery.mock.calls.length - 1][0];
const lastAllSql = () => allAsync.mock.calls[allAsync.mock.calls.length - 1][0];
const lastGetSql = () => getAsync.mock.calls[getAsync.mock.calls.length - 1][0];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/photos/favorites — mode filter', () => {
  test('mode=digital adds digital source_type clause', async () => {
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos/favorites?mode=digital');
    expect(res.status).toBe(200);
    expect(lastPaginateSql()).toContain(DIGITAL_CLAUSE);
  });

  test('mode=film adds film source_type clause (NULL tolerated)', async () => {
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos/favorites?mode=film');
    expect(res.status).toBe(200);
    expect(lastPaginateSql()).toContain(FILM_CLAUSE);
  });

  test('no mode → no source_type filter (legacy behavior)', async () => {
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos/favorites');
    expect(res.status).toBe(200);
    expect(lastPaginateSql()).not.toContain('source_type');
  });
});

describe('GET /api/photos/geo — mode filter', () => {
  test('mode=digital filters both photos query and total count', async () => {
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos/geo?mode=digital');
    expect(res.status).toBe(200);
    expect(lastAllSql()).toContain(DIGITAL_CLAUSE);
    expect(lastGetSql()).toContain(DIGITAL_CLAUSE);
  });

  test('no mode → no source_type filter (legacy behavior)', async () => {
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos/geo');
    expect(res.status).toBe(200);
    expect(lastAllSql()).not.toContain('source_type');
    expect(lastGetSql()).not.toContain('source_type');
  });
});

describe('GET /api/tags — mode filter', () => {
  test('mode=digital scopes count and cover subqueries to digital photos', async () => {
    const app = buildApp((a) => a.use('/api/tags', tagsRouter));
    const res = await request(app).get('/api/tags?mode=digital');
    expect(res.status).toBe(200);
    expect(lastAllSql()).toContain(DIGITAL_CLAUSE);
  });

  test('mode=film uses film clause', async () => {
    const app = buildApp((a) => a.use('/api/tags', tagsRouter));
    const res = await request(app).get('/api/tags?mode=film');
    expect(res.status).toBe(200);
    expect(lastAllSql()).toContain(FILM_CLAUSE);
  });

  test('no mode → no source_type filter (legacy behavior)', async () => {
    const app = buildApp((a) => a.use('/api/tags', tagsRouter));
    const res = await request(app).get('/api/tags');
    expect(res.status).toBe(200);
    expect(lastAllSql()).not.toContain('source_type');
  });
});

describe('GET /api/tags/:tagId/photos — mode filter', () => {
  test('mode=digital adds digital source_type clause', async () => {
    const app = buildApp((a) => a.use('/api/tags', tagsRouter));
    const res = await request(app).get('/api/tags/5/photos?mode=digital');
    expect(res.status).toBe(200);
    expect(lastPaginateSql()).toContain(DIGITAL_CLAUSE);
  });

  test('no mode → no source_type filter (legacy behavior)', async () => {
    const app = buildApp((a) => a.use('/api/tags', tagsRouter));
    const res = await request(app).get('/api/tags/5/photos');
    expect(res.status).toBe(200);
    expect(lastPaginateSql()).not.toContain('source_type');
  });
});

describe('GET /api/stats/themes — mode filter', () => {
  test('mode=digital counts only digital photos', async () => {
    const app = buildApp((a) => a.use('/api/stats', statsRouter));
    const res = await request(app).get('/api/stats/themes?mode=digital');
    expect(res.status).toBe(200);
    expect(lastAllSql()).toContain(DIGITAL_CLAUSE);
  });

  test('no mode → no source_type filter (legacy behavior)', async () => {
    const app = buildApp((a) => a.use('/api/stats', statsRouter));
    const res = await request(app).get('/api/stats/themes');
    expect(res.status).toBe(200);
    expect(lastAllSql()).not.toContain('source_type');
  });
});

describe('GET /api/stats/locations — mode filter', () => {
  test('mode=film filters both UNION branches', async () => {
    const app = buildApp((a) => a.use('/api/stats', statsRouter));
    const res = await request(app).get('/api/stats/locations?mode=film');
    expect(res.status).toBe(200);
    const sql = lastAllSql();
    expect(sql).toContain(FILM_CLAUSE);
    expect(sql.split('source_type').length - 1).toBe(4); // 2 branches × 2 refs (col + IS NULL)
  });

  test('mode=digital filters both UNION branches', async () => {
    const app = buildApp((a) => a.use('/api/stats', statsRouter));
    const res = await request(app).get('/api/stats/locations?mode=digital');
    expect(res.status).toBe(200);
    const sql = lastAllSql();
    expect(sql).toContain(DIGITAL_CLAUSE);
    expect(sql.split('source_type').length - 1).toBe(2); // 2 branches × 1 ref
  });

  test('no mode → no source_type filter (legacy behavior)', async () => {
    const app = buildApp((a) => a.use('/api/stats', statsRouter));
    const res = await request(app).get('/api/stats/locations');
    expect(res.status).toBe(200);
    expect(lastAllSql()).not.toContain('source_type');
  });
});
