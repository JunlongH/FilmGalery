function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function computeWBGains(params = {}, opts = {}) {
  const red = Number.isFinite(params.red) ? params.red : 1;
  const green = Number.isFinite(params.green) ? params.green : 1;
  const blue = Number.isFinite(params.blue) ? params.blue : 1;
  const temp = Number.isFinite(params.temp) ? params.temp : 0;
  const tint = Number.isFinite(params.tint) ? params.tint : 0;
  const minGain = opts.minGain ?? 0.05;
  const maxGain = opts.maxGain ?? 8.0;
  let r = red + temp/200 + tint/200;
  let g = green + temp/200 - tint/200;
  let b = blue - temp/200;
  r = clamp(r, minGain, maxGain);
  g = clamp(g, minGain, maxGain);
  b = clamp(b, minGain, maxGain);
  return [r, g, b];
}

module.exports = { computeWBGains };
