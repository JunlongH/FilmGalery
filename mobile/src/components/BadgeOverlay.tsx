import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export interface BadgeOverlayProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap | string;
  text?: string;
  color?: string;
  textColor?: string;
}

export default function BadgeOverlay({
  children,
  style,
  icon,
  text,
  color = 'rgba(0,0,0,0.45)',
  textColor = '#fff',
}: BadgeOverlayProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={[styles.badge, { backgroundColor: color }]}>
        {icon ? <MaterialCommunityIcons name={icon as any} size={14} color={textColor} /> : <Text style={[styles.text, { color: textColor }]}>{text}</Text>}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 12,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 12, fontWeight: '600' as const },
});
