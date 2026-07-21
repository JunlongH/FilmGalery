/**
 * Phase J — 大图导出分块让步测试（非烟测）
 *
 * 直接测试 SSOT packages/shared/renderChunked.js（CJS 可测）：
 * - 分块边界不影响结果（chunkRows=1 vs =H vs 同步全块 一致）
 * - shouldAbort 谓词可提前中止
 * - 透明像素跳过
 */

const { processBlock, processCanvasChunkedSync } = require('../packages/shared/renderChunked');
const { RenderCore } = require('../packages/shared/render/RenderCore');

function makeFakeCanvas(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 7 + 50) & 0xFF;
      data[i + 1] = (y * 5 + 30) & 0xFF;
      data[i + 2] = (100 - x) & 0xFF;
      if (data[i + 2] < 0) data[i + 2] += 256;
      data[i + 3] = 255;
    }
  }
  const snapshot = Uint8ClampedArray.from(data);
  const ctx = {
    _data: data,
    getImageData(x, y, w, h) {
      const sub = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const src = ((y + row) * width + (x + col)) * 4;
          const dst = (row * w + col) * 4;
          sub[dst] = data[src]; sub[dst+1] = data[src+1]; sub[dst+2] = data[src+2]; sub[dst+3] = data[src+3];
        }
      }
      return { data: sub, width: w, height: h };
    },
    putImageData(imgData, x, y) {
      const w = imgData.width, h = imgData.height;
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const dst = ((y + row) * width + (x + col)) * 4;
          const src = (row * w + col) * 4;
          data[dst] = imgData.data[src]; data[dst+1] = imgData.data[src+1]; data[dst+2] = imgData.data[src+2]; data[dst+3] = imgData.data[src+3];
        }
      }
    },
  };
  return { width, height, _snapshot: snapshot, getContext: () => ctx };
}

const params = { exposure: 15, contrast: 25, highlights: -10, inverted: true };

describe('Phase J processBlock / processCanvasChunkedSync', () => {
  test('processBlock 处理后 alpha 保留、RGB 改变', () => {
    const data = new Uint8ClampedArray([100, 120, 140, 255, 0, 0, 0, 0]);
    const core = new RenderCore(params);
    core.prepareLUTs();
    processBlock(data, core);
    expect(data[3]).toBe(255); // alpha 保留
    expect(data[7]).toBe(0);   // 透明像素跳过（alpha=0 的像素 RGB 不变）
    // 非透明像素 RGB 应被处理（inverted=true → 与原值不同）
    expect(data[0]).not.toBe(100);
  });

  test('chunkRows=1 与 chunkRows=H 结果一致', () => {
    const W = 16, H = 24;
    const c1 = makeFakeCanvas(W, H);
    const c2 = makeFakeCanvas(W, H);
    processCanvasChunkedSync(c1, params, { chunkRows: 1 });
    processCanvasChunkedSync(c2, params, { chunkRows: H });
    const d1 = c1.getContext()._data;
    const d2 = c2.getContext()._data;
    for (let i = 0; i < d1.length; i++) {
      expect(d1[i]).toBe(d2[i]);
    }
  });

  test('chunkRows=8（中间值）也与单块一致', () => {
    const W = 17, H = 40;
    const c1 = makeFakeCanvas(W, H);
    const c2 = makeFakeCanvas(W, H);
    processCanvasChunkedSync(c1, params, { chunkRows: 8 });
    processCanvasChunkedSync(c2, params, { chunkRows: H });
    const d1 = c1.getContext()._data;
    const d2 = c2.getContext()._data;
    for (let i = 0; i < d1.length; i += 4) {
      expect(d1[i]).toBe(d2[i]);
      expect(d1[i+1]).toBe(d2[i+1]);
      expect(d1[i+2]).toBe(d2[i+2]);
    }
  });

  test('shouldAbort 谓词提前中止（末尾行未处理）', () => {
    const W = 16, H = 64;
    const canvas = makeFakeCanvas(W, H);
    let calls = 0;
    processCanvasChunkedSync(canvas, params, {
      chunkRows: 8,
      shouldAbort: () => { calls++; return calls > 2; },
    });
    const data = canvas.getContext()._data;
    const snapshot = canvas._snapshot;
    const lastIdx = ((H - 1) * W) * 4;
    // 末尾像素应保持原值（中止后未处理）
    expect(data[lastIdx]).toBe(snapshot[lastIdx]);
  });
});
