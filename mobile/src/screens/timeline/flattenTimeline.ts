import type { DigitalPhoto } from '../../components/digital/DigitalPhotoGrid';

export type GroupBy = 'month' | 'day';

export const MONTH_KEY_PREFIX = 'm-';
export const DAY_KEY_PREFIX = 'd-';
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
  groupBy?: GroupBy;
}

function readDateString(photo: DigitalPhoto): string | null {
  const ds =
    photo.date_taken ||
    (photo as any).dateTaken ||
    photo.created_at ||
    (photo as any).createdAt;
  if (!ds || typeof ds !== 'string') return null;
  return ds;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function getPhotoGroupKey(photo: DigitalPhoto, groupBy: GroupBy): string | null {
  const ds = readDateString(photo);
  if (!ds) return null;
  if (groupBy === 'day') {
    const match = ds.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(ds.includes('T') ? ds : ds.replace(' ', 'T'));
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
    }
    return null;
  }
  const match = ds.match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}`;
  const parsed = new Date(ds.includes('T') ? ds : ds.replace(' ', 'T'));
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}`;
  }
  return null;
}

export function getPhotoMonthKey(photo: DigitalPhoto): string | null {
  return getPhotoGroupKey(photo, 'month');
}

export function formatGroupLabel(
  key: string,
  groupBy: GroupBy,
  locale: string,
  unknownLabel: string,
): string {
  if (groupBy === 'day') {
    const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return unknownLabel;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day) ||
      month < 0 ||
      month > 11 ||
      day < 1 ||
      day > 31
    ) {
      return unknownLabel;
    }
    try {
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(new Date(year, month, day));
    } catch {
      return key;
    }
  }
  const match = key.match(/^(\d{4})-(\d{2})$/);
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
    return key;
  }
}

export function formatMonthLabel(monthKey: string, locale: string, unknownLabel: string): string {
  return formatGroupLabel(monthKey, 'month', locale, unknownLabel);
}

export function flattenPhotosToTimeline(
  photos: DigitalPhoto[],
  options: FlattenOptions = {},
): TimelineSectionItem[] {
  const locale = options.locale ?? 'zh';
  const unknownLabel = options.unknownLabel ?? '';
  const groupBy: GroupBy = options.groupBy ?? 'month';
  const headerPrefix = groupBy === 'day' ? DAY_KEY_PREFIX : MONTH_KEY_PREFIX;
  const out: TimelineSectionItem[] = [];
  const rowCountByGroup: Record<string, number> = {};

  let currentGroupKey = '';
  let currentRow: DigitalPhoto[] | null = null;

  const pushRow = (groupKey: string, photos: DigitalPhoto[]) => {
    const idx = rowCountByGroup[groupKey] ?? 0;
    rowCountByGroup[groupKey] = idx + 1;
    out.push({
      type: 'row',
      key: `${ROW_KEY_PREFIX}${groupKey}-${idx}`,
      monthKey: groupKey,
      photos,
    });
  };

  for (const photo of photos) {
    const groupKey = getPhotoGroupKey(photo, groupBy) ?? 'unknown';
    if (groupKey !== currentGroupKey) {
      if (currentRow && currentRow.length > 0) {
        pushRow(currentGroupKey, currentRow);
      }
      currentRow = null;
      currentGroupKey = groupKey;
      if (!out.some((it) => it.type === 'header' && it.monthKey === groupKey)) {
        out.push({
          type: 'header',
          key: `${headerPrefix}${groupKey}`,
          monthKey: groupKey,
          label:
            groupKey === 'unknown'
              ? unknownLabel
              : formatGroupLabel(groupKey, groupBy, locale, unknownLabel),
        });
      }
    }
    if (!currentRow) currentRow = [];
    currentRow.push(photo);
    if (currentRow.length >= 3) {
      pushRow(currentGroupKey, currentRow);
      currentRow = null;
    }
  }

  if (currentRow && currentRow.length > 0) {
    pushRow(currentGroupKey, currentRow);
  }

  return out;
}
