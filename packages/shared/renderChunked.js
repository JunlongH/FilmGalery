/**
 * 分块像素处理（与 client/CpuRenderService 的循环逻辑同源，SSOT）。
 *
 * 抽出到 shared 是为了让 Jest (CJS) 可直接测试分块边界正确性，
 * 而客户端的 async wrapper 只负责 setTimeout 让步 + DOM canvas I/O。
 *
 * @module renderChunked
 */

const { RenderCore } = require('./render/RenderCore');

/**
 * 处理单个 ImageData 风格的像素块（原地修改 data）。
 *
 * @param {Uint8ClampedArray} data - RGBA 像素（原地修改 RGB，保留 alpha）
 * @param {RenderCore} core - 已 prepareLUTs 的 RenderCore 实例
 */
function processBlock(data, core) {
  const length = data.length;
  for (let i = 0; i < length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const [rF, gF, bF] = core.processPixelFloat(r, g, b);
    data[i] = Math.min(255, Math.max(0, Math.round(rF * 255)));
    data[i + 1] = Math.min(255, Math.max(0, Math.round(gF * 255)));
    data[i + 2] = Math.min(255, Math.max(0, Math.round(bF * 255)));
  }
}

/**
 * 在"伪 canvas"对象上做分块处理。
 * 伪 canvas 需提供：width, height, getContext()→{getImageData,putImageData}。
 * 真正的 setTimeout 让步由客户端 async wrapper 负责；本函数同步执行所有块，
 * 用于测试验证分块边界不影响结果。
 *
 * @param {Object} fakeCanvas - 伪 canvas
 * @param {Object} params - RenderCore 参数
 * @param {Object} [opts]
 * @param {number} [opts.chunkRows=64]
 * @param {() => boolean} [opts.shouldAbort]
 */
function processCanvasChunkedSync(fakeCanvas, params, opts = {}) {
  const { chunkRows = 64, shouldAbort = null } = opts;
  const ctx = fakeCanvas.getContext('2d', { willReadFrequently: true });
  const width = fakeCanvas.width;
  const height = fakeCanvas.height;
  const core = new RenderCore(params);
  core.prepareLUTs();

  for (let y0 = 0; y0 < height; y0 += chunkRows) {
    if (shouldAbort && shouldAbort()) break;
    const y1 = Math.min(y0 + chunkRows, height);
    const blockHeight = y1 - y0;
    const imageData = ctx.getImageData(0, y0, width, blockHeight);
    processBlock(imageData.data, core);
    ctx.putImageData(imageData, 0, y0);
  }
  return fakeCanvas;
}

module.exports = { processBlock, processCanvasChunkedSync };
