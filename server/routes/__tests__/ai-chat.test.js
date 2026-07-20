/**
 * Error-path coverage for routes/ai-chat.js.
 *
 * Excludes streaming endpoints (POST /chat uses SSE — error contract differs;
 * covered separately by 2C.2 bucket D). Focuses on JSON routes.
 *
 * Locks:
 *   - GET /api/ai/config with db failure → 500 contract
 *   - GET /api/ai/conversations with db failure → 500 contract
 */
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

jest.mock('../../utils/db-helpers', () => ({
  getAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
  allAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
  runAsync: jest.fn().mockRejectedValue(new Error('db connection lost')),
}));

jest.mock('../../services/ai-config', () => ({
  getAIConfig: jest.fn().mockRejectedValue(new Error('config load failed')),
  updateAIConfig: jest.fn(),
  isAIAvailable: jest.fn().mockReturnValue(true),
}));

jest.mock('../../services/ai-gateway', () => ({
  listModels: jest.fn(),
  chat: jest.fn(),
}));

jest.mock('../../services/ai-orchestrator', () => ({
  handleChat: jest.fn(),
}));

const router = require('../ai-chat');

describe('routes/ai-chat — error path (JSON routes)', () => {
  test('GET /config with failure → 500 contract', async () => {
    const app = buildApp((a) => a.use('/api/ai', router));
    const res = await request(app).get('/api/ai/config');
    assertServerErrorContract(res);
  });

  test('GET /conversations with db failure → 500 contract', async () => {
    const app = buildApp((a) => a.use('/api/ai', router));
    const res = await request(app).get('/api/ai/conversations');
    assertServerErrorContract(res);
  });
});
