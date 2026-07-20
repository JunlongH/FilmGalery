/**
 * Render worker — runs the per-pixel Float pipeline in a worker_thread.
 *
 * Receives raw pixel buffer + RenderCore params, produces 8-bit JPEG source
 * buffer and (optionally) 16-bit TIFF source buffer. The actual JPEG/TIFF
 * encoding (sharp) stays on the main thread — only the per-pixel math
 * (which is what blocks the event loop) lives here.
 *
 * The math itself is the shared renderBuffer() in packages/shared — the
 * same function the inline main-thread path uses, guaranteeing bit-equivalence.
 *
 * Protocol (parentPort messages):
 *   in:  { id, type:'render', buffer, width, height, channels, is16bit,
 *          wantTiff16, params }
 *   out: { id, type:'done', jpeg8, tiff16? }
 *        or { id, type:'error', message, stack? }
 *
 * Buffers are transferred (zero-copy) via the worker_threads message list.
 *
 * @module server/services/render-worker
 */
const { parentPort } = require('worker_threads');
const { renderBuffer } = require('../../packages/shared');

if (!parentPort) {
  throw new Error('render-worker.js must be launched as a worker_thread');
}

parentPort.on('message', (msg) => {
  const { id, type, buffer, ...rest } = msg;
  if (type !== 'render') return;

  try {
    const result = renderBuffer(Buffer.from(buffer), rest);
    // Transfer the underlying ArrayBuffers (zero-copy back to main thread).
    const transferList = [result.jpeg8.buffer];
    if (result.tiff16) transferList.push(result.tiff16.buffer);
    parentPort.postMessage({ id, type: 'done', ...result }, transferList);
  } catch (err) {
    parentPort.postMessage({
      id,
      type: 'error',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
});
