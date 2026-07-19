import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from 'react-native-paper';
import * as LucideIcons from 'lucide-react-native';

const toPascalCase = (s: string): string =>
  s
    .split(/[-_]/)
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : ''))
    .join('');

const MATERIAL_FALLBACK_MAP: Record<string, string> = {
  'bot': 'robot',
};

const LUCIDE_ICON_MAP: Record<string, string> = {
  'home': 'Home',
  'map': 'Map',
  'map-pin': 'MapPin',
  'globe': 'Globe',
  'grid': 'LayoutGrid',
  'layoutgrid': 'LayoutGrid',
  'menu': 'Menu',
  'settings': 'Settings',
  'search': 'Search',
  'filter': 'Filter',
  'list': 'List',
  'listordered': 'ListOrdered',
  'maximize': 'Maximize',
  'maximize2': 'Maximize2',
  'gauge': 'Gauge',
  'x': 'X',
  'chevron-left': 'ChevronLeft',
  'chevron-right': 'ChevronRight',
  'chevron-down': 'ChevronDown',
  'chevron-up': 'ChevronUp',
  'inbox': 'Inbox',
  'bar-chart': 'BarChart3',
  'bar-chart-2': 'BarChart2',
  'bar-chart-3': 'BarChart3',
  'barchart': 'BarChart3',
  'barchart2': 'BarChart2',
  'barchart3': 'BarChart3',
  'refresh-cw': 'RefreshCw',
  'refreshcw': 'RefreshCw',

  'camera': 'Camera',
  'camera-off': 'CameraOff',
  'aperture': 'Aperture',
  'image': 'Image',
  'images': 'Images',
  'film': 'Film',
  'focus': 'Focus',
  'flash': 'Zap',
  'flash-off': 'ZapOff',

  'heart': 'Heart',
  'heart-filled': 'Heart',
  'star': 'Star',
  'bookmark': 'Bookmark',
  'share': 'Share2',
  'download': 'Download',
  'upload': 'Upload',
  'edit': 'Edit3',
  'trash': 'Trash2',
  'trash-2': 'Trash2',
  'plus': 'Plus',
  'minus': 'Minus',
  'check': 'Check',
  'refresh': 'RefreshCw',

  'package': 'Package',
  'box': 'Box',
  'tag': 'Tag',
  'tags': 'Tags',
  'calendar': 'Calendar',
  'clock': 'Clock',
  'folder': 'Folder',
  'file': 'File',

  'chart': 'BarChart3',
  'pie-chart': 'PieChart',
  'trending-up': 'TrendingUp',
  'activity': 'Activity',
  'contrast': 'Contrast',
  'palette': 'Palette',
  'file-text': 'FileText',
  'filetext': 'FileText',

  'info': 'Info',
  'alert': 'AlertCircle',
  'warning': 'AlertTriangle',
  'error': 'XCircle',
  'success': 'CheckCircle',

  'document': 'FileText',

  'sun': 'Sun',
  'moon': 'Moon',
  'eye': 'Eye',
  'eye-off': 'EyeOff',
  'lock': 'Lock',
  'unlock': 'Unlock',
  'link': 'Link',
  'external': 'ExternalLink',
  'copy': 'Copy',
  'layers': 'Layers',
};

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  variant?: 'lucide' | 'material';
  style?: StyleProp<ViewStyle>;
  [key: string]: any;
}

export default function Icon({
  name,
  size = 24,
  color,
  variant = 'lucide',
  style,
  ...props
}: IconProps) {
  const theme = useTheme();
  const resolvedColor = color ?? theme.colors.onSurface;

  if (variant === 'material') {
    return (
      <MaterialCommunityIcons
        name={name as any}
        size={size}
        color={resolvedColor}
        style={style}
        {...props}
      />
    );
  }

  const lucideIconName = LUCIDE_ICON_MAP[name.toLowerCase()] || toPascalCase(name);
  const LucideIcon = (LucideIcons as any)[lucideIconName] as React.ComponentType<any> | undefined;

  if (LucideIcon) {
    return (
      <LucideIcon
        size={size}
        color={resolvedColor}
        style={style}
        strokeWidth={2}
        {...props}
      />
    );
  }

  const materialName = MATERIAL_FALLBACK_MAP[name.toLowerCase()] || name;
  if (materialName in MaterialCommunityIcons.glyphMap) {
    return (
      <MaterialCommunityIcons
        name={materialName as any}
        size={size}
        color={resolvedColor}
        style={style}
        {...props}
      />
    );
  }

  console.warn(`[Icon] "${name}" not found in Lucide or Material, using placeholder`);
  return (
    <MaterialCommunityIcons
      name="help-circle-outline"
      size={size}
      color={resolvedColor}
      style={style}
      {...props}
    />
  );
}

export function getIconComponent(name: string, variant: 'lucide' | 'material' = 'lucide') {
  return ({ size, color }: { size?: number; color?: string }) => (
    <Icon name={name} size={size} color={color} variant={variant} />
  );
}
