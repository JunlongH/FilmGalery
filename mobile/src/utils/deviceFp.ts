/**
 * Phase 2B #1 — Device fingerprint for pairing.
 *
 * Generates a stable UUID on first install, stored in SecureStore.
 * Used as the `deviceFp` field in pairing requests so the server can
 * identify re-pairing from the same device (UNIQUE constraint on
 * device_fp + device_kind).
 */
import * as SecureStore from 'expo-secure-store';

const FP_KEY = 'device_fingerprint';

let cached: string | null = null;

export async function getDeviceFingerprint(): Promise<string> {
  if (cached) return cached;
  try {
    let fp = await SecureStore.getItemAsync(FP_KEY);
    if (!fp) {
      // Generate a v4-style UUID
      const hex = Array.from({ length: 16 }, () =>
        Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
      ).join('');
      fp = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      await SecureStore.setItemAsync(FP_KEY, fp);
    }
    cached = fp;
    return fp;
  } catch {
    // Fallback: random non-persistent
    if (!cached) {
      cached = `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return cached;
  }
}
