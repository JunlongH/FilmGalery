// Type declarations for @filmgallery/api-client (runtime is CommonJS: index.js).
// Resource modules are typed loosely (Promise<any>); TypeScript consumers cast
// at their boundary until the modules ship typed signatures.

export interface RetryOptions {
  maxRetries?: number;
  delayMs?: number;
  backoff?: 'linear' | 'fixed';
}

export interface ApiClientConfig {
  baseUrl?: string;
  /** Secondary base URL; enables failover when `failover: true`. */
  backupUrl?: string;
  /** Injected fetch (tests / React Native). Defaults to global fetch. */
  fetch?: any;
  /** Global error hook — fires once per failed request. */
  onError?: (err: any) => void;
  /** Same-URL retry on network (transport) errors. HTTP errors are never retried. */
  retry?: RetryOptions;
  /** Toggle to `backupUrl` on a network error (sticky until setBaseUrl). */
  failover?: boolean;
  /** Per-request abort timeout in ms (0 = no timeout). A timeout surfaces as a
   *  network error and is therefore retried/failed-over. */
  timeout?: number;
}

export interface HttpHelpers {
  /** Active base URL (may differ from primary after a sticky failover). */
  readonly baseUrl: string;
  setBaseUrl: (url: string) => void;
  get(path: string, params?: Record<string, any>): Promise<any>;
  post(path: string, data?: any): Promise<any>;
  put(path: string, data?: any): Promise<any>;
  delete(path: string): Promise<any>;
  postForm(path: string, formData: FormData, onProgress?: (pct: number) => void): Promise<any>;
  buildUploadUrl(pathOrUrl?: string | null): string | null;
}

export interface ApiClient {
  readonly baseUrl: string;
  readonly primaryBaseUrl: string;
  readonly backupUrl: string | null;
  setBaseUrl: (url: string) => void;
  http: HttpHelpers;
  equipment: any;
  rolls: any;
  photos: any;
  films: any;
  locations: any;
  stats: any;
  metadata: any;
}

export declare function createApiClient(config?: ApiClientConfig): ApiClient;
export declare function isNetworkError(err: any): boolean;
