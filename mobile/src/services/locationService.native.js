/**
 * Native Android Location Service - Direct Geolocation API
 * 
 * Bypasses expo-location completely for HyperOS/MIUI compatibility
 * Uses React Native's built-in Geolocation API (based on Android native)
 * 
 * VERSION: 2026-01-13-NATIVE
 */

import { Platform, PermissionsAndroid, Alert, Linking } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { wgs84ToGcj02 } from '@filmgallery/shared/coordTransform';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  TIMEOUT: 10000,                 // 10秒超时
  CACHE_MAX_AGE: 5 * 60 * 1000,  // 5分钟缓存
  MAX_AGE: 60000,                 // 接受1分钟内的位置
};

// ============================================================================
// State
// ============================================================================

let cachedLocation = null;
let diagnosticLog = [];
const MAX_LOG = 30;

// ============================================================================
// Logging
// ============================================================================

const log = (msg, level = 'info') => {
  const ts = new Date().toISOString().slice(11, 23);
  const entry = `[${ts}] ${level.toUpperCase()}: ${msg}`;
  diagnosticLog.unshift(entry);
  if (diagnosticLog.length > MAX_LOG) diagnosticLog.pop();
  
  if (__DEV__) {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn('[LocationNative]', msg);
  }
};

// ============================================================================
// Reverse Geocoding (Convert coords to address)
// ============================================================================

/**
 * Reverse geocode using BigDataCloud API (works in China, no API key needed)
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<{country: string, city: string, detail: string}>}
 */
const reverseGeocode = async (latitude, longitude) => {
  try {
    log(`Reverse geocoding: (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
    
    // Check if Amap is configured
    const mapProvider = await AsyncStorage.getItem('map_provider');
    if (mapProvider === 'amap') {
      const amapKey = await AsyncStorage.getItem('amap_key');
      if (amapKey) {
        try {
          // Input is WGS-84 from GPS → convert to GCJ-02 for Amap API
          const gcj = wgs84ToGcj02(latitude, longitude);
          const amapUrl = `https://restapi.amap.com/v3/geocode/regeo?location=${gcj.lng},${gcj.lat}&key=${encodeURIComponent(amapKey)}&output=JSON`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const response = await fetch(amapUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          
          if (response.ok) {
            const data = await response.json();
            if (data.status === '1' && data.regeocode) {
              const comp = data.regeocode.addressComponent || {};
              const geocode = {
                country: comp.country || '中国',
                city: comp.city || comp.district || '',
                detail: data.regeocode.formatted_address || ''
              };
              log(`✓ Amap geocoded: ${geocode.city}, ${geocode.country}`);
              return geocode;
            }
          }
        } catch (amapErr) {
          log(`Amap reverse geocode failed: ${amapErr.message}, falling back`, 'warn');
        }
      }
    }
    
    // Fallback: BigDataCloud (works in China, no API key)
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'FilmGallery/1.0',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`BigDataCloud API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Extract English names from BigDataCloud response
    const geocode = {
      country: data.countryName || '',
      city: data.city || data.locality || data.principalSubdivision || '',
      detail: [data.street, data.neighbourhood, data.locality].filter(Boolean).join(', ') || data.localityInfo?.administrative?.[0]?.name || ''
    };
    
    log(`✓ Geocoded: ${geocode.city}, ${geocode.country}`);
    return geocode;
  } catch (e) {
    log(`BigDataCloud geocode failed: ${e.message}, falling back to Expo`, 'warn');
    
    // Fallback to Expo Location if BigDataCloud fails
    try {
      const results = await Location.reverseGeocodeAsync({ latitude, longitude });
      const addr = results?.[0] || {};
      return {
        country: addr.country || '',
        city: addr.city || addr.subregion || addr.region || '',
        detail: `${addr.street || ''} ${addr.name || ''}`.trim() || ''
      };
    } catch (fallbackError) {
      log(`Fallback geocode also failed: ${fallbackError.message}`, 'warn');
      return { country: '', city: '', detail: '' };
    }
  }
};

// ============================================================================
// Android Native Geolocation (Bypass Expo completely)
// ============================================================================

/**
 * Get location using React Native's Geolocation API (Android native)
 * This bypasses expo-location entirely
 */
const getLocationNative = () => {
  return new Promise((resolve, reject) => {
    log('Using React Native Geolocation (native Android API)');
    
    // Import the native geolocation package
    const Geolocation = require('@react-native-community/geolocation').default;
    
    if (!Geolocation || !Geolocation.getCurrentPosition) {
      reject(new Error('Geolocation not available - native module not linked'));
      return;
    }
    
    const timeout = setTimeout(() => {
      log('Native geolocation timeout', 'error');
      reject(new Error('NATIVE_TIMEOUT'));
    }, CONFIG.TIMEOUT);
    
    Geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timeout);
        log(`✓ Native success: (${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)})`);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitude: position.coords.altitude,
          accuracy: position.coords.accuracy
        });
      },
      (error) => {
        clearTimeout(timeout);
        log(`Native error: ${error.code} ${error.message}`, 'error');
        reject(error);
      },
      {
        enableHighAccuracy: false,  // Use network location for speed
        timeout: CONFIG.TIMEOUT,
        maximumAge: CONFIG.MAX_AGE
      }
    );
  });
};

/**
 * Request Android permissions manually
 */
const requestAndroidPermissions = async () => {
  if (Platform.OS !== 'android') return true;
  
  try {
    log('Requesting Android location permissions...');
    
    // Request fine location
    const fineGranted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: '位置权限',
        message: 'FilmGallery需要访问您的位置',
        buttonPositive: '允许'
      }
    );
    
    if (fineGranted !== PermissionsAndroid.RESULTS.GRANTED) {
      log('Fine location denied', 'warn');
      return false;
    }
    
    log('✓ Fine location granted');
    
    // Try background permission (may fail on older Android)
    if (Platform.Version >= 29) {
      try {
        const bgGranted = await PermissionsAndroid.request(
          'android.permission.ACCESS_BACKGROUND_LOCATION',
          {
            title: '后台位置权限',
            message: 'FilmGallery需要后台位置访问（HyperOS要求）',
            buttonPositive: '允许'
          }
        );
        
        if (bgGranted === PermissionsAndroid.RESULTS.GRANTED) {
          log('✓ Background location granted');
        } else {
          log('Background location denied (may still work)', 'warn');
        }
      } catch (e) {
        log(`BG permission request failed: ${e.message}`, 'warn');
      }
    }
    
    return true;
  } catch (e) {
    log(`Permission request failed: ${e.message}`, 'error');
    return false;
  }
};

/**
 * Check current permissions
 */
const checkPermissions = async () => {
  if (Platform.OS !== 'android') return { fine: true, background: true };
  
  try {
    const fine = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    
    let background = 'unknown';
    if (Platform.Version >= 29) {
      try {
        background = await PermissionsAndroid.check(
          'android.permission.ACCESS_BACKGROUND_LOCATION'
        );
      } catch (e) {
        background = 'unknown';
      }
    }
    
    return { fine, background };
  } catch (e) {
    return { fine: false, background: 'unknown' };
  }
};

// ============================================================================
// Main API
// ============================================================================

/**
 * Get diagnostics using Expo (for display only)
 */
export const getDiagnostics = async () => {
  const diag = {
    timestamp: Date.now(),
    expo: {},
    native: {},
    log: [...diagnosticLog]
  };
  
  // Expo diagnostics (may fail but we don't care)
  try {
    const fgPerm = await Location.getForegroundPermissionsAsync();
    diag.expo.foreground = fgPerm.status;
    
    const svc = await Location.hasServicesEnabledAsync();
    diag.expo.servicesEnabled = svc;
    
    const providers = await Location.getProviderStatusAsync();
    diag.expo.providers = providers;
  } catch (e) {
    diag.expo.error = e.message;
  }
  
  // Native Android diagnostics
  const perms = await checkPermissions();
  diag.native.permissionFine = perms.fine;
  diag.native.permissionBackground = perms.background;
  diag.native.platform = Platform.OS;
  diag.native.version = Platform.Version;
  
  return diag;
};

/**
 * Request all permissions
 */
export const requestPermissions = async () => {
  log('Requesting permissions (native path)');
  
  if (Platform.OS === 'android') {
    return await requestAndroidPermissions();
  }
  
  // iOS fallback to Expo
  try {
    const result = await Location.requestForegroundPermissionsAsync();
    return result.status === 'granted';
  } catch (e) {
    log(`iOS permission failed: ${e.message}`, 'error');
    return false;
  }
};

/**
 * Get location - NATIVE FIRST strategy
 */
export const getLocation = async () => {
  log('═══ getLocation() START (NATIVE MODE) ═══');
  
  // Check cache first
  if (cachedLocation && (Date.now() - cachedLocation.timestamp) < CONFIG.CACHE_MAX_AGE) {
    const age = Math.round((Date.now() - cachedLocation.timestamp) / 1000);
    log(`Using cache (age: ${age}s)`);
    return {
      success: true,
      coords: cachedLocation.coords,
      geocode: cachedLocation.geocode,  // Include cached geocode!
      source: 'cache'
    };
  }
  
  // Check permissions
  const perms = await checkPermissions();
  log(`Permissions: fine=${perms.fine}, bg=${perms.background}`);
  
  if (!perms.fine) {
    log('No fine location permission', 'warn');
    const granted = await requestPermissions();
    if (!granted) {
      return {
        success: false,
        error: 'PERMISSION_DENIED',
        coords: null
      };
    }
  }
  
  // Strategy 1: Try Expo's lastKnown (fast, doesn't need active GPS)
  try {
    log('Quick check: Expo lastKnown');
    const lastKnown = await Location.getLastKnownPositionAsync({
      maxAge: CONFIG.CACHE_MAX_AGE,
      requiredAccuracy: 3000
    });
    
    if (lastKnown?.coords) {
      log(`✓ LastKnown: (${lastKnown.coords.latitude.toFixed(4)}, ${lastKnown.coords.longitude.toFixed(4)})`);
      
      // Reverse geocode to get address
      const geocode = await reverseGeocode(lastKnown.coords.latitude, lastKnown.coords.longitude);
      
      cachedLocation = { coords: lastKnown.coords, geocode, timestamp: Date.now() };
      return {
        success: true,
        coords: lastKnown.coords,
        geocode,
        source: 'lastKnown'
      };
    }
  } catch (e) {
    log(`LastKnown failed: ${e.message}`, 'warn');
  }
  
  // Strategy 2: Native Android Geolocation (PRIMARY for HyperOS)
  try {
    const coords = await getLocationNative();
    
    // Reverse geocode to get address
    const geocode = await reverseGeocode(coords.latitude, coords.longitude);
    
    cachedLocation = { coords, geocode, timestamp: Date.now() };
    
    log('═══ SUCCESS via NATIVE ═══');
    return {
      success: true,
      coords,
      geocode,
      source: 'native'
    };
  } catch (nativeError) {
    log(`Native failed: ${nativeError.message}`, 'error');
    
    // Strategy 3: Try Expo watch as last resort
    try {
      log('Final attempt: Expo watch');
      const coords = await new Promise((resolve, reject) => {
        let subscription = null;
        let resolved = false;
        
        const cleanup = () => {
          if (subscription) {
            subscription.remove();
            subscription = null;
          }
        };
        
        const tid = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error('WATCH_TIMEOUT'));
          }
        }, CONFIG.TIMEOUT);
        
        Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Lowest, timeInterval: 500, distanceInterval: 0 },
          (pos) => {
            if (!resolved && pos?.coords) {
              resolved = true;
              clearTimeout(tid);
              cleanup();
              resolve(pos.coords);
            }
          }
        ).then(sub => {
          subscription = sub;
          if (resolved) cleanup();
        }).catch(err => {
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });
      });
      
      cachedLocation = { coords, timestamp: Date.now() };
      
      // Reverse geocode to get address
      const geocode = await reverseGeocode(coords.latitude, coords.longitude);
      cachedLocation.geocode = geocode;
      
      log('═══ SUCCESS via EXPO WATCH ═══');
      return {
        success: true,
        coords,
        geocode,
        coords,
        source: 'watch'
      };
    } catch (watchError) {
      log(`Watch also failed: ${watchError.message}`, 'error');
      
      // Complete failure
      log('═══ ALL METHODS FAILED ═══', 'error');
      return {
        success: false,
        error: 'ALL_FAILED',
        coords: null,
        errors: {
          native: nativeError.message,
          watch: watchError.message
        }
      };
    }
  }
};

/**
 * Preload location
 */
export const preloadLocation = async () => {
  log('Preloading...');
  return await getLocation();
};

/**
 * Get cached location
 */
export const getCachedLocation = () => cachedLocation;

/**
 * Clear cache
 */
export const clearCache = () => {
  log('Cache cleared');
  cachedLocation = null;
};

/**
 * Get log
 */
export const getLog = () => [...diagnosticLog];

/**
 * Open settings
 */
export const openLocationSettings = () => {
  if (Platform.OS === 'android') {
    Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => {
      Linking.openSettings();
    });
  } else {
    Linking.openSettings();
  }
};

/**
 * Show guidance
 */
export const showGuidance = (error) => {
  Alert.alert(
    '定位失败',
    `无法获取位置。\n\n请检查：\n1. 位置服务已开启\n2. GPS信号良好\n3. 权限已授予\n\n错误: ${error}`,
    [
      { text: '取消' },
      { text: '打开设置', onPress: openLocationSettings }
    ]
  );
};

/**
 * Stop watching location (no-op for native service)
 * Native service uses one-shot location requests, not continuous watching
 */
const stopWatch = () => {
  // No-op: Native service uses one-shot location, not continuous watch
  log('stopWatch called (no-op for native service)');
};

export default {
  getDiagnostics,
  requestPermissions,
  getLocation,
  preloadLocation,
  getCachedLocation,
  clearCache,
  getLog,
  openLocationSettings,
  showGuidance,
  reverseGeocode,
  stopWatch
};
