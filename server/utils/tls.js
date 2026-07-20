/**
 * TLS credential loader — Phase 2B #7.
 *
 * Resolution order:
 *   1. env FG_TLS_CERT + FG_TLS_KEY (user-provided, e.g. Let's Encrypt + DDNS)
 *   2. cached files at <userDir>/.filmgallery/certs/{cert,key}.pem
 *   3. generate self-signed (RSA 2048, 365d, CN=localhost, SAN covers loopback)
 *      via the openssl CLI — available on Linux/macOS and Windows Git Bash.
 *
 * Disable entirely with FG_TLS_DISABLE=1 (HTTP-only — for tests / opt-out).
 *
 * See docs/phase2-roadmap/phase-2b-security.md §「server HTTPS」.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
// Reference the module (not destructured) so tests can spy on execSync.
const cp = require('child_process');

function getCertDir() {
  const env = process.env.FG_TLS_CERT_DIR;
  if (env) return env;
  const base = process.env.USER_DATA || os.homedir();
  return path.join(base, '.filmgallery', 'certs');
}

function loadCertFromEnv() {
  const cert = process.env.FG_TLS_CERT;
  const key = process.env.FG_TLS_KEY;
  if (!cert || !key) return null;
  if (!fs.existsSync(cert) || !fs.existsSync(key)) {
    throw new Error(`FG_TLS_CERT/FG_TLS_KEY path missing: ${cert} / ${key}`);
  }
  return {
    cert: fs.readFileSync(cert),
    key: fs.readFileSync(key),
    source: 'env',
  };
}

function loadOrGenerateSelfSigned() {
  const certDir = getCertDir();
  const certPath = path.join(certDir, 'cert.pem');
  const keyPath = path.join(certDir, 'key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      source: 'cached',
      certPath,
    };
  }

  fs.mkdirSync(certDir, { recursive: true });
  // Git-for-Windows' openssl is compiled with a default OPENSSL_CONF pointing
  // at a build-machine path (Z:/extlib/.../openssl.cnf) that doesn't exist on
  // end-user machines, making `openssl req` fail. Always pass an explicit
  // minimal -config we write ourselves — harmless on Linux/macOS.
  const cnfPath = path.join(certDir, 'openssl-minimal.cnf');
  fs.writeFileSync(cnfPath, '[req]\ndistinguished_name = dn\nprompt = no\n[dn]\n');
  // openssl 1.1.1+ supports -addext; ships on all targeted platforms.
  const cmd =
    `openssl req -x509 -newkey rsa:2048 -nodes -days 365 ` +
    `-config "${cnfPath}" ` +
    `-keyout "${keyPath}" -out "${certPath}" ` +
    `-subj "/CN=localhost" ` +
    `-addext "subjectAltName=IP:127.0.0.1,IP:::1,DNS:localhost"`;
  try {
    cp.execSync(cmd, { stdio: 'pipe' });
  } catch (err) {
    throw new Error(
      `TLS autocert generation failed (openssl not found or errored): ${err.message}`
    );
  }
  // Tighten perms on the private key (Unix only; chmod is a no-op on Windows
  // but doesn't throw). Default umlaut leaves key files world-readable.
  try { fs.chmodSync(keyPath, 0o600); } catch { /* best-effort */ }
  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    source: 'generated',
    certPath,
  };
}

function loadTlsCredentials() {
  if (process.env.FG_TLS_DISABLE === '1') return null;
  return loadCertFromEnv() || loadOrGenerateSelfSigned();
}

/** Days before cert expiry at which we start warning on boot. */
function getDaysUntilExpiry(certPath) {
  try {
    const out = cp.execSync(
      `openssl x509 -in "${certPath}" -noout -enddate`,
      { stdio: ['pipe', 'pipe', 'ignore'] }
    ).toString();
    // notAfter=Jul 19 12:34:56 2027 GMT
    const m = /notAfter=(.+)/.exec(out);
    if (!m) return null;
    const notAfter = new Date(m[1].trim());
    if (Number.isNaN(notAfter.getTime())) return null;
    return Math.floor((notAfter.getTime() - Date.now()) / (24 * 3600 * 1000));
  } catch {
    return null;
  }
}

module.exports = { loadTlsCredentials, getCertDir, getDaysUntilExpiry };
