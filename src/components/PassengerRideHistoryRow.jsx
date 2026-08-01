import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

function statusColor(tone) {
  if (tone === 'success') return colors.success;
  if (tone === 'warning') return colors.warning;
  if (tone === 'danger') return colors.danger;
  if (tone === 'info') return colors.primary;
  return colors.textMuted;
}

export default function PassengerRideHistoryRow({ item, compact = false, onPress = null }) {
  const pixStatusLabel = compact && item.pixStatus === 'received'
    ? '✓ PAGO'
    : item.pixStatusLabel;

  return (
    <Pressable
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `Abrir corrida de ${item.dateLabel}` : undefined}
      onPress={onPress || undefined}
      style={({ pressed }) => [
        styles.card,
        compact && styles.compactCard,
        pressed && onPress && styles.cardPressed,
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.driverName}>{item.driverFirstName}</Text>
          <Text style={styles.date}>{item.dateLabel}</Text>
        </View>
        <View style={styles.amountCopy}>
          <Text style={styles.amount}>{item.amountLabel}</Text>
          {item.amountDetail ? <Text style={styles.amountDetail}>{item.amountDetail}</Text> : null}
        </View>
      </View>

      <View style={styles.routeBox}>
        <Text numberOfLines={compact ? 1 : 2} style={styles.routeLine}>{`📍 ${item.pickupLabel}`}</Text>
        <Text numberOfLines={compact ? 1 : 2} style={styles.routeLine}>{`🏁 ${item.destinationLabel}`}</Text>
      </View>

      <Text numberOfLines={compact ? 1 : 2} style={styles.vehicle}>{item.vehicleLabel}</Text>

      <View style={styles.statusRow}>
        <Text style={[styles.status, { color: statusColor(item.rideStatusTone) }]}>
          {item.rideStatusLabel}
        </Text>
        <Text style={[styles.status, { color: statusColor(item.pixStatusTone) }]}>
          {pixStatusLabel}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  compactCard: { padding: spacing.sm },
  cardPressed: { opacity: 0.68 },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  headerCopy: { flex: 1, gap: 2 },
  driverName: { fontFamily, color: colors.text, ...typography.bodyBold },
  date: { fontFamily, color: colors.textMuted, ...typography.caption },
  amountCopy: { alignItems: 'flex-end', gap: 2 },
  amount: { fontFamily, color: colors.primary, ...typography.bodyBold },
  amountDetail: { fontFamily, color: colors.textMuted, ...typography.caption },
  routeBox: { gap: 4 },
  routeLine: { fontFamily, color: colors.text, ...typography.small },
  vehicle: { fontFamily, color: colors.textMuted, ...typography.caption },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  status: { fontFamily, ...typography.caption, fontWeight: '700' },
});
