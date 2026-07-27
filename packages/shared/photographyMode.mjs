/**
 * Photography Mode Helpers (ESM entry — mirrors photographyMode.js)
 *
 * @module packages/shared/photographyMode
 */

export const PHOTO_MODES = Object.freeze({
  FILM: 'film',
  DIGITAL: 'digital',
  ALL: 'all',
});

export const VALID_MODES = Object.freeze(new Set(Object.values(PHOTO_MODES)));

// Module-level de-dupe set: each distinct unrecognized mode value is warned
// about at most once per process. Exported (underscore-prefixed) so tests can
// reset it between cases. Capped to prevent unbounded growth from arbitrary
// `?mode=` request values. See D-P2-5.
const MAX_WARNED_VALUES = 500;
export const _normalizeModeWarnedValues = new Set();

/**
 * Normalise an arbitrary mode value to a valid PHOTO_MODES member.
 * Unknown / missing values default to 'all'.
 *
 * Unrecognized string values still coerce to 'all' (API compat) but emit a
 * one-time-per-process `console.warn`. Gated to non-browser contexts to avoid
 * spamming future client bundles. See .js twin for full rationale.
 */
export function normalizeMode(mode) {
  if (typeof mode === 'string') {
    const lower = mode.toLowerCase();
    if (VALID_MODES.has(lower)) return lower;
    if (
      typeof window === 'undefined' &&
      _normalizeModeWarnedValues.size < MAX_WARNED_VALUES &&
      !_normalizeModeWarnedValues.has(lower)
    ) {
      _normalizeModeWarnedValues.add(lower);
      console.warn(
        `[photographyMode] Unrecognized mode "${mode}" (normalized: "${lower}") — ` +
        `defaulting to "all" (no filtering). Valid modes: film, digital, all.`
      );
    }
  }
  return PHOTO_MODES.ALL;
}

export function isFilmMode(mode) {
  return normalizeMode(mode) === PHOTO_MODES.FILM;
}

export function isDigitalMode(mode) {
  return normalizeMode(mode) === PHOTO_MODES.DIGITAL;
}

export function isAllMode(mode) {
  return normalizeMode(mode) === PHOTO_MODES.ALL;
}

/**
 * Whether a photo row may enter the film (FilmLab) pipeline.
 * NULL source_type is tolerated (un-migrated rows are treated as film,
 * mirroring buildSourceTypeClause's film branch).
 * @param {string|null|undefined} sourceType
 * @returns {boolean}
 */
export function isFilmPipelineSource(sourceType) {
  return sourceType == null || sourceType === PHOTO_MODES.FILM;
}

export function sourceTypeFilter(mode) {
  const normalized = normalizeMode(mode);
  if (normalized === PHOTO_MODES.FILM) return ['film'];
  if (normalized === PHOTO_MODES.DIGITAL) return ['digital'];
  return ['film', 'digital'];
}

const COLUMN_ALIAS_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function buildSourceTypeClause(mode, columnAlias = 'p.source_type') {
  if (typeof columnAlias !== 'string' || !COLUMN_ALIAS_RE.test(columnAlias)) {
    throw new Error(`Invalid columnAlias: ${columnAlias}`);
  }
  const normalized = normalizeMode(mode);
  if (normalized === PHOTO_MODES.ALL) {
    return { clause: '', params: [] };
  }
  // NULL source_type rows are un-migrated legacy film photos, so film branch must include them;
  // digital rows are always explicitly stamped, so digital branch is strict.
  if (normalized === PHOTO_MODES.FILM) {
    return {
      clause: `(${columnAlias} = 'film' OR ${columnAlias} IS NULL)`,
      params: [],
    };
  }
  return {
    clause: `${columnAlias} = 'digital'`,
    params: [],
  };
}
