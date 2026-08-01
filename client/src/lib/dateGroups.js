function readDateString(photo) {
  const ds = photo.date_taken || photo.dateTaken || photo.created_at || photo.createdAt;
  if (!ds || typeof ds !== 'string') return null;
  return ds;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function getPhotoGroupKey(photo, groupBy) {
  const ds = readDateString(photo);
  if (!ds) return null;
  if (groupBy === 'day') {
    const match = ds.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(ds);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getUTCFullYear()}-${pad2(parsed.getUTCMonth() + 1)}-${pad2(parsed.getUTCDate())}`;
    }
    return null;
  }
  const match = ds.match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}`;
  const parsed = new Date(ds);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getUTCFullYear()}-${pad2(parsed.getUTCMonth() + 1)}`;
  }
  return null;
}

export function formatGroupLabel(key, groupBy, unknownLabel) {
  if (groupBy === 'day') {
    const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return unknownLabel;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    if (
      !Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)
      || month < 0 || month > 11 || day < 1 || day > 31
    ) {
      return unknownLabel;
    }
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
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
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' })
      .format(new Date(year, month, 1));
  } catch {
    return key;
  }
}

export function groupPhotosByDate(photos, groupBy, unknownLabel = 'Unknown') {
  const sections = [];
  let current = null;
  for (const photo of photos) {
    const rawKey = getPhotoGroupKey(photo, groupBy);
    const isUnknown = rawKey === null;
    const sectionKey = isUnknown ? '__unknown__' : rawKey;
    if (!current || current.key !== sectionKey) {
      current = {
        key: sectionKey,
        label: isUnknown ? unknownLabel : formatGroupLabel(rawKey, groupBy, unknownLabel),
        photos: [],
      };
      sections.push(current);
    }
    current.photos.push(photo);
  }
  return sections;
}
