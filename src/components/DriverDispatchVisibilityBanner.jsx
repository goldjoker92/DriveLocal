import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useDriverAvailability } from '../contexts/DriverAvailabilityContext';
import { driverAvailabilityPresentation } from '../utils/driverAvailabilityPresentation';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

export function visibilityCopy(state, reason) {
  return driverAvailabilityPresentation({ state, reason });
}

export default function DriverDispatchVisibilityBanner({ hideWhenStable = false }) {
  const { visibility, presentation: copy, recover, recovering, recoveryError } = useDriverAvailability();
  if (!copy || visibility.state === 'on_ride') return null;
  if (hideWhenStable && ['healthy', 'offline'].includes(visibility.state)) return null;
  const stable = ['healthy', 'offline'].includes(visibility.state);
  const accent = copy.tone === 'danger' ? colors.danger
    : copy.tone === 'success' ? colors.success : copy.tone === 'neutral' ? colors.textMuted : colors.warning;
  const background = copy.tone === 'danger' ? colors.dangerBg
    : copy.tone === 'warning' ? colors.warningBg : colors.background;

  return (
    <View accessibilityLiveRegion="polite" style={{
      backgroundColor: background, borderRadius: radius.md, borderWidth: 1,
      borderColor: accent, padding: stable ? spacing.sm : spacing.md, gap: spacing.xs,
    }}>
      <Text style={[{ fontFamily, color: accent, fontWeight: '800' }, typography.body]}>{copy.title}</Text>
      {!stable ? <Text style={[{ fontFamily, color: colors.text }, typography.small]}>{copy.body}</Text> : null}
      {recoveryError ? <Text accessibilityRole="alert" style={[{ color: colors.danger }, typography.small]}>{recoveryError}</Text> : null}
      {copy.action ? (
        <Pressable accessibilityRole="button" accessibilityLabel={copy.actionLabel}
          accessibilityState={{ disabled: recovering, busy: recovering }}
          disabled={recovering} onPress={recover}
          style={{ minHeight: 48, padding: spacing.sm, borderRadius: radius.sm, alignItems: 'center',
            justifyContent: 'center', backgroundColor: accent, opacity: recovering ? 0.7 : 1 }}>
          {recovering ? <ActivityIndicator color={colors.white} />
            : <Text style={[{ fontFamily, color: colors.white, fontWeight: '800', textAlign: 'center' }, typography.small]}>{copy.actionLabel}</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}
