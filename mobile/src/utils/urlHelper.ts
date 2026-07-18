export function buildUploadUrl(pathOrUrl: string, baseUrl: string): string | null {
  if (!pathOrUrl) return null;
  if (!baseUrl) return null;

  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;

  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');

  if (pathOrUrl.startsWith('/')) return `${cleanBaseUrl}${pathOrUrl}`;

  const lower = pathOrUrl.toLowerCase();
  const idx = lower.indexOf('uploads');
  if (idx !== -1) {
    const sub = pathOrUrl.slice(idx).replace(/\\/g, '/').replace(/^\/+/, '');
    return `${cleanBaseUrl}/${sub}`;
  }

  if (pathOrUrl.indexOf('\\') !== -1 || /^([a-zA-Z]:\\)/.test(pathOrUrl)) {
    const parts = pathOrUrl.split(/[/\\]+/);
    const base = parts[parts.length - 1];
    return `${cleanBaseUrl}/uploads/${base}`;
  }

  return `${cleanBaseUrl}/uploads/${pathOrUrl.replace(/^\/+/, '')}`;
}
