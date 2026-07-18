function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toISODateString(date: Date): string {
  try {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    return `${y}-${m}-${d}`;
  } catch {
    return '';
  }
}

export function parseISODate(str: string): Date | null {
  if (!str) return null;
  const parts = str.split('-').map((v) => parseInt(v, 10));
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
