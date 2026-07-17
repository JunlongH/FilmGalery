// Type declarations for packages/shared/geocode — enables type-safe imports
// from TypeScript consumers (watch-app). Runtime is CommonJS (geocode.js).

import type { GeocodeResult } from '@filmgallery/types';

export interface BigDataCloudOptions {
  /** Injected fetch (tests); defaults to the global fetch. */
  fetch?: any;
  /** Abort timeout in milliseconds. @default 5000 */
  timeout?: number;
  /** Request User-Agent. @default 'FilmGallery/1.0' */
  userAgent?: string;
}

export declare function reverseGeocodeBigDataCloud(
  latitude: number,
  longitude: number,
  opts?: BigDataCloudOptions
): Promise<GeocodeResult>;

export declare function normalizeBigDataCloud(
  data: any,
  latitude: number,
  longitude: number
): GeocodeResult;

export declare const BDC_BASE: string;
