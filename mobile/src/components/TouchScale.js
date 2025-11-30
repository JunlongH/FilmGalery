import React, { useRef } from 'react';
import { Animated, Pressable } from 'react-native';

export default function TouchScale({ children, scaleTo = 0.97, style, onPress, ...rest }) {
  const anim = useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    Animated.spring(anim, { toValue: scaleTo, useNativeDriver: true, speed: 20 }).start();
  };
  const onPressOut = () => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 20 }).start();
  };

  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} {...rest}>
      <Animated.View style={[{ transform: [{ scale: anim }] }, style]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
