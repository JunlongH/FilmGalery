/**
 * Wave 0 toolchain smoke test.
 *
 * Purpose: prove the mobile TypeScript + jest pipeline works end-to-end
 * BEFORE any source migration begins. A .ts test file importing .js mobile
 * modules exercises, in one shot:
 *   - @babel/preset-typescript transform (wired via babel-preset-expo ->
 *     @react-native/babel-preset -> @babel/plugin-transform-typescript)
 *   - allowJs module resolution (.ts importing .js, the incremental-migration
 *     foundation for all subsequent waves)
 *   - the jest-expo preset + babel-jest transform pipeline
 *
 * If this test compiles and passes, Waves 1-8 can rely on the same toolchain.
 * It is deliberately pure-logic (no React/RN render) so it runs under Node
 * without a metro/emulator environment — matching the Phase 2A verification
 * boundary. Component render tests are introduced in Wave 3.
 */
import {
  FILM_ITEM_STATUSES,
  FILM_ITEM_STATUS_LABELS,
  FILM_ITEM_STATUS_FILTERS,
} from '../src/constants/filmItemStatus';
import { toISODateString, parseISODate } from '../src/utils/date';
import {
  wgs84ToGcj02,
  gcj02ToWgs84,
  isInChina,
} from '@filmgallery/shared/coordTransform';

describe('Wave 0 toolchain smoke', () => {
  test('imports a .js constants module under jest + typescript', () => {
    expect(Array.isArray(FILM_ITEM_STATUSES)).toBe(true);
    expect(FILM_ITEM_STATUSES).toContain('loaded');
    expect(FILM_ITEM_STATUSES).toContain('developed');
    expect(FILM_ITEM_STATUS_LABELS.loaded).toBe('Loaded');
    expect(FILM_ITEM_STATUS_LABELS.developed).toBe('Developed');
    expect(FILM_ITEM_STATUS_FILTERS.length).toBeGreaterThan(5);
    expect(FILM_ITEM_STATUS_FILTERS[0]).toMatchObject({ value: 'all', label: 'All' });
  });

  test('imports a .js utils module and exercises its logic', () => {
    expect(toISODateString(new Date(2024, 0, 5))).toBe('2024-01-05');
    expect(toISODateString(new Date(2024, 11, 31))).toBe('2024-12-31');
    expect(toISODateString(new Date('invalid'))).toBe('');
    expect(toISODateString(parseISODate('2024-01-05')!)).toBe('2024-01-05');
    expect(parseISODate('')).toBeNull();
    expect(parseISODate('not-a-date')).toBeNull();
  });

  test('round-trips date parse -> format -> parse', () => {
    const original = '2024-07-17';
    const parsed = parseISODate(original);
    expect(parsed).toBeInstanceOf(Date);
    expect(toISODateString(parsed!)).toBe(original);
  });

  test('resolves typed @filmgallery/shared subpath (cross-package type resolution)', () => {
    // This exercises the workspace-package types condition added in W0.9
    // (packages/shared/coordTransform.d.ts) — a prerequisite for Wave 2.
    // Points outside China are returned unchanged by the transform.
    const outside = wgs84ToGcj02(40.0, -74.0);
    expect(outside.lat).toBe(40.0);
    expect(outside.lng).toBe(-74.0);
    expect(isInChina(40.0, -74.0)).toBe(false);
    // Points inside China are shifted off the WGS-84 input.
    const beijing = wgs84ToGcj02(39.9, 116.4);
    expect(isInChina(39.9, 116.4)).toBe(true);
    expect(Math.abs(beijing.lat - 39.9)).toBeGreaterThan(0.001);
    // GCJ-02 -> WGS-84 recovers the original to within ~0.01 deg.
    const back = gcj02ToWgs84(beijing.lat, beijing.lng);
    expect(Math.abs(back.lat - 39.9)).toBeLessThan(0.01);
    expect(Math.abs(back.lng - 116.4)).toBeLessThan(0.01);
  });
});
