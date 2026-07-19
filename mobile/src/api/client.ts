import { createApiClient, type ApiClient } from '@filmgallery/api-client';

export interface ApiErrorInfo {
  message: string;
  status?: number;
}

type ErrorListener = (info: ApiErrorInfo) => void;

const errorListeners = new Set<ErrorListener>();
let lastNotifyAt = 0;
let lastMessage = '';

const NOTIFY_INTERVAL_MS = 4000;

export function subscribeApiErrors(cb: ErrorListener): () => void {
  errorListeners.add(cb);
  return () => {
    errorListeners.delete(cb);
  };
}

function notifyError(err: any): void {
  const info: ApiErrorInfo = { message: err && (err as Error).message, status: (err as any)?.status };
  console.log('API_ERROR', info);
  const now = Date.now();
  if (info.message === lastMessage && now - lastNotifyAt < NOTIFY_INTERVAL_MS) return;
  lastMessage = info.message;
  lastNotifyAt = now;
  errorListeners.forEach((cb) => {
    try {
      cb(info);
    } catch (_) {
      // listener must not break the client
    }
  });
}

let _client: ApiClient = createApiClient({ baseUrl: '', timeout: 5000, onError: notifyError });

export function configureApi(primaryUrl: string, secondaryUrl?: string | null): void {
  _client = createApiClient({
    baseUrl: primaryUrl || '',
    backupUrl: secondaryUrl || undefined,
    failover: !!secondaryUrl,
    timeout: 5000,
    onError: notifyError,
  });
}

export const api: ApiClient = new Proxy({} as ApiClient, {
  get: (_target, prop) => Reflect.get(_client, prop),
});
