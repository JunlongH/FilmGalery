/**
 * ShotModeModal - Professional Light Meter
 * Powered by react-native-vision-camera
 * Real-time exposure monitoring with Frame Processor support
 * 
 * VERSION: 2026-01-13-v10-LOCATION-DEBUG
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  View, StyleSheet, Modal, TouchableOpacity, Alert, Platform, 
  FlatList, TouchableWithoutFeedback, useWindowDimensions, ScrollView
} from 'react-native';
import { Text, Button, ActivityIndicator, Surface } from 'react-native-paper';
import Slider from '@react-native-community/slider';
import { 
  Camera, useCameraDevice, useCameraFormat, useCameraPermission 
} from 'react-native-vision-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './ui';

// Native location service (bypasses Expo for HyperOS compatibility)
import _locationSvc from '../services/locationService.native';
const locationService: any = _locationSvc;

// Import our custom utilities
import { 
  APERTURES, SHUTTERS, 
  calculateEV,
  getBestFormat 
} from './camera/cameraUtils';
import { useExposureMonitor } from './camera/ExposureMonitor';
import { calculateExposure, formatExposureForDisplay } from './camera/ExposureCalculations';
import { getTapCoordinates } from './camera/SpotMeteringHandler';

// Picker Modal Component
const PickerModal = ({ visible, onClose, data, onSelect, title }: any) => {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <Surface style={styles.pickerContainer} elevation={5}>
              <Text style={styles.pickerTitle}>{title}</Text>
              <FlatList
                data={data}
                keyExtractor={(item) => String(item)}
                renderItem={({ item }) => (
                  <TouchableOpacity 
                    style={styles.pickerItem} 
                    onPress={() => {
                      onSelect(item);
                      onClose();
                    }}
                  >
                    <Text style={styles.pickerItemText}>{item}</Text>
                  </TouchableOpacity>
                )}
                style={{ maxHeight: 300 }}
              />
            </Surface>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

export default function ShotModeModal({ visible, onClose, onUse, filmIso = 400, forcePsMode = false, forcedMaxAperture = null, preloadedLocation = null }: any) {
  const { width, height } = useWindowDimensions();
  const cameraHeight = height * 0.55;
  const insets = useSafeAreaInsets();
  
  // Camera setup
  const cameraRef = useRef(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const formats = device?.formats || [];
  const format = getBestFormat(formats);
  const minZoom = device?.minZoom ?? 1;
  const maxZoom = device?.maxZoom ?? Math.max(4, minZoom + 3);
  
  // Camera state
  const [isActive, setIsActive] = useState(false);
  const [zoom, setZoom] = useState(minZoom);
  const [meteringMode, setMeteringMode] = useState('average');
  const [iso, setIso] = useState(filmIso || 400);

  useEffect(() => {
    setIso(filmIso || 400);
  }, [filmIso]);
  
  // Common focal lengths for snap-to feature (in mm)
  const SNAP_FOCAL_LENGTHS = [24, 28, 35, 50, 70, 85, 105, 135, 200];
  const SNAP_THRESHOLD = 0.08; // Snap when within 8% of slider range

  const ISO_STEPS = [25, 50, 64, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 12800];
  const bumpIso = (direction: any) => {
    if (!iso) return;
    const list = ISO_STEPS;
    const idx = list.findIndex(v => v >= iso);
    const currentIdx = idx === -1 ? list.length - 1 : (list[idx] === iso ? idx : Math.max(0, idx - 1));
    const nextIdx = Math.min(Math.max(0, currentIdx + direction), list.length - 1);
    setIso(list[nextIdx]);
  };
  
  // Convert focal length to zoom (base focal length is 24mm)
  const focalToZoom = (focal: any) => focal / 24;
  
  // Handle zoom with snap-to common focal lengths
  const handleZoomChange = (value: any) => {
    const focalLength = 24 * value;
    const range = maxZoom - minZoom;
    
    // Check if close to any common focal length
    for (const snapFocal of SNAP_FOCAL_LENGTHS) {
      const snapZoom = focalToZoom(snapFocal);
      // Only snap to values within our zoom range
      if (snapZoom >= minZoom && snapZoom <= maxZoom) {
        const distance = Math.abs(value - snapZoom);
        if (distance < range * SNAP_THRESHOLD) {
          setZoom(snapZoom);
          return;
        }
      }
    }
    setZoom(value);
  };
  const [focusPoint, setFocusPoint] = useState<any>(null);

  // Exposure modes
  const [selectedAperture, setSelectedAperture] = useState(5.6);
  const [selectedShutter, setSelectedShutter] = useState('1/125');
  
  // Location state
  const [location, setLocation] = useState<any>(null);
  const [locLoading, setLocLoading] = useState(true);

  // Measurement state
  const [measuring, setMeasuring] = useState(false);
  const [measuredEV, setMeasuredEV] = useState<any>(null);
  const [spotInfo, setSpotInfo] = useState<any>(null);
  
  // Real-time exposure monitoring
  const [liveExposure, setLiveExposure] = useState<any>(null);
  const [diagnosticInfo, setDiagnosticInfo] = useState({ frames: 0, fpRunning: false, brightness: 0, ev: 0 });
  
  // Camera mode state
  const [cameraMode, setCameraMode] = useState(forcePsMode ? 'ps' : 'av'); // av | tv | ps
  const [psFlashMode, setPsFlashMode] = useState('off');
  const [psMaxAperture, setPsMaxAperture] = useState(forcedMaxAperture || 2.8);

  // Picker state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerType, setPickerType] = useState<any>(null);

  // Frame Processor callback - receives brightness/EV data
  const handleExposureUpdate = useCallback((data: any) => {
    if (data?.fpActive) {
      setDiagnosticInfo(prev => ({
        ...prev,
        frames: data.frameNumber || prev.frames + 1,
        fpRunning: true,
        brightness: data.brightness || 0,
        ev: data.ev || 0
      }));
      setLiveExposure(data);
    }
  }, []);

  // Use Frame Processor + EXIF sampling for exposure monitoring
  // Pass cameraRef and filmIso for accurate EXIF-based EV calculation
  const { frameProcessor, exposureData, triggerMeasurement, setSpotPoint } = useExposureMonitor(
    handleExposureUpdate,
    cameraRef,
    iso
  );
  
  // Calculate exposure settings based on measured EV
  // Use the EV from liveExposure OR exposureData (which comes from EXIF or brightness analysis)
  // Priority: liveExposure (from callback) > exposureData (from hook state) > diagnosticInfo
  const measuredSceneEV = liveExposure?.ev ?? exposureData?.ev ?? diagnosticInfo.ev ?? null;
  
  // Debug: Log EV sources only when source changes (reduce log spam)
  const sourceRef = React.useRef(null);
  if (exposureData?.source !== sourceRef.current) {
    sourceRef.current = exposureData?.source;
    __DEV__ && console.log('[ShotModeModal] EV source changed to:', exposureData?.source, 'EV:', measuredSceneEV);
  }
  
  const calculatedExposure = React.useMemo(() => {
    if (measuredSceneEV === null || measuredSceneEV === undefined || measuredSceneEV === 0) {
      return { isValid: false };
    }
    
    const result: any = calculateExposure(
      measuredSceneEV,
      iso,
      cameraMode,
      cameraMode === 'av' ? selectedAperture : selectedShutter,
      cameraMode === 'ps' ? { maxAperture: psMaxAperture, flashMode: psFlashMode } : undefined
    );
    
    __DEV__ && console.log('[Exposure] Calculated:', result);
    return result;
  }, [measuredSceneEV, iso, cameraMode, selectedAperture, selectedShutter, psMaxAperture, psFlashMode]);

  // Auto-update UI based on calculator result (Av/Tv linkage)
  // Only update when no fixed measurement exists
  useEffect(() => {
    if (!calculatedExposure.isValid || measuredEV !== null) return;

    if (cameraMode === 'av') {
      setSelectedShutter(calculatedExposure.targetShutter);
    } else if (cameraMode === 'tv') {
      setSelectedAperture(calculatedExposure.targetAperture);
    }
  }, [calculatedExposure, cameraMode, measuredEV]);

  const activeEV = measuredEV ?? calculatedExposure.ev;

  // Diagnostic logging (reduced frequency - only log once on mount)
  const hasLoggedRef = React.useRef(false);
  if (!hasLoggedRef.current && visible) {
    hasLoggedRef.current = true;
    __DEV__ && console.log('[ShotModeModal] Version: 2025-12-11-v9-FAST-SPOT');
    __DEV__ && console.log('[ShotModeModal] Device:', device ? `${device.name} (${device.position})` : 'null');
  }

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      __DEV__ && console.log('[ShotModeModal] Modal opened - device:', !!device, 'hasPermission:', hasPermission);
      setIsActive(true);
      setMeasuredEV(null);
      setZoom(minZoom);
      setFocusPoint(null);
      setMeteringMode('average');
      setLiveExposure(null);
      setSelectedAperture(5.6);
      setSelectedShutter('1/125');
      setCameraMode(forcePsMode ? 'ps' : 'av');
      if (forcedMaxAperture) setPsMaxAperture(forcedMaxAperture);
      setDiagnosticInfo({ frames: 0, fpRunning: false, brightness: 0, ev: 0 });
      fetchLocation();
    } else {
      setIsActive(false);
      // Cleanup location subscription when modal closes
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }
    }
  }, [visible, minZoom, device, hasPermission]);

  // Reference to store location subscription for cleanup
  const locationSubscriptionRef = useRef(null);
  
  // Location status for UI feedback
  const [locationStatus, setLocationStatus] = useState('idle'); // 'idle' | 'loading' | 'optimizing' | 'done' | 'failed'
  
  // Diagnostic info for debugging (HyperOS/MIUI issues)
  const [locationDiagnostics, setLocationDiagnostics] = useState<any>(null);
  const [showDiagPanel, setShowDiagPanel] = useState(false);

  /**
   * Fetch location using locationService with full diagnostics
   * This provides visibility into exactly why location might fail on HyperOS
   */
  const fetchLocation = async () => {
    setLocLoading(true);
    setLocationStatus('loading');
    setLocationDiagnostics(null);
    
    try {
      // Step 0: Use preloaded location if available (fastest path)
      if (preloadedLocation && preloadedLocation.latitude && preloadedLocation.longitude) {
        __DEV__ && console.log('[Location] Using PRELOADED location from parent');
        setLocation(preloadedLocation);
        setLocationStatus('done');
        setLocLoading(false);
        return;
      }
      
      // Use new simplified locationService v2
      const result: any = await locationService.getLocation();
      
      __DEV__ && console.log('[Location] Result:', result);
      
      // Store diagnostics for display
      if (result.diagnostics) {
        setLocationDiagnostics(result.diagnostics);
      }
      
      // Check success
      if (result.success && result.coords) {
        // If geocode is available, use it directly
        if (result.geocode && (result.geocode.country || result.geocode.city)) {
          __DEV__ && console.log('[Location] Using geocode from service:', result.geocode);
          setLocation({
            country: result.geocode.country || '',
            city: result.geocode.city || '',
            detail: result.geocode.displayName || '',
            latitude: result.coords.latitude,
            longitude: result.coords.longitude,
            altitude: result.coords.altitude
          });
        } else {
          // Fallback: do our own reverse geocoding
          await updateLocationFromCoords(result.coords);
        }
        setLocationStatus('done');
      } else {
        // Failed - show guidance
        setLocation(null);
        setLocationStatus('failed');
        
        if (result.error) {
          locationService.showGuidance(result.error);
        }
      }
      
    } catch (e) {
      console.error('[Location] Unexpected error:', e);
      setLocation(null);
      setLocationStatus('failed');
    } finally {
      setLocLoading(false);
    }
  };
  
  // Start background optimization using watch
  const startBackgroundOptimization = async () => {
    try {
      const watchResult = await locationService.startWatch(
        async (coords: any, accuracy: any) => {
          __DEV__ && console.log(`[Location] Watch update: accuracy=${accuracy?.toFixed(0)}m`);
          await updateLocationFromCoords(coords);
          
          if (accuracy && accuracy < 50) {
            setLocationStatus('done');
            locationService.stopWatch();
          }
        },
        { accuracy: 'high', maxDuration: 12000 }
      );
      
      if (!watchResult.success) {
        __DEV__ && console.log('[Location] Watch failed to start:', watchResult.error);
        setLocationStatus('done');
      }
    } catch (e) {
      __DEV__ && console.log('[Location] Watch error:', e);
      setLocationStatus('done');
    }
  };

  // Stop the location watch subscription
  const stopLocationWatch = () => {
    locationService.stopWatch();
    setLocLoading(false);
  };

  // Helper to update location state from coordinates
  const updateLocationFromCoords = async (coords: any) => {
    try {
      // Use centralized reverse geocoding (supports Amap when configured)
      const geocode = await locationService.reverseGeocode(
        coords.latitude,
        coords.longitude
      );
      
      setLocation({
        country: geocode.country || '',
        city: geocode.city || '',
        detail: geocode.displayName || '',
        latitude: coords.latitude,
        longitude: coords.longitude,
        altitude: coords.altitude
      });
    } catch (e) {
      // If reverse geocoding fails, still save coordinates
      setLocation({
        country: '',
        city: '',
        detail: '',
        latitude: coords.latitude,
        longitude: coords.longitude,
        altitude: coords.altitude
      });
    }
  };

  // Retry location fetch (clears cache to get fresh location)
  const retryLocation = () => {
    setLocation(null);
    setLocationStatus('idle');
    setLocationDiagnostics(null);
    locationService.clearCache();  // Clear cache to force fresh location fetch
    fetchLocation();
  };
  
  // Open system location settings (for HyperOS troubleshooting)
  const openLocationSettings = () => {
    locationService.showLocationGuidance('general');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      locationService.stopWatch();
    };
  }, []);

  // When switching modes, unlock live flow
  useEffect(() => {
    setMeasuredEV(null);
  }, [cameraMode]);

  // Handle single-shot measurement (triggered by meter button)
  // This replaces the old lock/unlock toggle
  const handleMeasure = useCallback(async () => {
    if (!cameraRef.current) {
      Alert.alert('错误', '相机未就绪');
      return;
    }

    setMeasuring(true);
    
    try {
      // Use triggerMeasurement from ExposureMonitor for EXIF-based EV
      // Always measure with flash OFF, algorithm will calculate flash exposure
      const measuredEV = await triggerMeasurement();
      
      if (measuredEV !== null && measuredEV !== undefined) {
        setMeasuredEV(measuredEV);
        __DEV__ && console.log('[ShotModeModal] Measured EV:', measuredEV);
      } else {
        Alert.alert('测光失败', '无法获取曝光数据，请重试');
      }
    } catch (e) {
      __DEV__ && console.warn('Measure failed:', e);
      Alert.alert('测光失败', e.message || '未知错误');
    } finally {
      setMeasuring(false);
    }
  }, [triggerMeasurement]);

  // Handle tap to focus/meter (for spot metering mode)
  // Strategy: Set spot point for Frame Processor to calculate brightness at that location,
  // then use brightness ratio to adjust the EXIF-based EV
  const handleTapToFocus = useCallback(async (event: any) => {
    if (!cameraRef.current) return;
    
    // In average mode, just trigger standard measurement
    if (meteringMode !== 'spot') {
      handleMeasure();
      return;
    }
    
    const point = getTapCoordinates(event, width, cameraHeight);
    setFocusPoint(point);
    
    console.log('[ShotModeModal] Spot metering at:', point);
    
    // Visual feedback immediately
    setSpotInfo({ 
      active: true, 
      message: '点测光中...' 
    });
    setMeasuring(true);
    
    try {
      // Step 1: Set spot point for Frame Processor to calculate spot brightness
      if (setSpotPoint) {
        setSpotPoint({ x: point.x, y: point.y });
        console.log('[ShotModeModal] Spot point set for brightness calculation');
      }
      
      // Step 2: Try to apply focus at the point (for better camera response)
      try {
        await cameraRef.current.focus({ x: point.x, y: point.y });
      } catch (focusErr) {
        // Focus not supported - that's ok
      }
      
      // Step 3: Wait for Frame Processor to calculate brightness at spot point
      // Need ~200-300ms for a few frames to be processed
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Step 4: Take measurement with spot point - triggerMeasurement will use stored brightness
      // Always measure with flash OFF, algorithm will calculate flash exposure
      const spotEV = await triggerMeasurement({ spotPoint: { x: point.x, y: point.y } });
      
      if (spotEV !== null && spotEV !== undefined) {
        setMeasuredEV(spotEV);
        setSpotInfo({ 
          active: true, 
          message: `点测光完成 EV ${spotEV.toFixed(1)}` 
        });
        console.log('[ShotModeModal] Spot meter result:', spotEV.toFixed(1));
      } else {
        setSpotInfo({ 
          active: true, 
          message: '点测光失败' 
        });
      }
    } catch (e) {
      console.warn('Spot metering failed:', e);
      setSpotInfo({ 
        active: true, 
        message: '点测光失败' 
      });
    } finally {
      setMeasuring(false);
      // Clear spot point after measurement (return to average mode visualization)
      if (setSpotPoint) {
        setSpotPoint(null);
      }
      // Clear feedback after 1.5s
      setTimeout(() => setSpotInfo(null), 1500);
    }
  }, [meteringMode, width, cameraHeight, triggerMeasurement, handleMeasure, setSpotPoint]);

  // Handle manual value selection
  const handleManualSelect = useCallback((value: any) => {
    if (pickerType === 'max_aperture') {
      setPsMaxAperture(value);
      return;
    }

    if (pickerType === 'aperture') {
      setSelectedAperture(value);
    } else if (pickerType === 'shutter') {
      setSelectedShutter(value);
    }
  }, [pickerType]);

  // Permission handling
  if (!hasPermission) {
    return (
      <Modal visible={visible} animationType="slide">
        <View style={styles.container}>
          <Text style={{ color: 'white', textAlign: 'center', marginTop: 100 }}>
            Camera permission required
          </Text>
          <Button onPress={requestPermission}>Grant Permission</Button>
          <Button onPress={onClose}>Close</Button>
        </View>
      </Modal>
    );
  }

  if (!device) {
    return (
      <Modal visible={visible} animationType="slide">
        <View style={styles.container}>
          <Text style={{ color: 'white', textAlign: 'center', marginTop: 100 }}>
            No camera device found
          </Text>
          <Button onPress={onClose}>Close</Button>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        
        {/* Viewfinder Section */}
        <View style={[styles.cameraContainer, { height: cameraHeight }]}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={isActive && visible}
            photo={true}
            format={format}
            zoom={zoom}
            frameProcessor={frameProcessor}
            onInitialized={() => {
              __DEV__ && console.log('[Camera] ✅ Initialized successfully');
            }}
            onStarted={() => {
              __DEV__ && console.log('[Camera] ✅ Camera started (preview active)');
            }}
            onStopped={() => {
              __DEV__ && console.log('[Camera] Camera stopped');
            }}
            onError={(error) => {
              console.error('[Camera] ❌ Error:', error.code, error.message);
            }}
          />
          
          {/* Touch layer for spot metering */}
          <TouchableOpacity 
            style={StyleSheet.absoluteFill} 
            activeOpacity={1} 
            onPress={handleTapToFocus}
          >
            {/* Focus indicator */}
            {meteringMode === 'spot' && focusPoint && (
              <View style={[styles.focusBox, { 
                left: focusPoint.x * width - 30, 
                top: focusPoint.y * cameraHeight - 30,
              }]} />
            )}
            
            {/* Center reticle when no focus point */}
            {meteringMode === 'spot' && !focusPoint && (
              <View style={styles.centerReticle} />
            )}
          </TouchableOpacity>

          {/* Spot metering feedback */}
          {spotInfo && (
            <View style={styles.spotInfoToast}>
              <MaterialCommunityIcons 
                name="check-circle" 
                size={28} 
                color="#FFD700" 
              />
              <Text style={styles.spotInfoText}>
                {spotInfo.message}
              </Text>
            </View>
          )}

          {/* Live exposure indicator with diagnostics */}
          {!measuredEV && (
            <View style={styles.liveExposureIndicator}>
              <Text style={styles.waitingText}>
                FP Status: {frameProcessor ? 'Assigned' : 'NULL'}
              </Text>
              <Text style={styles.diagnosticText}>
                Check Metro console for [FP] logs
              </Text>
            </View>
          )}

          {/* Top bar */}
          <View style={[styles.topBar, { top: Math.max(20, insets.top + 10) }]}>
            <TouchableOpacity 
              onPress={onClose} 
              style={{ 
                backgroundColor: 'rgba(0,0,0,0.3)', 
                width: 44, 
                height: 44, 
                borderRadius: 22, 
                justifyContent: 'center', 
                alignItems: 'center' 
              }}
            >
              <Icon name="x" size={24} color="white" />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.locationBadge}
              onPress={() => setShowDiagPanel(!showDiagPanel)}
              onLongPress={openLocationSettings}
            >
              {locLoading && !location ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <ActivityIndicator size="small" color="white" />
                  <Text style={[styles.locationText, { fontSize: 11 }]}>定位中...</Text>
                </View>
              ) : location ? (
                <View style={{ alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={styles.locationText}>
                      {location.city || location.country || 'Unknown'}
                    </Text>
                    {locationStatus === 'optimizing' ? (
                      <ActivityIndicator size="small" color="#4ade80" style={{ marginLeft: 4 }} />
                    ) : (
                      <MaterialCommunityIcons 
                        name="refresh" 
                        size={14} 
                        color="rgba(255,255,255,0.7)" 
                        style={{ marginLeft: 4 }}
                        onPress={retryLocation} 
                      />
                    )}
                  </View>
                  {location.latitude && location.longitude && (
                    <Text style={[styles.locationText, { fontSize: 10, opacity: 0.8, marginTop: 2 }]}>
                      📍 {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                    </Text>
                  )}
                </View>
              ) : (
                <View style={{ alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.locationText, { color: '#f87171' }]}>
                      {locationDiagnostics?.errorCode 
                        ? `Error: ${locationDiagnostics.errorCode}` 
                        : 'Unknown'}
                    </Text>
                    <MaterialCommunityIcons name="refresh" size={16} color="#f87171" onPress={retryLocation} />
                  </View>
                  <Text style={[styles.locationText, { fontSize: 9, opacity: 0.7, marginTop: 2 }]}>
                    点击查看详情 | 长按设置
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            
            {/* Diagnostic Panel - shows when location fails and user taps */}
            {showDiagPanel && locationDiagnostics && (
              <View style={styles.diagPanel}>
                <Text style={styles.diagTitle}>📍 定位诊断</Text>
                <View style={styles.diagRow}>
                  <Text style={styles.diagLabel}>权限状态:</Text>
                  <Text style={[styles.diagValue, { color: locationDiagnostics.permissionStatus === 'granted' ? '#4ade80' : '#f87171' }]}>
                    {locationDiagnostics.permissionStatus || 'unknown'}
                  </Text>
                </View>
                <View style={styles.diagRow}>
                  <Text style={styles.diagLabel}>定位服务:</Text>
                  <Text style={[styles.diagValue, { color: locationDiagnostics.servicesEnabled ? '#4ade80' : '#f87171' }]}>
                    {locationDiagnostics.servicesEnabled ? '已开启' : '已关闭'}
                  </Text>
                </View>
                <View style={styles.diagRow}>
                  <Text style={styles.diagLabel}>GPS可用:</Text>
                  <Text style={[styles.diagValue, { color: locationDiagnostics.providerStatus?.gpsAvailable ? '#4ade80' : '#f87171' }]}>
                    {locationDiagnostics.providerStatus?.gpsAvailable ? '是' : '否'}
                  </Text>
                </View>
                <View style={styles.diagRow}>
                  <Text style={styles.diagLabel}>网络定位:</Text>
                  <Text style={[styles.diagValue, { color: locationDiagnostics.providerStatus?.networkAvailable ? '#4ade80' : '#f87171' }]}>
                    {locationDiagnostics.providerStatus?.networkAvailable ? '是' : '否'}
                  </Text>
                </View>
                <View style={styles.diagRow}>
                  <Text style={styles.diagLabel}>尝试次数:</Text>
                  <Text style={styles.diagValue}>
                    {locationDiagnostics.attemptCount || 0}
                  </Text>
                </View>
                {locationDiagnostics.cachedLocation && (
                  <View style={styles.diagRow}>
                    <Text style={styles.diagLabel}>缓存位置:</Text>
                    <Text style={styles.diagValue}>
                      {new Date(locationDiagnostics.cachedLocation.timestamp).toLocaleTimeString()}
                    </Text>
                  </View>
                )}
                {(locationDiagnostics.lastError || locationDiagnostics.lastErrorCode) && (
                  <View style={styles.diagRow}>
                    <Text style={styles.diagLabel}>错误信息:</Text>
                    <Text style={[styles.diagValue, { color: '#f87171', fontSize: 10 }]}>
                      {locationDiagnostics.lastErrorCode || locationDiagnostics.lastError || 'Unknown'}
                    </Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity 
                    style={styles.diagButton} 
                    onPress={retryLocation}
                  >
                    <Text style={styles.diagButtonText}>🔄 重试</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.diagButton} 
                    onPress={openLocationSettings}
                  >
                    <Text style={styles.diagButtonText}>⚙️ 系统设置</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.diagButton, { backgroundColor: '#333' }]} 
                    onPress={() => setShowDiagPanel(false)}
                  >
                    <Text style={styles.diagButtonText}>✕ 关闭</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Camera controls */}
          <View style={styles.cameraControls}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {/* Metering mode toggle */}
              <TouchableOpacity 
                style={styles.modeButton} 
                onPress={() => {
                  setMeteringMode(m => m === 'average' ? 'spot' : 'average');
                  setFocusPoint(null);
                  // Clear any existing measurement when switching modes
                  setMeasuredEV(null);
                }}
              >
                <MaterialCommunityIcons 
                  name={meteringMode === 'average' ? 'camera-metering-matrix' : 'camera-metering-spot'} 
                  size={24} 
                  color="white" 
                />
                <Text style={styles.modeText}>
                  {meteringMode === 'average' ? 'AVG' : 'SPOT'}
                </Text>
              </TouchableOpacity>

              {/* Camera mode cycle: Av -> Tv -> P&S (disabled when forcePsMode) */}
              <TouchableOpacity 
                style={[styles.modeButton, forcePsMode && { opacity: 0.5 }]} 
                onPress={() => {
                  if (forcePsMode) return; // PS camera - mode locked
                  const order = ['av', 'tv', 'ps'];
                  const next = order[(order.indexOf(cameraMode) + 1) % order.length];
                  setCameraMode(next);
                }}
                disabled={forcePsMode}
              >
                <MaterialCommunityIcons 
                  name={
                    cameraMode === 'av' ? 'alpha-a-circle' :
                    cameraMode === 'tv' ? 'alpha-t-circle' : 'camera-gopro'
                  } 
                  size={24} 
                  color="white" 
                />
                <Text style={styles.modeText}>
                  {forcePsMode ? 'P&S (固定)' : cameraMode === 'av' ? 'Av' : cameraMode === 'tv' ? 'Tv' : 'P&S'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Zoom control with snap-to common focal lengths */}
            <View style={styles.zoomControl}>
              <Text style={[styles.zoomText, SNAP_FOCAL_LENGTHS.includes(Math.round(24 * zoom)) && styles.zoomTextSnapped]}>
                {Math.round(24 * zoom)}mm
              </Text>
              <Slider
                style={{ width: 140, height: 40 }}
                minimumValue={minZoom}
                maximumValue={maxZoom}
                minimumTrackTintColor="#fff"
                maximumTrackTintColor="rgba(255,255,255,0.3)"
                thumbTintColor="#fff"
                value={zoom}
                onValueChange={handleZoomChange}
              />
            </View>
          </View>
        </View>

        {/* Control Deck Section */}
        <Surface style={[styles.controlDeck, { paddingBottom: Math.max(20, insets.bottom + 10) }]} elevation={4}>
          
          {measuredEV === null ? (
            /* Live State - show real-time EV and lock */
            <View style={styles.idleContainer}>
              <Text style={styles.instructionText}>
                {cameraMode === 'ps' ? 'Point & Shoot Mode' : 'Point camera at subject'}
              </Text>
              
              {cameraMode === 'ps' && (
                <View style={styles.psSettingsRow}>
                  <TouchableOpacity 
                    style={styles.psSettingBtn}
                    onPress={() => {
                      const modes = ['auto', 'on', 'off'];
                      const next = modes[(modes.indexOf(psFlashMode) + 1) % 3];
                      setPsFlashMode(next);
                    }}
                  >
                    <MaterialCommunityIcons 
                      name={
                        psFlashMode === 'auto' ? 'flash-auto' : 
                        psFlashMode === 'on' ? 'flash' : 'flash-off'
                      } 
                      size={20} 
                      color="white" 
                    />
                    <Text style={styles.psSettingText}>
                      Flash: {psFlashMode.toUpperCase()}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.psSettingBtn, forcedMaxAperture && { opacity: 0.5 }]}
                    onPress={() => {
                      if (forcedMaxAperture) return; // Fixed lens camera - aperture locked
                      setPickerType('max_aperture');
                      setPickerVisible(true);
                    }}
                    disabled={!!forcedMaxAperture}
                  >
                    <MaterialCommunityIcons name="camera-iris" size={20} color="white" />
                    <Text style={styles.psSettingText}>
                      Max f/{psMaxAperture}{forcedMaxAperture ? ' (固定)' : ''}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* ISO control */}
              <View style={styles.psSettingsRow}>
                <TouchableOpacity 
                  style={styles.psSettingBtn}
                  onPress={() => bumpIso(-1)}
                >
                  <MaterialCommunityIcons name="minus" size={20} color="white" />
                  <Text style={styles.psSettingText}>ISO -</Text>
                </TouchableOpacity>

                <View style={[styles.psSettingBtn, { justifyContent: 'center' }]}> 
                  <Text style={[styles.psSettingText, { fontWeight: 'bold' as const }]}>ISO {iso}</Text>
                </View>

                <TouchableOpacity 
                  style={styles.psSettingBtn}
                  onPress={() => bumpIso(1)}
                >
                  <MaterialCommunityIcons name="plus" size={20} color="white" />
                  <Text style={styles.psSettingText}>ISO +</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity 
                style={styles.measureButtonBig} 
                onPress={handleMeasure}
                disabled={measuring}
              >
                {measuring ? (
                  <ActivityIndicator size="large" color="black" />
                ) : (
                  <MaterialCommunityIcons name="camera-metering-spot" size={48} color="black" />
                )}
              </TouchableOpacity>
              
              <Text style={styles.isoLabel}>
                {diagnosticInfo.brightness > 0
                  ? `亮度: ${diagnosticInfo.brightness.toFixed(0)} · ISO ${iso}`
                  : diagnosticInfo.frames > 0
                    ? `准备中... (${diagnosticInfo.frames})`
                    : '启动相机...'}
              </Text>
              <Text style={styles.instructionSubText}>
                {meteringMode === 'spot' ? '点击画面进行点测光' : '点击测光按钮进行测光'}
              </Text>
            </View>
          ) : (
            /* Result State */
            <View style={styles.resultContainer}>
              
              {/* Info header */}
              <View style={styles.resultHeader}>
                <View style={styles.evBadge}>
                  <Text style={styles.evValue}>EV {measuredEV?.toFixed(1)}</Text>
                </View>
                <TouchableOpacity 
                  style={styles.remeasureButton}
                  onPress={handleMeasure}
                  disabled={measuring}
                >
                  {measuring ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <MaterialCommunityIcons name="camera-metering-spot" size={24} color="white" />
                  )}
                  <Text style={styles.remeasureText}>重新测光</Text>
                </TouchableOpacity>
                {/* 闪光灯设置按钮，仅在PS模式显示 */}
                {cameraMode === 'ps' && (
                  <TouchableOpacity 
                    style={[styles.remeasureButton, { marginLeft: 8 }]}
                    onPress={() => {
                      const modes = ['auto', 'on', 'off'];
                      const next = modes[(modes.indexOf(psFlashMode) + 1) % 3];
                      setPsFlashMode(next);
                    }}
                  >
                    <MaterialCommunityIcons 
                      name={
                        psFlashMode === 'auto' ? 'flash-auto' : 
                        psFlashMode === 'on' ? 'flash' : 'flash-off'
                      }
                      size={22}
                      color={psFlashMode === 'off' ? '#888' : '#FFD700'}
                    />
                    <Text style={styles.remeasureText}>闪光灯: {psFlashMode.toUpperCase()}</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Main values display */}
              <View style={styles.valuesDisplay}>
                <TouchableOpacity 
                  style={styles.valueBox}
                  disabled={cameraMode === 'ps' || cameraMode === 'tv'}
                  onPress={() => {
                    setPickerType('aperture');
                    setPickerVisible(true);
                  }}
                >
                  <Text style={styles.valueLabel}>Aperture</Text>
                  <Text style={styles.valueMain}>
                    f/{calculatedExposure.targetAperture}
                  </Text>
                  {cameraMode === 'av' && (
                    <MaterialCommunityIcons name="chevron-down" size={20} color="#666" />
                  )}
                </TouchableOpacity>
                
                <View style={styles.divider} />
                
                <TouchableOpacity 
                  style={styles.valueBox}
                  disabled={cameraMode === 'ps' || cameraMode === 'av'}
                  onPress={() => {
                    setPickerType('shutter');
                    setPickerVisible(true);
                  }}
                >
                  <Text style={styles.valueLabel}>Shutter</Text>
                  <Text style={styles.valueMain}>
                    {calculatedExposure.targetShutter}
                  </Text>
                  {cameraMode === 'tv' && (
                    <MaterialCommunityIcons name="chevron-down" size={20} color="#666" />
                  )}
                </TouchableOpacity>
              </View>

              {/* Info Text */}
              <View style={styles.psResultInfo}>
                <MaterialCommunityIcons 
                  name={cameraMode === 'av' ? 'alpha-a-circle-outline' : cameraMode === 'tv' ? 'alpha-t-circle-outline' : 'camera-gopro'} 
                  size={24} 
                  color="#FFD700" 
                />
                <View style={{ marginLeft: 10 }}>
                  <Text style={{ color: 'white', fontSize: 16 }}>
                    {cameraMode === 'av'
                      ? `Av: f/${selectedAperture} → ${calculatedExposure.targetShutter}`
                      : cameraMode === 'tv'
                        ? `Tv: ${selectedShutter} → f/${calculatedExposure.targetAperture}`
                        : `P&S: f/${calculatedExposure.targetAperture} - ${calculatedExposure.targetShutter}`}
                  </Text>
                  {cameraMode === 'ps' && calculatedExposure.useFlash && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <MaterialCommunityIcons 
                        name="flash" 
                        size={16} 
                        color="#FFD700" 
                      />
                      <Text style={{ color: '#FFD700', fontSize: 13, marginLeft: 4 }}>
                        建议使用闪光灯
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Use button */}
              <Button 
                mode="contained" 
                style={styles.useButton}
                contentStyle={{ height: 50 }}
                labelStyle={{ fontSize: 18, fontWeight: 'bold' as const }}
                textColor="#000"
                  onPress={() => onUse({ 
                    f: calculatedExposure.targetAperture,
                    s: calculatedExposure.targetShutter,
                    iso,
                    location,
                    focal_length: Math.round(24 * zoom)
                  })}
              >
                Use Settings
              </Button>

            </View>
          )}
        </Surface>

        {/* Picker Modal */}
        <PickerModal
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          title={
            pickerType === 'aperture' ? 'Select Aperture' : 
            pickerType === 'shutter' ? 'Select Shutter Speed' : 
            'Select Max Aperture'
          }
          data={pickerType === 'shutter' ? SHUTTERS : APERTURES}
          onSelect={handleManualSelect}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraContainer: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  topBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    zIndex: 10,
  },
  locationBadge: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  locationText: {
    color: 'white',
    fontWeight: '600' as const,
    fontSize: 13,
  },
  diagPanel: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 90 : 70,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.85)',
    padding: 12,
    borderRadius: 12,
    minWidth: 200,
    zIndex: 100,
  },
  diagTitle: {
    color: 'white',
    fontWeight: 'bold' as const,
    fontSize: 14,
    marginBottom: 8,
    textAlign: 'center',
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  diagLabel: {
    color: '#aaa',
    fontSize: 11,
  },
  diagValue: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600' as const,
    maxWidth: 120,
  },
  diagButton: {
    backgroundColor: '#4a5568',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    flex: 1,
  },
  diagButtonText: {
    color: 'white',
    fontSize: 10,
    textAlign: 'center',
  },
  cameraControls: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 8,
    borderRadius: 20,
    gap: 6,
  },
  modeText: {
    color: 'white',
    fontWeight: 'bold' as const,
    fontSize: 12,
  },
  zoomControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  zoomText: {
    color: 'white',
    fontSize: 12,
    marginRight: 5,
    width: 45,
    textAlign: 'right',
  },
  zoomTextSnapped: {
    color: '#FFD700',
    fontWeight: 'bold' as const,
  },
  focusBox: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderWidth: 3,
    borderColor: '#FFD700',
    borderRadius: 30,
  },
  centerReticle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -10,
    marginTop: -10,
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  spotInfoToast: {
    position: 'absolute',
    top: '50%',
    left: '10%',
    right: '10%',
    marginTop: -30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 16,
    zIndex: 999,
  },
  spotInfoText: {
    color: '#fff',
    fontWeight: 'bold' as const,
    fontSize: 16,
    marginTop: 8,
  },
  liveExposureIndicator: {
    position: 'absolute',
    top: 80,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    minWidth: 120,
  },
  liveEvText: {
    color: '#FFD700',
    fontWeight: 'bold' as const,
    fontSize: 16,
    textAlign: 'center',
  },
  waitingText: {
    color: '#FFA500',
    fontSize: 12,
    textAlign: 'center',
  },
  diagnosticText: {
    color: '#888',
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
  },
  controlDeck: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 20,
    justifyContent: 'center',
  },
  idleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  measureButtonBig: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },
  instructionText: {
    color: '#888',
    fontSize: 16,
  },
  instructionSubText: {
    color: '#555',
    fontSize: 12,
    marginTop: 5,
    textAlign: 'center',
  },
  isoLabel: {
    color: '#666',
    fontSize: 14,
    marginTop: 10,
  },
  psSettingsRow: {
    flexDirection: 'row',
    gap: 15,
    marginTop: 10,
  },
  psSettingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  psSettingText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600' as const,
  },
  psResultInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    backgroundColor: '#222',
    padding: 10,
    borderRadius: 10,
  },
  resultContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  evBadge: {
    backgroundColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  evValue: {
    color: '#FFD700',
    fontWeight: 'bold' as const,
    fontSize: 14,
  },
  remeasureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#444',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  remeasureText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600' as const,
  },
  valuesDisplay: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  valueBox: {
    alignItems: 'center',
    flex: 1,
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: '#333',
  },
  valueLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  valueMain: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
  },
  useButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerContainer: {
    width: '80%',
    backgroundColor: '#222',
    borderRadius: 16,
    padding: 20,
    maxHeight: '60%',
  },
  pickerTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold' as const,
    marginBottom: 15,
    textAlign: 'center',
  },
  pickerItem: {
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    alignItems: 'center',
  },
  pickerItemText: {
    color: 'white',
    fontSize: 18,
  },
});
