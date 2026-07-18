import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import * as FS from 'expo-file-system';
const FSLegacy: any = require('expo-file-system/legacy');

export async function ensureMediaPermissionsAsync(): Promise<void> {
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    const res = await MediaLibrary.getPermissionsAsync();
    if (!res.granted) {
      const req = await MediaLibrary.requestPermissionsAsync();
      if (!req.granted) throw new Error('MediaLibrary permission denied');
    }
  }
}

export interface DownloadImageOptions {
  fileName?: string;
  saveToLibrary?: boolean;
}

export async function downloadImageAsync(
  url: string,
  options: DownloadImageOptions = {}
): Promise<string> {
  if (!url) throw new Error('downloadImageAsync: url required');
  const { fileName = `download_${Date.now()}.jpg`, saveToLibrary = true } = options;

  let documentDir: string | null = null;
  const FSAny = FS as any;
  if (FSAny?.Paths?.document?.uri) documentDir = FSAny.Paths.document.uri;
  if (!documentDir && (FSLegacy as any)?.documentDirectory) documentDir = (FSLegacy as any).documentDirectory;
  if (!documentDir && FSAny?.documentDirectory) documentDir = FSAny.documentDirectory;
  if (!documentDir) throw new Error('Unable to resolve document directory');

  const targetUri = documentDir + fileName;

  const hasNewApi = !!(FSAny?.File && typeof FSAny.File.createAsync === 'function');
  if (hasNewApi) {
    const file = await FSAny.File.createAsync(targetUri);
    if (file && typeof file.downloadFileAsync === 'function') {
      const response = await file.downloadFileAsync(url);
      if (!response || (response.status && response.status !== 200)) {
        throw new Error(`Download failed (status ${response?.status ?? 'unknown'})`);
      }
    } else {
      const dl = await FSLegacy.downloadAsync(url, targetUri);
      if (dl.status !== 200) {
        throw new Error(`Download failed (status ${dl.status})`);
      }
    }
  } else {
    const dl = await FSLegacy.downloadAsync(url, targetUri);
    if (dl.status !== 200) {
      throw new Error(`Download failed (status ${dl.status})`);
    }
  }

  if (saveToLibrary) {
    try {
      await ensureMediaPermissionsAsync();
      await MediaLibrary.saveToLibraryAsync(targetUri);
    } catch (e: any) {
      console.warn('MediaLibrary save failed:', e?.message);
    }
  }

  return targetUri;
}
