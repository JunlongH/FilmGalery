import React from 'react';
import { Pressable, Text, ActivityIndicator, StyleSheet, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { colors, radius } from '../../theme';
import Icon from './Icon';

interface VariantStyle {
  bg: string;
  text: string;
  pressed?: string;
  border?: string;
}

const VARIANTS: Record<string, VariantStyle> = {
  primary: { bg: colors.primary, text: '#fff', pressed: '#00696E' },
  secondary: { bg: colors.secondary, text: '#fff', pressed: '#2E5A54' },
  outline: { bg: 'transparent', text: colors.primary, border: colors.primary, pressed: colors.primaryContainer },
  ghost: { bg: 'transparent', text: colors.primary, pressed: 'rgba(0, 151, 167, 0.12)' },
  danger: { bg: colors.error, text: '#fff', pressed: '#8B0015' },
};

interface SizeStyle {
  paddingHorizontal: number;
  paddingVertical: number;
  fontSize: number;
  iconSize: number;
  borderRadius: number;
}

const SIZES: Record<string, SizeStyle> = {
  sm: { paddingHorizontal: 12, paddingVertical: 6, fontSize: 13, iconSize: 16, borderRadius: radius.sm },
  md: { paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, iconSize: 18, borderRadius: radius.md },
  lg: { paddingHorizontal: 24, paddingVertical: 14, fontSize: 16, iconSize: 20, borderRadius: radius.lg },
};

export interface ButtonProps {
  children?: React.ReactNode;
  variant?: string;
  size?: string;
  icon?: string;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  [key: string]: any;
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  fullWidth = false,
  onPress,
  style,
  textStyle,
  ...props
}: ButtonProps) {
  const variantStyles = VARIANTS[variant] || VARIANTS.primary;
  const sizeStyles = SIZES[size] || SIZES.md;

  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed && !isDisabled ? variantStyles.pressed : variantStyles.bg,
          paddingHorizontal: sizeStyles.paddingHorizontal,
          paddingVertical: sizeStyles.paddingVertical,
          borderRadius: sizeStyles.borderRadius,
        },
        variantStyles.border && {
          borderWidth: 1.5,
          borderColor: variantStyles.border,
        },
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
      disabled={isDisabled}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variantStyles.text} />
      ) : (
        <>
          {icon && iconPosition === 'left' && (
            <Icon name={icon} size={sizeStyles.iconSize} color={variantStyles.text} style={styles.iconLeft} />
          )}
          {typeof children === 'string' ? (
            <Text style={[styles.text, { color: variantStyles.text, fontSize: sizeStyles.fontSize }, textStyle]}>
              {children}
            </Text>
          ) : (
            children
          )}
          {icon && iconPosition === 'right' && (
            <Icon name={icon} size={sizeStyles.iconSize} color={variantStyles.text} style={styles.iconRight} />
          )}
        </>
      )}
    </Pressable>
  );
}

export interface IconButtonProps {
  icon: string;
  size?: string;
  variant?: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  [key: string]: any;
}

export function IconButton({
  icon,
  size = 'md',
  variant = 'ghost',
  onPress,
  disabled = false,
  style,
  ...props
}: IconButtonProps) {
  const variantStyles = VARIANTS[variant] || VARIANTS.ghost;
  const sizeStyles = SIZES[size] || SIZES.md;

  const buttonSize = sizeStyles.iconSize + sizeStyles.paddingVertical * 2;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: buttonSize,
          height: buttonSize,
          borderRadius: buttonSize / 2,
          backgroundColor: pressed && !disabled ? variantStyles.pressed : variantStyles.bg,
        },
        variantStyles.border && {
          borderWidth: 1,
          borderColor: variantStyles.border,
        },
        disabled && styles.disabled,
        style,
      ]}
      disabled={disabled}
      {...props}
    >
      <Icon name={icon} size={sizeStyles.iconSize} color={variantStyles.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '600' as const },
  iconLeft: { marginRight: 6 },
  iconRight: { marginLeft: 6 },
  fullWidth: { width: '100%' },
  disabled: { opacity: 0.5 },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
});
