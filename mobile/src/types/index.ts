// Local façade re-exporting the shared TypeScript types so callers import from
// '../types' (monorepo consistency with watch-app/src/types/index.ts). Tighten
// or extend here without touching every consumer.

export type {
  BaseEntity,
  Film,
  FilmItem,
  Roll,
  Photo,
  Tag,
  Location,
  Camera,
  Lens,
  ShotLog,
  ServerConfig,
  GeocodeResult,
  FilmItemStatus,
  ReverseGeocoder,
} from '@filmgallery/types';
