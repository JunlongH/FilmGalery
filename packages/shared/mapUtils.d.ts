/**
 * Type declarations for @filmgallery/shared/mapUtils.
 */

export type MapProvider = 'osm' | 'amap';
export type TileLayerStyle = 'light' | 'dark' | 'satellite';

export interface TileLayerConfig {
  url: string;
  subdomains?: string[];
  maxZoom?: number;
  className?: string;
  attribution?: string;
  name?: string;
  crossOrigin?: 'anonymous' | 'use-credentials';
}

export const MAP_PROVIDERS: MapProvider[];

export const TILE_LAYERS: Record<MapProvider, Record<TileLayerStyle, TileLayerConfig>>;

/**
 * Backward-compat shim: returns ONLY the URL string. New callers that need
 * subdomains/maxZoom/className should use getTileLayerConfig().
 */
export function buildTileLayerUrl(provider: MapProvider, style: TileLayerStyle): string;

/** Resolve the full tile-layer config object for a provider + style. */
export function getTileLayerConfig(provider: MapProvider, style: TileLayerStyle): TileLayerConfig;

export function clusterRadiusFromDelta(latitudeDelta: number): number;

export interface GridClusterResult {
  id: string | number;
  latitude: number;
  longitude: number;
  count: number;
  points: any[];
  representative: any;
}

export function gridCluster(
  points: Array<{
    id: string | number;
    latitude: number;
    longitude: number;
    [k: string]: any;
  }>,
  opts?: {
    radius?: number;
    latitudeDelta?: number;
    maxPreview?: number;
  }
): GridClusterResult[];

export function isValidLatitude(n: any): boolean;
export function isValidLongitude(n: any): boolean;
export function isValidLatLng(lat: any, lng: any): boolean;

export function formatLatLng(
  lat: number,
  lng: number,
  format?: 'decimal' | 'dms'
): string;
