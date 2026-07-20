/**
 * Error-path coverage for routes/tags.js.
 *
 * Locks:
 *   - GET /api/tags with db failure → 500 contract
 *   - GET /api/tags/:id/photos with attachTagsToPhotos failure → 500 contract
 */
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

jest.mock('../../utils/db-helpers', () => ({
  allAsync: jest.fn().mockResolvedValue([{ id: 1, roll_id: 1 }]),
}));
jest.mock('../../services/tag-service', () => ({
  attachTagsToPhotos: jest.fn().mockRejectedValue(new Error('tag service down')),
  savePhotoTags: jest.fn(),
}));

const router = require('../tags');

describe('GET /api/tags/:tagId/photos — error path', () => {
  test('service failure yields 500 without leaking stack', async () => {
    const app = buildApp((a) => a.use('/api/tags', router));
    const res = await request(app).get('/api/tags/42/photos');
    assertServerErrorContract(res);
  });
});
