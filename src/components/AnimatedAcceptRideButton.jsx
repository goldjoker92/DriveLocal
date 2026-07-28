// Modern but restrained accept action: one shine, a soft pulse, press spring and
// light haptic feedback. No business mutation happens here; onPress owns it.

import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

export default function AnimatedAcceptRideButton({
  onPress,
  title = 'ACEITAR',
  disabled = false,
  loading = false,
}) {
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const shineProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    pulseScale.stopAnimation();
    shineProgress.stopAnimation();
    pulseScale.setValue(1);
    shineProgress.setValue(0);
    if (disabled || loading) return undefined;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseScale, {
          toValue: 1.015,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseScale, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    const shine = Animated.timing(shineProgress, {
      toValue: 1,
      delay: 250,
      duration: 850,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    pulse.start();
    shine.start();
    return () => {
      pulse.stop();
      shine.stop();
    };
  }, [disabled, loading, pulseScale, shineProgress]);

  function animatePress(toValue, speed, bounciness) {
    if (disabled || loading) return;
    Animated.spring(pressScale, {
      toValue,
      speed,
      bounciness,
      useNativeDriver: true,
    }).start();
  }

  async function handlePress() {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    await onPress();
  }

  const shineTranslateX = shineProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-140, 520],
  });
  const visibleTitle = loading ? 'ACEITANDO…' : title;

  return (
    <Animated.View style={[styles.halo, { transform: [{ scale: pulseScale }] }]}>
      <Animated.View style={{ transform: [{ scale: pressScale }] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={loading ? 'Aceitando corrida' : 'Aceitar corrida'}
          onPress={handlePress}
          onPressIn={() => animatePress(0.97, 35, 0)}
          onPressOut={() => animatePress(1, 24, 7)}
          disabled={disabled || loading}
          style={({ pressed }) => [
            styles.button,
            pressed && !disabled && !loading ? styles.pressed : null,
            disabled || loading ? styles.disabled : null,
          ]}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              styles.shine,
              { transform: [{ translateX: shineTranslateX }, { skewX: '-18deg' }] },
            ]}
          />
          <View style={styles.content}>
            {loading ? <ActivityIndicator size="small" color={colors.white} /> : null}
            <Text style={styles.text} numberOfLines={1} adjustsFontSizeToFit>
              {visibleTitle}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  halo: {
    borderRadius: radius.lg,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.24,
    shadowRadius: 12,
    elevation: 8,
  },
  button: {
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pressed: {
    backgroundColor: colors.primaryDark,
  },
  disabled: {
    opacity: 0.55,
  },
  shine: {
    position: 'absolute',
    top: -20,
    bottom: -20,
    width: 54,
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  content: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  text: {
    flexShrink: 1,
    fontFamily,
    color: colors.white,
    ...typography.bodyBold,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});
