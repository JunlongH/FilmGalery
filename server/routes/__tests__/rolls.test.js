/**
 * Error-path coverage for routes/rolls.js.
 *
 * Locks:
 *   - GET /api/rolls with db failure → 500 contract
 *   - GET /api/rolls/:id with db failure → 500 contract
 *
 * Avoids POST/PUT/DELETE which fan out into fs + gear-service; those paths
 * get coverage via the multi-step write audit in 2C.1.4.
 */
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

jest.mock('../../utils/db-helpers', () => ({
  allAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
  getAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
  runAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
}));

jest.mock('../../services/roll-service', () => ({
  recomputeRollSequence: jest.fn().mockResolvedValue({ count: 0 }),
  ensureStartDateColumn: jest.fn().mockResolvedValue(),
  ensureDisplaySeqColumn: jest.fn().mockResolvedValue(),
}));

jest.mock('../../services/gear-service', () => ({
  addOrUpdateGear: jest.fn(),
  formatFixedLensDescription: jest.fn(),
  getFixedLensInfo: jest.fn(),
  cleanupFixedLensGear: jest.fn(),
}));

const router = require('../rolls');

describe('routes/rolls — error path', () => {
  test('GET / with db failure → 500 contract', async () => {
    const app = buildApp((a) => a.use('/api/rolls', router));
    const res = await request(app).get('/api/rolls');
    assertServerErrorContract(res);
  });

  test('GET /:id with db failure → 500 contract', async () => {
    const app = buildApp((a) => a.use('/api/rolls', router));
    const res = await request(app).get('/api/rolls/1');
    assertServerErrorContract(res);
  });
});
