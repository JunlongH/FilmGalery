/**
 * App Config API - Photography mode and onboarding
 */

import { jsonFetch, postJson, putJson } from './core';

export async function getAppConfig() {
  return jsonFetch('/api/app-config');
}

export async function updateAppConfig(data) {
  return putJson('/api/app-config', data);
}

export async function setOnboardingChoice(choice) {
  return postJson('/api/app-config/onboarding', choice);
}
