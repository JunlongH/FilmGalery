import { createApiClient, type ApiClient } from '@filmgallery/api-client';
import * as SecureStore from 'expo-secure-store';

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
    } catch {
      // listener must not break the client
    }
  });
}

// ============================================================================
// Phase 2B #1 — Auth token persistence
// ============================================================================
// The token survives configureApi() re-creation because we remember it in a
// closure variable and re-apply on every reconfigure. Persisted in
// expo-secure-store (Android Keystore / iOS Keychain).

const TOKEN_KEY = 'auth_token';
let _pendingToken: string | null = null;
let _onUnauthorizedCb: (() => void) | null = null;

function applyAuth(client: ApiClient) {
  if (_pendingToken) client.setAuthToken(_pendingToken);
  if (_onUnauthorizedCb) client.setOnUnauthorized(_onUnauthorizedCb);
}

// TEST HACK (temp): default to host server via adb reverse. Revert before commit.
let _client: ApiClient = createApiClient({ baseUrl: 'http://localhost:4001', timeout: 5000, onError: notifyError });

export function configureApi(primaryUrl: string, secondaryUrl?: string | null): void {
  _client = createApiClient({
    baseUrl: primaryUrl || '',
    backupUrl: secondaryUrl || undefined,
    failover: !!secondaryUrl,
    timeout: 5000,
    onError: notifyError,
  });
  // Re-apply auth token + 401 hook after client re-creation.
  applyAuth(_client);
}

export const api: ApiClient = new Proxy({} as ApiClient, {
  get: (_target, prop) => Reflect.get(_client, prop),
});

// --- Auth token API ---

export async function loadAuthToken(): Promise<string | null> {
  try {
    _pendingToken = await SecureStore.getItemAsync(TOKEN_KEY);
    if (_pendingToken) _client.setAuthToken(_pendingToken);
    return _pendingToken;
  } catch {
    return null;
  }
}

export async function saveAuthToken(token: string): Promise<void> {
  _pendingToken = token;
  _client.setAuthToken(token);
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch { /* best-effort */ }
}

export async function clearAuthToken(): Promise<void> {
  _pendingToken = null;
  _client.clearAuthToken();
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch { /* best-effort */ }
}

export function setApiOnUnauthorized(cb: () => void): void {
  _onUnauthorizedCb = cb;
  _client.setOnUnauthorized(cb);
}
