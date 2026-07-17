/**
 * Unit tests for server/utils/network.js — isLoopback predicate.
 *
 * Locks the loopback-gate semantics used by the shutdown endpoint (and, later,
 * by the Phase 2B auth middleware that must treat loopback as trusted).
 */

const { isLoopback, LOOPBACK_IPS } = require('../network');

describe('isLoopback', () => {
  test('accepts the canonical loopback identities', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('localhost')).toBe(true);
  });

  test('normalises IPv4-mapped IPv6 form (::ffff:127.0.0.1)', () => {
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
  });

  test('accepts missing/empty peer (internal request)', () => {
    expect(isLoopback('')).toBe(true);
    expect(isLoopback(null)).toBe(true);
    expect(isLoopback(undefined)).toBe(true);
  });

  test('rejects remote peers (Phase 0–1 repro: non-loopback → 403)', () => {
    expect(isLoopback('192.168.1.5')).toBe(false);
    expect(isLoopback('10.0.0.2')).toBe(false);
    expect(isLoopback('203.0.113.5')).toBe(false);
    expect(isLoopback('8.8.8.8')).toBe(false);
  });

  test('the accepted set is exactly the documented loopback identities', () => {
    // Guards against accidentally broadening the trusted set.
    expect([...LOOPBACK_IPS].sort()).toEqual(['127.0.0.1', '::1', 'localhost']);
  });
});
