
export function buildUploadUrl(pathOrUrl, baseUrl) {
  if (!pathOrUrl) return null;
  if (!baseUrl) return null;

  // already absolute URL
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
  
  // Remove trailing slash from baseUrl if present
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');

  // leading slash -> relative to API_BASE
  if (pathOrUrl.startsWith('/')) return `${cleanBaseUrl}${pathOrUrl}`;
  
  // contains 'uploads' somewhere (e.g. Windows full path like D:\...\uploads\rolls\...)
  const lower = pathOrUrl.toLowerCase();
  const idx = lower.indexOf('uploads');
  if (idx !== -1) {
    // extract from 'uploads' onward and normalize slashes
    const sub = pathOrUrl.slice(idx).replace(/\\/g, '/').replace(/^\/+/, '');
    return `${cleanBaseUrl}/${sub}`;
  }
  
  // Windows path fallback - use basename
  if (pathOrUrl.indexOf('\\') !== -1 || /^([a-zA-Z]:\\)/.test(pathOrUrl)) {
    const parts = pathOrUrl.split(/[/\\]+/);
    const base = parts[parts.length - 1];
    return `${cleanBaseUrl}/uploads/${base}`;
  }
  
  // default: assume value is relative inside uploads (e.g. 'rolls/..')
  return `${cleanBaseUrl}/uploads/${pathOrUrl.replace(/^\/+/, '')}`;
}
