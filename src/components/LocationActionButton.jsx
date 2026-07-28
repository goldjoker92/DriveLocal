import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function LocationActionButton({
  loading = false,
  found = false,
  disabled = false,
  onPress,
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const previousFoundRef = useRef(false);

  useEffect(() => {
    if (!loading) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.82,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [loading, pulse]);

  useEffect(() => {
    if (found && !previousFoundRef.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
    previousFoundRef.current = found;
  }, [found]);

  function animatePressed(pressed) {
    Animated.spring(scale, {
      toValue: pressed ? 0.975 : 1,
      speed: 40,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
  }

  function handlePress() {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    onPress?.();
  }

  const backgroundColor = found ? colors.accentTint : colors.primaryTint;
  const borderColor = found ? colors.accent : colors.primary;
  const title = loading
    ? 'Localizando seu ponto de embarque…'
    : found
      ? 'Localização atualizada'
      : 'Usar minha localização atual';
  const subtitle = loading
    ? 'Aguarde enquanto confirmamos o endereço.'
    : found
      ? 'Toque novamente para atualizar o ponto.'
      : 'Preenche automaticamente o endereço de origem.';

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint="Usa o GPS do telefone para preencher o local de embarque"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={handlePress}
      onPressIn={() => animatePressed(true)}
      onPressOut={() => animatePressed(false)}
      style={{
        minHeight: 70,
        marginTop: spacing.sm,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
        borderRadius: radius.lg,
        borderWidth: 1.5,
        borderColor,
        backgroundColor,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        opacity: disabled ? 0.55 : 1,
        transform: [{ scale }],
        shadowColor: colors.primary,
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <Animated.View
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor,
          opacity: pulse,
          transform: [{ scale: pulse }],
        }}
      >
        <Text style={{ fontSize: 23 }}>{loading ? '◎' : found ? '✓' : '📍'}</Text>
      </Animated.View>

      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[{ fontFamily, color: found ? colors.success : colors.primary }, typography.bodyBold]}>
          {title}
        </Text>
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
          {subtitle}
        </Text>
      </View>

      {!loading ? (
        <Text style={[{ fontFamily, color: found ? colors.success : colors.primary }, typography.h3]}>
          ›
        </Text>
      ) : null}
    </AnimatedPressable>
  );
}
