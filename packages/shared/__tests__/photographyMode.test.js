/**
 * Tests for photographyMode helpers (D-P2-5 + parity).
 *
 * Locks:
 *   - normalizeMode maps known modes (case-insensitive) and falls back to 'all'
 *   - unrecognized values still return 'all' (no API break)
 *   - but each distinct unrecognized value fires console.warn exactly once
 *     per process (de-duped via module-level Set), server-side only
 *   - helpers (isFilmMode / sourceTypeFilter / buildSourceTypeClause) delegate
 *     to normalizeMode and inherit the contract.
 */

const {
  PHOTO_MODES,
  normalizeMode,
  isFilmMode,
  isDigitalMode,
  isAllMode,
  sourceTypeFilter,
  buildSourceTypeClause,
  _normalizeModeWarnedValues,
} = require('../photographyMode');

describe('normalizeMode — known values', () => {
  test('lowercases and accepts canonical modes', () => {
    expect(normalizeMode('film')).toBe('film');
    expect(normalizeMode('digital')).toBe('digital');
    expect(normalizeMode('all')).toBe('all');
  });

  test('case-insensitive', () => {
    expect(normalizeMode('FILM')).toBe('film');
    expect(normalizeMode('Digital')).toBe('digital');
    expect(normalizeMode('ALL')).toBe('all');
  });

  test('undefined / null / non-string / empty → all (silent)', () => {
    expect(normalizeMode(undefined)).toBe('all');
    expect(normalizeMode(null)).toBe('all');
    expect(normalizeMode(123)).toBe('all');
    expect(normalizeMode('')).toBe('all');
  });
});

describe('normalizeMode — unrecognized value warns once (D-P2-5)', () => {
  let warnSpy;
  beforeEach(() => {
    _normalizeModeWarnedValues.clear();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    _normalizeModeWarnedValues.clear();
  });

  test('unknown mode → returns "all" AND warns once', () => {
    const out = normalizeMode('fil');
    expect(out).toBe(PHOTO_MODES.ALL);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0][0]);
    expect(msg).toContain('[photographyMode]');
    expect(msg).toContain('"fil"');
    expect(msg).toContain('Valid modes: film, digital, all');
  });

  test('same unknown value second/third time → still "all" but no repeat warn', () => {
    expect(normalizeMode('fil')).toBe('all');
    expect(normalizeMode('fil')).toBe('all');
    expect(normalizeMode('fil')).toBe('all');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('distinct unknown values each warn once', () => {
    normalizeMode('fil');
    normalizeMode('dig');
    normalizeMode('xyz');
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  test('valid modes never warn', () => {
    normalizeMode('film');
    normalizeMode('digital');
    normalizeMode('all');
    normalizeMode('FILM');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('de-dup key is case-insensitive (FIL ≡ fil → single warn)', () => {
    normalizeMode('FIL');
    normalizeMode('fil');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('warn set is capped: distinct values beyond the cap stop warning, still return "all"', () => {
    for (let i = 0; i < 500; i++) {
      normalizeMode(`bad-${i}`);
    }
    expect(warnSpy).toHaveBeenCalledTimes(500);
    expect(_normalizeModeWarnedValues.size).toBe(500);

    expect(normalizeMode('bad-overflow')).toBe('all');
    expect(normalizeMode('bad-overflow-2')).toBe('all');
    expect(warnSpy).toHaveBeenCalledTimes(500);
    expect(_normalizeModeWarnedValues.size).toBe(500);
  });
});

describe('normalizeMode helpers', () => {
  test('isFilmMode / isDigitalMode / isAllMode', () => {
    expect(isFilmMode('film')).toBe(true);
    expect(isDigitalMode('digital')).toBe(true);
    expect(isAllMode('all')).toBe(true);
    // Unknown coerces to 'all' → isAllMode returns true.
    expect(isAllMode('garbage')).toBe(true);
    expect(isFilmMode('garbage')).toBe(false);
    expect(isDigitalMode('garbage')).toBe(false);
  });

  test('sourceTypeFilter', () => {
    expect(sourceTypeFilter('film')).toEqual(['film']);
    expect(sourceTypeFilter('digital')).toEqual(['digital']);
    expect(sourceTypeFilter('all')).toEqual(['film', 'digital']);
    expect(sourceTypeFilter('garbage')).toEqual(['film', 'digital']);
  });

  test('buildSourceTypeClause', () => {
    expect(buildSourceTypeClause('all').clause).toBe('');
    expect(buildSourceTypeClause('film').clause).toContain("'film'");
    expect(buildSourceTypeClause('film').clause).toContain('IS NULL');
    expect(buildSourceTypeClause('digital').clause).toContain("'digital'");
  });
});
