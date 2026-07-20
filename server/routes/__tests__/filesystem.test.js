/**
 * Error-path coverage for routes/filesystem.js.
 *
 * filesystem.js calls fs directly (no db layer). We mock fs to throw and
 * verify the route's catch surfaces it through errorHandler.
 *
 * Locks:
 *   - GET /api/filesystem/browse with fs failure → 500 contract
 */
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  statSync: jest.fn().mockImplementation(() => {
    throw new Error('EIO');
  }),
  readdirSync: jest.fn().mockImplementation(() => {
    throw new Error('EIO');
  }),
  mkdirSync: jest.fn(),
  accessSync: jest.fn(),
}));

// Bypass path-security gates so the route reaches the fs calls (which we
// mock to throw). Security behavior is independently covered by
// server/utils/__tests__/path-security.test.js.
jest.mock('../../utils/path-security', () => ({
  isPathBlocked: () => false,
  isPathAllowed: () => true,
  isPathConfined: () => true,
}));

const router = require('../filesystem');

describe('GET /api/filesystem/browse — error path', () => {
  test('fs failure yields 500 without leaking stack', async () => {
    const app = buildApp((a) => a.use('/api/filesystem', router));
    const res = await request(app).get('/api/filesystem/browse').query({ path: '/tmp' });
    assertServerErrorContract(res);
  });
});
