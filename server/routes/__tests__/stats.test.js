/**
 * Error-path coverage for routes/stats.js.
 *
 * Locks: GET /api/stats/summary with db failure → 500 contract.
 */
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

jest.mock('../../utils/db-helpers', () => ({
  allAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
  getAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
}));

const router = require('../stats');

describe('GET /api/stats/summary — error path', () => {
  test('db failure yields 500 without leaking stack', async () => {
    const app = buildApp((a) => a.use('/api/stats', router));
    const res = await request(app).get('/api/stats/summary');
    assertServerErrorContract(res);
  });
});
