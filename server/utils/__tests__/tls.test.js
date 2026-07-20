/**
 * Tests for the Phase 2B #7 TLS credential loader.
 *
 * Locks:
 *   - FG_TLS_DISABLE=1 → returns null (HTTP fallback)
 *   - FG_TLS_CERT + FG_TLS_KEY → loads from disk
 *   - falls back to autocert generation (execMocked openssl call)
 *   - cached files are reused on the second call
 *
 * execSync is mocked so tests don't actually shell out.
 */
const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// We load the module fresh per test so env mutations take effect.
let loadTls;
let getCertDir;

beforeEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
  loadTls = require('../tls').loadTlsCredentials;
  getCertDir = require('../tls').getCertDir;
});

test('FG_TLS_DISABLE=1 → null', () => {
  process.env.FG_TLS_DISABLE = '1';
  expect(loadTls()).toBeNull();
  delete process.env.FG_TLS_DISABLE;
});

test('FG_TLS_CERT + FG_TLS_KEY → loads from disk', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-test-'));
  const cert = path.join(tmp, 'cert.pem');
  const key = path.join(tmp, 'key.pem');
  fs.writeFileSync(cert, 'CERTCONTENT');
  fs.writeFileSync(key, 'KEYCONTENT');
  process.env.FG_TLS_CERT = cert;
  process.env.FG_TLS_KEY = key;

  const result = loadTls();
  expect(result.source).toBe('env');
  expect(result.cert.toString()).toBe('CERTCONTENT');
  expect(result.key.toString()).toBe('KEYCONTENT');

  delete process.env.FG_TLS_CERT;
  delete process.env.FG_TLS_KEY;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('FG_TLS_CERT pointing at a missing file → throws', () => {
  process.env.FG_TLS_CERT = '/nonexistent/cert.pem';
  process.env.FG_TLS_KEY = '/nonexistent/key.pem';
  expect(() => loadTls()).toThrow(/FG_TLS_CERT.*missing/i);
  delete process.env.FG_TLS_CERT;
  delete process.env.FG_TLS_KEY;
});

test('autocert: missing cache + openssl success → generates + caches', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-autocert-'));
  process.env.FG_TLS_CERT_DIR = tmp;

  // Mock execSync to "produce" cert/key files when called with the openssl command.
  jest.spyOn(child_process, 'execSync').mockImplementation((cmd) => {
    if (typeof cmd === 'string' && cmd.startsWith('openssl req')) {
      // openssl writes to the -keyout/-out paths in the real invocation;
      // simulate that side effect.
      fs.writeFileSync(path.join(tmp, 'key.pem'), 'KEY');
      fs.writeFileSync(path.join(tmp, 'cert.pem'), 'CERT');
      return Buffer.from('');
    }
    return Buffer.from('');
  });

  const result = loadTls();
  expect(result.source).toBe('generated');
  expect(result.cert.toString()).toBe('CERT');
  expect(result.key.toString()).toBe('KEY');

  // Second call reuses the cache (no execSync).
  child_process.execSync.mockClear();
  const cached = loadTls();
  expect(cached.source).toBe('cached');
  expect(child_process.execSync).not.toHaveBeenCalled();

  delete process.env.FG_TLS_CERT_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('autocert: openssl failure → throws a helpful error', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-fail-'));
  process.env.FG_TLS_CERT_DIR = tmp;
  jest.spyOn(child_process, 'execSync').mockImplementation(() => {
    throw new Error('openssl: command not found');
  });
  expect(() => loadTls()).toThrow(/TLS autocert generation failed/i);
  delete process.env.FG_TLS_CERT_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('getCertDir respects FG_TLS_CERT_DIR', () => {
  process.env.FG_TLS_CERT_DIR = '/custom/path';
  expect(getCertDir()).toBe('/custom/path');
  delete process.env.FG_TLS_CERT_DIR;
});

test('getCertDir falls back to USER_DATA/.filmgallery/certs', () => {
  delete process.env.FG_TLS_CERT_DIR;
  process.env.USER_DATA = '/user/data';
  expect(getCertDir()).toBe(path.join('/user/data', '.filmgallery', 'certs'));
  delete process.env.USER_DATA;
});

test('collectSanEntries: always includes loopback', () => {
  delete process.env.FG_TLS_EXTRA_SAN;
  const sans = require('../tls').collectSanEntries();
  expect(sans).toContain('IP:127.0.0.1');
  expect(sans).toContain('IP:::1');
  expect(sans).toContain('DNS:localhost');
});

test('collectSanEntries: FG_TLS_EXTRA_SAN accepts bare IP, prefixed entry, and DNS name', () => {
  process.env.FG_TLS_EXTRA_SAN = '59.66.234.26, IP:10.0.0.2, nas.example.com';
  const sans = require('../tls').collectSanEntries();
  expect(sans).toContain('IP:59.66.234.26');
  expect(sans).toContain('IP:10.0.0.2');
  expect(sans).toContain('DNS:nas.example.com');
  delete process.env.FG_TLS_EXTRA_SAN;
});

test('autocert: SAN change (FG_TLS_EXTRA_SAN added) → regenerates cert', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-san-'));
  process.env.FG_TLS_CERT_DIR = tmp;
  delete process.env.FG_TLS_EXTRA_SAN;

  jest.spyOn(child_process, 'execSync').mockImplementation((cmd) => {
    if (typeof cmd === 'string' && cmd.startsWith('openssl req')) {
      fs.writeFileSync(path.join(tmp, 'key.pem'), 'KEY');
      fs.writeFileSync(path.join(tmp, 'cert.pem'), 'CERT');
      return Buffer.from('');
    }
    return Buffer.from('');
  });

  expect(loadTls().source).toBe('generated');
  // Same SANs → cached, no regeneration
  expect(loadTls().source).toBe('cached');
  // Extra SAN → must regenerate (cert would otherwise fail hostname check)
  process.env.FG_TLS_EXTRA_SAN = '59.66.234.26';
  expect(loadTls().source).toBe('generated');
  // And the openssl command carried the extra SAN
  const cmd = child_process.execSync.mock.calls
    .map(c => c[0]).filter(c => typeof c === 'string' && c.startsWith('openssl req')).pop();
  expect(cmd).toContain('IP:59.66.234.26');

  delete process.env.FG_TLS_EXTRA_SAN;
  delete process.env.FG_TLS_CERT_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});
