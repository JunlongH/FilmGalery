/**
 * Shared-secret auth store.
 *
 * Replaces the Phase 2B pairing/sessions apparatus (~1000 lines) with one
 * persistent secret. A single row in `auth_config` (id=1). The plaintext is
 * cached in memory after first load — the secret changes only on explicit
 * regenerate — and compared with crypto.timingSafeEqual on every remote
 * request. No DB hit on the hot path.
 *
 * Why plaintext (not hashed): the secret must be re-displayable in the host
 * settings UI so the user can type/scan it on each client. Hashing would make
 * re-display impossible. The DB is a local SQLite file; an attacker with file
 * access owns the machine anyway, so plaintext-on-disk is acceptable here.
 */
const crypto = require('crypto');

let cachedSecret = null;

function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Ensure the auth_config table exists and has a row. Called once at startup
 * (after migrations). Idempotent + race-safe: INSERT OR IGNORE then re-SELECT
 * so concurrent first-boot callers always agree on the winner.
 */
function ensureSecret(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `CREATE TABLE IF NOT EXISTS auth_config (
          id         INTEGER PRIMARY KEY CHECK (id = 1),
          secret     TEXT    NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        (createErr) => {
          if (createErr) return reject(createErr);
          db.get('SELECT secret FROM auth_config WHERE id = 1', (err, row) => {
            if (err) return reject(err);
            if (row && row.secret) {
              cachedSecret = row.secret;
              return resolve(row.secret);
            }
            const secret = generateSecret();
            db.run(
              'INSERT OR IGNORE INTO auth_config (id, secret) VALUES (1, ?)',
              [secret],
              (insErr) => {
                if (insErr) return reject(insErr);
                db.get('SELECT secret FROM auth_config WHERE id = 1', (e2, r2) => {
                  if (e2) return reject(e2);
                  cachedSecret = (r2 && r2.secret) || secret;
                  resolve(cachedSecret);
                });
              }
            );
          });
        }
      );
    });
  });
}

/** Synchronous read of the in-memory cached secret. */
function getSecret() {
  return cachedSecret;
}

/** Constant-time verify of a submitted Bearer token against the cached secret. */
function verifySecret(token) {
  if (!cachedSecret || typeof token !== 'string') return false;
  const submitted = Buffer.from(token);
  const expected = Buffer.from(cachedSecret);
  if (submitted.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(submitted, expected);
  } catch {
    return false;
  }
}

/** Generate a new secret, persist it, and refresh the in-memory cache. */
function regenerateSecret(db) {
  return new Promise((resolve, reject) => {
    const secret = generateSecret();
    db.run(
      `UPDATE auth_config SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
      [secret],
      (err) => {
        if (err) return reject(err);
        cachedSecret = secret;
        resolve(secret);
      }
    );
  });
}

module.exports = { ensureSecret, getSecret, verifySecret, regenerateSecret, generateSecret };
