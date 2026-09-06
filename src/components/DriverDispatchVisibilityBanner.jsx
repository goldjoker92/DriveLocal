// DriverDispatchVisibilityBanner
//
// Tells a driver when the backend has stopped offering him rides.
//
// Why this exists: availabilityStatus is a local claim, dispatch eligibility is
// a server rule. When Android suspends the location service the two silently
// diverge — the cockpit keeps showing "disponível" while the driver has been
// invisible to dispatch for a quarter of an hour. He waits, receives nothing,
// and concludes the platform has no rides. Production incident 2026-09-05: three
// moto drivers online with a dead session while every moto request answered
// "no driver".
//
// The banner never changes availability and never stops tracking. It states the
// situation and offers one recovery action; the driver stays in control.

import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { driverDispatchVisibility } from '../utils/driverWorkSession';

// The session ages between snapshots, so the banner re-evaluates on its own
// instead of waiting for the next Firestore write.
const TICK_MS = 20_000;

export function visibilityCopy(state) {
  if (state === 'invisible') {
    return {
      title: 'Você não está recebendo corridas',
      body: 'O app perdeu contato com o servidor. Toque para reativar.',
      action: 'REATIVAR AGORA',
      tone: 'danger',
    };
  }
  return {
    title: 'Sinal fraco',
    body: 'Sua posição está demorando a atualizar. Você ainda recebe corridas.',
    action: 'ATUALIZAR AGORA',
    tone: 'warning',
  };
}

export default function DriverDispatchVisibilityBanner({
  driver,
  availabilityStatus,
  hasActiveRide,
  onRecover,
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const visibility = driverDispatchVisibility(driver, {
    nowMs,
    availabilityStatus,
    hasActiveRide,
  });

  if (!visibility.visible) return null;

  const copy = visibilityCopy(visibility.state);
  const danger = copy.tone === 'danger';
  const accent = danger ? colors.danger : colors.warning;
  const background = danger ? colors.dangerBg : colors.warningBg;

  async function handleRecover() {
    if (recovering || typeof onRecover !== 'function') return;
    setRecovering(true);
    try {
      await onRecover();
      // Optimistic re-evaluation: a successful heartbeat rewrites the session,
      // and the driver document snapshot dismisses the banner on its own.
      setNowMs(Date.now());
    } finally {
      setRecovering(false);
    }
  }

  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={`${copy.title}. ${copy.body}`}
      style={{
        backgroundColor: background,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: accent,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      <Text style={[{ fontFamily, color: accent, fontWeight: '800' }, typography.body]}>
        {copy.title}
      </Text>
      <Text style={[{ fontFamily, color: colors.text }, typography.small]}>
        {copy.body}
      </Text>

      {typeof onRecover === 'function' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.action}
          disabled={recovering}
          onPress={handleRecover}
          style={{
            marginTop: spacing.xs,
            minHeight: 44,
            borderRadius: radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: accent,
            opacity: recovering ? 0.7 : 1,
          }}
        >
          {recovering ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={[{ fontFamily, color: '#FFFFFF', fontWeight: '800' }, typography.small]}>
              {copy.action}
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}
