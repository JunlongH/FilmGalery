/**
 * Auth API — shared-secret management (replaces the pairing/session flow).
 *
 * Server-side endpoints:
 *   GET    /api/auth/secret             — read the current secret (loopback only)
 *   POST   /api/auth/secret/regenerate  — rotate the secret (loopback only)
 *   GET    /api/auth/check              — report caller auth status
 */
import { jsonFetch, postJson } from './core';

export function getServerSecret() {
  return jsonFetch('/api/auth/secret');
}

export function regenerateSecret() {
  return postJson('/api/auth/secret/regenerate', {});
}

export function checkAuth() {
  return jsonFetch('/api/auth/check');
}
