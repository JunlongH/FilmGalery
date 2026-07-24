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

export function normalizeMode(mode) {
  if (typeof mode === 'string') {
    const lower = mode.toLowerCase();
    if (VALID_MODES.has(lower)) return lower;
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
