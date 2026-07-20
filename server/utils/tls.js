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

/**
 * Build the SAN list for the self-signed cert:
 *   - loopback (always)
 *   - every non-internal interface address (LAN/public IP of this machine),
 *     so phones can connect by IP without hostname-validation failures
 *   - FG_TLS_EXTRA_SAN: comma-separated extras for addresses NOT on a local
 *     interface (e.g. NAT port-forwarded public IP or a DDNS name).
 *     Accepts "1.2.3.4", "IP:1.2.3.4", "name.example.com", "DNS:name".
 */
function collectSanEntries() {
  const entries = ['IP:127.0.0.1', 'IP:::1', 'DNS:localhost'];
  try {
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      for (const it of list || []) {
        if (!it || it.internal || !it.address) continue;
        const addr = String(it.address).split('%')[0]; // strip IPv6 zone id
        const fam = it.family;
        if (fam === 'IPv4' || fam === 4 || fam === 'IPv6' || fam === 6) {
          entries.push(`IP:${addr}`);
        }
      }
    }
  } catch { /* best-effort */ }
  const extra = process.env.FG_TLS_EXTRA_SAN;
  if (extra) {
    for (const raw of String(extra).split(',')) {
      const t = raw.trim();
      if (!t) continue;
      if (/^(IP|DNS):/i.test(t)) entries.push(t);
      else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) entries.push(`IP:${t}`);
      else entries.push(`DNS:${t}`);
    }
  }
  return [...new Set(entries)];
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
  const sanPath = path.join(certDir, 'san.txt');

  // The SAN list is part of the cache identity: if the machine's addresses
  // changed (new LAN IP, FG_TLS_EXTRA_SAN added), the cached cert no longer
  // covers them and must be regenerated. Pre-sidecar certs (no san.txt)
  // are regenerated once on upgrade.
  const sanEntries = collectSanEntries();
  const sanSignature = sanEntries.join(',');
  let cachedSan = null;
  try { cachedSan = fs.readFileSync(sanPath, 'utf-8').trim(); } catch { /* no sidecar */ }

  if (fs.existsSync(certPath) && fs.existsSync(keyPath) && cachedSan === sanSignature) {
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
    `-addext "subjectAltName=${sanEntries.join(',')}"`;
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
  try { fs.writeFileSync(sanPath, sanSignature); } catch { /* best-effort */ }
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

module.exports = { loadTlsCredentials, getCertDir, getDaysUntilExpiry, collectSanEntries };
