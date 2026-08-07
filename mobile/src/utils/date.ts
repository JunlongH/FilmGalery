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

export function isDateOnlyString(value: any): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function parseLocalDate(value: any): Date | null {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const mo = Number(dateOnly[2]);
    const da = Number(dateOnly[3]);
    const d = new Date(y, mo - 1, da);
    if (isNaN(d.getTime()) || d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) {
      return null;
    }
    return d;
  }
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}
