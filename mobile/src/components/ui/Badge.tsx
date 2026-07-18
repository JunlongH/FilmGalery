import React from 'react';
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import Icon from './Icon';

interface BadgeVariantStyle {
  bg: string;
  text: string;
  border?: string;
}

const VARIANTS: Record<string, BadgeVariantStyle> = {
  default: { bg: colors.primaryContainer, text: colors.primary },
  primary: { bg: colors.primary, text: '#fff' },
  secondary: { bg: colors.secondaryContainer, text: colors.secondary },
  success: { bg: '#E8F5E9', text: colors.success },
  warning: { bg: '#FFF3E0', text: '#E65100' },
  error: { bg: '#FFEBEE', text: colors.error },
  outline: { bg: 'transparent', text: colors.primary, border: colors.outline },
};

interface BadgeSizeStyle {
  paddingHorizontal: number;
  paddingVertical: number;
  fontSize: number;
  iconSize: number;
}

const SIZES: Record<string, BadgeSizeStyle> = {
  sm: { paddingHorizontal: 8, paddingVertical: 2, fontSize: 11, iconSize: 12 },
  md: { paddingHorizontal: 12, paddingVertical: 4, fontSize: 13, iconSize: 14 },
  lg: { paddingHorizontal: 16, paddingVertical: 6, fontSize: 14, iconSize: 16 },
};

export interface BadgeProps {
  children?: React.ReactNode;
  variant?: string;
  size?: string;
  icon?: string;
  iconPosition?: 'left' | 'right';
  onPress?: () => void;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  [key: string]: any;
}

export default function Badge({
  children,
  variant = 'default',
  size = 'md',
  icon,
  iconPosition = 'left',
  onPress,
  selected = false,
  style,
  textStyle,
  ...props
}: BadgeProps) {
  const variantStyles = VARIANTS[variant] || VARIANTS.default;
  const sizeStyles = SIZES[size] || SIZES.md;

  const containerStyles = [
    styles.badge,
    {
      backgroundColor: selected ? colors.primary : variantStyles.bg,
      paddingHorizontal: sizeStyles.paddingHorizontal,
      paddingVertical: sizeStyles.paddingVertical,
    },
    variantStyles.border && { borderWidth: 1, borderColor: variantStyles.border },
    style,
  ];

  const textStyles = [
    styles.text,
    {
      color: selected ? '#fff' : variantStyles.text,
      fontSize: sizeStyles.fontSize,
    },
    textStyle,
  ];

  const iconColor = selected ? '#fff' : variantStyles.text;

  const content = (
    <>
      {icon && iconPosition === 'left' && (
        <Icon name={icon} size={sizeStyles.iconSize} color={iconColor} style={styles.iconLeft} />
      )}
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text style={textStyles as any}>{children}</Text>
      ) : (
        children
      )}
      {icon && iconPosition === 'right' && (
        <Icon name={icon} size={sizeStyles.iconSize} color={iconColor} style={styles.iconRight} />
      )}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [...containerStyles as any, pressed && styles.pressed]}
        {...props}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={containerStyles as any} {...props}>
      {content}
    </View>
  );
}

export interface BadgeGroupProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  [key: string]: any;
}

export function BadgeGroup({ children, style, ...props }: BadgeGroupProps) {
  return (
    <View style={[styles.group, style]} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.lg, alignSelf: 'flex-start' },
  text: { fontWeight: '600' as const },
  iconLeft: { marginRight: 4 },
  iconRight: { marginLeft: 4 },
  pressed: { opacity: 0.8 },
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
