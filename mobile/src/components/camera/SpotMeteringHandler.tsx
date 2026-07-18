/**
 * SpotMeteringHandler
 * Handles spot metering (tap to focus/meter) for Vision Camera
 */

import { Platform } from 'react-native';

/**
 * Focus and meter at a specific point
 * @param {object} cameraRef - Vision Camera ref
 * @param {object} point - {x, y} normalized coordinates (0-1)
 * @returns {Promise<boolean>} - Success status
 */
export async function focusAndMeter(cameraRef, point) {
  if (!cameraRef.current || !point) {
    return false;
  }

  try {
    // Vision Camera supports native focus
    await cameraRef.current.focus(point);
    return true;
  } catch (error) {
    console.error('Focus error:', error);
    return false;
  }
}

/**
 * Set exposure compensation
 * @param {object} cameraRef - Vision Camera ref
 * @param {number} ev - Exposure compensation in EV
 * @returns {Promise<boolean>} - Success status
 */
export async function setExposureCompensation(cameraRef, ev) {
  if (!cameraRef.current) {
    return false;
  }

  try {
    // Set exposure compensation (if supported)
    if (Platform.OS === 'android') {
      // Android supports exposure compensation
      await cameraRef.current.setExposureCompensation(ev);
    }
    return true;
  } catch (error) {
    console.error('Exposure compensation error:', error);
    return false;
  }
}

/**
 * Calculate tap coordinates relative to camera view
 * @param {object} event - Touch event
 * @param {number} viewWidth - Camera view width
 * @param {number} viewHeight - Camera view height
 * @returns {object} - Normalized point {x, y}
 */
export function getTapCoordinates(event, viewWidth, viewHeight) {
  const { locationX, locationY } = event.nativeEvent;
  
  return {
    x: locationX / viewWidth,
    y: locationY / viewHeight
  };
}

/**
 * Validate if spot metering is supported
 * @param {object} device - Camera device
 * @returns {boolean} - Support status
 */
export function isSpotMeteringSupported(device) {
  if (!device) return false;
  
  // Vision Camera devices typically support focus, which implies spot metering
  return device.supportsFocus !== false;
}
