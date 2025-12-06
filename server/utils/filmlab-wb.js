function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function computeWBGains(params = {}, opts = {}) {
  const red = Number.isFinite(params.red) ? params.red : 1;
  const green = Number.isFinite(params.green) ? params.green : 1;
  const blue = Number.isFinite(params.blue) ? params.blue : 1;
  const temp = Number.isFinite(params.temp) ? params.temp : 0;
  const tint = Number.isFinite(params.tint) ? params.tint : 0;
  const minGain = opts.minGain ?? 0.05;
  const maxGain = opts.maxGain ?? 50.0;
  const t = temp/200;
  const n = tint/200;
  let r = red * (1 + t + n);
  let g = green * (1 + t - n);
  let b = blue * (1 - t);
  r = clamp(r, minGain, maxGain);
  g = clamp(g, minGain, maxGain);
  b = clamp(b, minGain, maxGain);
  return [r, g, b];
}

module.exports = { computeWBGains };
