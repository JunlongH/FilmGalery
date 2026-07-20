/**
 * Wrap an async (or sync) route handler so that rejected promises AND
 * synchronous throws both propagate to errorHandler via next(err).
 *
 * Required for Express 4 (which does not auto-forward async rejections the
 * way Express 5 does).
 *
 * Note on the implementation: the older `Promise.resolve(fn(...)).catch(next)`
 * form fails to catch *synchronous* throws inside `fn` — `fn(...)` runs
 * before Promise.resolve wraps it. We use an async wrapper so both sync
 * throws and async rejections land in the catch.
 *
 * Usage:
 *   router.get('/:id', asyncHandler(async (req, res) => {
 *     const row = await getAsync(...);
 *     if (!row) throw new NotFoundError('Photo not found'); // → 404 via handler
 *     res.json(row);
 *   }));
 *
 * Idempotent with the legacy per-file copy that used to live in
 * routes/equipment.js — that file imports from here as part of 2C.2
 * consolidation.
 *
 * @param {function} fn - (req, res, next?) => Promise<any> | any
 * @returns {(req, res, next) => Promise<void>}
 */
function asyncHandler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { asyncHandler };
