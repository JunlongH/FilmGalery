import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface DraggableFabProps {
  children: React.ReactNode;
  initialRight?: number;
  initialBottom?: number;
  size?: number;
  margin?: number;
}

interface XY {
  x: number;
  y: number;
}

export default function DraggableFab({
  children,
  initialRight = 16,
  initialBottom = 200,
  size = 56,
  margin = 12,
}: DraggableFabProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const initial = useMemo<XY>(() => {
    const x = Math.max(margin, width - size - initialRight);
    const y = Math.max(insets.top + margin, height - size - initialBottom);
    return { x, y };
  }, [width, height, insets.top, margin, size, initialRight, initialBottom]);

  const position = useRef(new Animated.ValueXY(initial)).current;
  const positionAny = position as any;

  const clampToBounds = (pt: XY): XY => {
    const minX = margin;
    const maxX = Math.max(margin, width - size - margin);
    const minY = insets.top + margin;
    const maxY = Math.max(minY, height - insets.bottom - size - margin);

    return {
      x: Math.min(maxX, Math.max(minX, pt.x)),
      y: Math.min(maxY, Math.max(minY, pt.y)),
    };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_: any, gesture: any) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 2,
      onPanResponderGrant: () => {
        const cur: XY = positionAny.__getValue();
        position.setOffset({ x: cur.x, y: cur.y });
        position.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: position.x, dy: position.y }] as any, {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        position.flattenOffset();
        const cur: XY = positionAny.__getValue();
        const clamped = clampToBounds(cur);
        Animated.spring(position, {
          toValue: clamped,
          useNativeDriver: false,
          friction: 7,
          tension: 80,
        }).start();
      },
      onPanResponderTerminate: () => {
        position.flattenOffset();
        const cur: XY = positionAny.__getValue();
        const clamped = clampToBounds(cur);
        position.setValue(clamped);
      },
    })
  ).current;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        zIndex: 20,
      }}
      {...panResponder.panHandlers}
    >
      {children}
    </Animated.View>
  );
}
