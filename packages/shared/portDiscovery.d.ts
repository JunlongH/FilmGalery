// Type declarations for packages/shared/portDiscovery (runtime: portDiscovery.js).
// Enables type-safe imports from TypeScript consumers (watch-app).

export declare const APP_IDENTIFIER: string;
export declare const DISCOVERY_ENDPOINT: string;
export declare const DEFAULT_PORT: number;
export declare const PORT_SCAN_RANGE: number[];
export declare const DISCOVERY_TIMEOUT: number;

export interface MdnsConfig {
  SERVICE_TYPE: string;
  PROTOCOL: string;
  readonly FULL_SERVICE_TYPE: string;
  SERVICE_NAME: string;
  BROWSE_TIMEOUT: number;
  TXT_RECORDS: Record<string, string>;
}
export declare const MDNS_CONFIG: MdnsConfig;

export type DiscoveryModeValue = 'auto' | 'mdns' | 'portscan' | 'manual';
export declare const DISCOVERY_MODE: Record<string, DiscoveryModeValue>;

export declare function buildDiscoverUrl(host: string, port: number): string;
export declare function cleanIpAddress(input: string): string;
export declare function extractPort(url: string): number | null;
export declare function buildUrl(ip: string, port: number): string;
export declare function isPrivateIp(ip: string): boolean;
export declare function recommendDiscoveryMode(ip?: string): DiscoveryModeValue;
