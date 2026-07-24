/**
 * Photography Mode Helpers
 *
 * Centralised constants and utilities for the film/digital mode system.
 * Used by server route handlers to translate a `?mode=` query parameter
 * into SQL `WHERE p.source_type IN (...)` fragments.
 *
 * See docs/digital-mode-design/03-data-model-and-migration.md (D3/D5) and
 * 05-backend-api-stats-ai.md §5.8.
 *
 * @module packages/shared/photographyMode
 */

const PHOTO_MODES = Object.freeze({
  FILM: 'film',
  DIGITAL: 'digital',
  ALL: 'all',
});

const VALID_MODES = Object.freeze(new Set(Object.values(PHOTO_MODES)));

/**
 * Normalise an arbitrary mode value to a valid PHOTO_MODES member.
 * Unknown / missing values default to 'all'.
 * @param {string|undefined} mode
 * @returns {string} one of PHOTO_MODES
 */
function normalizeMode(mode) {
  if (typeof mode === 'string') {
    const lower = mode.toLowerCase();
    if (VALID_MODES.has(lower)) return lower;
  }
  return PHOTO_MODES.ALL;
}

function isFilmMode(mode) {
  return normalizeMode(mode) === PHOTO_MODES.FILM;
}

function isDigitalMode(mode) {
  return normalizeMode(mode) === PHOTO_MODES.DIGITAL;
}

function isAllMode(mode) {
  return normalizeMode(mode) === PHOTO_MODES.ALL;
}

/**
 * Map a mode to the list of source_type values it covers.
 *
 * After migration all photos have source_type='film' or 'digital', but
 * we defensively include NULL so that any un-migrated row is treated as
 * film (the backfill default) rather than disappearing.
 *
 * @param {string} mode
 * @returns {string[]} e.g. ['film'], ['digital'], or ['film','digital']
 */
function sourceTypeFilter(mode) {
  const normalized = normalizeMode(mode);
  if (normalized === PHOTO_MODES.FILM) return ['film'];
  if (normalized === PHOTO_MODES.DIGITAL) return ['digital'];
  return ['film', 'digital'];
}

/**
 * Build a parameterised SQL fragment for filtering by source_type.
 *
 * Returns an object with `{ clause, params }`:
 *   mode='film'    → clause = "(p.source_type = 'film' OR p.source_type IS NULL)"
 *   mode='digital' → clause = "p.source_type = 'digital'"
 *   mode='all'     → clause = "" (no filtering)
 *
 * The NULL guard on film-mode ensures compatibility with any photo row
 * whose source_type was not yet backfilled (treated as film).
 *
 * @param {string} mode
 * @param {string} [columnAlias='p.source_type'] - fully-qualified column ref
 * @returns {{clause: string, params: Array}}
 */
const COLUMN_ALIAS_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

function buildSourceTypeClause(mode, columnAlias = 'p.source_type') {
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

module.exports = {
  PHOTO_MODES,
  VALID_MODES,
  normalizeMode,
  isFilmMode,
  isDigitalMode,
  isAllMode,
  sourceTypeFilter,
  buildSourceTypeClause,
};
