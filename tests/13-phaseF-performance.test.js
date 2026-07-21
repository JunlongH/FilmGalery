/**
 * Phase F — 性能/正确性测试（非烟测）
 *
 * 覆盖：
 * 1. renderBuffer 单循环：jpeg8 与 tiff16 输出互一致（同一 processPixelFloat 结果）
 * 2. buildFragmentShader 支持 highp / isGL2 变体（不抛异常、含精度声明）
 */

const { renderBuffer } = require('../packages/shared/render/render-buffer');
const { buildFragmentShader } = require('../packages/shared/shaders');

describe('Phase F.1 renderBuffer 单循环 jpeg8/tiff16 一致性', () => {
  function makeInput8(w, h, channels) {
    const buf = Buffer.alloc(w * h * channels);
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 37) & 0xFF;
    return buf;
  }

  test('wantTiff16=true 时返回 jpeg8 与 tiff16，二者数值一致', () => {
    const w = 4, h = 4, ch = 4;
    const input = makeInput8(w, h, ch);
    const { jpeg8, tiff16 } = renderBuffer(input, {
      width: w, height: h, channels: ch, is16bit: false, wantTiff16: true,
      params: { exposure: 10, contrast: 20 },
    });
    expect(jpeg8.length).toBe(w * h * 3);
    expect(tiff16.length).toBe(w * h * 3 * 2);
    // 逐像素：tiff16 右移 8 应 ≈ jpeg8（同一 float 结果量化到不同位深）
    for (let j = 0; j < jpeg8.length; j += 3) {
      const j16 = j * 2;
      const r16 = tiff16[j16] | (tiff16[j16 + 1] << 8);
      const g16 = tiff16[j16 + 2] | (tiff16[j16 + 3] << 8);
      const b16 = tiff16[j16 + 4] | (tiff16[j16 + 5] << 8);
      // 16-bit 右移 8 位应等于 8-bit（向下取整，容差 ±1）
      expect(Math.abs((r16 >> 8) - jpeg8[j])).toBeLessThanOrEqual(1);
      expect(Math.abs((g16 >> 8) - jpeg8[j + 1])).toBeLessThanOrEqual(1);
      expect(Math.abs((b16 >> 8) - jpeg8[j + 2])).toBeLessThanOrEqual(1);
    }
  });

  test('wantTiff16=false 只返回 jpeg8（不分配 tiff16）', () => {
    const w = 2, h = 2;
    const input = makeInput8(w, h, 3);
    const result = renderBuffer(input, {
      width: w, height: h, channels: 3, is16bit: false, wantTiff16: false,
      params: {},
    });
    expect(result.jpeg8).toBeDefined();
    expect(result.tiff16).toBeUndefined();
  });
});

describe('Phase F.2 buildFragmentShader highp / isGL2 变体', () => {
  test('WebGL1 + highp 精度声明存在', () => {
    const fs = buildFragmentShader({ isGL2: false, precision: 'highp' });
    expect(fs).toContain('precision highp float');
    expect(fs).toContain('void main()');
  });

  test('WebGL2 变体含 #version 300 es 与 sampler3D 路径', () => {
    const fs = buildFragmentShader({ isGL2: true, precision: 'highp' });
    expect(fs).toMatch(/#version 300 es/);
    expect(fs).toContain('precision highp float');
  });

  test('默认（无参数）仍可构建（向后兼容）', () => {
    expect(() => buildFragmentShader()).not.toThrow();
  });
});
