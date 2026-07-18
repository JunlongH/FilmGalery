/**
 * Pairing endpoints — Phase 2B #1.
 *
 * Two-step first-bind flow:
 *   1. Desktop (loopback) calls POST /api/pairing/code to get a 6-digit code.
 *      Server holds it in-memory with TTL 5min.
 *   2. Mobile posts the code to POST /api/pairing/verify along with its
 *      device fingerprint + friendly name. On match, server issues a long-lived
 *      token bound to that fingerprint.
 *
 * Brute-force defence:
 *   - 5 verify attempts per 15min per IP (rate limiter mounted in server.js).
 *   - After 3 failed verifies against a code, the code is locked (any further
 *     attempt returns 423 until it expires or is regenerated).
 *
 * NOTE: this router is mounted under the auth whitelist (anyone can call it).
 * /code defends itself with a loopback gate; /verify is open by design (the
 * 6-digit code IS the credential).
 */
const express = require('express');
const crypto = require('crypto');
const { isLoopback } = require('../utils/network');

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_FAILURES = 3;

function generateCode() {
  // crypto.randomInt gives unbiased 6-digit decimal.
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function createPairingRouter({ sessionsStore }) {
  const router = express.Router();
  // Single-slot code: only the most recently issued code is valid. Sufficient
  // for the desktop single-admin flow; restart clears it (no impact).
  let activeCode = null;

  // POST /api/pairing/code — loopback-only.
  router.post('/code', (req, res) => {
    const remoteIp = req.ip || (req.socket && req.socket.remoteAddress) || '';
    if (!isLoopback(remoteIp)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    activeCode = {
      code: generateCode(),
      expiresAt: Date.now() + CODE_TTL_MS,
      failures: 0,
    };
    return res.json({ ok: true, code: activeCode.code, expiresIn: CODE_TTL_MS });
  });

  // POST /api/pairing/verify — open; the 6-digit code is the credential.
  router.post('/verify', async (req, res, next) => {
    try {
      const { code, deviceName, deviceKind, deviceFp } = req.body || {};
      if (!code || !deviceName || !deviceFp) {
        return res.status(400).json({
          ok: false,
          error: 'missing required fields: code, deviceName, deviceFp',
        });
      }
      if (!activeCode || activeCode.expiresAt < Date.now()) {
        return res.status(401).json({ ok: false, error: 'no active pairing code' });
      }
      if (activeCode.failures >= MAX_FAILURES) {
        return res.status(423).json({
          ok: false,
          error: 'pairing locked; regenerate the code on the desktop',
        });
      }
      // Constant-time compare to harden against timing attacks on the 6-digit
      // space. Length-mismatch short-circuits (timingSafeEqual throws otherwise).
      const submitted = Buffer.from(String(code));
      const expected = Buffer.from(String(activeCode.code));
      if (submitted.length !== expected.length
          || !crypto.timingSafeEqual(submitted, expected)) {
        activeCode.failures += 1;
        return res.status(401).json({ ok: false, error: 'invalid code' });
      }

      // Consume the code BEFORE awaiting the DB so a concurrent verify with
      // the same code sees "no active code" rather than issuing a second
      // token. Single-use is the plan's contract; the race window between
      // the code check above and `activeCode = null` below is now zero.
      activeCode = null;

      const issued = await sessionsStore.issue({
        deviceName,
        deviceKind: deviceKind || 'mobile',
        deviceFp,
        issuedBy: null,
      });
      return res.json({ ok: true, token: issued.token, sessionId: issued.id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createPairingRouter, CODE_TTL_MS, MAX_FAILURES };
