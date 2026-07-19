import AsyncStorage from '@react-native-async-storage/async-storage';
import { createApiClient } from '@filmgallery/api-client';
import type { ApiClient } from '@filmgallery/api-client';
import { Photo, FilmItem, ShotLog, Roll, Film } from '../types';

const SERVER_URL_KEY = '@server_url';
const AUTH_TOKEN_KEY = '@auth_token';
// Default to empty - user must configure server URL in settings.
// This avoids having placeholder IP addresses in production code.
const DEFAULT_URL = '';

class ApiService {
  // Shared client. Resilience matches the previous axios setup:
  //   timeout 15s, up to 2 retries on network errors with linear 1s/2s backoff.
  private client: ApiClient = createApiClient({
    baseUrl: DEFAULT_URL,
    timeout: 15000,
    retry: { maxRetries: 2, delayMs: 1000, backoff: 'linear' },
  });
  private baseURL: string = DEFAULT_URL;
  private filmsCache: Film[] | null = null;
  private filmsCacheAt: number = 0;

  private unwrapList<T>(data: any): T[] {
    if (Array.isArray(data)) return data as T[];
    if (data && Array.isArray((data as any).items)) return (data as any).items as T[];
    return [];
  }

  private unwrapItem<T>(data: any): T {
    if (data && (data as any).item) return (data as any).item as T;
    return data as T;
  }

  async loadServerURL(): Promise<string> {
    try {
      const url = await AsyncStorage.getItem(SERVER_URL_KEY);
      if (url) {
        this.baseURL = url;
        this.client.setBaseUrl(url);
        return url;
      }
    } catch (error) {
      console.error('Failed to load server URL:', error);
    }
    return this.baseURL;
  }

  async saveServerURL(url: string): Promise<void> {
    try {
      await AsyncStorage.setItem(SERVER_URL_KEY, url);
      this.baseURL = url;
      this.client.setBaseUrl(url);
    } catch (error) {
      console.error('Failed to save server URL:', error);
      throw error;
    }
  }

  getServerURL(): string {
    return this.baseURL;
  }

  // --- Phase 2B #1: Auth token ---

  async loadAuthToken(): Promise<void> {
    try {
      const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
      if (token) this.client.setAuthToken(token);
    } catch (error) {
      console.error('Failed to load auth token:', error);
    }
  }

  async saveAuthToken(token: string): Promise<void> {
    try {
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
      this.client.setAuthToken(token);
    } catch (error) {
      console.error('Failed to save auth token:', error);
    }
  }

  async clearAuthToken(): Promise<void> {
    try {
      await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
      this.client.clearAuthToken();
    } catch (error) {
      console.error('Failed to clear auth token:', error);
    }
  }

  setOnUnauthorized(cb: () => void): void {
    this.client.setOnUnauthorized(cb);
  }

  getImageURL(relativePath: string | undefined): string | null {
    return this.client.http.buildUploadUrl(relativePath);
  }

  async getRandomPhotos(limit: number = 10): Promise<Photo[]> {
    return (await this.client.photos.getRandom(limit)) as Photo[];
  }

  async getFilms(options?: { force?: boolean }): Promise<Film[]> {
    const force = Boolean(options?.force);
    const now = Date.now();
    // cache for 5 minutes
    if (!force && this.filmsCache && now - this.filmsCacheAt < 5 * 60 * 1000) {
      return this.filmsCache;
    }
    const data = await this.client.films.list();
    const films = this.unwrapList<Film>(data);
    this.filmsCache = films;
    this.filmsCacheAt = now;
    return films;
  }

  async getFilmItems(status?: string | string[]): Promise<FilmItem[]> {
    const statusParam = Array.isArray(status) ? status.join(',') : status;
    const data = await this.client.films.items.list(statusParam ? { status: statusParam } : {});
    const items = this.unwrapList<FilmItem>(data);
    // Ensure title is readable
    return items.map(item => ({
      ...item,
      title: item.title || `Film Item #${item.id}`,
    }));
  }

  async getFilmItem(id: number): Promise<FilmItem> {
    const data = await this.client.films.items.get(id);
    return this.unwrapItem<FilmItem>(data);
  }

  async updateFilmItemShotLogs(
    id: number,
    shotLogs: ShotLog[]
  ): Promise<FilmItem> {
    const data = await this.client.films.items.update(id, {
      shot_logs: JSON.stringify(shotLogs),
    });
    return this.unwrapItem<FilmItem>(data);
  }

  async getPhotosByRoll(rollId: number): Promise<Photo[]> {
    return (await this.client.http.get('/api/photos', { roll_id: rollId })) as Photo[];
  }

  async getRolls(): Promise<Roll[]> {
    const data = await this.client.rolls.list();
    const rolls = this.unwrapList<Roll>(data);
    // Map film_name_joined to film_type for display compatibility
    return rolls.map(roll => ({
      ...roll,
      film_type: roll.film_type || roll.film_name_joined || undefined,
    }));
  }

  async getCamera(id: number): Promise<{
    id: number;
    brand?: string;
    model?: string;
    has_fixed_lens?: boolean;
    fixed_lens_focal_length?: number;
    fixed_lens_max_aperture?: number;
    mount?: string;
  } | null> {
    try {
      return await this.client.equipment.cameras.get(id);
    } catch (error) {
      console.error('Failed to get camera:', error);
      return null;
    }
  }
}

export const api = new ApiService();
