// Simple Cache-Control middleware with short-lived TTLs for GETs only
function cacheSeconds(seconds = 60) {
  const value = `public, max-age=${Math.max(0, seconds)}, stale-while-revalidate=30`;
  return (req, res, next) => {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', value);
    }
    next();
  };
}

module.exports = { cacheSeconds };
