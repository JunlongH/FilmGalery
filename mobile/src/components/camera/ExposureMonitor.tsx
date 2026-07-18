/**
 * ExposureMonitor - Real-time exposure monitoring with spot metering support
 * 
 * VERSION: 2025-12-11-v7-SPOT-METERING
 * 
 * Strategy:
 * 1. Frame Processor for real-time brightness feedback (3 FPS)
 * 2. Periodic silent photo capture for accurate EXIF-based EV (500ms interval)
 * 3. Spot metering via localized brightness sampling in Frame Processor
 * 4. EV calibration using EXIF baseline + brightness delta
 * 
 * On Android, we read EXIF directly from the temp file without saving to media library.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { Platform } from 'react-native';
import { useFrameProcessor } from 'react-native-vision-camera';
import { runAtTargetFps } from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Parse EXIF data from a JPEG file (base64 encoded)
 * This is a simplified EXIF parser that extracts only the exposure-related tags we need.
 * 
 * @param {string} base64Data - Base64 encoded JPEG data
 * @returns {object|null} - Extracted EXIF data or null
 */
function parseExifFromBase64(base64Data) {
  try {
    // Decode base64 to binary
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Check for JPEG marker
    if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
      return null;
    }
    
    // Find APP1 marker (EXIF)
    let offset = 2;
    while (offset < bytes.length - 4) {
      if (bytes[offset] !== 0xFF) {
        offset++;
        continue;
      }
      
      const marker = bytes[offset + 1];
      
      // APP1 marker (0xE1) contains EXIF
      if (marker === 0xE1) {
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        
        // Check for "Exif\0\0" identifier
        if (bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78 &&
            bytes[offset + 6] === 0x69 && bytes[offset + 7] === 0x66 &&
            bytes[offset + 8] === 0x00 && bytes[offset + 9] === 0x00) {
          
          const tiffOffset = offset + 10;
          return parseTiffHeader(bytes, tiffOffset, length - 8);
        }
      }
      
      // Skip to next marker
      if (marker >= 0xE0 && marker <= 0xEF) {
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        offset += 2 + length;
      } else if (marker === 0xD9) {
        // End of image
        break;
      } else {
        offset++;
      }
    }
    
    return null;
  } catch (e) {
    __DEV__ && console.warn('[EXIF] Parse error:', e.message);
    return null;
  }
}

/**
 * Parse TIFF header and extract EXIF tags
 */
function parseTiffHeader(bytes, tiffOffset, maxLength) {
  try {
    // Check byte order (II = little endian, MM = big endian)
    const isLittleEndian = bytes[tiffOffset] === 0x49 && bytes[tiffOffset + 1] === 0x49;
    
    const readUint16 = (offset) => {
      if (isLittleEndian) {
        return bytes[offset] | (bytes[offset + 1] << 8);
      }
      return (bytes[offset] << 8) | bytes[offset + 1];
    };
    
    const readUint32 = (offset) => {
      if (isLittleEndian) {
        return bytes[offset] | (bytes[offset + 1] << 8) | 
               (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
      }
      return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | 
             (bytes[offset + 2] << 8) | bytes[offset + 3];
    };
    
    const readRational = (offset) => {
      const numerator = readUint32(offset);
      const denominator = readUint32(offset + 4);
      return denominator !== 0 ? numerator / denominator : 0;
    };
    
    // Verify TIFF marker (42)
    if (readUint16(tiffOffset + 2) !== 42) {
      return null;
    }
    
    // Get offset to first IFD
    const ifd0Offset = readUint32(tiffOffset + 4);
    
    const result: any = {};
    
    // Parse IFD0 to find EXIF IFD pointer
    let exifIfdOffset = null;
    const ifd0EntryCount = readUint16(tiffOffset + ifd0Offset);
    
    for (let i = 0; i < ifd0EntryCount; i++) {
      const entryOffset = tiffOffset + ifd0Offset + 2 + (i * 12);
      const tag = readUint16(entryOffset);
      
      // ExifIFDPointer tag (0x8769)
      if (tag === 0x8769) {
        exifIfdOffset = readUint32(entryOffset + 8);
        break;
      }
    }
    
    // Parse EXIF IFD
    if (exifIfdOffset) {
      const exifEntryCount = readUint16(tiffOffset + exifIfdOffset);
      
      for (let i = 0; i < exifEntryCount; i++) {
        const entryOffset = tiffOffset + exifIfdOffset + 2 + (i * 12);
        const tag = readUint16(entryOffset);
        const type = readUint16(entryOffset + 2);
        const count = readUint32(entryOffset + 4);
        
        // ExposureTime (0x829A) - RATIONAL
        if (tag === 0x829A && type === 5) {
          const valueOffset = readUint32(entryOffset + 8);
          result.ExposureTime = readRational(tiffOffset + valueOffset);
        }
        
        // FNumber (0x829D) - RATIONAL
        if (tag === 0x829D && type === 5) {
          const valueOffset = readUint32(entryOffset + 8);
          result.FNumber = readRational(tiffOffset + valueOffset);
        }
        
        // ISOSpeedRatings (0x8827) - SHORT
        if (tag === 0x8827 && type === 3) {
          result.ISOSpeedRatings = readUint16(entryOffset + 8);
        }
        
        // ApertureValue (0x9202) - RATIONAL
        if (tag === 0x9202 && type === 5) {
          const valueOffset = readUint32(entryOffset + 8);
          result.ApertureValue = readRational(tiffOffset + valueOffset);
        }
        
        // BrightnessValue (0x9203) - SRATIONAL
        if (tag === 0x9203) {
          const valueOffset = readUint32(entryOffset + 8);
          result.BrightnessValue = readRational(tiffOffset + valueOffset);
        }
      }
    }
    
    return Object.keys(result).length > 0 ? result : null;
  } catch (e) {
    __DEV__ && console.warn('[EXIF] TIFF parse error:', e.message);
    return null;
  }
}

/**
 * Calculate average brightness from YUV frame data
 * In YUV format, Y channel represents luminance (brightness)
 * 
 * @param {ArrayBuffer} buffer - Frame data buffer
 * @param {number} width - Frame width
 * @param {number} height - Frame height
 * @returns {number} - Average brightness (0-255)
 */
function calculateAverageBrightness(buffer, width, height) {
  'worklet';
  
  const data = new Uint8Array(buffer);
  const pixelCount = width * height;
  
  // In YUV (NV21) format, Y data comes first, one byte per pixel
  // Sample every 16th pixel for performance
  const sampleStep = 16;
  let sum = 0;
  let count = 0;
  
  for (let i = 0; i < pixelCount; i += sampleStep) {
    sum += data[i];
    count++;
  }
  
  return count > 0 ? sum / count : 128;
}

/**
 * Calculate brightness for a specific region (spot metering)
 * Uses a circular sampling area centered on the given point.
 * 
 * @param {ArrayBuffer} buffer - Frame data buffer
 * @param {number} width - Frame width  
 * @param {number} height - Frame height
 * @param {number} centerX - Center X coordinate (0-1 normalized)
 * @param {number} centerY - Center Y coordinate (0-1 normalized)
 * @param {number} radiusRatio - Radius as ratio of min(width,height), default 0.1 (10%)
 * @returns {number} - Average brightness in region (0-255)
 */
function calculateRegionBrightness(buffer, width, height, centerX, centerY, radiusRatio = 0.1) {
  'worklet';
  
  const data = new Uint8Array(buffer);
  const pixelCount = width * height;
  
  // Convert normalized coordinates to pixel coordinates
  const cx = Math.floor(centerX * width);
  const cy = Math.floor(centerY * height);
  const radius = Math.floor(Math.min(width, height) * radiusRatio);
  const radiusSq = radius * radius;
  
  // Calculate bounding box for the region
  const minX = Math.max(0, cx - radius);
  const maxX = Math.min(width - 1, cx + radius);
  const minY = Math.max(0, cy - radius);
  const maxY = Math.min(height - 1, cy + radius);
  
  let sum = 0;
  let count = 0;
  const sampleStep = 4; // Sample every 4th pixel in region for performance
  
  // In YUV (NV21) format, Y data comes first, one byte per pixel
  for (let y = minY; y <= maxY; y += sampleStep) {
    for (let x = minX; x <= maxX; x += sampleStep) {
      // Check if point is within circular region
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radiusSq) {
        const index = y * width + x;
        if (index < pixelCount) {
          sum += data[index];
          count++;
        }
      }
    }
  }
  
  return count > 0 ? sum / count : 128;
}

/**
 * Convert brightness to approximate EV value
 * 
 * IMPORTANT: This is an APPROXIMATION only!
 * Due to camera auto-exposure, the measured brightness stays around 128 (middle gray).
 * This function provides a rough estimate for UI feedback, but accurate EV 
 * should come from EXIF metadata via takePhoto().
 * 
 * The formula attempts to map the narrow brightness range to a wider EV range,
 * assuming the camera's auto-exposure targets middle gray.
 * 
 * @param {number} brightness - Average brightness (0-255)
 * @returns {number} - Estimated EV value (approximate)
 */
function brightnessToEV(brightness) {
  'worklet';
  
  // Camera auto-exposure targets ~128 (middle gray)
  // Deviations from 128 indicate the scene is brighter/darker than the camera can compensate
  
  // Clamp to reasonable range
  if (brightness <= 1) return -2;
  if (brightness >= 254) return 18;
  
  // Base EV calculation using log scale
  // At brightness=128 (middle gray), we estimate EV ~8 (typical indoor)
  // This is a rough approximation since we don't have real exposure data
  
  // log2(brightness) gives us: 
  //   brightness=1 → 0, brightness=128 → 7, brightness=255 → 8
  const log2Brightness = Math.log(brightness) / Math.log(2);
  
  // Scale to reasonable EV range
  // Adjust so that typical indoor (brightness ~100-150) maps to EV 6-9
  // And bright outdoor (brightness ~200+) maps to EV 12-15
  const baseEV = log2Brightness * 1.5 - 2.5;
  
  return Math.max(-2, Math.min(18, baseEV));
}

// Configuration constants
const EXIF_SAMPLE_INTERVAL_MS = 500; // EXIF sampling interval (faster for near-realtime feel)
const FRAME_PROCESSOR_FPS = 10; // Frame processor target FPS for responsiveness
const SPOT_METERING_RADIUS = 0.08; // Spot metering radius as ratio of screen (8%)

/**
 * Main exposure monitoring hook with spot metering support
 * 
 * Combines:
 * 1. Frame Processor for real-time brightness feedback (visual only)
 * 2. Periodic EXIF sampling via takePhoto for accurate EV calculation (500ms)
 * 3. Spot metering via localized brightness sampling
 * 4. EV calibration using EXIF baseline + brightness delta
 * 
 * @param {function} onExposureUpdate - Callback when exposure data changes
 * @param {object} cameraRef - React ref to Camera component
 * @param {number} filmIso - Target film ISO for EV calculation
 * @param {object} spotPoint - Shared value {x, y} for spot metering (normalized 0-1), null for average metering
 * @returns {object} - { frameProcessor, exposureData, currentEV, triggerMeasurement, spotPointRef }
 */
export function useExposureMonitor(onExposureUpdate, cameraRef, filmIso = 100, spotPoint = null) {
  // JS state
  const [exposureData, setExposureData] = useState<any>(null);
  const [exifEV, setExifEV] = useState<any>(null);
  const measurementInProgress = useRef(false);
  
  // EV calibration state: stores baseline brightness when EXIF was captured
  const calibrationRef = useRef({
    baselineEV: null,        // Last EXIF-derived EV
    baselineBrightness: null, // Brightness when EXIF was captured
    lastUpdate: 0            // Timestamp of last calibration
  });
  
  // Internal spot point shared value (used if external not provided)
  const internalSpotPoint = useSharedValue(null);
  const spotPointRef = spotPoint || internalSpotPoint;
  
  // Keep callback ref updated
  const callbackRef = useRef(onExposureUpdate);
  useEffect(() => {
    callbackRef.current = onExposureUpdate;
  }, [onExposureUpdate]);
  
  // Store last frame brightness data for spot metering calculations
  const lastFrameDataRef = useRef({
    avgBrightness: 128,
    spotBrightness: null,
    spotPoint: null
  });

  // Trigger measurement with optional spot point
  // Always uses flash: 'off' for measurement, then algorithm will calculate flash exposure separately
  // If spotPoint is provided, will calculate EV adjustment based on spot vs average brightness
  // options: { spotPoint }
  const triggerMeasurement = useCallback(async (options: any = {}) => {
    if (!cameraRef?.current || measurementInProgress.current) {
      return null;
    }
    
    const { spotPoint = null } = options;
    
    measurementInProgress.current = true;
    
    try {
      // Always measure with flash OFF - we calculate flash exposure from ambient light
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: false,
        qualityPrioritization: 'speed',
      });
      
      const fileUri = photo?.path?.startsWith('file://') ? photo.path : `file://${photo?.path}`;
      
      let exifData = null;
      
      // On Android, read EXIF directly from temp file (no media library needed)
      if (Platform.OS === 'android' && photo?.path) {
        try {
          // Read file as base64
          const base64 = await FileSystem.readAsStringAsync(fileUri, {
            encoding: 'base64',
          });
          
          // Parse EXIF from base64 data
          exifData = parseExifFromBase64(base64);
        } catch (readErr) {
          __DEV__ && console.warn('[ExposureMonitor] File read error:', readErr.message);
        }
        
        // Delete the temp file silently
        try {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch (fsErr) {
          // Ignore file deletion errors
        }
      } else if (photo?.metadata) {
        // iOS returns metadata directly
        exifData = photo.metadata['{Exif}'] || photo.metadata;
      }
      
      // Extract exposure values from EXIF
      // ISOSpeedRatings can be a number or an array depending on device
      let iso = exifData?.ISOSpeedRatings;
      if (Array.isArray(iso)) {
        iso = iso[0];
      }
      if (!iso) {
        iso = exifData?.ISO || exifData?.ISOSpeedRating;
      }
      
      const exposureTime = exifData?.ExposureTime;
      const aperture = exifData?.FNumber || exifData?.ApertureValue || 1.8;
      
      if (iso && exposureTime) {
        // Calculate Scene EV (EV100) from EXIF
        // Scene EV is the "absolute brightness" of the scene, independent of film ISO
        // EV100 = log2(f² / t) - log2(ISO_camera / 100)
        // This normalizes the camera's exposure to what it would be at ISO 100
        const sceneEV = Math.log2((aperture * aperture) / exposureTime) - Math.log2(iso / 100);
        
        // NOTE: We return Scene EV (EV100) here, NOT adjusted for film ISO
        // The film ISO adjustment is done in ExposureCalculations.js
        let targetEV = sceneEV;
        
        // SPOT METERING ADJUSTMENT
        // If we have spot point and brightness data, adjust EV based on spot vs average brightness
        if (spotPoint && lastFrameDataRef.current.spotBrightness !== null) {
          const avgBrightness = lastFrameDataRef.current.avgBrightness || 128;
          const spotBrightness = lastFrameDataRef.current.spotBrightness;
          
          // Every doubling of brightness = 1 EV difference
          // If spot is brighter than average, scene is brighter at that point, so EV should be higher
          // If spot is darker than average, scene is darker at that point, so EV should be lower
          if (spotBrightness > 0 && avgBrightness > 0) {
            const brightnessRatio = spotBrightness / avgBrightness;
            const evAdjustment = Math.log2(brightnessRatio);
            targetEV = targetEV + evAdjustment;
            
            console.log('[ExposureMonitor] SPOT adjustment:', {
              avgBrightness: avgBrightness.toFixed(0),
              spotBrightness: spotBrightness.toFixed(0),
              ratio: brightnessRatio.toFixed(2),
              evAdjust: evAdjustment.toFixed(1),
              sceneEV: targetEV.toFixed(1)
            });
          }
        } else {
          console.log('[ExposureMonitor] Scene EV:', targetEV.toFixed(1), '(camera ISO:', iso, 'shutter:', exposureTime, 'f/', aperture, ')');
        }
        
        setExifEV(targetEV);
        
        // Update calibration baseline for interpolation between EXIF samples
        const currentBrightness = exposureData?.brightness ?? 128;
        calibrationRef.current = {
          baselineEV: targetEV,
          baselineBrightness: currentBrightness,
          lastUpdate: Date.now()
        };
        
        // Update exposure data with accurate EV
        const data = {
          frameNumber: Date.now(),
          brightness: currentBrightness,
          ev: targetEV,
          fpActive: true,
          iso,
          shutterSpeed: exposureTime,
          aperture,
          source: spotPoint ? 'spot' : 'exif'
        };
        
        setExposureData(data);
        
        if (callbackRef.current) {
          callbackRef.current(data);
        }
        
        return targetEV;
      }
    } catch (e) {
      __DEV__ && console.log('[ExposureMonitor] EXIF measurement failed:', e.message);
    } finally {
      measurementInProgress.current = false;
    }
    
    return null;
  }, [cameraRef, filmIso, exposureData?.brightness]);

  // REMOVED: Auto-polling. Now triggerMeasurement is only called manually by the UI.
  // Camera readiness is checked when triggerMeasurement is called.

  // JS function to receive brightness data from worklet
  // Receives both average and spot brightness for proper spot metering calculation
  const onFrameAnalyzed = useCallback((frameNumber, avgBrightness, spotBrightness, spotPoint, approxEV) => {
    // Store brightness data for spot metering calculations
    lastFrameDataRef.current = {
      avgBrightness,
      spotBrightness,
      spotPoint
    };
    
    // Use spot brightness for display if spot metering is active
    const displayBrightness = spotBrightness !== null ? spotBrightness : avgBrightness;
    const isSpotMeasurement = spotBrightness !== null;
    
    // Only update brightness for visual feedback - don't change measured EV
    setExposureData(prev => ({
      ...prev,
      brightness: displayBrightness,
      avgBrightness,
      spotBrightness,
      frameNumber,
      fpActive: true,
      isSpot: isSpotMeasurement
    }));
    
    if (callbackRef.current) {
      const data = {
        frameNumber,
        brightness: displayBrightness,
        avgBrightness,
        spotBrightness,
        ev: exposureData?.ev ?? approxEV,
        fpActive: true,
        iso: exposureData?.iso ?? null,
        shutterSpeed: exposureData?.shutterSpeed ?? null,
        aperture: exposureData?.aperture ?? 1.8,
        source: exposureData?.source ?? 'preview',
        isSpot: isSpotMeasurement
      };
      callbackRef.current(data);
    }
  }, [exposureData?.ev, exposureData?.iso, exposureData?.shutterSpeed, exposureData?.aperture, exposureData?.source]);
  
  // Create worklet-callable version of our JS function
  const onFrameAnalyzedWorklet = Worklets.createRunOnJS(onFrameAnalyzed);

  // The Frame Processor - calculates both average and spot brightness
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    
    runAtTargetFps(FRAME_PROCESSOR_FPS, () => {
      'worklet';
      
      try {
        const buffer = frame.toArrayBuffer();
        
        if (buffer && buffer.byteLength > 0) {
          // Always calculate average brightness
          const avgBrightness = calculateAverageBrightness(buffer, frame.width, frame.height);
          
          // Calculate spot brightness if spot point is set
          let spotBrightness = null;
          let spotPoint = null;
          const spot = spotPointRef.value;
          if (spot && typeof spot.x === 'number' && typeof spot.y === 'number') {
            spotBrightness = calculateRegionBrightness(
              buffer, 
              frame.width, 
              frame.height, 
              spot.x, 
              spot.y, 
              SPOT_METERING_RADIUS
            );
            spotPoint = { x: spot.x, y: spot.y };
          }
          
          const approxEV = brightnessToEV(spotBrightness ?? avgBrightness);
          
          // Call JS function with both brightness values
          onFrameAnalyzedWorklet(
            Date.now(), 
            Math.round(avgBrightness),
            spotBrightness !== null ? Math.round(spotBrightness) : null,
            spotPoint,
            Math.round(approxEV * 10) / 10
          );
        }
      } catch (e) {
        // Silently ignore frame processing errors
      }
    });
  }, [onFrameAnalyzedWorklet, spotPointRef]);

  return {
    frameProcessor,
    exposureData,
    currentEV: exposureData?.ev ?? null,
    triggerMeasurement,
    spotPointRef,  // Expose so ShotModeModal can update it
    setSpotPoint: (point) => { spotPointRef.value = point; }  // Convenience setter
  };
}

/**
 * Format exposure parameters for display
 */
export function formatExposureParams(params) {
  if (!params) return null;

  const { iso, shutterSpeed, aperture, ev, brightness } = params;

  let shutterDisplay = '--';
  if (shutterSpeed && shutterSpeed < 1) {
    const denominator = Math.round(1 / shutterSpeed);
    shutterDisplay = `1/${denominator}`;
  } else if (shutterSpeed) {
    shutterDisplay = `${shutterSpeed.toFixed(1)}s`;
  }

  return {
    iso: iso ? `ISO ${Math.round(iso)}` : 'ISO --',
    shutter: shutterDisplay,
    aperture: aperture ? `f/${aperture.toFixed(1)}` : 'f/--',
    ev: ev !== null && ev !== undefined ? `EV ${ev.toFixed(1)}` : 'EV --',
    brightness: brightness !== undefined ? `Lum ${brightness.toFixed(0)}` : ''
  };
}
