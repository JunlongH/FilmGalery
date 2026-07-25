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
const { allAsync } = require('../../utils/db-helpers');

const DIGITAL_CLAUSE = "p.source_type = 'digital'";
const FILM_CLAUSE = "(p.source_type = 'film' OR p.source_type IS NULL)";

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/photos/facets', () => {
  test('mode=digital applies digital clause + deleted_at filter to all facet queries', async () => {
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos/facets?mode=digital');
    expect(res.status).toBe(200);
    expect(allAsync).toHaveBeenCalledTimes(3);
    for (const call of allAsync.mock.calls) {
      expect(call[0]).toContain(DIGITAL_CLAUSE);
      expect(call[0]).toContain('p.deleted_at IS NULL');
    }
  });

  test('mode=film applies film clause (NULL tolerated)', async () => {
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos/facets?mode=film');
    expect(res.status).toBe(200);
    expect(allAsync).toHaveBeenCalledTimes(3);
    for (const call of allAsync.mock.calls) {
      expect(call[0]).toContain(FILM_CLAUSE);
    }
  });

  test('no mode → no source_type filter, deleted rows still excluded', async () => {
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos/facets');
    expect(res.status).toBe(200);
    for (const call of allAsync.mock.calls) {
      expect(call[0]).not.toContain('source_type');
      expect(call[0]).toContain('p.deleted_at IS NULL');
    }
  });

  test('response nests month buckets under years and passes camera/lens rows through', async () => {
    allAsync
      .mockResolvedValueOnce([
        { year: '2025', month: '05', count: 12 },
        { year: '2025', month: '03', count: 4 },
        { year: '2024', month: '11', count: 7 },
      ])
      .mockResolvedValueOnce([{ value: 'ILCE-7M3', count: 30 }])
      .mockResolvedValueOnce([{ value: 'FE 35mm F1.8', count: 18 }]);
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos/facets?mode=digital');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      years: [
        { year: '2025', count: 16, months: [
          { month: '05', count: 12 },
          { month: '03', count: 4 },
        ] },
        { year: '2024', count: 7, months: [
          { month: '11', count: 7 },
        ] },
      ],
      cameras: [{ value: 'ILCE-7M3', count: 30 }],
      lenses: [{ value: 'FE 35mm F1.8', count: 18 }],
    });
  });

  test('db failure → 500 contract', async () => {
    allAsync.mockRejectedValueOnce(new Error('db connection lost'));
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos/facets?mode=digital');
    expect(res.status).toBe(500);
    expect(typeof res.body.error).toBe('string');
  });
});

describe('GET /api/photos — sort whitelist', () => {
  const { paginateQuery } = require('../../utils/db-helpers');
  const lastSql = () => paginateQuery.mock.calls[paginateQuery.mock.calls.length - 1][0];

  test('default sort unchanged: date_taken DESC with id tiebreaker', async () => {
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos');
    expect(res.status).toBe(200);
    expect(lastSql()).toContain('ORDER BY p.date_taken DESC NULLS LAST, p.id DESC');
  });

  test('sort=rating&order=desc is honored', async () => {
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos?sort=rating&order=desc');
    expect(res.status).toBe(200);
    expect(lastSql()).toContain('ORDER BY p.rating DESC, p.id DESC');
  });

  test('sort=date_taken&order=asc keeps NULLS LAST', async () => {
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos?sort=date_taken&order=asc');
    expect(res.status).toBe(200);
    expect(lastSql()).toContain('ORDER BY p.date_taken ASC NULLS LAST, p.id DESC');
  });

  test('sort=id&order=asc is honored', async () => {
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos?sort=id&order=asc');
    expect(res.status).toBe(200);
    expect(lastSql()).toContain('ORDER BY p.id ASC, p.id DESC');
  });

  test('invalid sort/order values fall back to default without injecting raw input', async () => {
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app).get('/api/photos?sort=date_taken;DROP TABLE photos&order=sideways');
    expect(res.status).toBe(200);
    const sql = lastSql();
    expect(sql).toContain('ORDER BY p.date_taken DESC NULLS LAST, p.id DESC');
    expect(sql).not.toContain('DROP');
    expect(sql).not.toContain('sideways');
  });
});
