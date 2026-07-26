import type { DigitalPhoto } from '../../components/digital/DigitalPhotoGrid';

export const MONTH_KEY_PREFIX = 'm-';
export const ROW_KEY_PREFIX = 'r-';

export interface MonthHeaderItem {
  type: 'header';
  key: string;
  monthKey: string;
  label: string;
}

export interface PhotoRowItem {
  type: 'row';
  key: string;
  monthKey: string;
  photos: DigitalPhoto[];
}

export type TimelineSectionItem = MonthHeaderItem | PhotoRowItem;

export interface FlattenOptions {
  now?: Date;
  locale?: string;
  unknownLabel?: string;
}

export function getPhotoMonthKey(photo: DigitalPhoto): string | null {
  const ds =
    photo.date_taken ||
    (photo as any).dateTaken ||
    photo.created_at ||
    (photo as any).createdAt;
  if (!ds || typeof ds !== 'string') return null;
  const match = ds.match(/^(\d{4})-(\d{2})/);
  if (!match) {
    const parsed = new Date(ds);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
    }
    return null;
  }
  return `${match[1]}-${match[2]}`;
}

export function formatMonthLabel(monthKey: string, locale: string, unknownLabel: string): string {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return unknownLabel;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) {
    return unknownLabel;
  }
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(
      new Date(year, month, 1),
    );
  } catch {
    return monthKey;
  }
}

export function flattenPhotosToTimeline(
  photos: DigitalPhoto[],
  options: FlattenOptions = {},
): TimelineSectionItem[] {
  const locale = options.locale ?? 'zh';
  const unknownLabel = options.unknownLabel ?? '';
  const out: TimelineSectionItem[] = [];
  const rowCountByMonth: Record<string, number> = {};

  // currentMonthKey is normalized at the loop entry to a non-empty string
  // ('unknown' fallback), so the trailing flush below can rely on it being
  // set whenever currentRow is non-null.
  let currentMonthKey = '';
  let currentRow: DigitalPhoto[] | null = null;

  const pushRow = (monthKey: string, photos: DigitalPhoto[]) => {
    const idx = rowCountByMonth[monthKey] ?? 0;
    rowCountByMonth[monthKey] = idx + 1;
    out.push({
      type: 'row',
      key: `${ROW_KEY_PREFIX}${monthKey}-${idx}`,
      monthKey,
      photos,
    });
  };

  for (const photo of photos) {
    const monthKey = getPhotoMonthKey(photo) ?? 'unknown';
    if (monthKey !== currentMonthKey) {
      if (currentRow && currentRow.length > 0) {
        pushRow(currentMonthKey, currentRow);
      }
      currentRow = null;
      currentMonthKey = monthKey;
      if (!out.some((it) => it.type === 'header' && it.monthKey === monthKey)) {
        out.push({
          type: 'header',
          key: `${MONTH_KEY_PREFIX}${monthKey}`,
          monthKey,
          label:
            monthKey === 'unknown'
              ? unknownLabel
              : formatMonthLabel(monthKey, locale, unknownLabel),
        });
      }
    }
    if (!currentRow) currentRow = [];
    currentRow.push(photo);
    if (currentRow.length >= 3) {
      pushRow(currentMonthKey, currentRow);
      currentRow = null;
    }
  }

  // currentRow non-null ⟹ loop ran at least once ⟹ currentMonthKey set.
  if (currentRow && currentRow.length > 0) {
    pushRow(currentMonthKey, currentRow);
  }

  return out;
}
