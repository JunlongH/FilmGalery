/**
 * Network-level security helpers.
 *
 * Kept separate from path-security.js (which is filesystem access control) so
 * each concern has a single home. The loopback predicate is reused by the
 * shutdown route today and by the Phase 2B auth middleware later.
 */

// Loopback identities accepted as "local". Empty/missing remote address is
// treated as local too (it occurs for certain internal requests where no peer
// is attached); this preserves the original shutdown-gate semantics.
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * True if `ip` refers to the local machine.
 *
 * Accepts raw `req.ip` / `req.socket.remoteAddress` values, including the
 * IPv4-mapped IPv6 form (`::ffff:127.0.0.1`), which is normalised away.
 *
 * @param {string|null|undefined} ip
 * @returns {boolean}
 */
function isLoopback(ip) {
  if (ip == null) return true;
  const normalized = String(ip).replace(/^::ffff:/, '').toLowerCase();
  return normalized === '' || LOOPBACK_IPS.has(normalized);
}

module.exports = { isLoopback, LOOPBACK_IPS };
