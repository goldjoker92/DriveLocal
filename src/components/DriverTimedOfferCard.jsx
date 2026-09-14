import { StyleSheet, Text, View } from 'react-native';
import AppCard from './AppCard';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';

function SummaryRow({ label, value, emphasized = false }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, emphasized && styles.summaryValueEmphasized]}>
        {value}
      </Text>
    </View>
  );
}

export default function DriverTimedOfferCard({ view }) {
  if (!view?.visible) return null;

  return (
    <AppCard style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.vehicleRow}>
          <Text style={styles.vehicleEmoji}>{view.vehicle.emoji}</Text>
          <Text style={styles.vehicleLabel}>{view.vehicle.label}</Text>
        </View>
        <View style={[styles.countdown, view.urgent && styles.countdownUrgent]}>
          <Text style={[styles.countdownValue, view.urgent && styles.countdownValueUrgent]}>
            {view.secondsLeft}s
          </Text>
        </View>
      </View>

      <View style={styles.routeSection}>
        <View style={styles.routeRail} accessibilityElementsHidden>
          <View style={styles.pickupMarker} />
          <View style={styles.routeLine} />
          <View style={styles.destinationMarker} />
        </View>
        <View style={styles.routeDetails}>
          <View style={styles.routeStop}>
            <Text style={styles.eyebrow}>EMBARQUE</Text>
            <Text style={styles.routeRegion}>{view.pickupRegionLabel}</Text>
            <Text style={styles.routeMetrics}>
              {`${view.distanceLabel}  •  ${view.etaLabel}`}
            </Text>
          </View>
          <View style={styles.routeStop}>
            <Text style={styles.eyebrow}>DESTINO</Text>
            <Text style={styles.routeRegion}>{view.destinationRegionLabel}</Text>
            <Text style={styles.routeMetrics}>
              {`${view.routeDistanceLabel}  •  ${view.routeDurationLabel}`}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.receiveSection}>
        <Text style={styles.receiveLabel}>VOCÊ RECEBE</Text>
        <Text style={styles.receiveValue} adjustsFontSizeToFit numberOfLines={1}>
          {view.driverReceivesLabel}
        </Text>
      </View>

      <View style={styles.summary}>
        <SummaryRow label="Valor da corrida" value={view.fareLabel} />
        <SummaryRow label="Taxa da plataforma" value={view.commissionLabel} />
        <SummaryRow label="Pagamento" value={view.paymentLabel} emphasized />
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.background,
    borderColor: colors.primary,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  vehicleEmoji: { fontSize: 24 },
  vehicleLabel: {
    fontFamily,
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  countdown: {
    minWidth: 62,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.primaryTint,
  },
  countdownUrgent: { backgroundColor: colors.dangerBg },
  countdownValue: {
    fontFamily,
    color: colors.primary,
    fontSize: 19,
    fontWeight: '900',
  },
  countdownValueUrgent: { color: colors.danger },
  routeSection: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  routeRail: {
    width: 16,
    alignItems: 'center',
    paddingVertical: 5,
  },
  pickupMarker: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  routeLine: {
    width: 2,
    flex: 1,
    minHeight: 48,
    backgroundColor: colors.border,
  },
  destinationMarker: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  routeDetails: {
    flex: 1,
    gap: spacing.lg,
  },
  routeStop: { gap: spacing.xs },
  eyebrow: {
    fontFamily,
    color: colors.textFaint,
    ...typography.caption,
    letterSpacing: 0.8,
  },
  routeRegion: {
    fontFamily,
    color: colors.text,
    ...typography.h3,
  },
  routeMetrics: {
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
  },
  receiveSection: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.successBg,
  },
  receiveLabel: {
    fontFamily,
    color: colors.success,
    ...typography.caption,
    letterSpacing: 0.9,
  },
  receiveValue: {
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    fontFamily,
    color: colors.success,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900',
    textAlign: 'center',
  },
  summary: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  summaryLabel: {
    flex: 1,
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
  },
  summaryValue: {
    flexShrink: 1,
    fontFamily,
    color: colors.text,
    ...typography.bodyBold,
    textAlign: 'right',
  },
  summaryValueEmphasized: { color: colors.primary },
});
