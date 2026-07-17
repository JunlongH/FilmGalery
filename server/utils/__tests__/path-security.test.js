/**
 * Regression tests for server/utils/path-security.js
 *
 * These lock the Phase 0–1 security fixes by pinning the exact repro cases:
 *   - /etc/passwd (and every BLOCKED_PATH) is never allowed, in any mode
 *   - traversal (..) / absolute escapes are rejected by isPathConfined
 *   - the import/batch-download guards (isPathBlocked on outputDir) hold
 *
 * Determinism: tests rely only on isPathBlocked/isPathConfined (pure) and the
 * open-mode branch of isPathAllowed. They never touch the real filesystem, so
 * they are stable across dev/CI machines. Non-existent roots are used for the
 * confinement cases so fs.realpathSync is not consulted (its result would be
 * environment-dependent).
 */

const {
  BLOCKED_PATHS,
  isPathBlocked,
  isPathAllowed,
  isPathConfined,
  isOpenMode,
} = require('../path-security');

describe('isPathBlocked', () => {
  test('blocks every declared sensitive path and its children', () => {
    const posixBlocked = BLOCKED_PATHS.filter((p) => p.startsWith('/'));
    for (const p of posixBlocked) {
      expect(isPathBlocked(p)).toBe(true); // exact
      expect(isPathBlocked(`${p}/something`)).toBe(true); // child
    }
  });

  test('blocks /etc/passwd (Phase 0–1 repro)', () => {
    expect(isPathBlocked('/etc/passwd')).toBe(true);
  });

  test('does not treat unrelated paths as blocked', () => {
    expect(isPathBlocked('/home/user/photos')).toBe(false);
    expect(isPathBlocked('/mnt/nas/films')).toBe(false);
    expect(isPathBlocked('/etcfoo')).toBe(false); // not a child of /etc
  });

  test('rejects bad input', () => {
    expect(isPathBlocked(null)).toBe(true);
    expect(isPathBlocked(undefined)).toBe(true);
    expect(isPathBlocked(123)).toBe(true);
    expect(isPathBlocked('')).toBe(true);
  });
});

describe('isPathAllowed — block-first invariant', () => {
  // The core security property: blocked paths are NEVER allowed, regardless of
  // mode. isPathAllowed checks isPathBlocked before any allow-list logic.
  test('sensitive paths are denied in every mode', () => {
    const savedOpen = process.env.FILESYSTEM_OPEN_MODE;
    try {
      for (const mode of ['true', undefined]) {
        process.env.FILESYSTEM_OPEN_MODE = mode;
        expect(isOpenMode()).toBe(mode === 'true');
        expect(isPathAllowed('/etc/passwd')).toBe(false);
        expect(isPathAllowed('/proc/cpuinfo')).toBe(false);
        expect(isPathAllowed('/root/.ssh/id_rsa')).toBe(false);
        expect(isPathAllowed('/etc')).toBe(false);
      }
    } finally {
      process.env.FILESYSTEM_OPEN_MODE = savedOpen;
    }
  });

  test('open mode allows an ordinary path (block-list bypass only)', () => {
    const saved = process.env.FILESYSTEM_OPEN_MODE;
    process.env.FILESYSTEM_OPEN_MODE = 'true';
    try {
      expect(isOpenMode()).toBe(true);
      expect(isPathAllowed('/home/user/something')).toBe(true);
    } finally {
      process.env.FILESYSTEM_OPEN_MODE = saved;
    }
  });

  test('rejects bad input', () => {
    expect(isPathAllowed(null)).toBe(false);
    expect(isPathAllowed('')).toBe(false);
  });
});

describe('isPathConfined — traversal / escape protection', () => {
  // Use a non-existent root so the resolver takes the pure path.resolve branch
  // instead of fs.realpathSync (which depends on the host).
  const ROOT = '/tmp/fg_path_security_test_root';

  test('allows a path inside the root', () => {
    expect(isPathConfined(ROOT, 'roll_1/thumb/a.jpg')).toBe(true);
    expect(isPathConfined(ROOT, 'a/b/c')).toBe(true);
  });

  test('rejects parent traversal (Phase 0–1 repro: /uploads/../../etc/passwd)', () => {
    expect(isPathConfined(ROOT, '../../etc/passwd')).toBe(false);
    expect(isPathConfined(ROOT, 'sub/../../../etc/passwd')).toBe(false);
  });

  test('rejects absolute-path escape', () => {
    expect(isPathConfined(ROOT, '/etc/passwd')).toBe(false);
    expect(isPathConfined(ROOT, '/tmp/elsewhere')).toBe(false);
  });

  test('rejects bad input', () => {
    expect(isPathConfined(null, 'a')).toBe(false);
    expect(isPathConfined(ROOT, null)).toBe(false);
    expect(isPathConfined(ROOT, '')).toBe(false); // empty target treated as invalid
  });
});
