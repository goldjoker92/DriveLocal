import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import AppButton from './AppButton';
import AppCard from './AppCard';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { loadDriverRideHistoryPage } from '../services/driverRideHistoryService';
import { formatBRL } from '../utils/format';
import { formatDateBR } from '../utils/driverCockpit';
import {
  formatDriverRateBps,
  normalizeDriverHistoryPage,
} from '../utils/driverRideHistory';

function Metric({ value, label, detail }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      {detail ? <Text style={styles.metricDetail}>{detail}</Text> : null}
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

function walletCopy(summary, commission) {
  if (commission?.mode === 'free') {
    return commission.dateMs
      ? `nenhuma recarga até ${formatDateBR(commission.dateMs)}`
      : 'nenhuma recarga necessária';
  }
  const threshold = formatBRL(summary.walletMinimumCentavos || 300);
  if (summary.walletNeedsTopup) return `recarga necessária • saldo deve ficar acima de ${threshold}`;
  return `pronto para comissões • mínimo acima de ${threshold}`;
}

function statusColor(tone) {
  if (tone === 'success') return colors.success;
  if (tone === 'warning') return colors.warning;
  if (tone === 'danger') return colors.danger;
  if (tone === 'info') return colors.primary;
  return colors.textMuted;
}

function RecentRideRow({ item }) {
  return (
    <View style={styles.historyRow}>
      <View style={styles.historyHeader}>
        <View style={styles.historyHeaderCopy}>
          <Text style={styles.historyPassenger}>{item.passengerFirstName}</Text>
          <Text style={styles.historyDate}>{item.dateLabel}</Text>
        </View>
        <View style={styles.historyAmountCopy}>
          <Text style={styles.historyAmount}>{item.fareLabel}</Text>
          {item.fareDetail ? <Text style={styles.historyFareDetail}>{item.fareDetail}</Text> : null}
        </View>
      </View>

      <View style={styles.routeBox}>
        <Text style={styles.routeLine}>{`📍 ${item.pickupLabel}`}</Text>
        <Text style={styles.routeLine}>{`🏁 ${item.destinationLabel}`}</Text>
      </View>

      <View style={styles.historyMetaRow}>
        <Text style={styles.historyMeta}>{item.vehicleLabel}</Text>
        <Text style={styles.historyMeta}>{item.commissionLabel}</Text>
      </View>
      <View style={styles.historyMetaRow}>
        <Text style={[styles.historyStatus, { color: statusColor(item.rideStatusTone) }]}>
          {item.rideStatusLabel}
        </Text>
        <Text style={[styles.historyStatus, { color: statusColor(item.pixStatusTone) }]}>
          {item.pixStatusLabel}
        </Text>
      </View>
    </View>
  );
}

export default function DriverCockpitDashboardCard({
  summary,
  commission,
  subscription,
  onWalletPress,
  onSubscriptionPress,
}) {
  const router = useRouter();
  const [recentHistory, setRecentHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const plan = subscriptionCopy(subscription);
  const heldPrefix = summary.walletHeldCentavos > 0
    ? `${formatBRL(summary.walletHeldCentavos)} reservado • `
    : '';
  const walletDetail = `${heldPrefix}${walletCopy(summary, commission)}`;
  const walletBlocked = summary.walletNeedsTopup === true;
  const thresholdLabel = formatBRL(summary.walletMinimumCentavos || 300);
  const openWallet = walletBlocked
    ? () => router.push({
      pathname: '/wallet',
      params: { reason: 'wallet_required', returnTo: '/driver-home' },
    })
    : onWalletPress || (() => router.push('/wallet'));
  const openSubscription = onSubscriptionPress || (() => router.push('/subscription-plans'));
  const openAllHistory = () => router.push('/ride-history');

  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    loadDriverRideHistoryPage({ limit: 3 })
      .then((snapshot) => {
        if (!active) return;
        const page = normalizeDriverHistoryPage(snapshot);
        setRecentHistory(page.items.slice(0, 3));
        setHistoryError('');
      })
      .catch(() => {
        if (!active) return;
        setHistoryError('Não foi possível carregar as últimas corridas.');
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => { active = false; };
  }, [
    summary.totalCompletedRideCount,
    summary.trackedCancelledRideCount,
    summary.excludedCancellationCount,
  ]);

  const performanceDetail = summary.performanceStatsReady
    ? summary.performanceTrackingStartedAtMs
      ? `taxas acompanhadas desde ${formatDateBR(summary.performanceTrackingStartedAtMs)}`
      : 'taxas calculadas com eventos reais do servidor'
    : 'as taxas aparecerão após novas ofertas e corridas finalizadas';

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

      <View style={styles.divider} />

      <View style={styles.section}>
        <Text style={styles.eyebrow}>SEU DESEMPENHO</Text>
        <View style={styles.performanceGrid}>
          <Metric value={summary.totalCompletedRideCount} label="corridas concluídas" />
          <Metric
            value={formatDriverRateBps(summary.completionRateBps)}
            label="taxa de conclusão"
            detail={summary.terminalRideCount > 0
              ? `${summary.trackedCompletedRideCount} de ${summary.terminalRideCount} finalizadas`
              : null}
          />
          <Metric
            value={formatDriverRateBps(summary.acceptanceRateBps)}
            label="taxa de aceitação"
            detail={summary.offersReceivedCount > 0
              ? `${summary.offersAcceptedCount} de ${summary.offersReceivedCount} ofertas`
              : null}
          />
        </View>
        <Text style={styles.performanceNote}>{performanceDetail}</Text>
      </View>

      <View style={styles.commercialGrid}>
        <CommercialMetric label="Comissão" value={commission.label} />
        <CommercialMetric
          label="Saldo DriveLocal"
          value={formatBRL(summary.walletAvailableCentavos)}
          detail={walletDetail}
        />
        <CommercialMetric label="Assinatura" value={plan.value} detail={plan.detail} />
      </View>

      {walletBlocked ? (
        <View style={styles.walletAlert}>
          <Text style={styles.walletAlertTitle}>Recarga necessária para receber corridas</Text>
          <Text style={styles.walletAlertText}>
            {`Seu saldo disponível é ${formatBRL(summary.walletAvailableCentavos)}. Depois da promoção de comissão 0%, o servidor exige saldo acima de ${thresholdLabel} para ficar disponível e também saldo suficiente para reservar a comissão da próxima corrida.`}
          </Text>
          <AppButton title="RECARREGAR AGORA" onPress={openWallet} />
        </View>
      ) : null}

      <View style={styles.divider} />

      <View style={styles.historySection}>
        <View style={styles.historySectionHeader}>
          <View style={styles.historySectionCopy}>
            <Text style={styles.eyebrow}>ÚLTIMAS 3 CORRIDAS</Text>
            <Text style={styles.historyIntro}>Valores, comissão, status da corrida e confirmação Pix.</Text>
          </View>
          <AppButton title="VER TODAS" variant="ghost" onPress={openAllHistory} />
        </View>

        {historyLoading ? (
          <View style={styles.historyLoading}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.historyEmpty}>Carregando histórico real…</Text>
          </View>
        ) : historyError ? (
          <View style={styles.historyErrorBox}>
            <Text style={styles.historyError}>{historyError}</Text>
            <AppButton title="ABRIR HISTÓRICO" variant="ghost" onPress={openAllHistory} />
          </View>
        ) : recentHistory.length > 0 ? (
          <View style={styles.historyList}>
            {recentHistory.map((item) => <RecentRideRow key={item.rideId} item={item} />)}
          </View>
        ) : (
          <Text style={styles.historyEmpty}>Suas corridas aceitas aparecerão aqui.</Text>
        )}
      </View>

      <View style={styles.footerRow}>
        {!summary.statsVersion ? (
          <Text style={styles.syncNote}>
            Os totais de hoje e da semana começam a atualizar após a próxima corrida concluída.
          </Text>
        ) : null}
        <View style={styles.actionRow}>
          <AppButton
            title={walletBlocked ? 'Recarregar saldo' : 'Ver carteira'}
            variant={walletBlocked ? 'primary' : 'ghost'}
            onPress={openWallet}
          />
          <AppButton title="Ver assinatura" variant="ghost" onPress={openSubscription} />
        </View>
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
  performanceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
  metricDetail: { fontFamily, color: colors.textMuted, ...typography.caption, lineHeight: 15 },
  performanceNote: { fontFamily, color: colors.textMuted, ...typography.caption },
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
  walletAlert: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  walletAlertTitle: { fontFamily, color: colors.warning, ...typography.bodyBold },
  walletAlertText: { fontFamily, color: colors.text, ...typography.small, lineHeight: 19 },
  historySection: { gap: spacing.md },
  historySectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  historySectionCopy: { flex: 1, gap: 3 },
  historyIntro: { fontFamily, color: colors.textMuted, ...typography.caption, lineHeight: 16 },
  historyLoading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  historyList: { gap: 0 },
  historyRow: { gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  historyHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  historyHeaderCopy: { flex: 1, gap: 2 },
  historyPassenger: { fontFamily, color: colors.text, ...typography.bodyBold },
  historyDate: { fontFamily, color: colors.textMuted, ...typography.caption },
  historyAmountCopy: { alignItems: 'flex-end', gap: 2 },
  historyAmount: { fontFamily, color: colors.primary, ...typography.bodyBold },
  historyFareDetail: { fontFamily, color: colors.textMuted, ...typography.caption },
  routeBox: { gap: 3 },
  routeLine: { fontFamily, color: colors.text, ...typography.small, lineHeight: 18 },
  historyMetaRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  historyMeta: { fontFamily, color: colors.textMuted, ...typography.caption },
  historyStatus: { flexShrink: 1, fontFamily, ...typography.caption, fontWeight: '700' },
  historyErrorBox: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerBg },
  historyError: { fontFamily, color: colors.danger, ...typography.small },
  historyEmpty: { fontFamily, color: colors.textMuted, ...typography.small },
  footerRow: { gap: spacing.xs },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  syncNote: { fontFamily, color: colors.textMuted, ...typography.caption },
});
