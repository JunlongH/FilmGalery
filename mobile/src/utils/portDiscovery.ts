import Zeroconf from 'react-native-zeroconf';

import {
  PORT_SCAN_RANGE,
  DISCOVERY_TIMEOUT,
  APP_IDENTIFIER,
  DISCOVERY_MODE,
  MDNS_CONFIG,
  cleanIpAddress,
  extractPort,
  buildUrl,
  isPrivateIp,
} from '@filmgallery/shared/portDiscovery';
export { DISCOVERY_MODE, cleanIpAddress, extractPort, buildUrl, isPrivateIp };

const MDNS_SERVICE_TYPE = `_${MDNS_CONFIG.SERVICE_TYPE}._${MDNS_CONFIG.PROTOCOL}.`;
const MDNS_BROWSE_TIMEOUT = MDNS_CONFIG.BROWSE_TIMEOUT;

export interface ProbeResult {
  port: number;
  version: string;
}

export interface PortScanResult {
  port: number;
  fullUrl: string;
  version: string;
  method: string;
  ip: string;
}

export interface MdnsService {
  name: string;
  ip: string;
  port: number;
  fullUrl: string;
  version: string;
  device: string;
  method: string;
}

export type DiscoveryService = PortScanResult | MdnsService;

export interface DiscoverProgressEvent {
  step: string;
  status: string;
  ip?: string;
  found?: number;
}

export interface DiscoverServicesOptions {
  mode?: string;
  ip?: string | null;
  timeout?: number;
  onProgress?: ((e: DiscoverProgressEvent) => void) | null;
}

export interface DiscoverServicesResult {
  services: DiscoveryService[];
  primaryService: DiscoveryService | null;
}

export interface DiscoverPortResult {
  port: number;
  fullUrl: string;
  version: string;
  method?: string;
}

export interface ValidateServerResult {
  valid: boolean;
  version?: string;
}

async function probePort(ip: string, port: number): Promise<ProbeResult | null> {
  try {
    const url = `http://${ip}:${port}/api/discover`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data.app === APP_IDENTIFIER) {
        return {
          port: data.port || port,
          version: data.version || 'unknown',
        };
      }
    }
  } catch (e) {
    // Port not reachable or not FilmGallery, silently ignore
  }
  return null;
}

export async function discoverByPortScan(ip: string): Promise<PortScanResult | null> {
  const cleanIp = cleanIpAddress(ip);
  if (!cleanIp) return null;

  const promises = PORT_SCAN_RANGE.map((port: number) => probePort(cleanIp, port));
  const results = await Promise.all(promises);

  for (let i = 0; i < results.length; i++) {
    if (results[i]) {
      return {
        port: results[i]!.port,
        fullUrl: `http://${cleanIp}:${results[i]!.port}`,
        version: results[i]!.version,
        method: 'portscan',
        ip: cleanIp,
      };
    }
  }

  return null;
}

let zeroconfInstance: any = null;

function getZeroconf(): any {
  if (!zeroconfInstance) {
    try {
      zeroconfInstance = new Zeroconf();
    } catch (e: any) {
      console.warn('[mDNS] Zeroconf not available:', e?.message);
      return null;
    }
  }
  return zeroconfInstance;
}

export function discoverByMdns(timeout: number = MDNS_BROWSE_TIMEOUT): Promise<MdnsService[]> {
  return new Promise((resolve) => {
    const zeroconf = getZeroconf();

    if (!zeroconf) {
      console.log('[mDNS] Zeroconf not available, skipping mDNS discovery');
      resolve([]);
      return;
    }

    const services: MdnsService[] = [];
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      try {
        zeroconf.stop();
        zeroconf.removeAllListeners();
      } catch (e) {
        // Ignore cleanup errors
      }
    };

    zeroconf.on('resolved', (service: any) => {
      console.log('[mDNS] Service resolved:', service.name);

      const txt = service.txt || {};
      const ip = service.addresses?.[0] || service.host;
      const port = service.port || parseInt(txt.port, 10) || 4000;

      if (ip) {
        services.push({
          name: service.name,
          ip: ip,
          port: port,
          fullUrl: `http://${ip}:${port}`,
          version: txt.version || 'unknown',
          device: txt.device || service.name,
          method: 'mdns',
        });
      }
    });

    zeroconf.on('error', (err: any) => {
      console.warn('[mDNS] Error:', err);
    });

    timeoutId = setTimeout(() => {
      console.log(`[mDNS] Browse timeout (${timeout}ms), found ${services.length} services`);
      cleanup();
      resolve(services);
    }, timeout);

    try {
      console.log(`[mDNS] Starting browse for ${MDNS_SERVICE_TYPE}`);
      zeroconf.scan(MDNS_SERVICE_TYPE.slice(0, -1));
    } catch (e: any) {
      console.warn('[mDNS] Scan failed:', e?.message);
      cleanup();
      resolve([]);
    }
  });
}

export function stopMdnsDiscovery(): void {
  const zeroconf = getZeroconf();
  if (zeroconf) {
    try {
      zeroconf.stop();
      zeroconf.removeAllListeners();
    } catch (e) {
      // Ignore
    }
  }
}

export async function discoverServices(options: DiscoverServicesOptions = {}): Promise<DiscoverServicesResult> {
  const {
    mode = DISCOVERY_MODE.AUTO,
    ip = null,
    timeout = MDNS_BROWSE_TIMEOUT,
    onProgress = null,
  } = options;

  const services: DiscoveryService[] = [];
  let primaryService: DiscoveryService | null = null;

  const shouldTryMdns = mode === DISCOVERY_MODE.AUTO || mode === DISCOVERY_MODE.MDNS_ONLY;
  const shouldTryPortScan = mode === DISCOVERY_MODE.AUTO || mode === DISCOVERY_MODE.PORT_SCAN;

  if (shouldTryMdns) {
    if (onProgress) onProgress({ step: 'mdns', status: 'scanning' });

    try {
      const mdnsServices = await discoverByMdns(timeout);
      services.push(...mdnsServices);

      if (mdnsServices.length > 0) {
        console.log(`[Discovery] Found ${mdnsServices.length} services via mDNS`);
        primaryService = mdnsServices[0];
      }
    } catch (e: any) {
      console.warn('[Discovery] mDNS discovery failed:', e?.message);
    }

    if (onProgress) {
      onProgress({
        step: 'mdns',
        status: 'complete',
        found: services.length,
      });
    }
  }

  if (shouldTryPortScan && ip) {
    const cleanIp = cleanIpAddress(ip);
    const alreadyFound = services.some((s) => s.ip === cleanIp);

    if (!alreadyFound) {
      if (onProgress) onProgress({ step: 'portscan', status: 'scanning', ip: cleanIp });

      try {
        const portScanResult = await discoverByPortScan(cleanIp);

        if (portScanResult) {
          services.push(portScanResult);
          if (!primaryService) {
            primaryService = portScanResult;
          }
          console.log(`[Discovery] Found service via port scan: ${portScanResult.fullUrl}`);
        }
      } catch (e: any) {
        console.warn('[Discovery] Port scan failed:', e?.message);
      }

      if (onProgress) {
        onProgress({
          step: 'portscan',
          status: 'complete',
          found: services.length,
        });
      }
    }
  }

  return {
    services,
    primaryService,
  };
}

export async function discoverPort(ip: string): Promise<DiscoverPortResult | PortScanResult | null> {
  const cleanIp = cleanIpAddress(ip);

  if (isPrivateIp(cleanIp)) {
    const result = await discoverServices({
      mode: DISCOVERY_MODE.AUTO,
      ip: cleanIp,
      timeout: 3000,
    });

    if (result.primaryService) {
      const ps = result.primaryService;
      return {
        port: ps.port,
        fullUrl: ps.fullUrl,
        version: ps.version,
        method: ps.method,
      };
    }
  } else {
    return await discoverByPortScan(cleanIp);
  }

  return null;
}

export async function validateServer(url: string): Promise<ValidateServerResult> {
  try {
    const cleanUrl = url.replace(/\/$/, '');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT);

    const response = await fetch(`${cleanUrl}/api/discover`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data.app === APP_IDENTIFIER) {
        return { valid: true, version: data.version };
      }
    }
  } catch (e) {
    // Not reachable or not valid
  }
  return { valid: false };
}

export default {
  discoverServices,
  discoverPort,
  discoverByMdns,
  discoverByPortScan,
  stopMdnsDiscovery,
  validateServer,

  cleanIpAddress,
  extractPort,
  buildUrl,
  isPrivateIp,

  DISCOVERY_MODE,
  PORT_SCAN_RANGE,
  DISCOVERY_TIMEOUT,
  MDNS_BROWSE_TIMEOUT,
};
