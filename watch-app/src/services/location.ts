/**
 * Location Service for Watch App
 * 
 * Uses @react-native-community/geolocation for better Wear OS compatibility
 * Fallback to react-native-geolocation-service if needed
 * 
 * VERSION: 2026-01-13-v2
 */
import { PermissionsAndroid, Platform, NativeModules } from 'react-native';
import { reverseGeocodeBigDataCloud } from '@filmgallery/shared/geocode';
import type { GeocodeResult } from '@filmgallery/types';

// Try to use @react-native-community/geolocation first, fallback to react-native-geolocation-service
let Geolocation: any;
let geolocationSource = 'unknown';

try {
  Geolocation = require('@react-native-community/geolocation').default;
  geolocationSource = '@react-native-community/geolocation';
  console.log('[Location] Using @react-native-community/geolocation');
} catch (e1) {
  try {
    Geolocation = require('react-native-geolocation-service').default;
    geolocationSource = 'react-native-geolocation-service';
    console.log('[Location] Using react-native-geolocation-service');
  } catch (e2) {
    console.error('[Location] No geolocation package available!');
  }
}

// Canonical reverse-geocode result lives in @filmgallery/types. This alias
// keeps the legacy export name for any existing importers.
export type LocationResult = GeocodeResult;

export interface LocationCoords {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

// Store last known position for quick access
let cachedPosition: LocationCoords | null = null;
let watchId: number | null = null;

export const requestLocationPermission = async (): Promise<boolean> => {
  console.log('[Location] Requesting permission...');
  if (Platform.OS === 'android') {
    try {
      // Check if already granted
      const alreadyGranted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      if (alreadyGranted) {
        console.log('[Location] Permission already granted');
        return true;
      }
      
      console.log('[Location] Showing permission dialog...');
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'Film Gallery Watch needs access to your location',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      const result = granted === PermissionsAndroid.RESULTS.GRANTED;
      console.log('[Location] Permission result:', granted, '-> granted:', result);
      return result;
    } catch (err) {
      console.warn('[Location] Permission error:', err);
      return false;
    }
  }
  return true;
};

/**
 * Start watching position in background
 * Call this when app starts to have position ready
 */
export const startLocationWatch = async (): Promise<void> => {
  const hasPermission = await requestLocationPermission();
  if (!hasPermission) return;

  // Stop any existing watch
  stopLocationWatch();

  watchId = Geolocation.watchPosition(
    (position: { coords: { latitude: number; longitude: number; accuracy: number | null } }) => {
      cachedPosition = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy ?? undefined,
      };
      console.log('[Location] Watch update:', cachedPosition?.accuracy?.toFixed(0), 'm');
      
      // If we have good accuracy, stop watching to save battery
      if (position.coords.accuracy && position.coords.accuracy < 50) {
        console.log('[Location] Good accuracy achieved, stopping watch');
        stopLocationWatch();
      }
    },
    (error: { code: number; message: string }) => {
      console.warn('[Location] Watch error:', error);
    },
    {
      enableHighAccuracy: false,
      distanceFilter: 0,
      interval: 2000,
      fastestInterval: 1000,
    }
  );

  // Auto-stop after 30 seconds
  setTimeout(() => {
    if (watchId !== null) {
      console.log('[Location] Watch timeout, stopping');
      stopLocationWatch();
    }
  }, 30000);
};

/**
 * Stop watching position
 */
export const stopLocationWatch = (): void => {
  if (watchId !== null) {
    Geolocation.clearWatch(watchId);
    watchId = null;
  }
};

/**
 * Get current location with improved reliability
 * Uses cached position if available, falls back to new request
 */
export const getCurrentLocation = async (): Promise<LocationCoords | null> => {
  console.log('[Location] getCurrentLocation called, source:', geolocationSource);
  
  if (!Geolocation) {
    throw new Error('No geolocation package available');
  }
  
  const hasPermission = await requestLocationPermission();
  if (!hasPermission) {
    throw new Error('Location permission denied');
  }

  // Step 1: If we have a cached position, return it immediately
  if (cachedPosition) {
    console.log('[Location] Using CACHED position:', cachedPosition.latitude.toFixed(4), cachedPosition.longitude.toFixed(4));
    return cachedPosition;
  }

  // Step 2: Try to get a position with various strategies
  const tryGetPosition = (
    strategyName: string,
    options: {
      enableHighAccuracy: boolean;
      timeout: number;
      maximumAge: number;
    }
  ): Promise<LocationCoords> => {
    return new Promise((resolve, reject) => {
      console.log(`[Location] Trying ${strategyName}...`);
      const startTime = Date.now();
      
      Geolocation.getCurrentPosition(
        (position: any) => {
          const elapsed = Date.now() - startTime;
          const coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          };
          console.log(`[Location] ✓ ${strategyName} success in ${elapsed}ms: (${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}) ±${coords.accuracy?.toFixed(0)}m`);
          // Update cache
          cachedPosition = coords;
          resolve(coords);
        },
        (error: any) => {
          const elapsed = Date.now() - startTime;
          console.log(`[Location] ✗ ${strategyName} failed in ${elapsed}ms:`, error.code, error.message);
          reject(error);
        },
        options
      );
    });
  };

  // Strategy: First try with large maximumAge to use system cache
  try {
    return await tryGetPosition('CACHED (120s)', {
      enableHighAccuracy: false,
      timeout: 5000,
      maximumAge: 120000, // Accept up to 2 minutes old
    });
  } catch (cacheError) {
    // Continue to next strategy
  }

  // Then try low accuracy for quick result
  try {
    return await tryGetPosition('LOW accuracy', {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 60000,
    });
  } catch (lowAccuracyError) {
    // Continue to next strategy
  }

  // Finally try high accuracy
  try {
    return await tryGetPosition('HIGH accuracy', {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
    });
  } catch (highAccuracyError: any) {
    console.error('[Location] All strategies failed:', highAccuracyError.code, highAccuracyError.message);
    throw highAccuracyError;
  }
};

// Reverse geocoding via the shared BigDataCloud provider (works in China, no API key).
export const reverseGeocode = async (
  latitude: number,
  longitude: number
): Promise<GeocodeResult> => {
  console.log(`[Location] reverseGeocode called: (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
  try {
    const result = await reverseGeocodeBigDataCloud(latitude, longitude, {
      timeout: 15000,
      userAgent: 'FilmGalleryWatch/1.0',
    });
    console.log(`[Location] ✓ Geocoded: ${result.city}, ${result.country}, ${result.displayName}`);
    return result;
  } catch (error: any) {
    console.warn(`[Location] Reverse geocode failed:`, error.name, error.message);
    // Fallback - return coordinates but no address data
    return { displayName: '', country: '', city: '', state: '', latitude, longitude };
  }
};

export const autoDetectLocation = async (): Promise<LocationResult> => {
  console.log('[Location] autoDetectLocation called');
  try {
    const coords = await getCurrentLocation();
    if (!coords) {
      throw new Error('Unable to get location');
    }
    console.log('[Location] Got coordinates, starting reverse geocode...');
    const result = await reverseGeocode(coords.latitude, coords.longitude);
    console.log('[Location] autoDetectLocation result:', JSON.stringify(result));
    return {
      ...result,
      latitude: coords.latitude,
      longitude: coords.longitude,
    };
  } catch (error: any) {
    console.error('[Location] autoDetectLocation failed:', error.code, error.message);
    throw error;
  }
};

/**
 * Get cached position if available (synchronous)
 * Returns null if no cached position
 */
export const getCachedLocation = (): LocationCoords | null => {
  return cachedPosition;
};

/**
 * Get diagnostic information about location service
 */
export const getDiagnostics = async (): Promise<{
  source: string;
  hasGeolocation: boolean;
  permissionGranted: boolean;
  cachedPosition: LocationCoords | null;
}> => {
  const permissionGranted = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );
  return {
    source: geolocationSource,
    hasGeolocation: !!Geolocation,
    permissionGranted,
    cachedPosition,
  };
};
