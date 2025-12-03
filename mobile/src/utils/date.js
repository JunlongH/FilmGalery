function pad2(n) { return n < 10 ? `0${n}` : String(n); }

export function toISODateString(date) {
  try {
    if (!(date instanceof Date) || isNaN(date)) return '';
    // Use local date components to avoid UTC timezone shifts
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    return `${y}-${m}-${d}`;
  } catch {
    return '';
  }
}

export function parseISODate(str) {
  if (!str) return null;
  // Ensure YYYY-MM-DD becomes local date without timezone shift
  const [y, m, d] = str.split('-').map((v) => parseInt(v, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
