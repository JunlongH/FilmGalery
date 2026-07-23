/**
 * Type declarations for @filmgallery/shared/geocoding.
 *
 * The runtime module is CommonJS; these declarations make it consumable from
 * TypeScript (mobile / watch) via `import { searchAddress } from
 * '@filmgallery/shared/geocoding'`.
 */

import type {
  GeocodeConfig,
  GeocodeResult,
  SearchOptions,
  SearchResult,
} from '@filmgallery/types';

export function searchAddress(
  query: string,
  opts?: SearchOptions
): Promise<SearchResult[]>;

export function reverseGeocode(
  latitude: number,
  longitude: number,
  opts?: GeocodeConfig
): Promise<GeocodeResult>;

export function getCityCoordinates(
  country: string | null,
  city: string | null,
  opts?: GeocodeConfig
): Promise<{ latitude: number; longitude: number } | null>;

// Individual providers (exported for unit tests).
export function searchWithAmap(
  query: string,
  amapKey: string,
  limit: number,
  opts?: GeocodeConfig
): Promise<SearchResult[]>;

export function searchWithPhoton(
  query: string,
  limit: number,
  opts?: GeocodeConfig
): Promise<SearchResult[]>;

export function searchWithNominatim(
  query: string,
  limit: number,
  countryCode: string | null,
  opts?: GeocodeConfig
): Promise<SearchResult[]>;

export function reverseWithAmap(
  latitude: number,
  longitude: number,
  amapKey: string,
  opts?: GeocodeConfig
): Promise<Partial<GeocodeResult> | null>;

export function reverseWithPhoton(
  latitude: number,
  longitude: number,
  opts?: GeocodeConfig
): Promise<Partial<GeocodeResult> | null>;

export function reverseWithNominatim(
  latitude: number,
  longitude: number,
  opts?: GeocodeConfig
): Promise<Partial<GeocodeResult> | null>;

export function reverseWithBigDataCloud(
  latitude: number,
  longitude: number,
  opts?: GeocodeConfig
): Promise<GeocodeResult>;

export const PHOTON_BASE: string;
export const NOMINATIM_BASE: string;
export const AMAP_BASE: string;
export const DEFAULT_TIMEOUT: number;
export const NOMINATIM_RATE_LIMIT_MS: number;
