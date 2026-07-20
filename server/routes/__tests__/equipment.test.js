/**
 * Error-path coverage for routes/equipment.js.
 *
 * Locks:
 *   - GET /api/equipment/suggestions with service failure → 500 contract
 *   - GET /api/equipment/compatible-lenses/:cameraId with service failure → 500 contract
 */
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

jest.mock('../../services/equipment-service', () => ({
  getSuggestions: jest.fn().mockRejectedValue(new Error('service down')),
  getCompatibleLenses: jest.fn().mockRejectedValue(new Error('service down')),
  getRelatedRolls: jest.fn().mockRejectedValue(new Error('service down')),
}));

const router = require('../equipment');

describe('routes/equipment — error path', () => {
  test('GET /suggestions failure → 500 contract', async () => {
    const app = buildApp((a) => a.use('/api/equipment', router));
    const res = await request(app).get('/api/equipment/suggestions');
    assertServerErrorContract(res);
  });

  test('GET /compatible-lenses/:cameraId failure → 500 contract', async () => {
    const app = buildApp((a) => a.use('/api/equipment', router));
    const res = await request(app).get('/api/equipment/compatible-lenses/1');
    assertServerErrorContract(res);
  });
});
