/**
 * Error-path coverage for routes/uploads.js.
 *
 * uploads.js delegates to multer; failures come out as express errors. We
 * mount the router with a stubbed middleware that calls next(err) to verify
 * the route's catch + errorHandler handle multer failures cleanly.
 *
 * Locks: upload middleware failure → 500 contract.
 */
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

jest.mock('../../config/multer', () => ({
  uploadTmp: {
    array: () => (_req, _res, next) => next(new Error('multer disk I/O failed')),
  },
}));

const router = require('../uploads');

describe('POST /api/uploads — error path', () => {
  test('upload middleware failure yields 500 contract', async () => {
    const app = buildApp((a) => a.use('/api/uploads', router));
    const res = await request(app)
      .post('/api/uploads')
      .attach('files', Buffer.from('x'), 'x.jpg');
    assertServerErrorContract(res);
  });
});
