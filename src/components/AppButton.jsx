// AppButton
// Pressable button with four variants:
//   primary   - solid brand blue (default)
//   secondary - light blue tint
//   ghost     - transparent with neutral border
//   danger    - destructive action with red tint
//
// Every enabled app button receives subtle light haptic + scale feedback by
// default. Critical actions can override the haptic type, and either behavior can
// still be disabled explicitly when a screen must remain silent/static.

import { useRef } from 'react';
import { Animated, Pressable, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

async function triggerHaptic(type) {
  if (!type) return;
  if (type === 'selection') return Haptics.selectionAsync();
  if (type === 'success') {
    return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
  if (type === 'warning') {
    return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }
  if (type === 'error') {
    return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }

  const style = type === 'heavy'
    ? Haptics.ImpactFeedbackStyle.Heavy
    : type === 'medium'
      ? Haptics.ImpactFeedbackStyle.Medium
      : Haptics.ImpactFeedbackStyle.Light;
  return Haptics.impactAsync(style);
}

export default function AppButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
  haptic = 'light',
  pressScale = true,
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressedOpacity = useRef(new Animated.Value(1)).current;

  const backgroundColor = variant === 'primary'
    ? colors.primary
    : variant === 'secondary'
      ? colors.primaryTint
      : variant === 'danger'
        ? colors.dangerBg
        : 'transparent';

  const textColor = variant === 'primary'
    ? colors.white
    : variant === 'danger'
      ? colors.danger
      : colors.primary;

  const borderWidth = variant === 'ghost' || variant === 'danger' ? 1 : 0;
  const borderColor = variant === 'danger' ? colors.danger : colors.border;

  function animatePressed(pressed) {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: pressScale && pressed ? 0.98 : 1,
        useNativeDriver: true,
        speed: 40,
        bounciness: 0,
      }),
      Animated.timing(pressedOpacity, {
        toValue: pressed ? 0.88 : 1,
        duration: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }

  function handlePress() {
    if (disabled) return;
    triggerHaptic(haptic).catch(() => undefined);
    if (onPress) onPress();
  }

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={() => animatePressed(true)}
      onPressOut={() => animatePressed(false)}
      disabled={disabled}
      style={[
        {
          backgroundColor,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.md,
          alignItems: 'center',
          borderWidth,
          borderColor,
          opacity: disabled ? 0.5 : pressedOpacity,
          transform: [{ scale }],
        },
        style,
      ]}
    >
      <Text style={[{ fontFamily, color: textColor }, typography.bodyBold]}>
        {title}
      </Text>
    </AnimatedPressable>
  );
}
