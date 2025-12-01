// Lightweight in-process request profiler
const stats = new Map(); // key -> {count,total, min, max}

function keyFor(req) {
  return `${req.method} ${req.path}`;
}

function record(key, ms) {
  const s = stats.get(key) || { count: 0, total: 0, min: Infinity, max: 0 };
  s.count += 1;
  s.total += ms;
  if (ms < s.min) s.min = ms;
  if (ms > s.max) s.max = ms;
  stats.set(key, s);
}

function requestProfiler() {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        const end = process.hrtime.bigint();
        const ms = Number(end - start) / 1e6;
        record(keyFor(req), ms);
      } catch (_) {}
    });
    next();
  };
}

function getProfilerStats() {
  const out = [];
  for (const [k, s] of stats) {
    out.push({ route: k, count: s.count, avg: s.total / s.count, min: s.min, max: s.max });
  }
  out.sort((a, b) => b.count - a.count);
  return {
    since: new Date().toISOString(),
    top: out.slice(0, 50)
  };
}

let timer = null;
function scheduleProfilerLog(intervalMs = 60000) {
  if (timer) return;
  timer = setInterval(() => {
    const snapshot = getProfilerStats();
    if (snapshot.top.length) {
      console.log('[PROFILER] Top routes:', snapshot.top.slice(0, 5));
    }
  }, intervalMs);
}

module.exports = { requestProfiler, getProfilerStats, scheduleProfilerLog };
