// Full authenticated driver history. Pages come from getDriverRideHistorySecure;
// this screen never reads private rideRequests or passenger profiles directly.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { loadDriverRideHistoryPage } from '../../services/driverRideHistoryService';
import {
  appendDriverHistoryPages,
  normalizeDriverHistoryPage,
} from '../../utils/driverRideHistory';

function statusColor(tone) {
  if (tone === 'success') return colors.success;
  if (tone === 'warning') return colors.warning;
  if (tone === 'danger') return colors.danger;
  if (tone === 'info') return colors.primary;
  return colors.textMuted;
}

function RideHistoryRow({ item }) {
  const router = useRouter();
  return (
    <AppCard style={styles.rideCard}>
      <AppButton title="MENSAGENS DA CORRIDA" variant="ghost"
        onPress={() => router.push({ pathname: '/driver-ride-messages', params: { rideId: item.rideId } })} />
      <View style={styles.rideHeader}>
        <View style={styles.rideHeaderCopy}>
          <Text style={styles.passengerName}>{item.passengerFirstName}</Text>
          <Text style={styles.dateLabel}>{item.dateLabel}</Text>
        </View>
        <View style={styles.amountCopy}>
          <Text style={styles.amountLabel}>{item.fareLabel}</Text>
          {item.fareDetail ? <Text style={styles.smallMuted}>{item.fareDetail}</Text> : null}
        </View>
      </View>

      <View style={styles.routeBox}>
        <View style={styles.routeRow}>
          <Text style={styles.routeIcon}>📍</Text>
          <View style={styles.routeCopy}>
            <Text style={styles.routeCaption}>PARTIDA</Text>
            <Text style={styles.routeText}>{item.pickupLabel}</Text>
          </View>
        </View>
        <View style={styles.routeDivider} />
        <View style={styles.routeRow}>
          <Text style={styles.routeIcon}>🏁</Text>
          <View style={styles.routeCopy}>
            <Text style={styles.routeCaption}>DESTINO</Text>
            <Text style={styles.routeText}>{item.destinationLabel}</Text>
          </View>
        </View>
      </View>

      <View style={styles.detailsGrid}>
        <View style={styles.detailCell}>
          <Text style={styles.detailLabel}>Veículo</Text>
          <Text style={styles.detailValue}>{item.vehicleLabel}</Text>
        </View>
        <View style={styles.detailCell}>
          <Text style={styles.detailLabel}>Taxa da plataforma</Text>
          <Text style={styles.detailValue}>{item.commissionLabel}</Text>
        </View>
      </View>

      <View style={styles.statusBox}>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Corrida</Text>
          <Text style={[styles.statusValue, { color: statusColor(item.rideStatusTone) }]}>
            {item.rideStatusLabel}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Pix</Text>
          <Text style={[styles.statusValue, { color: statusColor(item.pixStatusTone) }]}>
            {item.pixStatusLabel}
          </Text>
        </View>
      </View>
    </AppCard>
  );
}

export default function DriverRideHistory() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadFirstPage = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const snapshot = await loadDriverRideHistoryPage({ limit: 20 });
      const page = normalizeDriverHistoryPage(snapshot);
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setError('');
    } catch (loadError) {
      setError(loadError?.message || 'Não foi possível carregar seu histórico de corridas.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore() {
    if (!hasMore || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const snapshot = await loadDriverRideHistoryPage({ limit: 20, cursor: nextCursor });
      const page = normalizeDriverHistoryPage(snapshot);
      setItems((current) => appendDriverHistoryPages(current, page.items));
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setError('');
    } catch (loadError) {
      setError(loadError?.message || 'Não foi possível carregar mais corridas.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Header title="Histórico de corridas" onBack={() => router.back()} />

        <AppCard style={styles.introCard}>
          <View style={styles.introHeader}>
            <View style={styles.introCopy}>
              <Text style={styles.eyebrow}>SEUS REGISTROS REAIS</Text>
              <Text style={styles.introTitle}>Corridas aceitas e pagamentos Pix</Text>
              <Text style={styles.introText}>
                Veja data, passageiro, trajeto, veículo, valor, taxa da plataforma e o estado final do Pix. Os dados vêm do servidor e podem levar alguns segundos para refletir uma corrida recém-concluída.
              </Text>
            </View>
            <AppButton
              title={refreshing ? 'ATUALIZANDO…' : 'ATUALIZAR'}
              variant="ghost"
              onPress={() => loadFirstPage({ refresh: true })}
              disabled={refreshing || loading}
            />
          </View>
        </AppCard>

        {loading ? (
          <AppCard style={styles.centerCard}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.mutedText}>Carregando histórico seguro…</Text>
          </AppCard>
        ) : items.length > 0 ? (
          <View style={styles.list}>
            {items.map((item) => <RideHistoryRow key={item.rideId} item={item} />)}
          </View>
        ) : (
          <AppCard style={styles.centerCard}>
            <Text style={styles.emptyTitle}>Nenhuma corrida aceita ainda</Text>
            <Text style={styles.mutedText}>
              Quando você aceitar uma corrida, ela aparecerá aqui com o status da viagem e do Pix.
            </Text>
          </AppCard>
        )}

        {error ? (
          <AppCard style={styles.errorCard}>
            <Text style={styles.errorTitle}>Não foi possível atualizar tudo</Text>
            <Text style={styles.errorText}>{error}</Text>
            <AppButton title="TENTAR NOVAMENTE" variant="ghost" onPress={() => loadFirstPage()} />
          </AppCard>
        ) : null}

        {hasMore ? (
          <AppButton
            title={loadingMore ? 'CARREGANDO…' : 'CARREGAR MAIS CORRIDAS'}
            onPress={loadMore}
            disabled={loadingMore}
          />
        ) : items.length > 0 ? (
          <Text style={styles.endText}>Você chegou ao fim do histórico disponível.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, flexGrow: 1 },
  introCard: { gap: spacing.md },
  introHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  introCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { fontFamily, color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  introTitle: { fontFamily, color: colors.text, ...typography.h2 },
  introText: { fontFamily, color: colors.textMuted, ...typography.small, lineHeight: 19 },
  list: { gap: spacing.md },
  rideCard: { gap: spacing.md },
  rideHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  rideHeaderCopy: { flex: 1, gap: 2 },
  passengerName: { fontFamily, color: colors.text, ...typography.h2 },
  dateLabel: { fontFamily, color: colors.textMuted, ...typography.small },
  amountCopy: { alignItems: 'flex-end', gap: 2 },
  amountLabel: { fontFamily, color: colors.primary, ...typography.h2 },
  smallMuted: { fontFamily, color: colors.textMuted, ...typography.caption },
  routeBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primaryTint, gap: spacing.sm },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  routeIcon: { fontSize: 16 },
  routeCopy: { flex: 1, gap: 2 },
  routeCaption: { fontFamily, color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  routeText: { fontFamily, color: colors.text, ...typography.small, lineHeight: 18 },
  routeDivider: { height: 1, marginLeft: 26, backgroundColor: colors.border },
  detailsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  detailCell: { flexGrow: 1, flexBasis: 130, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 3 },
  detailLabel: { fontFamily, color: colors.textMuted, ...typography.caption },
  detailValue: { fontFamily, color: colors.text, ...typography.bodyBold },
  statusBox: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  statusLabel: { fontFamily, color: colors.textMuted, ...typography.small },
  statusValue: { flex: 1, textAlign: 'right', fontFamily, ...typography.small, fontWeight: '700' },
  centerCard: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { fontFamily, color: colors.text, ...typography.bodyBold, textAlign: 'center' },
  mutedText: { fontFamily, color: colors.textMuted, ...typography.small, textAlign: 'center', lineHeight: 19 },
  errorCard: { gap: spacing.sm, backgroundColor: colors.dangerBg, borderColor: colors.danger },
  errorTitle: { fontFamily, color: colors.danger, ...typography.bodyBold },
  errorText: { fontFamily, color: colors.text, ...typography.small },
  endText: { fontFamily, color: colors.textMuted, ...typography.caption, textAlign: 'center', paddingVertical: spacing.md },
});
