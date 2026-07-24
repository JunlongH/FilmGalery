// Shared TypeScript type definitions for FilmGallery.
//
// NOTE: These mirror the backend schema (see server/server.js). Most fields
// are optional because responses vary by endpoint. A transitional index
// signature is included so consumers (e.g. watch-app) compile even when
// accessing fields not yet declared here — tighten by removing the index
// signature once all call-sites are audited.

export type FilmItemStatus =
  | 'unexposed'
  | 'loaded'
  | 'partial'
  | 'exposed'
  | 'developed'
  | 'archived'
  | string;

export interface BaseEntity {
  id?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
}

export interface Film extends BaseEntity {
  name?: string;
  iso?: number;
  format?: string;
  type?: string;
  brand?: string;
  process?: string;
  description?: string;
}

export interface FilmItem extends BaseEntity {
  film_id?: number;
  status?: FilmItemStatus;
  batch?: string;
  expiry?: string;
  purchased_at?: string;
  notes?: string;
  quantity?: number;
}

export interface Roll extends BaseEntity {
  film_id?: number;
  camera_id?: number;
  title?: string;
  date_loaded?: string;
  date_finished?: string;
  start_date?: string;
  notes?: string;
  display_seq?: number;
}

export interface CropParams {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flip_h: boolean;
  flip_v: boolean;
}

export interface DevelopParams {
  white_balance?: { temp: number; tint: number };
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  hsl?: Record<string, { hue: number; sat: number; lum: number }>;
  tone_curve?: { rgb: number[]; red: number[]; green: number[]; blue: number[] };
  split_tone?: { highlights: { color: string; balance: number }; shadows: { color: string; balance: number } };
  lut?: string;
  crop?: CropParams;
}

export interface Photo extends BaseEntity {
  roll_id?: number;
  filename?: string;
  path?: string;
  positive_rel_path?: string;
  positive_source?: string;
  aperture?: number;
  shutter_speed?: string;
  iso?: number;
  focal_length?: number;
  rating?: number;
  notes?: string;
  frame_number?: number;
  display_seq?: number;
  location_id?: number;
  date_taken?: string;
  width?: number;
  height?: number;
  thumb_path?: string;
  source_type?: string;
  session_id?: number;
  content_hash?: string;
  media_type?: string;
  stack_id?: string;
  stack_role?: string;
  white_balance?: string;
  color_space?: string;
  original_filename?: string;
  develop_params_json?: string;
  scene_id?: string;
}

export interface Tag extends BaseEntity {
  name?: string;
}

export interface Location extends BaseEntity {
  name?: string;
  latitude?: number;
  lat?: number;
  longitude?: number;
  lng?: number;
  address?: string;
  country?: string;
}

export interface Camera extends BaseEntity {
  brand?: string;
  model?: string;
  type?: string;
  format?: string;
  notes?: string;
  is_digital?: number;
  sensor_type?: string;
  sensor_width_mm?: number;
  sensor_height_mm?: number;
  megapixels?: number;
  crop_factor?: number;
  sensor_format?: string;
}

export interface Album extends BaseEntity {
  title?: string;
  description?: string;
  parent_id?: number;
  cover_photo_id?: number;
  date_start?: string;
  date_end?: string;
  sort_order?: number;
  is_smart?: number;
  smart_rule_json?: string;
  deleted_at?: string;
  photo_count?: number;
}

export interface DigitalSession extends BaseEntity {
  import_batch?: string;
  session_date?: string;
  camera_id?: number;
  label?: string;
  notes?: string;
  file_count?: number;
  total_size_bytes?: number;
  import_source?: string;
  deleted_at?: string;
}

export interface AppConfig extends BaseEntity {
  photography_mode?: string;
  default_import_dir?: string;
  auto_organize?: number;
  duplicate_detection?: number;
}

export interface Lens extends BaseEntity {
  brand?: string;
  model?: string;
  focal_length?: number;
  max_aperture?: number;
  mount?: string;
}

export interface ShotLog extends BaseEntity {
  photo_id?: number;
  roll_id?: number;
  aperture?: number;
  shutter_speed?: string;
  iso?: number;
  focal_length?: number;
  light_value?: number;
  notes?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  shot_at?: string;
}

export interface ServerConfig {
  baseUrl?: string;
  backupUrl?: string;
  darkMode?: boolean;
  mapProvider?: string;
  amapKey?: string;
  [key: string]: any;
}

/**
 * Canonical reverse-geocode result — the single contract returned by every
 * platform's reverseGeocode (client / mobile / watch).
 *
 * The string fields are NEVER undefined: when a provider cannot resolve an
 * address, callers return an object with empty strings (coordinates are still
 * known). This replaces the platform-specific shapes that previously diverged
 * (`displayName` / `detail` / `detail_location` for the full-address field).
 */
export interface GeocodeResult {
  /** Full formatted address / street-level detail. '' when unavailable. */
  displayName: string;
  /** Country name. '' when unavailable. */
  country: string;
  /** City (or locality / district / region fallback). '' when unavailable. */
  city: string;
  /** First-level administrative division (state / province). '' when unavailable. */
  state: string;
  /** Echoed input latitude. */
  latitude: number;
  /** Echoed input longitude. */
  longitude: number;
}

/**
 * A reverse-geocoder function. Never throws for "no address found"; returns a
 * GeocodeResult with empty string fields instead. May throw on transport error
 * only when used as an individual provider (the public reverseGeocode wrappers
 * catch and degrade to empty fields).
 */
export type ReverseGeocoder = (
  latitude: number,
  longitude: number
) => Promise<GeocodeResult>;

/**
 * Map tile/geocoding provider. Drives both tile URL selection and the
 * geocoding provider chain. 'osm' uses OSM/Photon/Nominatim (no key);
 * 'amap' uses Amap REST + Amap tiles (GCJ-02, requires amapKey).
 */
export type MapProvider = 'osm' | 'amap';

/**
 * Shared geocoding configuration. Injected by each platform (desktop reads
 * localStorage, mobile reads AsyncStorage, server reads env vars) so the
 * shared geocoding module stays pure and testable.
 */
export interface GeocodeConfig {
  provider: MapProvider;
  /** AMap Web Service key. Required when provider === 'amap'. */
  amapKey?: string;
  /** Optional abort signal for cancellation. */
  signal?: AbortSignal;
  /** Abort timeout in ms. Default 5000. */
  timeout?: number;
  /** Injected fetch (tests). Defaults to global fetch. */
  fetch?: typeof fetch;
}

/**
 * Options for forward geocoding (address → coordinates).
 */
export interface SearchOptions extends GeocodeConfig {
  /** Max results. Default 5. */
  limit?: number;
  /** ISO 3166-1 alpha-2 country code to bias search (Nominatim only). */
  countryCode?: string;
}

/**
 * A single forward-geocode result. Coordinates are always WGS-84 (AMap's
 * GCJ-02 is converted at the provider boundary inside @filmgallery/shared/geocoding).
 */
export interface SearchResult {
  displayName: string;
  latitude: number;
  longitude: number;
  country: string;
  city: string;
  state: string;
  road?: string;
  houseNumber?: string;
}

/**
 * The value returned by a LocationPicker interaction. Mirrors GeocodeResult
 * (same field semantics — string fields are '' when unavailable, coordinates
 * echoed) plus a `detail_location` field for the user-editable formatted
 * address shown in the picker UI.
 */
export interface LocationPickerValue {
  latitude: number;
  longitude: number;
  country: string;
  city: string;
  state: string;
  /** User-editable full formatted address (picker input field). */
  detail_location: string;
  /** Display name, same semantics as GeocodeResult.displayName. */
  displayName: string;
}
