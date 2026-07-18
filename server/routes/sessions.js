/**
 * Session management endpoints — Phase 2B #1.
 *
 * Mounted AFTER the auth middleware, so all routes require either loopback
 * (desktop admin) or a valid bearer token. The auth middleware attaches
 * `req.session` for token-authenticated callers.
 *
 * Endpoints:
 *   GET    /api/sessions                       — list all sessions (desktop view)
 *   DELETE /api/sessions/:id                   — revoke a session + cascade
 *   POST   /api/sessions/:id/derive-watch      — issue a watch token chained
 *                                                 to the caller's session
 *
 * `onRevoke(id)` is invoked after a successful DELETE so the auth middleware
 * can invalidate its positive cache for the revoked session(s). Without this,
 * a just-revoked token would keep working for up to the 60s LRU TTL.
 */
const express = require('express');

function createSessionsRouter({ sessionsStore, onRevoke = null }) {
  const router = express.Router();

  // GET /api/sessions — list (desktop admin via loopback pass-through).
  router.get('/', async (req, res, next) => {
    try {
      const sessions = await sessionsStore.list();
      res.json({ ok: true, sessions });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/sessions/:id — revoke (cascade to derived watch tokens).
  router.delete('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ ok: false, error: 'invalid id' });
      }
      const result = await sessionsStore.revoke(id);
      // Drop any cached positive verify result so the next request from the
      // revoked token hits the DB and 401s. Plan §「撤销（D2）」: immediate.
      if (typeof onRevoke === 'function') onRevoke(id);
      res.json({ ok: true, revoked: result.revoked });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/sessions/:id/derive-watch — caller may only derive from their
  // OWN session (req.session.id must equal :id). The derived watch token
  // chains revocation: when this mobile session is revoked, all watch tokens
  // it issued are revoked in the same UPDATE.
  router.post('/:id/derive-watch', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ ok: false, error: 'invalid id' });
      }
      if (!req.session || req.session.id !== id) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
      const { deviceName, deviceFp } = req.body || {};
      if (!deviceName || !deviceFp) {
        return res.status(400).json({
          ok: false,
          error: 'missing required fields: deviceName, deviceFp',
        });
      }
      const issued = await sessionsStore.issue({
        deviceName,
        deviceKind: 'watch',
        deviceFp,
        issuedBy: id,
      });
      res.json({ ok: true, token: issued.token, sessionId: issued.id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createSessionsRouter };
