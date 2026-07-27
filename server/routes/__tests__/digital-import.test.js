/**
 * Contract tests for routes/digital-import.js.
 *
 * Locks the client↔server execute contract the import wizard depends on:
 *   - POST /execute accepts { items, session_title, album_id } → 202 + jobId,
 *     and forwards the exact body keys to digitalImportService.execute.
 *   - POST /execute without items (or with the legacy { files } shape) → 400.
 *
 * The service is mocked so no DB / filesystem / sharp work happens; the
 * job registry is real (in-memory, no I/O).
 */
const request = require('supertest');
const { buildApp } = require('./_helpers');

jest.mock('../../services/digital-import-service', () => ({
  preview: jest.fn(),
  execute: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/prepared-statements', () => ({
  getAsync: jest.fn().mockResolvedValue(null),
  allAsync: jest.fn().mockResolvedValue([]),
}));

const digitalImportService = require('../../services/digital-import-service');
const router = require('../digital-import');

const sampleItem = {
  file: { path: '/tmp/x.jpg', originalname: 'x.jpg', size: 123 },
  hash: 'abc123',
  duplicate: false,
  existingId: null,
  isRaw: false,
  rawSupported: null,
  exif: { make: 'Canon', model: 'EOS R5', dateTimeOriginal: '2026-01-01T00:00:00.000Z' },
};

describe('routes/digital-import — execute contract', () => {
  beforeEach(() => {
    digitalImportService.execute.mockClear();
  });

  test('POST /execute with { items, session_title, album_id } → 202 + jobId', async () => {
    const app = buildApp((a) => a.use('/api/digital/import', router));
    const res = await request(app)
      .post('/api/digital/import/execute')
      .send({ items: [sampleItem], session_title: '测试导入', album_id: 7 });
    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.jobId).toBe('string');
    expect(res.body.jobId.length).toBeGreaterThan(0);
  });

  test('POST /execute forwards exact body keys to the service', async () => {
    const app = buildApp((a) => a.use('/api/digital/import', router));
    await request(app)
      .post('/api/digital/import/execute')
      .send({ items: [sampleItem], session_title: '测试导入', album_id: 7 });
    expect(digitalImportService.execute).toHaveBeenCalledTimes(1);
    const [body, jobId, registry] = digitalImportService.execute.mock.calls[0];
    expect(body).toEqual({ items: [sampleItem], session_title: '测试导入', album_id: 7 });
    expect(typeof jobId).toBe('string');
    expect(registry).toBeDefined();
  });

  test('POST /execute without items → 400', async () => {
    const app = buildApp((a) => a.use('/api/digital/import', router));
    const res = await request(app)
      .post('/api/digital/import/execute')
      .send({ session_title: 'x' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(digitalImportService.execute).not.toHaveBeenCalled();
  });

  test('POST /execute with legacy { files } shape → 400 (regression)', async () => {
    // The pre-fix client sent { files, album_id } — the server must keep
    // rejecting it so the shapes can't silently drift again.
    const app = buildApp((a) => a.use('/api/digital/import', router));
    const res = await request(app)
      .post('/api/digital/import/execute')
      .send({ files: [sampleItem], album_id: 7 });
    expect(res.status).toBe(400);
    expect(digitalImportService.execute).not.toHaveBeenCalled();
  });

  test('POST /execute with empty items array → 400', async () => {
    const app = buildApp((a) => a.use('/api/digital/import', router));
    const res = await request(app)
      .post('/api/digital/import/execute')
      .send({ items: [] });
    expect(res.status).toBe(400);
    expect(digitalImportService.execute).not.toHaveBeenCalled();
  });
});

describe('routes/digital-import — preview contract', () => {
  beforeEach(() => {
    digitalImportService.preview.mockClear();
    digitalImportService.preview.mockResolvedValue({ total: 0, items: [] });
  });

  test('POST /preview with multiple files → 200, forwards ALL files to service', async () => {
    // Regression for multi-photo import: multer must parse every file under
    // the shared 'files' field name and hand the full array to the service.
    const app = buildApp((a) => a.use('/api/digital/import', router));
    digitalImportService.preview.mockResolvedValue({
      total: 3, items: [], duplicates: 0, raws: 0,
    });
    const res = await request(app)
      .post('/api/digital/import/preview')
      .attach('files', Buffer.from('img1-bytes'), 'a.jpg')
      .attach('files', Buffer.from('img2-bytes'), 'b.jpg')
      .attach('files', Buffer.from('img3-bytes'), 'c.jpg');

    expect(res.status).toBe(200);
    expect(digitalImportService.preview).toHaveBeenCalledTimes(1);
    const files = digitalImportService.preview.mock.calls[0][0];
    expect(files).toHaveLength(3);
    expect(files.map((f) => f.originalname)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    files.forEach((f) => {
      expect(typeof f.path).toBe('string'); // multer wrote to disk
      expect(typeof f.size).toBe('number');
    });
  });

  test('POST /preview with a single file → 200', async () => {
    const app = buildApp((a) => a.use('/api/digital/import', router));
    const res = await request(app)
      .post('/api/digital/import/preview')
      .attach('files', Buffer.from('solo'), 'solo.jpg');

    expect(res.status).toBe(200);
    expect(digitalImportService.preview).toHaveBeenCalledTimes(1);
    expect(digitalImportService.preview.mock.calls[0][0]).toHaveLength(1);
  });

  test('POST /preview with no files → 400', async () => {
    const app = buildApp((a) => a.use('/api/digital/import', router));
    const res = await request(app)
      .post('/api/digital/import/preview');

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(digitalImportService.preview).not.toHaveBeenCalled();
  });
});
