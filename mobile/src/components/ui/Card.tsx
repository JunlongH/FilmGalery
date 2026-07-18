import React from 'react';
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle, type ImageStyle, type TextStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing, radius } from '../../theme';

export interface CardProps {
  children?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  variant?: 'elevated' | 'outlined' | 'filled';
  className?: string;
  [key: string]: any;
}

export interface CardCoverProps {
  source: any;
  height?: number;
  showGradient?: boolean;
  gradientColors?: string[];
  style?: StyleProp<ImageStyle>;
  [key: string]: any;
}

export interface CardContentProps {
  children?: React.ReactNode;
  position?: 'bottom' | 'top' | 'center';
  style?: StyleProp<ViewStyle>;
  [key: string]: any;
}

export interface CardTextProps {
  children?: React.ReactNode;
  style?: StyleProp<TextStyle>;
  [key: string]: any;
}

type CardType = ((props: CardProps) => React.JSX.Element) & {
  Cover: (props: CardCoverProps) => React.JSX.Element;
  Content: (props: CardContentProps) => React.JSX.Element;
  Title: (props: CardTextProps) => React.JSX.Element;
  Subtitle: (props: CardTextProps) => React.JSX.Element;
  Body: (props: CardTextProps) => React.JSX.Element;
};

const Card = (({ children, onPress, style, variant = 'elevated', className = '', ...props }: CardProps) => {
  const cardStyles = [
    styles.card,
    variant === 'outlined' && styles.cardOutlined,
    variant === 'filled' && styles.cardFilled,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [...cardStyles as any, pressed && styles.cardPressed]}
        {...props}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={cardStyles as any} {...props}>
      {children}
    </View>
  );
}) as CardType;

function CardCover({ source, height = 200, showGradient = true, gradientColors = ['transparent', 'rgba(0,0,0,0.7)'], style, ...props }: CardCoverProps) {
  return (
    <View style={[styles.coverContainer, { height }, style]}>
      <Image source={source} style={styles.coverImage} contentFit="cover" transition={200} {...props} />
      {showGradient && <LinearGradient colors={gradientColors as any} style={styles.coverGradient} />}
    </View>
  );
}

function CardContent({ children, position = 'bottom', style, ...props }: CardContentProps) {
  const positionStyles: Record<string, StyleProp<ViewStyle>> = {
    bottom: styles.contentBottom,
    top: styles.contentTop,
    center: styles.contentCenter,
  };

  return (
    <View style={[styles.content, positionStyles[position], style]} {...props}>
      {children}
    </View>
  );
}

function CardTitle({ children, style, ...props }: CardTextProps) {
  return (
    <Text style={[styles.title, style]} numberOfLines={1} {...props}>
      {children}
    </Text>
  );
}

function CardSubtitle({ children, style, ...props }: CardTextProps) {
  return (
    <Text style={[styles.subtitle, style]} numberOfLines={1} {...props}>
      {children}
    </Text>
  );
}

function CardBody({ children, style, ...props }: CardTextProps) {
  return (
    <View style={[styles.body, style]} {...props}>
      {children}
    </View>
  );
}

Card.Cover = CardCover;
Card.Content = CardContent;
Card.Title = CardTitle;
Card.Subtitle = CardSubtitle;
Card.Body = CardBody;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: '#fff',
    overflow: 'hidden',
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  cardOutlined: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.outline,
    elevation: 0,
    shadowOpacity: 0,
  },
  cardFilled: {
    backgroundColor: colors.surfaceVariant,
    elevation: 0,
    shadowOpacity: 0,
  },
  cardPressed: {
    opacity: 0.95,
    transform: [{ scale: 0.98 }],
  },
  coverContainer: {
    position: 'relative',
    width: '100%',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '60%',
  },
  content: {
    position: 'absolute',
    left: 0,
    right: 0,
    padding: spacing.lg,
  },
  contentBottom: {
    bottom: 0,
  },
  contentTop: {
    top: 0,
  },
  contentCenter: {
    top: '50%',
    transform: [{ translateY: -50 }],
  },
  title: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#fff',
    marginBottom: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    fontWeight: '500' as const,
  },
  body: {
    padding: spacing.lg,
  },
});

export default Card;
