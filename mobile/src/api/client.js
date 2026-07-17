/**
 * Mobile shared API client.
 *
 * Replaces the global-axios + setupAxios failover with @filmgallery/api-client,
 * which provides the same resilience (primary/secondary failover, 5s timeout)
 * centrally and tested. configureApi() is the drop-in for the old
 * configureAxios() — call it whenever the user changes server settings.
 *
 * Consumers import { api } and call e.g. `api.http.get('/api/rolls')` or
 * `api.equipment.cameras.list()`. The Proxy forwards to the current client, so
 * a configureApi() swap is picked up without re-importing.
 */
import { createApiClient } from '@filmgallery/api-client';
import { Alert } from 'react-native';

let _client = createApiClient({ baseUrl: '', timeout: 5000 });

// Preserve the prior UX: the axios interceptor alerted on every request that
// failed (network or HTTP). api-client's onError fires once per failed request
// (after retry/failover), matching that behaviour.
function notifyError(err) {
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

/**
 * Reconfigure the shared client. Recreating (rather than mutating) resets
 * failover stickiness to the primary — matching the old configureAxios.
 * @param {string} primaryUrl
 * @param {string|null} [secondaryUrl]
 */
export function configureApi(primaryUrl, secondaryUrl) {
  _client = createApiClient({
    baseUrl: primaryUrl || '',
    backupUrl: secondaryUrl || null,
    failover: !!secondaryUrl,
    timeout: 5000,
    onError: notifyError,
  });
}

// Always-forwarding Proxy so consumers see the live client after a swap.
export const api = new Proxy(
  {},
  {
    get: (_target, prop) => Reflect.get(_client, prop),
  }
);
