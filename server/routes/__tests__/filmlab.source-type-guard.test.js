/**
 * Source-type guard coverage for film-pipeline endpoints (D-P0-1 / D-M4).
 *
 * Film-pipeline endpoints (FilmLab preview/render/export, photos render-positive,
 * edge-detection) must reject digital photos with HTTP 409 source_type_mismatch
 * before touching disk or DB writes. Previously they queried photos without a
 * source_type guard — /api/filmlab/render even overwrote the digital photo's
 * positive_rel_path, causing irreversible data loss.
 *
 * DB and IO layers are mocked; we exercise the guard in isolation.
 */
const request = require('supertest');
const { buildApp } = require('./_helpers');

jest.mock('../../db', () => ({
  get: jest.fn(),
  run: jest.fn(),
}));

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

jest.mock('../../services/edge-detection-service', () => ({
  detectEdges: jest.fn().mockResolvedValue({ success: true, result: { isValid: true } }),
  detectEdgesBatch: jest.fn().mockResolvedValue([]),
}));

const db = require('../../db');
const { getAsync } = require('../../utils/db-helpers');
const filmlabRouter = require('../filmlab');
const photosRouter = require('../photos');
const edgeDetectionRouter = require('../edge-detection');

const digitalPhoto = {
  id: 1, roll_id: null, frame_number: '01', source_type: 'digital',
  filename: 'IMG_0001.jpg',
  original_rel_path: 'digital/sessions/abc/IMG_0001.jpg',
  positive_rel_path: 'digital/sessions/abc/IMG_0001.jpg',
  full_rel_path: null, negative_rel_path: null,
  positive_thumb_rel_path: null,
};

// Film row with no resolvable source path — guard passes (not 409), then the
// existing source_type_unavailable check returns 400 (not 404), satisfying the
// "may fail later for missing files" positive-case contract.
const filmPhotoNoPath = {
  id: 2, roll_id: 5, frame_number: '02', source_type: 'film',
  filename: null, original_rel_path: null, positive_rel_path: null,
  full_rel_path: null, negative_rel_path: null,
  positive_thumb_rel_path: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/filmlab/preview — source_type guard', () => {
  test('digital photo → 409 source_type_mismatch', async () => {
    db.get.mockImplementation((sql, params, cb) => cb(null, digitalPhoto));
    const app = buildApp((a) => a.use('/api/filmlab', filmlabRouter));
    const res = await request(app)
      .post('/api/filmlab/preview')
      .send({ photoId: 1, params: {}, sourceType: 'original' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('source_type_mismatch');
    expect(res.body.sourceType).toBe('digital');
    expect(res.body.photoId).toBe(1);
  });

  test('film photo → passes guard (not 409, not 404)', async () => {
    db.get.mockImplementation((sql, params, cb) => cb(null, filmPhotoNoPath));
    const app = buildApp((a) => a.use('/api/filmlab', filmlabRouter));
    const res = await request(app)
      .post('/api/filmlab/preview')
      .send({ photoId: 2, params: {}, sourceType: 'original' });
    expect(res.status).not.toBe(409);
    expect(res.status).not.toBe(404);
  });
});

describe('POST /api/filmlab/render — source_type guard', () => {
  test('digital photo → 409 source_type_mismatch (prevents positive_rel_path overwrite)', async () => {
    db.get.mockImplementation((sql, params, cb) => cb(null, digitalPhoto));
    const app = buildApp((a) => a.use('/api/filmlab', filmlabRouter));
    const res = await request(app)
      .post('/api/filmlab/render')
      .send({ photoId: 1, params: {}, sourceType: 'original' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('source_type_mismatch');
    expect(db.run).not.toHaveBeenCalled();
  });

  test('film photo → passes guard (not 409, not 404)', async () => {
    db.get.mockImplementation((sql, params, cb) => cb(null, filmPhotoNoPath));
    const app = buildApp((a) => a.use('/api/filmlab', filmlabRouter));
    const res = await request(app)
      .post('/api/filmlab/render')
      .send({ photoId: 2, params: {}, sourceType: 'original' });
    expect(res.status).not.toBe(409);
    expect(res.status).not.toBe(404);
  });
});

describe('POST /api/filmlab/export — source_type guard', () => {
  test('digital photo → 409 source_type_mismatch', async () => {
    db.get.mockImplementation((sql, params, cb) => cb(null, digitalPhoto));
    const app = buildApp((a) => a.use('/api/filmlab', filmlabRouter));
    const res = await request(app)
      .post('/api/filmlab/export')
      .send({ photoId: 1, params: {}, sourceType: 'original' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('source_type_mismatch');
    expect(db.run).not.toHaveBeenCalled();
  });

  test('film photo → passes guard (not 409, not 404)', async () => {
    db.get.mockImplementation((sql, params, cb) => cb(null, filmPhotoNoPath));
    const app = buildApp((a) => a.use('/api/filmlab', filmlabRouter));
    const res = await request(app)
      .post('/api/filmlab/export')
      .send({ photoId: 2, params: {}, sourceType: 'original' });
    expect(res.status).not.toBe(409);
    expect(res.status).not.toBe(404);
  });
});

describe('POST /api/photos/:id/render-positive — source_type guard', () => {
  test('digital photo → 409 source_type_mismatch', async () => {
    getAsync.mockResolvedValue(digitalPhoto);
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app)
      .post('/api/photos/1/render-positive')
      .send({ params: { sourceType: 'original' }, format: 'jpeg' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('source_type_mismatch');
    expect(res.body.sourceType).toBe('digital');
  });

  test('film photo → passes guard (not 409, not 404)', async () => {
    getAsync.mockResolvedValue(filmPhotoNoPath);
    const app = buildApp((a) => a.use('/api/photos', photosRouter));
    const res = await request(app)
      .post('/api/photos/2/render-positive')
      .send({ params: { sourceType: 'original' }, format: 'jpeg' });
    expect(res.status).not.toBe(409);
    expect(res.status).not.toBe(404);
  });
});

describe('POST /api/photos/:id/detect-edges — source_type guard', () => {
  test('digital photo → 409 source_type_mismatch ({ success: false, ... } shape)', async () => {
    getAsync.mockResolvedValue(digitalPhoto);
    const app = buildApp((a) => a.use('/', edgeDetectionRouter));
    const res = await request(app)
      .post('/photos/1/detect-edges')
      .send({ sensitivity: 50, sourceType: 'original' });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('source_type_mismatch');
    expect(res.body.sourceType).toBe('digital');
  });

  test('film photo → passes guard (not 409, not 404)', async () => {
    getAsync.mockResolvedValue({ ...filmPhotoNoPath, filename: 'frame_02.nef' });
    const app = buildApp((a) => a.use('/', edgeDetectionRouter));
    const res = await request(app)
      .post('/photos/2/detect-edges')
      .send({ sensitivity: 50, sourceType: 'original' });
    expect(res.status).not.toBe(409);
    expect(res.status).not.toBe(404);
  });
});

describe('POST /api/photos/:id/apply-edge-detection — source_type guard', () => {
  test('digital photo → 409 source_type_mismatch ({ success: false, ... } shape)', async () => {
    getAsync.mockResolvedValue(digitalPhoto);
    const app = buildApp((a) => a.use('/', edgeDetectionRouter));
    const res = await request(app)
      .post('/photos/1/apply-edge-detection')
      .send({ cropRect: { x: 0, y: 0, w: 1, h: 1 }, rotation: 0 });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('source_type_mismatch');
    expect(res.body.sourceType).toBe('digital');
  });

  test('film photo → passes guard (not 409, not 404)', async () => {
    getAsync.mockResolvedValue({ ...filmPhotoNoPath, filename: 'frame_02.nef' });
    const app = buildApp((a) => a.use('/', edgeDetectionRouter));
    const res = await request(app)
      .post('/photos/2/apply-edge-detection')
      .send({ cropRect: { x: 0, y: 0, w: 1, h: 1 }, rotation: 0 });
    expect(res.status).not.toBe(409);
    expect(res.status).not.toBe(404);
  });
});
