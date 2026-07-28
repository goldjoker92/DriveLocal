// Passenger dashboard primary CTA.
// Kept separate from AppButton so the ride entry point has a real visual hierarchy
// without changing every primary button in the application.

import { useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function PassengerRideRequestCta({ loading = false, disabled = false, onPress }) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const blocked = disabled || loading;

  function animatePressed(pressed) {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: pressed ? 0.975 : 1,
        speed: 42,
        bounciness: 0,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: pressed ? 2 : 0,
        duration: 90,
        useNativeDriver: true,
      }),
    ]).start();
  }

  function handlePress() {
    if (blocked) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    onPress?.();
  }

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel="Pedir corrida"
      accessibilityHint="Abre a escolha do local de embarque, destino e veículo"
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={handlePress}
      onPressIn={() => animatePressed(true)}
      onPressOut={() => animatePressed(false)}
      style={{
        minHeight: 104,
        padding: spacing.lg,
        borderRadius: radius.lg,
        backgroundColor: colors.primary,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        opacity: blocked ? 0.55 : 1,
        transform: [{ scale }, { translateY }],
        shadowColor: colors.primaryDark,
        shadowOpacity: 0.26,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
        elevation: 7,
      }}
    >
      <View
        style={{
          width: 58,
          height: 58,
          borderRadius: 29,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(255,255,255,0.14)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.28)',
        }}
      >
        <Text style={{ fontSize: 28 }}>{loading ? '…' : '🚕'}</Text>
      </View>

      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[{ fontFamily, color: 'rgba(255,255,255,0.72)', letterSpacing: 0.8 }, typography.caption]}>
          NOVA CORRIDA
        </Text>
        <Text style={[{ fontFamily, color: colors.onPrimary }, typography.h2]}>
          {loading ? 'Carregando sua conta…' : 'Pedir corrida'}
        </Text>
        <Text style={[{ fontFamily, color: 'rgba(255,255,255,0.78)' }, typography.small]}>
          Informe embarque, destino e escolha moto ou carro.
        </Text>
      </View>

      {!loading ? (
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.onPrimary,
          }}
        >
          <Text style={[{ fontFamily, color: colors.primary }, typography.h3]}>›</Text>
        </View>
      ) : null}
    </AnimatedPressable>
  );
}
