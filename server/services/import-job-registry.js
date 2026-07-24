/**
 * Import Job Registry
 *
 * In-memory tracking of asynchronous digital-import jobs for progress polling
 * and cancellation. The render-worker-pool has no progress/cancellation
 * support (audit §3), so digital import builds its own lightweight job layer.
 *
 * Jobs are lost on process restart — acceptable because imports are short-lived
 * (minutes). The persistent import_batch_id in digital_sessions allows Phase 2
 * recovery of incomplete batches.
 *
 * Job lifecycle:
 *   pending → running → completed | failed | cancelled
 *
 * @module server/services/import-job-registry
 */

const crypto = require('crypto');

const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const jobs = new Map();
const GC_AFTER_MS = 30 * 60 * 1000;

let gcTimer = null;

function ensureGc() {
  if (gcTimer) return;
  gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (job.endedAt && now - job.endedAt > GC_AFTER_MS) {
        jobs.delete(id);
      }
    }
  }, 5 * 60 * 1000);
  gcTimer.unref?.();
}

/**
 * Create a new job.
 * @param {{total?: number}} [opts]
 * @returns {string} jobId
 */
function create(opts = {}) {
  ensureGc();
  const jobId = crypto.randomUUID();
  jobs.set(jobId, {
    jobId,
    status: STATUS.PENDING,
    total: opts.total || 0,
    done: 0,
    failed: 0,
    currentFile: null,
    errors: [],
    cancelled: false,
    result: null,
    startedAt: Date.now(),
    endedAt: null,
  });
  return jobId;
}

/**
 * Get a job by id.
 * @param {string} jobId
 * @returns {Object|null}
 */
function get(jobId) {
  return jobs.get(jobId) || null;
}

/**
 * Mark a job as running (called when execute begins processing).
 * @param {string} jobId
 * @param {number} total
 */
function start(jobId, total) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = STATUS.RUNNING;
  job.total = total;
}

/**
 * Record progress for one processed file.
 * @param {string} jobId
 * @param {string} [filename]
 */
function tick(jobId, filename) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.done += 1;
  job.currentFile = filename || null;
}

/**
 * Record a per-file error (does not stop the job).
 * @param {string} jobId
 * @param {string} filename
 * @param {string} message
 */
function recordError(jobId, filename, message) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.failed += 1;
  job.errors.push({ file: filename, error: message, at: new Date().toISOString() });
}

/**
 * Mark a job as completed.
 * @param {string} jobId
 * @param {Object} [result]
 */
function complete(jobId, result = {}) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = STATUS.COMPLETED;
  job.result = result;
  job.endedAt = Date.now();
  job.currentFile = null;
}

/**
 * Mark a job as failed.
 * @param {string} jobId
 * @param {string} message
 */
function fail(jobId, message) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = STATUS.FAILED;
  job.errors.push({ error: message, at: new Date().toISOString() });
  job.endedAt = Date.now();
}

/**
 * Request cancellation (worker checks isCancelled between files).
 * @param {string} jobId
 */
function cancel(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  if (job.status === STATUS.COMPLETED || job.status === STATUS.FAILED) return false;
  job.cancelled = true;
  return true;
}

/**
 * Mark a job as cancelled (called by the worker after cleanup).
 * @param {string} jobId
 */
function markCancelled(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = STATUS.CANCELLED;
  job.endedAt = Date.now();
  job.currentFile = null;
}

/**
 * Check whether cancellation was requested.
 * @param {string} jobId
 * @returns {boolean}
 */
function isCancelled(jobId) {
  const job = jobs.get(jobId);
  return !!(job && job.cancelled);
}

/**
 * Return a snapshot suitable for the progress endpoint.
 * @param {string} jobId
 * @returns {Object|null}
 */
function status(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    jobId: job.jobId,
    status: job.status,
    total: job.total,
    done: job.done,
    failed: job.failed,
    currentFile: job.currentFile,
    errors: job.errors,
    result: job.result,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
  };
}

module.exports = {
  STATUS,
  create,
  get,
  start,
  tick,
  recordError,
  complete,
  fail,
  cancel,
  markCancelled,
  isCancelled,
  status,
};
