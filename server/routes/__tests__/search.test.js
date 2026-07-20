/**
 * Error-path coverage for routes/search.js.
 *
 * Locks: db failure on GET /api/search → 500 + error contract (no stack leak).
 */
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

jest.mock('../../utils/db-helpers', () => ({
  allAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
}));

// search.js is a plain express.Router; safe to require after the mock above.
const router = require('../search');

describe('GET /api/search — error path', () => {
  test('db failure yields 500 without leaking stack', async () => {
    const app = buildApp((a) => a.use('/api/search', router));
    const res = await request(app).get('/api/search?q=foo');
    assertServerErrorContract(res);
  });
});
