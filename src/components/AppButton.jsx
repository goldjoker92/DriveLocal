// AppButton
// Pressable button with four variants:
//   primary   - solid brand blue (default)
//   secondary - light blue tint
//   ghost     - transparent with neutral border
//   danger    - destructive action with red tint
//
// Optional haptic + scale feedback is opt-in so existing screens keep their
// current interaction behavior until deliberately upgraded.

import { useRef } from 'react';
import { Animated, Pressable, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

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
  haptic = null,
  pressScale = false,
}) {
  const scale = useRef(new Animated.Value(1)).current;

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

  function animateScale(toValue) {
    if (!pressScale) return;
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
  }

  function handlePress() {
    if (disabled) return;
    triggerHaptic(haptic).catch(() => undefined);
    if (onPress) onPress();
  }

  const button = (
    <Pressable
      onPress={handlePress}
      onPressIn={() => animateScale(0.98)}
      onPressOut={() => animateScale(1)}
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.md,
          alignItems: 'center',
          borderWidth,
          borderColor,
          opacity: disabled ? 0.5 : pressed ? 0.88 : 1,
        },
        style,
      ]}
    >
      <Text style={[{ fontFamily, color: textColor }, typography.bodyBold]}>
        {title}
      </Text>
    </Pressable>
  );

  if (!pressScale) return button;
  return (
    <Animated.View style={{ alignSelf: 'stretch', transform: [{ scale }] }}>
      {button}
    </Animated.View>
  );
}
