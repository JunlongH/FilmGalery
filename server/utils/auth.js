/**
 * Auth middleware — Phase 2B #1.
 *
 * Strategy (docs/phase2-roadmap/phase-2b-security.md §「策略：本机放行，远端强制」):
 *   - loopback peer: pass through (desktop single-box UX, zero friction).
 *   - remote peer: require `Authorization: Bearer <token>` validated against
 *     the sessions table. Missing/invalid/revoked → 401.
 *
 * Soft mode (env AUTH_SOFT_MODE=1): remote requests without a valid token are
 * allowed through but flagged with `X-Auth-Soft-Mode: warn`. This is the
 * upgrade window for already-paired mobile clients (one release). A 401 in
 * soft mode would force every lagging mobile client to re-pair simultaneously.
 *
 * Whitelist (pre-auth): /api/discover (port discovery), /api/health/*
 * (liveness), /api/pairing/* (the pairing flow itself). OPTIONS preflight is
 * handled by `app.options('*')` mounted earlier in server.js and never reaches
 * this middleware. Static /uploads/* is mounted earlier still (D5豁免).
 *
 * Cache: positive verify results cached 60s (LRU, capacity 1000). Negative
 * results are NEVER cached so revocation is immediate.
 */
const { isLoopback } = require('./network');

const LRU_MAX = 1000;
const LRU_TTL_MS = 60 * 1000;

const WHITELIST = [
  /^\/api\/discover$/,
  /^\/api\/health(\/|$)/,
  /^\/api\/pairing(\/|$)/,
];

function isWhitelisted(reqPath) {
  return WHITELIST.some((re) => re.test(reqPath));
}

function createAuthMiddleware({ sessionsStore, softMode = false }) {
  const cache = new Map(); // token -> { session, expiresAt }

  function cacheGet(token) {
    const entry = cache.get(token);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      cache.delete(token);
      return null;
    }
    // Refresh insertion order so recently-used entries survive eviction.
    cache.delete(token);
    cache.set(token, entry);
    return entry.session;
  }

  function cacheSet(token, session) {
    if (cache.size >= LRU_MAX) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    cache.set(token, { session, expiresAt: Date.now() + LRU_TTL_MS });
  }

  /**
   * Drop every cache entry whose session was revoked (the row itself, or any
   * session derived from it via `issued_by`). Called by the sessions route
   * after a successful revoke so the next request hits the DB and 401s.
   *
   * This is the only path that can evict a still-TTL-fresh positive entry —
   * the plan demands revocation be immediate, not wait for the 60s TTL.
   */
  function invalidateBySessionId(sessionId) {
    for (const [token, entry] of cache) {
      const s = entry.session;
      if (s.id === sessionId || s.issued_by === sessionId) {
        cache.delete(token);
      }
    }
  }

  async function authorize(req) {
    // 1. Loopback always passes (desktop single-box).
    if (isLoopback(req.ip)) return { ok: true };

    // 2. Pre-auth whitelist.
    if (isWhitelisted(req.path)) return { ok: true };

    // 3. Extract Bearer token.
    const header = req.headers['authorization'] || '';
    const match = /^Bearer\s+([A-Za-z0-9+/=]+)$/i.exec(header);
    if (!match) {
      return softMode ? { ok: true, soft: true } : { ok: false, status: 401 };
    }
    const token = match[1];

    // 4. Cache lookup, then DB.
    let session = cacheGet(token);
    if (!session) {
      try {
        session = await sessionsStore.verify(token);
      } catch (err) {
        console.error('[AUTH] verify error:', err.message);
        return { ok: false, status: 500, message: 'auth verify failed' };
      }
      if (session) cacheSet(token, session);
      else return softMode ? { ok: true, soft: true } : { ok: false, status: 401 };
    }

    return { ok: true, session };
  }

  function auth(req, res, next) {
    authorize(req).then((result) => {
      if (result.ok) {
        if (result.soft) res.setHeader('X-Auth-Soft-Mode', 'warn');
        if (result.session) {
          req.session = result.session;
          sessionsStore.touch(result.session.id);
        }
        next();
      } else {
        res.status(result.status || 401).json({
          ok: false,
          error: result.message || 'unauthorized',
        });
      }
    }).catch((err) => next(err));
  }

  // Exposed for tests / health checks + revoke invalidation hook.
  auth._cache = cache;
  auth.invalidateBySessionId = invalidateBySessionId;
  return auth;
}

module.exports = { createAuthMiddleware, WHITELIST, isWhitelisted };
