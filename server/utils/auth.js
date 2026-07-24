/**
 * Auth middleware — shared-secret strategy.
 *
 *   - loopback peer: pass through (desktop single-box UX, zero friction).
 *   - remote peer: require `Authorization: Bearer <secret>` validated against
 *     the shared secret (constant-time compare, in-memory cached — no DB hit).
 *
 * Soft mode (AUTH_SOFT_MODE !== '0', default ON): remote requests without a
 * valid secret are allowed through but flagged with X-Auth-Soft-Mode: warn and
 * req.authenticated=false. This is the transition window while clients adopt
 * the shared secret. Set AUTH_SOFT_MODE=0 to hard-enforce once all clients
 * carry the secret.
 *
 * Whitelist (pre-auth): /api/discover (port discovery), /api/health/* (liveness).
 * OPTIONS preflight is handled by `app.options('*')` mounted earlier in
 * server.js and never reaches this middleware. Static /uploads/* is mounted
 * earlier still.
 *
 * req.authenticated: true for loopback + valid-secret callers; false for
 * soft-mode pass-through; unset for whitelisted paths. Routes can branch on
 * it (e.g. /api/auth/check).
 */
const { isLoopback } = require('./network');

const WHITELIST = [
  /^\/api\/discover$/,
  /^\/api\/health(\/|$)/,
];

function isWhitelisted(reqPath) {
  return WHITELIST.some((re) => re.test(reqPath));
}

function createAuthMiddleware({ secretStore, softMode = false }) {
  function auth(req, res, next) {
    // 1. Loopback always passes (desktop single-box).
    if (isLoopback(req.ip)) {
      req.authenticated = true;
      return next();
    }
    // 2. Pre-auth whitelist.
    if (isWhitelisted(req.path)) {
      return next();
    }
    // 3. Extract + verify Bearer secret.
    const header = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const token = match ? match[1].trim() : null;
    if (token && secretStore.verifySecret(token)) {
      req.authenticated = true;
      return next();
    }
    // 4. Soft mode — pass through with warning.
    if (softMode) {
      res.setHeader('X-Auth-Soft-Mode', 'warn');
      req.authenticated = false;
      return next();
    }
    // 5. Hard reject.
    const err = new Error('Unauthorized');
    err.status = 401;
    err.code = 'UNAUTHORIZED';
    return next(err);
  }
  return auth;
}

module.exports = { createAuthMiddleware, WHITELIST, isWhitelisted };
