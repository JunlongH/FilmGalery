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
