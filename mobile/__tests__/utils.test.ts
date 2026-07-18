import {
  FILM_ITEM_STATUSES,
  FILM_ITEM_STATUS_LABELS,
  FILM_ITEM_STATUS_FILTERS,
} from '../src/constants/filmItemStatus';
import { toISODateString, parseISODate } from '../src/utils/date';
import { buildUploadUrl } from '../src/utils/urlHelper';
import { getPhotoUrl, getRollCoverUrl } from '../src/utils/urls';
import { SPACING } from '../src/styles/spacing';

describe('constants/filmItemStatus', () => {
  test('FILM_ITEM_STATUSES has 6 statuses', () => {
    expect(FILM_ITEM_STATUSES).toHaveLength(6);
    expect(FILM_ITEM_STATUSES).toEqual([
      'in_stock', 'loaded', 'shot', 'sent_to_lab', 'developed', 'archived',
    ]);
  });

  test('every status has a label', () => {
    for (const status of FILM_ITEM_STATUSES) {
      expect(FILM_ITEM_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  test('FILM_ITEM_STATUS_FILTERS includes all + "all"', () => {
    expect(FILM_ITEM_STATUS_FILTERS).toHaveLength(7);
    expect(FILM_ITEM_STATUS_FILTERS[0]).toEqual({ value: 'all', label: 'All' });
  });
});

describe('utils/date', () => {
  test('toISODateString formats correctly', () => {
    expect(toISODateString(new Date(2024, 0, 5))).toBe('2024-01-05');
    expect(toISODateString(new Date(2024, 11, 31))).toBe('2024-12-31');
    expect(toISODateString(new Date('invalid'))).toBe('');
  });

  test('parseISODate parses valid dates', () => {
    expect(parseISODate('2024-07-17')).toEqual(new Date(2024, 6, 17));
    expect(parseISODate('')).toBeNull();
    expect(parseISODate('garbage')).toBeNull();
  });

  test('round-trip: format → parse → format', () => {
    const original = '2024-03-15';
    expect(toISODateString(parseISODate(original)!)).toBe(original);
  });
});

describe('utils/urlHelper', () => {
  const base = 'http://localhost:4000';

  test('returns null for empty inputs', () => {
    expect(buildUploadUrl('', base)).toBeNull();
    expect(buildUploadUrl('path', '')).toBeNull();
  });

  test('passes through absolute URLs', () => {
    expect(buildUploadUrl('http://example.com/img.jpg', base)).toBe('http://example.com/img.jpg');
    expect(buildUploadUrl('https://example.com/img.jpg', base)).toBe('https://example.com/img.jpg');
  });

  test('prepends base for leading-slash paths', () => {
    expect(buildUploadUrl('/uploads/photo.jpg', base)).toBe('http://localhost:4000/uploads/photo.jpg');
  });

  test('handles Windows backslash paths', () => {
    const result = buildUploadUrl('D:\\photos\\uploads\\rolls\\1\\photo.jpg', base);
    expect(result).toContain('uploads/rolls/1/photo.jpg');
  });

  test('strips trailing slash from base', () => {
    expect(buildUploadUrl('/path', 'http://localhost:4000/')).toBe('http://localhost:4000/path');
  });
});

describe('utils/urls', () => {
  const base = 'http://localhost:4000';

  test('getPhotoUrl returns null for missing inputs', () => {
    expect(getPhotoUrl(null, {}, 'full')).toBeNull();
    expect(getPhotoUrl(base, null, 'full')).toBeNull();
  });

  test('getPhotoUrl builds full URL from positive_rel_path', () => {
    expect(getPhotoUrl(base, { positive_rel_path: 'rolls/1/photo.jpg' }, 'full'))
      .toBe('http://localhost:4000/uploads/rolls/1/photo.jpg');
  });

  test('getPhotoUrl builds thumb URL from thumb_rel_path', () => {
    expect(getPhotoUrl(base, { thumb_rel_path: 'rolls/1/thumb.jpg' }, 'thumb'))
      .toBe('http://localhost:4000/uploads/rolls/1/thumb.jpg');
  });

  test('getRollCoverUrl handles coverPath with leading slash', () => {
    expect(getRollCoverUrl(base, { coverPath: '/uploads/cover.jpg' }))
      .toBe('http://localhost:4000/uploads/cover.jpg');
  });

  test('getRollCoverUrl handles relative coverPath', () => {
    expect(getRollCoverUrl(base, { coverPath: 'rolls/1/cover.jpg' }))
      .toBe('http://localhost:4000/uploads/rolls/1/cover.jpg');
  });
});

describe('styles/spacing', () => {
  test('has expected spacing values', () => {
    expect(SPACING.xs).toBe(4);
    expect(SPACING.sm).toBe(8);
    expect(SPACING.md).toBe(12);
    expect(SPACING.lg).toBe(16);
    expect(SPACING.xl).toBe(24);
  });

  test('default export equals named export', () => {
    const defaultExport = require('../src/styles/spacing').default;
    expect(defaultExport).toBe(SPACING);
  });
});
