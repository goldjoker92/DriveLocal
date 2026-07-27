// Full authenticated passenger history. Pages come from
// getPassengerRideHistorySecure; this screen never reads private rideRequests or
// driver profiles directly.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import PassengerRideHistoryRow from '../../components/PassengerRideHistoryRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { loadPassengerRideHistoryPage } from '../../services/passengerRideHistoryService';
import {
  appendPassengerHistoryPages,
  normalizePassengerHistoryPage,
} from '../../utils/passengerRideHistory';

export default function PassengerRideHistory() {
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
      const snapshot = await loadPassengerRideHistoryPage({ limit: 20 });
      const page = normalizePassengerHistoryPage(snapshot);
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
      const snapshot = await loadPassengerRideHistoryPage({ limit: 20, cursor: nextCursor });
      const page = normalizePassengerHistoryPage(snapshot);
      setItems((current) => appendPassengerHistoryPages(current, page.items));
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
              <Text style={styles.introTitle}>Trajetos, motoristas e pagamentos</Text>
              <Text style={styles.introText}>
                Veja data, partida, destino, motorista, veículo, valor e status da corrida. Os dados vêm do servidor e podem levar alguns segundos para refletir uma corrida recém-finalizada.
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
            {items.map((item) => <PassengerRideHistoryRow key={item.rideId} item={item} />)}
          </View>
        ) : (
          <AppCard style={styles.centerCard}>
            <Text style={styles.emptyTitle}>Nenhuma corrida solicitada ainda</Text>
            <Text style={styles.mutedText}>
              Sua primeira solicitação aparecerá aqui com o motorista, o trajeto, o valor e o status do Pix.
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
  introCopy: { flex: 1, gap: 4 },
  eyebrow: { fontFamily, color: colors.primary, ...typography.caption, fontWeight: '800', letterSpacing: 0.8 },
  introTitle: { fontFamily, color: colors.text, ...typography.h3 },
  introText: { fontFamily, color: colors.textMuted, ...typography.small, lineHeight: 19 },
  list: { gap: spacing.md },
  centerCard: { alignItems: 'center', gap: spacing.sm },
  mutedText: { fontFamily, color: colors.textMuted, ...typography.small, textAlign: 'center' },
  emptyTitle: { fontFamily, color: colors.text, ...typography.bodyBold },
  errorCard: { gap: spacing.sm, borderWidth: 1, borderColor: colors.danger },
  errorTitle: { fontFamily, color: colors.danger, ...typography.bodyBold },
  errorText: { fontFamily, color: colors.text, ...typography.small },
  endText: { fontFamily, color: colors.textMuted, ...typography.caption, textAlign: 'center' },
});