/**
 * Error-path coverage for routes/films.js.
 *
 * Locks:
 *   - GET /api/films with db failure → 500 contract
 *   - DELETE /api/films/:id with db failure → 500 contract
 *
 * Multer is bypassed by hitting GET/DELETE only.
 */
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

jest.mock('../../utils/db-helpers', () => ({
  allAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
  runAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
  getAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
}));

const router = require('../films');

describe('routes/films — error path', () => {
  test('GET / with db failure → 500 contract', async () => {
    const app = buildApp((a) => a.use('/api/films', router));
    const res = await request(app).get('/api/films');
    assertServerErrorContract(res);
  });

  test('DELETE /:id soft-delete with db failure → 500 contract', async () => {
    const app = buildApp((a) => a.use('/api/films', router));
    const res = await request(app).delete('/api/films/1');
    assertServerErrorContract(res);
  });
});
