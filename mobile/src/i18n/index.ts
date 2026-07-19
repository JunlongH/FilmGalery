import { useCallback, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import zh, { type TranslationKey } from './zh';
import en from './en';

export type Language = 'zh' | 'en';

const STORAGE_KEY = 'app_language';

let current: Language = 'zh';
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getLanguage(): Language {
  return current;
}

export async function setLanguage(lang: Language): Promise<void> {
  if (lang !== 'zh' && lang !== 'en') return;
  current = lang;
  emit();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
  } catch (_) {
    // persistence is best-effort
  }
}

export async function initLanguage(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    console.log('[i18n] init, saved =', saved);
    if ((saved === 'zh' || saved === 'en') && saved !== current) {
      current = saved;
      emit();
    }
  } catch (_) {
    // keep default
  }
}

const dictionaries: Record<Language, Record<TranslationKey, string>> = { zh, en };

let logged = false;
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  if (!logged) { logged = true; console.log('[i18n] first t() call, current =', current, '| en?', !!dictionaries.en); }
  let text = dictionaries[current][key] ?? dictionaries.zh[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\`, 'g'), String(v));
    }
  }
  return text;
}

export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLanguage);
  return useCallback((key: TranslationKey, vars?: Record<string, string | number>) => t(key, vars), []);
}

export type { TranslationKey };
