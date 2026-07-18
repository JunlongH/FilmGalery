/**
 * Header Buttons
 * 
 * Reusable header button components for navigation.
 * Includes settings button and quick meter button.
 */

import React, { useState, useCallback } from 'react';
import { TouchableOpacity, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from 'react-native-paper';
import { Icon } from '../ui';
import { QuickMeterSheet } from '../metering';
import AIChatSheet from '../AIChatSheet';

/**
 * Settings button for navigation header
 */
export function SettingsButton() {
  const navigation = useNavigation();
  const theme = useTheme();
  
  return (
    <TouchableOpacity
      onPress={() => navigation.navigate('Settings')}
      style={styles.headerButton}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Icon name="settings" size={22} color={theme.colors.onSurface} />
    </TouchableOpacity>
  );
}

/**
 * Quick Meter button for navigation header
 * Opens bottom sheet to select loaded film
 */
export function QuickMeterButton() {
  const theme = useTheme();
  const [showSheet, setShowSheet] = useState(false);
  
  const openSheet = useCallback(() => setShowSheet(true), []);
  const closeSheet = useCallback(() => setShowSheet(false), []);
  
  return (
    <>
      <TouchableOpacity
        onPress={openSheet}
        style={styles.headerButton}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <View style={[styles.meterIcon, { backgroundColor: theme.colors.primaryContainer }]}>
          <Icon name="gauge" size={18} color={theme.colors.primary} />
        </View>
      </TouchableOpacity>
      
      <QuickMeterSheet visible={showSheet} onClose={closeSheet} />
    </>
  );
}

/**
 * AI Chat button for navigation header
 * Opens bottom sheet with AI assistant
 */
export function AIChatButton() {
  const theme = useTheme();
  const [showSheet, setShowSheet] = useState(false);

  const openSheet = useCallback(() => setShowSheet(true), []);
  const closeSheet = useCallback(() => setShowSheet(false), []);

  return (
    <>
      <TouchableOpacity
        onPress={openSheet}
        style={styles.headerButton}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <View style={[styles.meterIcon, { backgroundColor: theme.colors.secondaryContainer }]}>
          <Icon name="bot" size={18} color={theme.colors.secondary} />
        </View>
      </TouchableOpacity>

      <AIChatSheet context={null} visible={showSheet} onClose={closeSheet} />
    </>
  );
}

/**
 * Header right component combining multiple buttons
 */
export function HeaderRight({ showQuickMeter = false, showSettings = true, showAI = false }) {
  return (
    <View style={styles.headerRight}>
      {showAI && <AIChatButton />}
      {showQuickMeter && <QuickMeterButton />}
      {showSettings && <SettingsButton />}
    </View>
  );
}

const styles = StyleSheet.create({
  headerButton: {
    padding: 8,
    marginHorizontal: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  meterIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
