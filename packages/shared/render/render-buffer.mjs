/**
 * Pure buffer-level renderer built on RenderCore.processPixelFloat.
 *
 * Extracted in Phase 2C.3 from server/routes/photos.js (which had 10 inline
 * copies of this loop) and server/services/render-worker.js / -pool.js.
 * Lives in packages/shared so it can be consumed by:
 *   - server/services/render-worker.js (server-side worker_thread)
 *   - server/services/render-worker-pool.js (server-side inline fallback)
 *   - client/src/services/CpuRenderService.js (browser CPU fallback)
 *
 * No worker_threads / DOM / node:fs dependencies — pure typed-array math.
 *
 * Bit-equivalence contract: this is THE canonical outer loop. Anywhere that
 * applies RenderCore to a pixel buffer MUST route through renderBuffer() to
 * keep CPU and GPU pipelines bit-identical. Regression coverage: PSNR/SSIM
 * fixture suite (tests/05-cross-path-integration).
 *
 * @module packages/shared/render/render-buffer
 */

import { RenderCore } from './RenderCore.mjs';

/**
 * Apply the Float pipeline to a raw pixel buffer and produce one or both
 * of: an 8-bit RGB buffer (JPEG source) and a 16-bit RGB buffer (TIFF16
 * source). The caller handles the sharp encode step.
 *
 * @param {Uint8Array|Buffer} buffer - Raw pixels (3 or 4 channels, 8 or 16-bit).
 * @param {Object} meta
 * @param {number} meta.width
 * @param {number} meta.height
 * @param {number} meta.channels - 3 or 4 (alpha is ignored on output)
 * @param {boolean} meta.is16bit - True if buffer holds Uint16 per sample
 * @param {boolean} meta.wantTiff16 - Also produce a 16-bit output buffer
 * @param {Object} meta.params - RenderCore constructor params
 * @returns {{jpeg8: Buffer, tiff16?: Buffer}}
 */
function renderBuffer(buffer, { width, height, channels, is16bit, wantTiff16, params }) {
  const core = new RenderCore(params);
  core.prepareLUTs();

  // allocUnsafeSlow: NEVER uses the Node Buffer pool, so each returned
  // Buffer is backed by its OWN ArrayBuffer (byteOffset=0, full coverage).
  // This matters for worker_threads.postMessage with transferList —
  // transferring a pool-backed Buffer would transfer the entire shared
  // pool memory and trigger DataCloneError under Node's stricter
  // structured clone algorithm (Node 22+). Even on the inline path this
  // is the correct contract: callers (and the worker pool) can safely
  // transfer these buffers' .buffer without copying.
  const jpeg8 = Buffer.allocUnsafeSlow(width * height * 3);
  const tiff16 = wantTiff16 ? Buffer.allocUnsafeSlow(width * height * 3 * 2) : null;

  // 单循环：processPixelFloat 只算一次，同时写 jpeg8（必要时 tiff16）。
  // 旧实现 tiff16 路径独立循环，16-bit 输出 CPU 成本 ×2。
  const writePixel = (j, rF, gF, bF) => {
    jpeg8[j]     = Math.min(255, Math.max(0, Math.round(rF * 255)));
    jpeg8[j + 1] = Math.min(255, Math.max(0, Math.round(gF * 255)));
    jpeg8[j + 2] = Math.min(255, Math.max(0, Math.round(bF * 255)));
    if (tiff16) {
      const j16 = j * 2;
      const r16 = Math.min(65535, Math.max(0, Math.round(rF * 65535)));
      const g16 = Math.min(65535, Math.max(0, Math.round(gF * 65535)));
      const b16 = Math.min(65535, Math.max(0, Math.round(bF * 65535)));
      tiff16[j16]     = r16 & 0xFF; tiff16[j16 + 1] = (r16 >> 8) & 0xFF;
      tiff16[j16 + 2] = g16 & 0xFF; tiff16[j16 + 3] = (g16 >> 8) & 0xFF;
      tiff16[j16 + 4] = b16 & 0xFF; tiff16[j16 + 5] = (b16 >> 8) & 0xFF;
    }
  };

  if (is16bit) {
    const pixels = new Uint16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
    for (let i = 0, j = 0; i < pixels.length; i += channels, j += 3) {
      const [rF, gF, bF] = core.processPixelFloat(
        pixels[i] / 65535, pixels[i + 1] / 65535, pixels[i + 2] / 65535
      );
      writePixel(j, rF, gF, bF);
    }
  } else {
    for (let i = 0, j = 0; i < buffer.length; i += channels, j += 3) {
      const [rF, gF, bF] = core.processPixelFloat(
        buffer[i] / 255, buffer[i + 1] / 255, buffer[i + 2] / 255
      );
      writePixel(j, rF, gF, bF);
    }
  }

  if (!wantTiff16) return { jpeg8 };
  return { jpeg8, tiff16 };
}

const _sharedExports = { renderBuffer };
const _e_renderBuffer = _sharedExports.renderBuffer;
export { _e_renderBuffer as renderBuffer };
export default _sharedExports;
