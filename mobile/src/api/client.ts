import { createApiClient, type ApiClient } from '@filmgallery/api-client';
import { Alert } from 'react-native';

let _client: ApiClient = createApiClient({ baseUrl: '', timeout: 5000 });

function notifyError(err: any): void {
  const info = { message: err && err.message, status: err && err.status };
  console.log('API_ERROR', info);
  try {
    Alert.alert(
      'Connection Error',
      `Error: ${info.message || 'unknown'}\nStatus: ${info.status || 'N/A'}`
    );
  } catch (_) {
    // Alert unavailable outside React Native (e.g. unit tests).
  }
}

export function configureApi(primaryUrl: string, secondaryUrl?: string | null): void {
  _client = createApiClient({
    baseUrl: primaryUrl || '',
    backupUrl: secondaryUrl || null,
    failover: !!secondaryUrl,
    timeout: 5000,
    onError: notifyError,
  });
}

export const api: ApiClient = new Proxy({} as ApiClient, {
  get: (_target, prop) => Reflect.get(_client, prop),
});
