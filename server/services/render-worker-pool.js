/**
 * Render worker pool — offloads the per-pixel Float pipeline to worker
 * threads so the main event loop stays responsive during large RAW exports.
 *
 * Why this exists (Phase 2C.3):
 *   - photos.js:886-985 + render-positive had 10 inline for-loops calling
 *     core.processPixelFloat(...). A 24MP RAW = ~24M iterations ≈ 200-500ms
 *     of blocked event loop per export — `/api/health` and other requests
 *     stall completely during that window.
 *   - Float pipeline itself is correct (RENDERING-PIPELINE-REFACTOR-PLAN.md
 *     P1-P9 fixed). Only the OUTER loop's blocking nature is the problem.
 *
 * Design constraints (locked by audit):
 *   - `packages/shared` stays worker_threads-free (it's bundled into the
 *     browser for the client-side CPU fallback path CpuRenderService.js).
 *     The worker script `render-worker.js` lives in server/services/ and
 *     is the ONLY place that combines worker_threads + the render math.
 *   - Bit-equivalence: worker and inline path both call the shared
 *     renderBuffer() in packages/shared/render/render-buffer.js. There is
 *     exactly one copy of the math; PSNR is therefore trivially ∞.
 *
 * Pool semantics:
 *   - Lazy: workers spawn on first processImage() call, not at server boot.
 *   - Size = max(1, os.cpus().length - 1); tunable via FG_RENDER_WORKERS.
 *   - Small images stay on the main thread (FG_RENDER_WORKER_THRESHOLD,
 *     default 2_000_000 px) — IPC overhead would exceed the gain.
 *   - On worker crash, the pool replaces it transparently; in-flight
 *     messages reject so the caller's catch surfaces them via next(err).
 *
 * @module server/services/render-worker-pool
 */

const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');
const { renderBuffer } = require('../../packages/shared');

const WORKER_PATH = path.join(__dirname, 'render-worker.js');
const DEFAULT_POOL_SIZE = Math.max(1, (os.cpus() || []).length - 1);
const DEFAULT_THRESHOLD = 2_000_000; // px; <this → main thread

const poolSize = Number(process.env.FG_RENDER_WORKERS) || DEFAULT_POOL_SIZE;
const threshold = Number(process.env.FG_RENDER_WORKER_THRESHOLD) || DEFAULT_THRESHOLD;

/**
 * Ensure a buffer is backed by its own ArrayBuffer (not the Node pool).
 *
 * Pool-backed Buffers (Buffer.from(array), Buffer.allocUnsafe for small
 * sizes) share a single large ArrayBuffer; transferring that via
 * worker_threads.postMessage with transferList would move the entire pool
 * and trigger DataCloneError under Node 22's stricter structured clone.
 *
 * This helper copies pool-backed buffers into a fresh ArrayBuffer; if the
 * source already owns its ArrayBuffer (byteOffset=0, full coverage) it is
 * returned as-is (zero-copy fast path).
 */
function isolateBuffer(src) {
  if (src.byteOffset === 0 && src.buffer.byteLength === src.byteLength) {
    return src;
  }
  const ab = new ArrayBuffer(src.byteLength);
  const view = new Uint8Array(ab);
  view.set(src);
  return view;
}

/** @type {{ worker: Worker, busy: boolean, queue: [{ msg, resolve, reject }] }[]} */
let workers = null;
let nextMessageId = 1;

function ensurePool() {
  if (workers) return;
  workers = [];
  for (let i = 0; i < poolSize; i++) {
    workers.push(spawnWorker());
  }
  console.log(`[RENDER-WORKERS] Pool started: ${poolSize} worker(s), threshold ${threshold}px`);
}

function spawnWorker() {
  const worker = new Worker(WORKER_PATH);
  const entry = { worker, busy: false, queue: [] };

  worker.on('message', (msg) => {
    const head = entry.queue[0];
    if (!head || head.msg.id !== msg.id) {
      // Stale or unexpected message; ignore.
      return;
    }
    entry.queue.shift();
    entry.busy = entry.queue.length > 0;
    if (entry.busy) dispatch(entry);
    if (msg.type === 'done') head.resolve(msg);
    else head.reject(new Error(msg.message || 'render worker error'));
  });

  worker.on('error', (err) => {
    console.error('[RENDER-WORKERS] Worker error, restarting:', err.message);
    for (const pending of entry.queue) pending.reject(err);
    entry.queue = [];
    entry.busy = false;
    const idx = workers.indexOf(entry);
    if (idx >= 0) workers[idx] = spawnWorker();
  });

  return entry;
}

function dispatch(entry) {
  const head = entry.queue[0];
  if (!head) return;
  entry.busy = true;
  // Transfer the input buffer's underlying ArrayBuffer to avoid copying.
  // isolateBuffer() guarantees a non-pool-backed ArrayBuffer (Node 22+
  // structured clone rejects pool transfers with DataCloneError).
  const transferList = [head.msg.buffer.buffer];
  entry.worker.postMessage(head.msg, transferList);
}

function enqueue(msg) {
  // Pick the worker with the shortest queue (least-loaded).
  let target = workers[0];
  for (const entry of workers) {
    if (entry.queue.length < target.queue.length) target = entry;
  }
  return new Promise((resolve, reject) => {
    target.queue.push({ msg, resolve, reject });
    if (!target.busy) dispatch(target);
  });
}

/**
 * Render a raw pixel buffer through the Float pipeline.
 *
 * @param {Buffer|Uint8Array} buffer - Raw pixels from sharp.raw().toBuffer()
 * @param {Object} meta
 * @param {number} meta.width
 * @param {number} meta.height
 * @param {number} meta.channels
 * @param {boolean} meta.is16bit
 * @param {boolean} meta.wantTiff16 - Also produce a 16-bit TIFF source buffer
 * @param {Object} meta.params - RenderCore constructor params
 * @returns {Promise<{ jpeg8: Buffer, tiff16?: Buffer }>}
 *          Raw RGB buffers ready for sharp to encode.
 */
async function processImage(buffer, meta) {
  const pixelCount = meta.width * meta.height;

  // Small images: stay inline. Worker IPC would cost more than the math.
  // Both paths route through the same shared renderBuffer() — bit-identical.
  if (pixelCount < threshold) {
    return renderBuffer(buffer, meta);
  }

  ensurePool();
  const id = nextMessageId++;
  // Isolate so transferList can take .buffer safely (see isolateBuffer).
  const isolated = isolateBuffer(buffer);
  const msg = { id, type: 'render', buffer: isolated, ...meta };
  const result = await enqueue(msg);
  return {
    jpeg8: Buffer.from(result.jpeg8),
    ...(result.tiff16 && { tiff16: Buffer.from(result.tiff16) }),
  };
}

/**
 * Shutdown the pool cleanly. Used by tests and server shutdown hooks.
 */
async function terminate() {
  if (!workers) return;
  await Promise.all(workers.map((entry) => entry.worker.terminate()));
  workers = null;
}

module.exports = {
  processImage,
  terminate,
  // Exposed for tests / observability.
  _getPoolSize: () => (workers ? workers.length : 0),
  _threshold: threshold,
};
