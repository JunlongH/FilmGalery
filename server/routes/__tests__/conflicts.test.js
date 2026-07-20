/**
 * Error-path coverage for routes/conflicts.js.
 *
 * Locks: GET /api/conflicts with resolver failure → 500 contract.
 */
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

jest.mock('../../conflict-resolver', () => ({
  getConflictStatus: jest.fn().mockRejectedValue(new Error('resolver crashed')),
  autoCleanup: jest.fn(),
}));

const router = require('../conflicts');

describe('GET /api/conflicts — error path', () => {
  test('resolver failure yields 500 without leaking stack', async () => {
    const app = buildApp((a) => a.use('/api/conflicts', router));
    const res = await request(app).get('/api/conflicts');
    assertServerErrorContract(res);
  });
});
