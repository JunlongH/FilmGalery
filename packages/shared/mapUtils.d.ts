/**
 * Type declarations for @filmgallery/shared/mapUtils.
 */

export const MAP_PROVIDERS: ('osm' | 'amap')[];

export const TILE_LAYERS: {
  osm: { light: string; dark: string; satellite: string };
  amap: { light: string; satellite: string };
};

export function buildTileLayerUrl(
  provider: 'osm' | 'amap',
  style: 'light' | 'dark' | 'satellite'
): string;

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
