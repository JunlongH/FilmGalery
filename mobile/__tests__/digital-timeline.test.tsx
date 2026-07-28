// N3-4: Digital Timeline flattening algorithm tests.
//
// Covers the pure `flattenPhotosToTimeline` function (extracted to
// src/screens/timeline/flattenTimeline.ts specifically so these tests can run
// without mounting FlatList / CachedImage):
//   1. Cross-month boundary inserts a fresh header for each month.
//   2. Missing date_taken falls back to created_at; both missing → 'unknown'.
//   3. Rows of exactly 3 photos; the trailing row of a month with <3 photos
//      is emitted as a final short row.
//   4. Pagination append (a second batch of photos for the same month or a
//      new month) regroups without duplicating headers.
//   5. Row keys are stable/unique within a month; month keys look like
//      'YYYY-MM'.
//   6. formatMonthLabel produces zh `2026年7月` and en `Jul 2026`.

import {
  flattenPhotosToTimeline,
  getPhotoMonthKey,
  formatMonthLabel,
  getPhotoGroupKey,
  formatGroupLabel,
  type GroupBy,
} from '../src/screens/timeline/flattenTimeline';
import {
  computeSectionLayouts,
  HEADER_HEIGHT,
  ROW_HEIGHT,
} from '../src/screens/timeline/DigitalTimelineScreen';
import type { DigitalPhoto } from '../src/components/digital/DigitalPhotoGrid';

function mk(id: number, date_taken?: string, created_at?: string): DigitalPhoto {
  return {
    id,
    source_type: 'digital',
    positive_thumb_rel_path: `t${id}.jpg`,
    date_taken,
    created_at,
  };
}

describe('getPhotoMonthKey', () => {
  test('extracts YYYY-MM from date_taken', () => {
    expect(getPhotoMonthKey(mk(1, '2026-07-15T10:00:00Z'))).toBe('2026-07');
  });

  test('falls back to created_at when date_taken missing', () => {
    expect(getPhotoMonthKey(mk(1, undefined, '2025-12-03T08:30:00Z'))).toBe('2025-12');
  });

  test('returns null when both missing', () => {
    expect(getPhotoMonthKey(mk(1))).toBeNull();
  });

  test('parses non-ISO date strings via Date fallback', () => {
    expect(getPhotoMonthKey(mk(1, 'Jul 4 2026'))).toBe('2026-07');
  });
});

describe('formatMonthLabel', () => {
  test('zh produces "2026年7月"', () => {
    expect(formatMonthLabel('2026-07', 'zh', '?')).toBe('2026年7月');
  });

  test('en produces "July 2026"', () => {
    expect(formatMonthLabel('2026-07', 'en', '?')).toBe('July 2026');
  });

  test('invalid month key falls back to unknownLabel', () => {
    expect(formatMonthLabel('garbage', 'en', '?')).toBe('?');
    expect(formatMonthLabel('2026-13', 'en', '?')).toBe('?');
  });
});

describe('getPhotoGroupKey (generalized)', () => {
  test('month mode matches getPhotoMonthKey', () => {
    expect(getPhotoGroupKey(mk(1, '2026-07-15T10:00:00Z'), 'month')).toBe('2026-07');
    expect(getPhotoGroupKey(mk(1, '2026-07-15T10:00:00Z'), 'month')).toBe(
      getPhotoMonthKey(mk(1, '2026-07-15T10:00:00Z')),
    );
  });

  test('day mode extracts YYYY-MM-DD', () => {
    expect(getPhotoGroupKey(mk(1, '2026-07-15T10:00:00Z'), 'day')).toBe('2026-07-15');
  });

  test('day mode falls back to created_at', () => {
    expect(getPhotoGroupKey(mk(1, undefined, '2025-12-03T08:30:00Z'), 'day')).toBe('2025-12-03');
  });

  test('day mode returns null when both dates missing', () => {
    expect(getPhotoGroupKey(mk(1), 'day')).toBeNull();
  });

  test('day mode parses non-ISO date strings via Date fallback', () => {
    expect(getPhotoGroupKey(mk(1, 'Jul 4 2026'), 'day')).toBe('2026-07-04');
  });
});

describe('formatGroupLabel', () => {
  test('month mode matches formatMonthLabel', () => {
    expect(formatGroupLabel('2026-07', 'month', 'zh', '?')).toBe('2026年7月');
    expect(formatGroupLabel('2026-07', 'month', 'en', '?')).toBe('July 2026');
  });

  test('day mode zh produces "2026年7月15日"', () => {
    expect(formatGroupLabel('2026-07-15', 'day', 'zh', '?')).toBe('2026年7月15日');
  });

  test('day mode en includes year, month, and day', () => {
    const label = formatGroupLabel('2026-07-15', 'day', 'en', '?');
    expect(label).toContain('2026');
    expect(label).toContain('15');
  });

  test('day mode invalid key falls back to unknownLabel', () => {
    expect(formatGroupLabel('garbage', 'day', 'en', '?')).toBe('?');
    expect(formatGroupLabel('2026-13-40', 'day', 'en', '?')).toBe('?');
  });

  test('month mode invalid key falls back to unknownLabel', () => {
    expect(formatGroupLabel('garbage', 'month', 'en', '?')).toBe('?');
    expect(formatGroupLabel('2026-13', 'month', 'en', '?')).toBe('?');
  });
});

describe('flattenPhotosToTimeline (groupBy: day)', () => {
  test('cross-day boundary inserts fresh headers per day', () => {
    const photos = [
      mk(1, '2026-07-15'),
      mk(2, '2026-07-15'),
      mk(3, '2026-07-16'),
      mk(4, '2026-07-16'),
      mk(5, '2026-07-16'),
    ];
    const out = flattenPhotosToTimeline(photos, { locale: 'en', groupBy: 'day' as GroupBy });
    const headers = out.filter((it) => it.type === 'header') as any[];
    expect(headers).toHaveLength(2);
    expect(headers[0].monthKey).toBe('2026-07-15');
    expect(headers[1].monthKey).toBe('2026-07-16');
    expect(headers[0].key.startsWith('d-')).toBe(true);
  });

  test('same-day photos across the 3-photo row boundary share one header', () => {
    const photos = [
      mk(1, '2026-07-15'),
      mk(2, '2026-07-15'),
      mk(3, '2026-07-15'),
      mk(4, '2026-07-15'),
    ];
    const out = flattenPhotosToTimeline(photos, { locale: 'en', groupBy: 'day' as GroupBy });
    const headers = out.filter((it) => it.type === 'header');
    expect(headers).toHaveLength(1);
  });

  test('day header keys do not collide with month header keys', () => {
    const photos = [mk(1, '2026-07-15')];
    const dayOut = flattenPhotosToTimeline(photos, { locale: 'en', groupBy: 'day' as GroupBy });
    const monthOut = flattenPhotosToTimeline(photos, { locale: 'en', groupBy: 'month' as GroupBy });
    const dayHeaderKey = (dayOut[0] as any).key;
    const monthHeaderKey = (monthOut[0] as any).key;
    expect(dayHeaderKey.startsWith('d-')).toBe(true);
    expect(monthHeaderKey.startsWith('m-')).toBe(true);
    expect(dayHeaderKey).not.toBe(monthHeaderKey);
  });

  test('unknown-date photos bucket identically under day mode', () => {
    const photos = [mk(1), mk(2), mk(3)];
    const out = flattenPhotosToTimeline(photos, {
      locale: 'en',
      unknownLabel: 'Unknown date',
      groupBy: 'day' as GroupBy,
    });
    const headers = out.filter((it) => it.type === 'header') as any[];
    expect(headers).toHaveLength(1);
    expect(headers[0].monthKey).toBe('unknown');
    expect(headers[0].label).toBe('Unknown date');
  });

  test('omitting groupBy defaults to month mode (regression)', () => {
    const photos = [
      mk(1, '2026-07-15'),
      mk(2, '2026-07-16'),
      mk(3, '2026-06-01'),
    ];
    const out = flattenPhotosToTimeline(photos, { locale: 'en' });
    const headers = out.filter((it) => it.type === 'header') as any[];
    expect(headers.map((h) => h.monthKey)).toEqual(['2026-07', '2026-06']);
    expect(headers[0].key.startsWith('m-')).toBe(true);
  });
});

describe('flattenPhotosToTimeline', () => {
  test('cross-month boundary inserts fresh headers', () => {
    const photos = [
      mk(1, '2026-07-15'),
      mk(2, '2026-07-16'),
      mk(3, '2026-07-17'),
      mk(4, '2026-06-10'),
      mk(5, '2026-06-11'),
    ];
    const out = flattenPhotosToTimeline(photos, { locale: 'zh' });
    const headers = out.filter((it) => it.type === 'header');
    expect(headers).toHaveLength(2);
    expect((headers[0] as any).monthKey).toBe('2026-07');
    expect((headers[1] as any).monthKey).toBe('2026-06');
  });

  test('missing date_taken falls back to created_at (no "unknown" header)', () => {
    const photos = [
      mk(1, '2026-07-15'),
      mk(2, undefined, '2026-07-20'),
    ];
    const out = flattenPhotosToTimeline(photos, { locale: 'en' });
    const headers = out.filter((it) => it.type === 'header');
    expect(headers).toHaveLength(1);
    expect((headers[0] as any).monthKey).toBe('2026-07');
  });

  test('photos with no date at all go to "unknown" bucket', () => {
    const photos = [mk(1), mk(2), mk(3)];
    const out = flattenPhotosToTimeline(photos, {
      locale: 'en',
      unknownLabel: 'Unknown date',
    });
    const headers = out.filter((it) => it.type === 'header');
    expect(headers).toHaveLength(1);
    expect((headers[0] as any).monthKey).toBe('unknown');
    expect((headers[0] as any).label).toBe('Unknown date');
  });

  test('rows are full of 3 photos except the trailing row of a month', () => {
    const photos = [
      mk(1, '2026-07-01'),
      mk(2, '2026-07-02'),
      mk(3, '2026-07-03'),
      mk(4, '2026-07-04'),
      mk(5, '2026-07-05'),
    ];
    const out = flattenPhotosToTimeline(photos, { locale: 'en' });
    const rows = out.filter((it) => it.type === 'row') as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].photos).toHaveLength(3);
    expect(rows[0].photos.map((p: any) => p.id)).toEqual([1, 2, 3]);
    expect(rows[1].photos).toHaveLength(2);
    expect(rows[1].photos.map((p: any) => p.id)).toEqual([4, 5]);
  });

  test('row keys are unique within a month and globally stable', () => {
    const photos = [
      mk(1, '2026-07-01'),
      mk(2, '2026-07-02'),
      mk(3, '2026-07-03'),
      mk(4, '2026-07-04'),
      mk(5, '2026-06-01'),
      mk(6, '2026-06-02'),
    ];
    const out = flattenPhotosToTimeline(photos, { locale: 'en' });
    const keys = out.map((it) => it.key);
    expect(new Set(keys).size).toBe(keys.length);
    const rows = out.filter((it) => it.type === 'row') as any[];
    expect(rows[0].key).toBe('r-2026-07-0');
    expect(rows[1].key).toBe('r-2026-07-1');
    expect(rows[2].key).toBe('r-2026-06-0');
  });

  test('pagination append: regrouping same month does not duplicate header', () => {
    const batch1 = [
      mk(1, '2026-07-01'),
      mk(2, '2026-07-02'),
      mk(3, '2026-07-03'),
    ];
    const batch2 = [
      mk(4, '2026-07-04'),
      mk(5, '2026-07-05'),
    ];
    const combined = [...batch1, ...batch2];
    const out = flattenPhotosToTimeline(combined, { locale: 'en' });
    const headers = out.filter((it) => it.type === 'header');
    expect(headers).toHaveLength(1);
    const rows = out.filter((it) => it.type === 'row') as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].photos.map((p: any) => p.id)).toEqual([1, 2, 3]);
    expect(rows[1].photos.map((p: any) => p.id)).toEqual([4, 5]);
  });

  test('pagination append: new month appends a fresh header', () => {
    const batch1 = [
      mk(1, '2026-07-01'),
      mk(2, '2026-07-02'),
      mk(3, '2026-07-03'),
    ];
    const batch2 = [
      mk(4, '2026-06-01'),
      mk(5, '2026-06-02'),
      mk(6, '2026-06-03'),
    ];
    const combined = [...batch1, ...batch2];
    const out = flattenPhotosToTimeline(combined, { locale: 'en' });
    const headers = out.filter((it) => it.type === 'header') as any[];
    expect(headers).toHaveLength(2);
    expect(headers[0].monthKey).toBe('2026-07');
    expect(headers[1].monthKey).toBe('2026-06');
  });

  test('deduplicates headers across non-contiguous runs of the same month', () => {
    // Photos sorted desc should never produce this layout in practice, but
    // pagination could deliver an out-of-order tail. The contract: a given
    // month has at most ONE header in the rendered list (iOS Photos style).
    // A 2026-07 photo appearing again after a 2026-06 run still slots under
    // the existing 2026-07 header — but only contiguous rows get grouped,
    // so the second 2026-07 run is rendered as a fresh row block whose
    // header is suppressed because it already exists earlier in the list.
    const photos = [
      mk(1, '2026-07-01'),
      mk(2, '2026-06-01'),
      mk(3, '2026-07-02'),
    ];
    const out = flattenPhotosToTimeline(photos, { locale: 'en' });
    const headers = out.filter((it) => it.type === 'header') as any[];
    expect(headers).toHaveLength(2);
    expect(headers.map((h) => h.monthKey)).toEqual(['2026-07', '2026-06']);
    // The out-of-order 2026-07 photo still renders as a row, just under
    // its own row key in the same month's row index sequence.
    const rows = out.filter((it) => it.type === 'row') as any[];
    expect(rows).toHaveLength(3);
    expect(rows[0].monthKey).toBe('2026-07');
    expect(rows[1].monthKey).toBe('2026-06');
    expect(rows[2].monthKey).toBe('2026-07');
    expect(rows[2].key).toBe('r-2026-07-1');
  });

  test('empty input → empty output', () => {
    expect(flattenPhotosToTimeline([], { locale: 'en' })).toEqual([]);
  });

  test('mixed known + unknown dates: unknown header appears once between known runs', () => {
    const photos = [
      mk(1, '2026-07-15'),
      mk(2, undefined, undefined),
      mk(3, '2026-07-16'),
    ];
    const out = flattenPhotosToTimeline(photos, {
      locale: 'zh',
      unknownLabel: '未知日期',
    });
    const headers = out.filter((it) => it.type === 'header') as any[];
    expect(headers.map((h) => h.monthKey)).toEqual(['2026-07', 'unknown']);
    expect(headers[1].label).toBe('未知日期');
  });
});

// W3: getItemLayout previously did an O(n) cumulative-offset walk on every
// call. Extracted to computeSectionLayouts() so the layout table is built
// once per sections change and getItemLayout is O(1).
describe('computeSectionLayouts (W3)', () => {
  test('empty sections → empty layouts', () => {
    expect(computeSectionLayouts([])).toEqual([]);
  });

  test('header contributes HEADER_HEIGHT, row contributes ROW_HEIGHT', () => {
    const sections = flattenPhotosToTimeline(
      [
        mk(1, '2026-07-01'),
        mk(2, '2026-07-02'),
        mk(3, '2026-07-03'),
        mk(4, '2026-07-04'),
      ],
      { locale: 'en' },
    );
    // Expected: header + row(3) + row(1)
    expect(sections).toHaveLength(3);
    expect(sections[0].type).toBe('header');
    expect(sections[1].type).toBe('row');
    expect(sections[2].type).toBe('row');

    const layouts = computeSectionLayouts(sections);
    expect(layouts).toHaveLength(3);
    expect(layouts[0]).toEqual({ length: HEADER_HEIGHT, offset: 0, index: 0 });
    expect(layouts[1]).toEqual({
      length: ROW_HEIGHT,
      offset: HEADER_HEIGHT,
      index: 1,
    });
    expect(layouts[2]).toEqual({
      length: ROW_HEIGHT,
      offset: HEADER_HEIGHT + ROW_HEIGHT,
      index: 2,
    });
  });

  test('offsets are strictly cumulative across many months', () => {
    const photos: DigitalPhoto[] = [];
    // 3 months, 7 photos each → header + 2 full rows + 1 partial row per month.
    for (let m = 1; m <= 3; m++) {
      for (let i = 0; i < 7; i++) {
        photos.push(mk(m * 10 + i, `2026-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`));
      }
    }
    const sections = flattenPhotosToTimeline(photos, { locale: 'en' });
    const layouts = computeSectionLayouts(sections);

    // Walk and verify: each entry's offset == previous offset + previous length.
    let expected = 0;
    for (let i = 0; i < layouts.length; i++) {
      const sec = sections[i];
      const want = sec.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
      expect(layouts[i].length).toBe(want);
      expect(layouts[i].offset).toBe(expected);
      expect(layouts[i].index).toBe(i);
      expected += want;
    }
  });

  test('item at index N can be fetched without scanning (O(1) contract)', () => {
    // Build 50 sections; looking up the last must read offsets[49] directly.
    const photos: DigitalPhoto[] = [];
    for (let i = 0; i < 100; i++) {
      const m = String((i % 12) + 1).padStart(2, '0');
      photos.push(mk(i + 1, `2026-${m}-15`));
    }
    const sections = flattenPhotosToTimeline(photos, { locale: 'en' });
    const layouts = computeSectionLayouts(sections);
    const lastIdx = sections.length - 1;
    // Snapshot the offset for the last item; this is what getItemLayout returns.
    const last = layouts[lastIdx];
    expect(last).toBeDefined();
    expect(last.index).toBe(lastIdx);
    // Sum of all preceding lengths equals the last offset.
    let sum = 0;
    for (let i = 0; i < lastIdx; i++) sum += layouts[i].length;
    expect(last.offset).toBe(sum);
  });
});
