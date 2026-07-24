/**
 * Auth settings endpoints — shared-secret management.
 *
 *   GET    /api/auth/secret             — return the current secret (loopback only)
 *   POST   /api/auth/secret/regenerate  — rotate the secret (loopback only)
 *   GET    /api/auth/ca-cert            — download the TLS CA cert PEM (loopback only)
 *   GET    /api/auth/check              — report caller auth status
 *
 * These routes sit BEHIND the auth middleware. Loopback callers pass through
 * automatically; remote callers need a valid Bearer secret. /secret,
 * /regenerate, and /ca-cert additionally enforce a loopback gate so a remote
 * client (even one holding the secret) cannot read sensitive material.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { isLoopback } = require('../utils/network');
const { getCertDir } = require('../utils/tls');

function loopbackGate(req, res) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || '';
  if (!isLoopback(ip)) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

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
    if (!loopbackGate(req, res)) return;
    res.json({ ok: true, secret: secretStore.getSecret() });
  });

  // POST /api/auth/secret/regenerate — loopback only. Invalidates all clients;
  // they must re-enter the new secret.
  router.post('/secret/regenerate', async (req, res, next) => {
    try {
      if (!loopbackGate(req, res)) return;
      const secret = await secretStore.regenerateSecret(db);
      res.json({ ok: true, secret });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/auth/ca-cert — loopback only. Serves the self-signed CA cert PEM
  // so the user can download it and install on mobile devices. The phone must
  // trust this CA for HTTPS discovery to succeed.
  router.get('/ca-cert', (req, res) => {
    if (!loopbackGate(req, res)) return;
    const certDir = getCertDir();
    const caPath = path.join(certDir, 'ca-cert.pem');
    if (!fs.existsSync(caPath)) {
      return res.status(404).json({ ok: false, error: 'CA cert not found (TLS may be disabled)' });
    }
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', 'attachment; filename="filmgallery-ca.pem"');
    res.sendFile(caPath);
  });

  return router;
}

module.exports = { createAuthSettingsRouter };
