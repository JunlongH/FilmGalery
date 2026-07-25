/**
 * Contract tests for routes/digital-develop.js.
 *
 * Locks the client↔server contract the DigitalDevelop panel depends on:
 *   - POST /preview accepts { photo_id, params_json } → image/jpeg body.
 *   - POST /save accepts { photo_id, params_json } → JSON { ok: true, ... }.
 *   - POST /export accepts { photo_id, params_json } → image/jpeg attachment.
 *   - Missing photo_id → 400 on all three.
 *   - The legacy client keys ({ photoId, params }) must NOT satisfy the route.
 *
 * The service is mocked — pixel-pipeline coverage lives in tests/01-05.
 */
const request = require('supertest');
const { buildApp } = require('./_helpers');

const mockFakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

function binaryParser(res, cb) {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

jest.mock('../../services/digital-develop-service', () => ({
  renderPreview: jest.fn().mockResolvedValue(mockFakeJpeg),
  renderExport: jest.fn().mockResolvedValue({ buffer: mockFakeJpeg, width: 8, height: 8 }),
  save: jest.fn().mockResolvedValue({ photoId: 1, positivePath: 'p.jpg', thumbPath: 't.jpg' }),
  getParams: jest.fn().mockResolvedValue({ exposure: 10 }),
}));

const digitalDevelopService = require('../../services/digital-develop-service');
const router = require('../digital-develop');

const params = { exposure: 10, contrast: -5 };

describe('routes/digital-develop — preview/save/export contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /preview with { photo_id, params_json } → 200 image/jpeg', async () => {
    const app = buildApp((a) => a.use('/api/digital-develop', router));
    const res = await request(app)
      .post('/api/digital-develop/preview')
      .send({ photo_id: 1, params_json: params })
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(Buffer.compare(res.body, mockFakeJpeg)).toBe(0);
    expect(digitalDevelopService.renderPreview).toHaveBeenCalledWith(1, params);
  });

  test('POST /preview with legacy { photoId, params } → 400 (regression)', async () => {
    const app = buildApp((a) => a.use('/api/digital-develop', router));
    const res = await request(app)
      .post('/api/digital-develop/preview')
      .send({ photoId: 1, params });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(digitalDevelopService.renderPreview).not.toHaveBeenCalled();
  });

  test('POST /save with { photo_id, params_json } → 200 JSON { ok: true }', async () => {
    const app = buildApp((a) => a.use('/api/digital-develop', router));
    const res = await request(app)
      .post('/api/digital-develop/save')
      .send({ photo_id: 1, params_json: params });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.ok).toBe(true);
    expect(digitalDevelopService.save).toHaveBeenCalledWith(1, params);
  });

  test('POST /save without photo_id → 400', async () => {
    const app = buildApp((a) => a.use('/api/digital-develop', router));
    const res = await request(app)
      .post('/api/digital-develop/save')
      .send({ params_json: params });
    expect(res.status).toBe(400);
    expect(digitalDevelopService.save).not.toHaveBeenCalled();
  });

  test('POST /export with { photo_id, params_json } → 200 image/jpeg attachment', async () => {
    const app = buildApp((a) => a.use('/api/digital-develop', router));
    const res = await request(app)
      .post('/api/digital-develop/export')
      .send({ photo_id: 1, params_json: params });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(digitalDevelopService.renderExport).toHaveBeenCalledWith(1, params);
  });

  test('GET /:photoId/params → 200 { params }', async () => {
    const app = buildApp((a) => a.use('/api/digital-develop', router));
    const res = await request(app).get('/api/digital-develop/1/params');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ params: { exposure: 10 } });
    expect(digitalDevelopService.getParams).toHaveBeenCalledWith(1);
  });
});
