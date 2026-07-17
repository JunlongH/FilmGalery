/**
 * Tests for the shared service-discovery helpers in packages/shared/portDiscovery.
 *
 * These are now the single source for server + mobile (+ watch once it adopts
 * them), so their behaviour is pinned here. The mobile copy was previously a
 * literal duplicate; consolidating onto this module is only safe because the
 * functions are pure and context-free (unlike the HTTP-layer variants).
 */

const {
  cleanIpAddress,
  extractPort,
  buildUrl,
  isPrivateIp,
  buildDiscoverUrl,
  recommendDiscoveryMode,
  DISCOVERY_MODE,
  DISCOVERY_ENDPOINT,
  PORT_SCAN_RANGE,
} = require('../portDiscovery');

describe('cleanIpAddress', () => {
  test('strips scheme and trailing slash; strips a trailing :port only when nothing follows', () => {
    expect(cleanIpAddress('https://10.0.0.2:4000')).toBe('10.0.0.2'); // trailing port removed
    // Quirk locked as-is: a trailing slash means the :port is not at end, so it
    // survives. Callers pass bare IPs in practice; changing this is out of scope.
    expect(cleanIpAddress('http://192.168.1.1:4000/')).toBe('192.168.1.1:4000');
    expect(cleanIpAddress('http://192.168.1.1/')).toBe('192.168.1.1');
  });
  test('passes through bare hosts', () => {
    expect(cleanIpAddress('localhost')).toBe('localhost');
    expect(cleanIpAddress('192.168.0.50')).toBe('192.168.0.50');
  });
  test('handles empty / non-string', () => {
    expect(cleanIpAddress('')).toBe('');
    expect(cleanIpAddress(null)).toBe('');
    expect(cleanIpAddress(undefined)).toBe('');
  });
});

describe('extractPort', () => {
  test('reads the port from a URL', () => {
    expect(extractPort('http://192.168.1.1:4000/')).toBe(4000);
    expect(extractPort('http://host:4100')).toBe(4100);
  });
  test('returns null when no port', () => {
    expect(extractPort('http://host/')).toBeNull();
    expect(extractPort('')).toBeNull();
  });
});

describe('buildUrl', () => {
  test('composes http://ip:port, cleaning the ip', () => {
    expect(buildUrl('192.168.1.1', 4000)).toBe('http://192.168.1.1:4000');
    expect(buildUrl('  http://10.0.0.2:4000 ', 4001)).toBe('http://10.0.0.2:4001');
  });
});

describe('isPrivateIp', () => {
  test('true for RFC1918 / link-local / loopback', () => {
    expect(isPrivateIp('10.0.0.5')).toBe(true);
    expect(isPrivateIp('172.20.0.1')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('169.254.1.1')).toBe(true);
    expect(isPrivateIp('localhost')).toBe(true);
    expect(isPrivateIp('127.0.0.1')).toBe(true);
  });
  test('false for public addresses', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('203.0.113.5')).toBe(false);
    expect(isPrivateIp('172.15.0.1')).toBe(false); // outside 172.16/12
  });
});

describe('buildDiscoverUrl', () => {
  test('uses the shared discovery endpoint', () => {
    expect(buildDiscoverUrl('192.168.1.1', 4000)).toBe(`http://192.168.1.1:4000${DISCOVERY_ENDPOINT}`);
  });
});

describe('recommendDiscoveryMode', () => {
  test('auto for private / unset, portscan for public', () => {
    expect(recommendDiscoveryMode('192.168.1.1')).toBe(DISCOVERY_MODE.AUTO);
    expect(recommendDiscoveryMode()).toBe(DISCOVERY_MODE.AUTO);
    expect(recommendDiscoveryMode('8.8.8.8')).toBe(DISCOVERY_MODE.PORT_SCAN);
  });
});

describe('constants', () => {
  test('PORT_SCAN_RANGE is the canonical server port list', () => {
    expect(PORT_SCAN_RANGE).toEqual([4000, 4001, 4002, 4003, 4004, 4005, 4010, 4020, 4100]);
  });
});
