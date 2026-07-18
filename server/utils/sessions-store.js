/**
 * Sessions store — DB persistence for Phase 2B #1 auth tokens.
 *
 * One row per active (mobile/watch) device session. Token is stored as a
 * sha256 hex hash; the plaintext is returned to the caller exactly once at
 * issuance. Revocation = setting revoked_at; the row is retained for audit
 * and to support immediate invalidate-by-hash on already-issued tokens.
 *
 * See docs/phase2-roadmap/phase-2b-security.md §「sessions 表 schema」.
 */
const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeKind(kind) {
  const k = String(kind || '').toLowerCase();
  return k === 'watch' ? 'watch' : 'mobile';
}

function createSessionsStore(db) {
  /**
   * Issue a new session. Replaces any prior session for the same
   * (device_fp, device_kind) — re-pairing overwrites the old token.
   *
   * @returns {Promise<{token: string, id: number}>}
   */
  function issue({ deviceName, deviceKind, deviceFp, issuedBy = null }) {
    return new Promise((resolve, reject) => {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(token);
      const now = Date.now();
      const kind = normalizeKind(deviceKind);
      db.serialize(() => {
        db.run(
          `DELETE FROM sessions WHERE device_fp = ? AND device_kind = ?`,
          [deviceFp, kind],
          (delErr) => {
            if (delErr) return reject(delErr);
            db.run(
              `INSERT INTO sessions
                 (token_hash, device_name, device_kind, device_fp,
                  issued_at, expires_at, last_seen_at, revoked_at, issued_by)
               VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?)`,
              [tokenHash, deviceName, kind, deviceFp, now, now, issuedBy],
              function (insErr) {
                if (insErr) return reject(insErr);
                resolve({ token, id: this.lastID });
              }
            );
          }
        );
      });
    });
  }

  /**
   * Verify a plaintext token. Returns the session row if valid, otherwise null.
   * A session is invalid if: hash unknown, revoked_at is set, or expires_at
   * is in the past. Negative results are NEVER cached by the auth layer —
   * revocation must be immediate.
   */
  function verify(token) {
    return new Promise((resolve, reject) => {
      if (!token || typeof token !== 'string') return resolve(null);
      const tokenHash = hashToken(token);
      db.get(
        `SELECT id, device_name, device_kind, device_fp, issued_at, expires_at,
                last_seen_at, revoked_at, issued_by
           FROM sessions
          WHERE token_hash = ?`,
        [tokenHash],
        (err, row) => {
          if (err) return reject(err);
          if (!row) return resolve(null);
          if (row.revoked_at != null) return resolve(null);
          if (row.expires_at != null && row.expires_at < Date.now()) return resolve(null);
          resolve(row);
        }
      );
    });
  }

  /** Fire-and-forget last-seen refresh. Failures are non-fatal. */
  function touch(id) {
    db.run(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`, [Date.now(), id]);
  }

  /** List all sessions (active + revoked) newest-first. */
  function list() {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT id, device_name, device_kind, device_fp, issued_at, expires_at,
                last_seen_at, revoked_at, issued_by
           FROM sessions
          ORDER BY issued_at DESC`,
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });
  }

  /**
   * Revoke a session and any session derived from it (watch tokens issued
   * via issued_by chain — single level, not recursive, which matches the
   * derive-watch flow).
   */
  function revoke(id) {
    return new Promise((resolve, reject) => {
      const now = Date.now();
      db.run(
        `UPDATE sessions
            SET revoked_at = ?
          WHERE id = ? OR issued_by = ?`,
        [now, id, id],
        function (err) {
          if (err) return reject(err);
          resolve({ revoked: this.changes });
        }
      );
    });
  }

  return { issue, verify, touch, list, revoke };
}

module.exports = { createSessionsStore, hashToken, normalizeKind };
