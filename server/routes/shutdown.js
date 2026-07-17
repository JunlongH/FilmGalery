/**
 * Graceful-shutdown endpoint.
 *
 * Exposed as a factory so the destructive side effect (closing the DB and
 * exiting the process) is injected by the caller. server.js wires the real
 * graceful-exit routine; tests inject a stub, so mounting this router in a
 * test never calls process.exit.
 *
 * SECURITY: the handler only accepts requests from a loopback peer (Electron /
 * local tooling). Remote callers get 403.
 */
const express = require('express');
const { isLoopback } = require('../utils/network');

/**
 * @param {Object} [opts]
 * @param {Function} [opts.onShutdown] Invoked ~100ms after the response is
 *   sent. Omit to make the route a safe no-op (used in tests).
 * @returns {import('express').Router} Router to mount at '/api/shutdown'.
 */
function createShutdownRouter(opts = {}) {
  const { onShutdown } = opts;
  const router = express.Router();

  router.post('/', (req, res) => {
    const remoteIp = req.ip || (req.socket && req.socket.remoteAddress) || '';
    if (!isLoopback(remoteIp)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    console.log('[SERVER] Shutdown requested');
    res.json({ ok: true, message: 'Shutting down...' });

    // Trigger graceful exit after the response is flushed. The timeout matches
    // the original behaviour and is only scheduled when a handler is provided.
    if (typeof onShutdown === 'function') {
      setTimeout(onShutdown, 100);
    }
  });

  return router;
}

module.exports = { createShutdownRouter };
