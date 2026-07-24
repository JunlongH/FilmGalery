/**
 * Auth settings endpoints — shared-secret management.
 *
 *   GET    /api/auth/secret             — return the current secret (loopback only)
 *   POST   /api/auth/secret/regenerate  — rotate the secret (loopback only)
 *   GET    /api/auth/check              — report caller auth status
 *
 * These routes sit BEHIND the auth middleware. Loopback callers pass through
 * automatically; remote callers need a valid Bearer secret. /secret and
 * /regenerate additionally enforce a loopback gate so a remote client (even
 * one holding the secret) cannot read or rotate the secret.
 */
const express = require('express');
const { isLoopback } = require('../utils/network');

function createAuthSettingsRouter({ secretStore, db }) {
  const router = express.Router();

  // GET /api/auth/check — reachable by anyone who passes auth (loopback,
  // valid secret, or soft-mode pass-through). Reports whether the caller is
  // truly authenticated (used by clients to validate an entered secret even
  // while soft mode is on).
  router.get('/check', (req, res) => {
    res.json({ ok: true, authenticated: !!req.authenticated });
  });

  // GET /api/auth/secret — loopback only (host displays the secret for clients).
  router.get('/secret', (req, res) => {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || '';
    if (!isLoopback(ip)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    res.json({ ok: true, secret: secretStore.getSecret() });
  });

  // POST /api/auth/secret/regenerate — loopback only. Invalidates all clients;
  // they must re-enter the new secret.
  router.post('/secret/regenerate', async (req, res, next) => {
    try {
      const ip = req.ip || (req.socket && req.socket.remoteAddress) || '';
      if (!isLoopback(ip)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      const secret = await secretStore.regenerateSecret(db);
      res.json({ ok: true, secret });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createAuthSettingsRouter };
