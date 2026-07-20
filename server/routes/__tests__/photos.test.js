/**
 * Error-path coverage for routes/photos.js.
 *
 * Photos router is heavy (sharp, fs, RenderCore). We mock the DB layer and
 * exercise the cheap read paths only — full pixel-pipeline coverage lives in
 * tests/01-05 (rendering consistency) and will be added under 2C.3 perf suite.
 *
 * Locks:
 *   - GET /api/photos with db failure → 500 contract
 *   - GET /api/photos/single/:id with db failure → 500 contract
 */
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

jest.mock('../../utils/db-helpers', () => ({
  allAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
  getAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
  runAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
  validatePhotoUpdate: jest.fn(),
}));

// tag-service is invoked by some read paths; neutralize to keep the failure
// source unambiguous (i.e. the mocked db-helpers above).
jest.mock('../../services/tag-service', () => ({
  attachTagsToPhotos: jest.fn((rows) => rows),
  savePhotoTags: jest.fn(),
}));

const router = require('../photos');

describe('routes/photos — error path', () => {
  test('GET / with db failure → 500 contract (was latent bug 2C.2 fix)', async () => {
    // Pre-2C.2: the first `await getAsync(...)` at photos.js:128 sat OUTSIDE
    // the inner try, so a db failure left the request hanging. After 2C.2
    // the whole handler is wrapped in try/catch + next(err), so the same
    // failure surfaces as a clean 500.
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).get('/api/photos');
    assertServerErrorContract(res);
  });

  test('GET /single/:id with db failure → 500 contract', async () => {
    const app = buildApp((a) => a.use('/api/photos', router));
    const res = await request(app).get('/api/photos/single/999');
    assertServerErrorContract(res);
  });
});
