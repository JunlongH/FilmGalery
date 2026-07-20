/**
 * Error-path coverage for routes/luts.js.
 *
 * luts.js reads from LUT_DIR via fs/promises. We mock it to reject and
 * verify the route's catch surfaces it through errorHandler.
 *
 * Locks: GET /api/luts with fs failure → 500 contract.
 */
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

jest.mock('fs', () => {
  const real = jest.requireActual('fs');
  return {
    ...real,
    existsSync: jest.fn().mockReturnValue(true),
    promises: {
      readdir: jest.fn().mockRejectedValue(new Error('EIO')),
      stat: jest.fn().mockRejectedValue(new Error('EIO')),
      unlink: jest.fn(),
      rename: jest.fn(),
    },
  };
});

const router = require('../luts');

describe('GET /api/luts — error path', () => {
  test('fs failure yields 500 without leaking stack', async () => {
    const app = buildApp((a) => a.use('/api/luts', router));
    const res = await request(app).get('/api/luts');
    assertServerErrorContract(res);
  });
});
