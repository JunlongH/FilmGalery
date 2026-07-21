/**
 * Phase K (P4 收尾) — 数据一致性测试（非烟测）
 *
 * 覆盖：
 * 1. applyHSLToArray / applySplitToneToArray 保留输入 TypedArray 类型
 * 2. ComputeService.getPhotoImageUrl 委托 CpuRenderService（SSOT，无重复实现）
 */

const { applyHSLToArray } = require('../packages/shared/filmLabHSL');
const { applySplitToneToArray } = require('../packages/shared/filmLabSplitTone');

describe('Phase K.1 applyHSLToArray 保留输入 TypedArray 类型', () => {
  test('Uint8ClampedArray 输入 → Uint8ClampedArray 输出', () => {
    const input = new Uint8ClampedArray([100, 150, 200, 255, 50, 60, 70, 255]);
    const out = applyHSLToArray(input, { red: { hue: 0, saturation: 30, luminance: 0 } });
    expect(out).toBeInstanceOf(Uint8ClampedArray);
    expect(out.length).toBe(input.length);
  });

  test('Uint8Array 输入 → Uint8Array 输出', () => {
    const input = new Uint8Array([100, 150, 200, 255, 50, 60, 70, 255]);
    const out = applyHSLToArray(input, { red: { hue: 0, saturation: 0, luminance: 20 } });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out).not.toBeInstanceOf(Uint8ClampedArray);
  });

  test('默认参数（无调整）返回原数组（恒等，不分配新缓冲）', () => {
    const input = new Uint8ClampedArray([100, 150, 200, 255]);
    const out = applyHSLToArray(input, {});
    expect(out).toBe(input); // 同一引用
  });
});

describe('Phase K.2 applySplitToneToArray 保留输入类型', () => {
  test('Uint8ClampedArray 输入 → Uint8ClampedArray 输出', () => {
    const input = new Uint8ClampedArray(16).fill(128);
    input[3] = 255; input[7] = 255; input[11] = 255; input[15] = 255;
    const params = { highlights: { hue: 40, saturation: 30 }, shadows: { hue: 220, saturation: 25 }, balance: 0 };
    const out = applySplitToneToArray(input, params);
    expect(out).toBeInstanceOf(Uint8ClampedArray);
  });

  test('Uint8Array 输入 → Uint8Array 输出', () => {
    const input = new Uint8Array(16).fill(128);
    input[3] = 255; input[7] = 255; input[11] = 255; input[15] = 255;
    const params = { highlights: { hue: 40, saturation: 30 }, shadows: { hue: 220, saturation: 25 }, balance: 0 };
    const out = applySplitToneToArray(input, params);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out).not.toBeInstanceOf(Uint8ClampedArray);
  });

  test('alpha 通道保留', () => {
    const input = new Uint8Array([100, 150, 200, 200, 50, 60, 70, 128]);
    const params = { highlights: { hue: 40, saturation: 40 }, shadows: { hue: 220, saturation: 0 }, balance: 0 };
    const out = applySplitToneToArray(input, params, { channels: 4 });
    expect(out[3]).toBe(200);
    expect(out[7]).toBe(128);
  });
});

describe('Phase K.3 ComputeService.getPhotoImageUrl SSOT 委托', () => {
  test('ComputeService 模块文件中不存在独立的 getPhotoImageUrl 实现（已委托）', () => {
    const fs = require('fs');
    const src = fs.readFileSync('/home/juno/FilmGallery/client/src/services/ComputeService.js', 'utf8');
    // 委托形式：引用 CpuRenderService.getPhotoImageUrl
    expect(src).toMatch(/CpuRenderService\.getPhotoImageUrl/);
    // 不应再有独立的 async function getPhotoImageUrl 实现
    expect(src).not.toMatch(/async\s+function\s+getPhotoImageUrl\s*\(/);
  });
});
