/**
 * Path Security Utilities
 *
 * Single source of truth for filesystem access control.
 *
 * Three access modes (mirrors routes/filesystem.js behavior):
 *  1. Whitelist mode (default): ALLOWED_BROWSE_PATHS lists allowed dirs
 *  2. Mounted mode: ALLOW_ALL_MOUNTED_PATHS=true allows all /mnt subdirs
 *  3. Open mode: FILESYSTEM_OPEN_MODE=true allows all paths (DANGEROUS)
 *
 * Sensitive system paths are always blocked regardless of mode.
 */

const fs = require('fs');
const path = require('path');

// Sensitive system paths — always blocked in every mode.
const BLOCKED_PATHS = [
  '/etc', '/var', '/usr', '/bin', '/sbin', '/lib', '/lib64',
  '/proc', '/sys', '/dev', '/root', '/boot', '/run',
  'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)',
  'C:\\ProgramData', 'C:\\Users\\Default'
];

const isOpenMode = () => process.env.FILESYSTEM_OPEN_MODE === 'true';
const isAllMountedMode = () => process.env.ALLOW_ALL_MOUNTED_PATHS === 'true';

// Detect /mnt subdirs (Linux mounted shares)
const getMountedPaths = () => {
  const mountRoot = '/mnt';
  try {
    if (!fs.existsSync(mountRoot)) return [];
    const entries = fs.readdirSync(mountRoot, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => path.join(mountRoot, e.name));
  } catch {
    return [];
  }
};

// Resolve the list of allowed root directories based on the active mode.
const getAllowedPaths = () => {
  const uploadsRoot = process.env.UPLOADS_ROOT ||
    (process.env.DATA_ROOT ? path.join(process.env.DATA_ROOT, 'uploads') : '/app/uploads');

  if (isOpenMode()) {
    const roots = process.platform === 'win32' ? ['C:\\', 'D:\\', 'E:\\'] : ['/'];
    return [...new Set([uploadsRoot, ...roots])];
  }

  if (isAllMountedMode()) {
    const mounted = getMountedPaths();
    return [...new Set([uploadsRoot, ...mounted])];
  }

  const envPaths = process.env.ALLOWED_BROWSE_PATHS || '';
  const configuredPaths = envPaths.split(',').map(p => p.trim()).filter(p => p.length > 0);
  const allPaths = [uploadsRoot, ...configuredPaths];

  return allPaths.filter(p => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
};

// True if the path is a sensitive system path.
const isPathBlocked = (targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') return true;
  const normalized = path.normalize(targetPath).toLowerCase();
  return BLOCKED_PATHS.some(blocked =>
    normalized === blocked.toLowerCase() ||
    normalized.startsWith(blocked.toLowerCase() + path.sep)
  );
};

// True if the path is within an allowed root (and not blocked).
const isPathAllowed = (targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') return false;
  if (isPathBlocked(targetPath)) return false;
  if (isOpenMode()) return true;

  const allowedPaths = getAllowedPaths();
  const normalizedTarget = path.normalize(targetPath);

  return allowedPaths.some(allowed => {
    const normalizedAllowed = path.normalize(allowed);
    return normalizedTarget === normalizedAllowed ||
      normalizedTarget.startsWith(normalizedAllowed + path.sep);
  });
};

/**
 * Verify that a resolved path stays confined within `root`.
 * Prevents traversal via ".." or absolute/symlink escapes.
 * @returns {boolean} true if the resolved target is inside root.
 */
const isPathConfined = (root, targetPath) => {
  if (!root || !targetPath || typeof targetPath !== 'string') return false;
  const resolvedRoot = fs.realpathSync && fs.existsSync(root) ? safeRealpath(root) : path.resolve(root);
  const resolvedTarget = path.resolve(root, targetPath);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Safe unlink — the only sanctioned way to delete a file by DB-derived path.
 *
 * v4 review found 8+ sites in photos.js and 3 in films.js that called
 * fsPromises.unlink(path.join(uploadsDir, dbValue)) without confinement
 * checks. A corrupted DB row (e.g. positive_rel_path='../../etc/critical')
 * would let path.join escape the uploads directory. Rather than guarding
 * each site individually (whack-a-mole), this helper centralizes the
 * pattern: it always verifies confinement before unlinking, and silently
 * skips paths that fail the check (with a console.warn for visibility).
 *
 * @param {string} rootDir - confinement root (typically uploadsDir)
 * @param {string} relPath - DB-derived relative path
 * @param {object} [opts]
 * @param {boolean} [opts.silent=false] - suppress warn log on rejection
 * @param {string} [opts.label=''] - prefix for log messages (e.g. 'EXPORT-POSITIVE')
 * @returns {Promise<{deleted: boolean, reason?: string}>}
 *   - deleted=true: file was unlinked (or didn't exist — ENOENT is success)
 *   - deleted=false, reason='unconfined': path escaped rootDir, refused
 *   - deleted=false, reason=<error.message>: other unlink failure
 */
async function safeUnlink(rootDir, relPath, opts = {}) {
  const { silent = false, label = '' } = opts;
  if (!relPath || typeof relPath !== 'string') {
    return { deleted: false, reason: 'empty_path' };
  }
  if (!isPathConfined(rootDir, relPath)) {
    if (!silent) {
      console.warn(`[${label || 'safeUnlink'}] refused to delete unconfined path: ${relPath}`);
    }
    return { deleted: false, reason: 'unconfined' };
  }
  const fullPath = path.join(rootDir, relPath);
  try {
    await fs.promises.unlink(fullPath);
    return { deleted: true };
  } catch (e) {
    if (e.code === 'ENOENT') return { deleted: true }; // already gone — success
    if (!silent) {
      console.warn(`[${label || 'safeUnlink'}] unlink failed for ${relPath}:`, e.message);
    }
    return { deleted: false, reason: e.message };
  }
}

// realpathSync that never throws (falls back to resolve)
function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

module.exports = {
  BLOCKED_PATHS,
  isPathBlocked,
  isPathAllowed,
  isPathConfined,
  safeUnlink,
  getAllowedPaths,
  isOpenMode,
  isAllMountedMode,
};
