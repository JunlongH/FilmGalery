/**
 * 3D LUT (.cube) 解析器（SSOT）
 *
 * 从客户端 client/src/components/FilmLab/utils.js 收敛至此，供客户端 / 服务器 / 测试共用。
 * 校验：LUT_3D_SIZE 必须为有效整数；拒绝 LUT_1D_SIZE；数据行数必须 = size³；
 * 畸形文件抛错（由调用方捕获并向用户提示）。
 *
 * @module lutParser
 */

/**
 * 解析 Adobe Cube 3D LUT 文本
 * @param {string} text - .cube 文件内容
 * @returns {{ size: number, data: Float32Array, domainMin: number[], domainMax: number[] }}
 * @throws {Error} 当缺少 LUT_3D_SIZE、数据长度不符或为 1D LUT 时
 */
function parseCubeLUT(text) {
  const lines = text.split('\n');
  let size = null;
  const data = [];
  let saw1D = false;
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    if (/^LUT_3D_SIZE/i.test(line)) {
      const v = parseInt(line.split(/\s+/)[1], 10);
      if (!Number.isFinite(v) || v < 2 || v > 256) {
        throw new Error(`Invalid LUT_3D_SIZE: ${line}`);
      }
      size = v;
      continue;
    }
    if (/^LUT_1D_SIZE/i.test(line)) {
      saw1D = true;
      continue;
    }
    if (/^DOMAIN_MIN/i.test(line)) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      if (parts.length === 3 && parts.every(Number.isFinite)) domainMin = parts;
      continue;
    }
    if (/^DOMAIN_MAX/i.test(line)) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      if (parts.length === 3 && parts.every(Number.isFinite)) domainMax = parts;
      continue;
    }
    if (/^[A-Z_]+/i.test(line)) continue; // TITLE 等标题行

    const parts = line.split(/\s+/).map(parseFloat);
    if (parts.length >= 3 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && Number.isFinite(parts[2])) {
      data.push(parts[0], parts[1], parts[2]);
    }
  }

  if (saw1D && size === null) {
    throw new Error('1D LUT not supported (expected LUT_3D_SIZE)');
  }
  if (size === null) {
    const cubes = data.length / 3;
    const guess = Math.round(Math.cbrt(cubes));
    if (guess ** 3 === cubes && guess >= 2) {
      size = guess;
    } else {
      throw new Error('Missing LUT_3D_SIZE and cannot infer from data length');
    }
  }

  const expected = size * size * size * 3;
  if (data.length !== expected) {
    throw new Error(`LUT data length mismatch: got ${data.length}, expected ${expected} (size=${size})`);
  }

  return { size, data: new Float32Array(data), domainMin, domainMax };
}

export { parseCubeLUT };