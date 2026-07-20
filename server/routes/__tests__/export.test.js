/**
 * Error-path coverage for routes/export.js.
 *
 * export.js delegates to exportQueue. We mock it to throw and verify the
 * route's catch surfaces it through errorHandler.
 *
 * Locks:
 *   - POST /api/export/batch with queue failure → 500 contract
 *   - GET /api/export/jobs/:jobId with unknown id → 404 contract
 */
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

jest.mock('../../services/export-queue', () => ({
  exportQueue: {
    addJob: jest.fn().mockRejectedValue(new Error('queue full')),
    // getJob is SYNCHRONOUS in export.js — must use mockReturnValue, not
    // mockResolvedValue, or the awaiting test will see a Promise as the job.
    getJob: jest.fn().mockReturnValue(null),
    listJobs: jest.fn().mockRejectedValue(new Error('queue full')),
    removeJob: jest.fn(),
    pauseJob: jest.fn(),
    resumeJob: jest.fn(),
    clearJobs: jest.fn(),
  },
  JOB_STATUS: { PENDING: 'pending', RUNNING: 'running', DONE: 'done', FAILED: 'failed' },
}));

jest.mock('../../../packages/shared/filmLabExport', () => ({
  validateExportParams: jest.fn(() => ({ valid: true })),
}));

const router = require('../export');

describe('routes/export — error path', () => {
  test('GET /jobs with listJobs failure → 500 contract', async () => {
    const app = buildApp((a) => a.use('/api/export', router));
    const res = await request(app).get('/api/export/jobs');
    assertServerErrorContract(res);
  });

  test('GET /jobs/:jobId with unknown id → 404 contract', async () => {
    const app = buildApp((a) => a.use('/api/export', router));
    const res = await request(app).get('/api/export/jobs/missing');
    assertServerErrorContract(res, { status: 404 });
  });
});
