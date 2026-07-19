/**
 * Phase 2B #1 — Pairing & session management API.
 *
 * Server-side endpoints:
 *   POST   /api/pairing/code    — generate a 6-digit pairing code (loopback only)
 *   POST   /api/pairing/verify  — exchange code for a bearer token (open)
 *   GET    /api/sessions        — list active sessions
 *   DELETE /api/sessions/:id    — revoke a session (+ cascade to derived watch tokens)
 */
import { jsonFetch, postJson, deleteRequest } from './core';

export function generatePairingCode() {
  return postJson('/api/pairing/code', {});
}

export function verifyPairingCode(code, deviceName, deviceFp) {
  return postJson('/api/pairing/verify', { code, deviceName, deviceFp });
}

export function listSessions() {
  return jsonFetch('/api/sessions');
}

export function revokeSession(id) {
  return deleteRequest(`/api/sessions/${id}`);
}

/**
 * Generate or read a stable device fingerprint for this desktop client.
 * Stored in localStorage so re-pairing overwrites the same device row
 * rather than creating duplicates.
 */
export function getDeviceFingerprint() {
  const KEY = '__fg_device_fp';
  try {
    let fp = localStorage.getItem(KEY);
    if (!fp) {
      const ts = Date.now().toString(36);
      const rand = Math.random().toString(36).slice(2, 10);
      fp = `desktop-${ts}${rand}`;
      localStorage.setItem(KEY, fp);
    }
    return fp;
  } catch {
    return `desktop-${Date.now().toString(36)}`;
  }
}
