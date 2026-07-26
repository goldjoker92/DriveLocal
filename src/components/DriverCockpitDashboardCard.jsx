import { StyleSheet, Text, View } from 'react-native';
import AppButton from './AppButton';
import AppCard from './AppCard';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { formatBRL } from '../utils/format';
import { formatDateBR } from '../utils/driverCockpit';

function Metric({ value, label }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function CommercialMetric({ label, value, detail }) {
  return (
    <View style={styles.commercialMetric}>
      <Text style={styles.commercialLabel}>{label}</Text>
      <Text style={styles.commercialValue}>{value}</Text>
      {detail ? <Text style={styles.commercialDetail}>{detail}</Text> : null}
    </View>
  );
}

function subscriptionCopy(subscription) {
  if (subscription?.mode === 'free') {
    return {
      value: 'Grátis',
      detail: subscription.dateMs ? `até ${formatDateBR(subscription.dateMs)}` : null,
    };
  }
  if (subscription?.mode === 'ride_grace') {
    const used = Number(subscription.freeRideCountUsed || 0);
    return {
      value: 'Grátis',
      detail: `${used} de 5 corridas usadas`,
    };
  }
  if (subscription?.mode === 'active') {
    return {
      value: 'Ativa',
      detail: subscription.dateMs ? `até ${formatDateBR(subscription.dateMs)}` : null,
    };
  }
  return { value: 'Necessária', detail: 'ative para receber ofertas' };
}

export default function DriverCockpitDashboardCard({
  summary,
  commission,
  subscription,
  onWalletPress,
}) {
  const plan = subscriptionCopy(subscription);
  const heldDetail = summary.walletHeldCentavos > 0
    ? `${formatBRL(summary.walletHeldCentavos)} reservado`
    : 'disponível para comissões';

  return (
    <AppCard style={styles.card}>
      <View style={styles.section}>
        <Text style={styles.eyebrow}>HOJE</Text>
        <View style={styles.metricsRow}>
          <Metric value={summary.todayRideCount} label="corridas" />
          <Metric value={formatBRL(summary.todayReceivedCentavos)} label="recebidos" />
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.section}>
        <Text style={styles.eyebrow}>ESTA SEMANA</Text>
        <View style={styles.metricsRow}>
          <Metric value={summary.weekRideCount} label="corridas" />
          <Metric value={formatBRL(summary.weekReceivedCentavos)} label="recebidos" />
        </View>
      </View>

      <View style={styles.commercialGrid}>
        <CommercialMetric label="Comissão" value={commission.label} />
        <CommercialMetric
          label="Saldo DriveLocal"
          value={formatBRL(summary.walletAvailableCentavos)}
          detail={heldDetail}
        />
        <CommercialMetric label="Assinatura" value={plan.value} detail={plan.detail} />
      </View>

      <View style={styles.footerRow}>
        {!summary.statsVersion ? (
          <Text style={styles.syncNote}>
            Os totais de hoje e da semana começam a atualizar após a próxima corrida concluída.
          </Text>
        ) : null}
        <Text style={styles.totalText}>
          {`${summary.totalCompletedRideCount} corridas concluídas no total`}
        </Text>
        <AppButton title="Ver carteira" variant="ghost" onPress={onWalletPress} />
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  section: { gap: spacing.sm },
  eyebrow: {
    fontFamily,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: {
    flexGrow: 1,
    flexBasis: 120,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    padding: spacing.md,
    gap: 2,
  },
  metricValue: { fontFamily, color: colors.primary, ...typography.h2 },
  metricLabel: { fontFamily, color: colors.textMuted, ...typography.small },
  divider: { height: 1, backgroundColor: colors.border },
  commercialGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  commercialMetric: {
    flexGrow: 1,
    flexBasis: 92,
    minWidth: 92,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: 3,
  },
  commercialLabel: { fontFamily, color: colors.textMuted, fontSize: 10, fontWeight: '700' },
  commercialValue: { fontFamily, color: colors.text, ...typography.bodyBold },
  commercialDetail: { fontFamily, color: colors.textMuted, fontSize: 10, lineHeight: 14 },
  footerRow: { gap: spacing.xs },
  syncNote: { fontFamily, color: colors.textMuted, ...typography.caption },
  totalText: { fontFamily, color: colors.textMuted, ...typography.small },
});