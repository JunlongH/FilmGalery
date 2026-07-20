/**
 * Bucket-E preservation test (Phase 2C.2).
 *
 * The 2C.2 migration converted ~157 inline 5xx catches to `next(err)`,
 * funneling everything through errorHandler. Bucket E (explicit 4xx input
 * validation like `return res.status(400).json({ error: 'rollId is required' })`)
 * was deliberately LEFT INLINE — those are early-returns, not error paths,
 * and they pre-compute the exact client-facing message.
 *
 * This test pins that bucket-E responses are NOT re-serialized by
 * errorHandler (which would strip the message in production). If someone
 * overzealously converts these to `throw new ValidationError(...)`, the
 * response shape changes — this test catches that.
 */

const express = require('express');
const request = require('supertest');
const { buildApp, assertServerErrorContract } = require('./_helpers');

// Pull a route that has known bucket-E patterns (export.js: missing
// outputDir → 400 with a specific message).
jest.mock('../../services/export-queue', () => ({
  exportQueue: {
    addJob: jest.fn(),
    getJob: jest.fn().mockReturnValue(null),
    listJobs: jest.fn(),
    removeJob: jest.fn(),
    pauseJob: jest.fn(),
    resumeJob: jest.fn(),
    clearJobs: jest.fn(),
    getAllJobs: jest.fn().mockReturnValue([]),
  },
  JOB_STATUS: { PENDING: 'pending', RUNNING: 'running', DONE: 'done', FAILED: 'failed' },
}));

jest.mock('../../../packages/shared/filmLabExport', () => ({
  validateExportParams: jest.fn(() => ({ valid: true })),
}));

const router = require('../export');

describe('bucket E — explicit 4xx input validation is preserved', () => {
  test('POST /api/export/batch with missing outputDir → 400 with specific message', async () => {
    const app = buildApp((a) => a.use('/api/export', router));
    const res = await request(app).post('/api/export/batch').send({ photoIds: [1] });
    expect(res.status).toBe(400);
    // Bucket E contracts ALWAYS expose the message (they're input validation,
    // not internal errors). If this fails with "Internal server error",
    // someone converted a bucket-E to throw + errorHandler, losing the message.
    expect(res.body.error).toMatch(/outputDir/i);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/export/batch with neither rollId nor photoIds → 400', async () => {
    const app = buildApp((a) => a.use('/api/export', router));
    const res = await request(app)
      .post('/api/export/batch')
      .send({ outputDir: '/tmp/x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rollId|photoIds/i);
  });

  test('POST /api/export/batch with invalid format → 400', async () => {
    const app = buildApp((a) => a.use('/api/export', router));
    const res = await request(app)
      .post('/api/export/batch')
      .send({ outputDir: '/tmp/x', photoIds: [1], format: 'WEBP' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/format/i);
  });
});

describe('bucket E — explicit 404 business mapping is preserved', () => {
  test('GET /api/export/jobs/:unknown → 404 with "Job not found"', async () => {
    const app = buildApp((a) => a.use('/api/export', router));
    const res = await request(app).get('/api/export/jobs/missing');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Job not found');
    expect(res.body.success).toBe(false);
  });
});
