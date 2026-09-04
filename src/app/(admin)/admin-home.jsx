// ============================================================
// Admin home / console dashboard (route "/(admin)/admin-home").
// Iteration 1C — operational admin console for driver approval.
//
// Data: driver moderation keeps its existing real-time Firestore listener.
// Ride KPIs come from the existing privacy-safe admin analytics callable, so
// every created request is counted without downloading passenger ride records.
//
// Admin-only: the screen mounts an admins/{uid} guard. Snapshot errors are
// surfaced as a UI message, never a red screen.
// ============================================================

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { collection, onSnapshot, doc, getDoc } from 'firebase/firestore';
import Header from '../../components/Header';
import AdminStatCard from '../../components/AdminStatCard';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth, db } from '../../config/firebase';
import { VERIFICATION_STATUS } from '../../constants/driverStatuses';
import { getAdminBusinessAnalytics } from '../../services/adminService';
import { formatBRL } from '../../utils/format';
import {
  ADMIN_RIDE_METRIC_PERIODS,
  deriveAdminRideMetrics,
  formatAdminRideDecimal,
  formatAdminRideHour,
  formatAdminRideRate,
} from '../../utils/adminRideMetrics';

// A titled section: caption title once, then its content below. Vertical
// spacing between sections is handled by the ScrollView's `gap`.
function Section({ title, children }) {
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>{title}</Text>
      {children}
    </View>
  );
}

// 2-column KPI grid. Percentage widths + space-between + rowGap is the stable
// Android pattern (no flex, no minWidth, no absolute/negative margins), so
// cards never overlap and a lone last card simply left-aligns.
function Grid({ children }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        rowGap: spacing.md,
      }}
    >
      {children}
    </View>
  );
}

function RidePeriodSelector({ selectedDays, onSelect }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {ADMIN_RIDE_METRIC_PERIODS.map((period) => {
        const selected = selectedDays === period.days;
        return (
          <Pressable
            key={period.days}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(period.days)}
            style={({ pressed }) => ({
              borderRadius: radius.full,
              borderWidth: 1,
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? colors.primary : colors.card,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              opacity: pressed ? 0.68 : 1,
            })}
          >
            <Text style={[
              { fontFamily, color: selected ? colors.onPrimary : colors.textMuted },
              typography.small,
            ]}>
              {period.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Width for one cell of the 2-column grid.
const CELL = { width: '48%' };

export default function AdminHome() {
  const router = useRouter();
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rideRangeDays, setRideRangeDays] = useState(1);
  const [rideAnalytics, setRideAnalytics] = useState(null);
  const [rideMetricsLoading, setRideMetricsLoading] = useState(true);
  const [rideMetricsError, setRideMetricsError] = useState('');
  const [rideMetricsRefreshKey, setRideMetricsRefreshKey] = useState(0);

  // Garde admin : l'utilisateur courant doit exister dans admins/{uid}.
  useEffect(() => {
    let active = true;
    const uid = auth.currentUser && auth.currentUser.uid;
    console.log('[ADMIN] guard check admin-home uid=', uid);
    if (!uid) {
      router.replace('/(auth)/login');
      return undefined;
    }
    getDoc(doc(db, 'admins', uid))
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          console.log('[ADMIN] guard failed admin-home -> /(auth)/login');
          router.replace('/(auth)/login');
        }
      })
      .catch(() => {
        if (active) router.replace('/(auth)/login');
      });
    return () => {
      active = false;
    };
  }, []);

  // Real-time listener on the drivers collection. Errors -> UI message.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'drivers'),
      (snapshot) => {
        setDrivers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError('');
      },
      (e) => {
        console.log('[ADMIN] admin-home snapshot error', e.message);
        setError('Não foi possível carregar os motoristas.');
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // One bounded server aggregate per selected period. This is intentionally not
  // a raw rideRequests listener: it is cheaper, privacy-safe and includes every
  // terminal outcome (including no_driver_available and cancelled).
  useEffect(() => {
    let active = true;
    const startedAtMs = Date.now();
    setRideAnalytics(null);
    setRideMetricsLoading(true);
    setRideMetricsError('');
    console.log('[ADMIN_RIDE_METRICS] load.started', { rangeDays: rideRangeDays });

    getAdminBusinessAnalytics(rideRangeDays)
      .then((result) => {
        if (!active) return;
        const metrics = deriveAdminRideMetrics(result);
        setRideAnalytics(result);
        setRideMetricsLoading(false);
        console.log('[ADMIN_RIDE_METRICS] load.succeeded', {
          rangeDays: rideRangeDays,
          durationMs: Date.now() - startedAtMs,
          requests: metrics.requests,
          truncated: metrics.ridesTruncated,
        });
      })
      .catch((e) => {
        if (!active) return;
        setRideMetricsError('Não foi possível carregar os indicadores de corridas.');
        setRideMetricsLoading(false);
        console.warn('[ADMIN_RIDE_METRICS] load.failed', {
          rangeDays: rideRangeDays,
          durationMs: Date.now() - startedAtMs,
          reason: e?.code || e?.name || 'unknown',
        });
      });

    return () => {
      active = false;
    };
  }, [rideRangeDays, rideMetricsRefreshKey]);

  // Counts per verificationStatus.
  const countBy = (status) => drivers.filter((d) => d.verificationStatus === status).length;
  const pendingCount = countBy(VERIFICATION_STATUS.PENDING_REVIEW);
  const approvedCount = countBy(VERIFICATION_STATUS.APPROVED);
  const correctionCount = countBy(VERIFICATION_STATUS.CORRECTION_REQUESTED);
  const rejectedCount = countBy(VERIFICATION_STATUS.REJECTED);
  const suspendedCount = countBy(VERIFICATION_STATUS.SUSPENDED);
  // "Documentos com alerta": drivers flagged as possible duplicates.
  const alertCount = drivers.filter((d) => d.duplicateCheckStatus === 'warning').length;
  const rideMetrics = deriveAdminRideMetrics(rideAnalytics);

  // Navigate to the drivers list filtered by a verificationStatus (or "all").
  function openList(status) {
    console.log('[ADMIN] open drivers list status=', status);
    router.push({ pathname: '/(admin)/drivers', params: { status } });
  }

  const loadingValue = (value) => (loading ? '…' : String(value));
  const rideValue = (value) => (
    rideMetricsLoading ? '…' : rideAnalytics ? String(value) : '—'
  );
  const rideRateHint = (value) => (
    rideAnalytics ? formatAdminRideRate(value) : undefined
  );
  const openRideDashboard = () => router.push('/(admin)/dashboard');
  const peakDemandValue = rideMetricsLoading
    ? '…'
    : rideAnalytics && rideMetrics.peakDemandRequests > 0
      ? formatAdminRideHour(rideMetrics.peakDemandHour)
      : '—';
  const peakUnservedValue = rideMetricsLoading
    ? '…'
    : rideAnalytics && rideMetrics.peakUnservedRequests > 0
      ? formatAdminRideHour(rideMetrics.peakUnservedHour)
      : '—';
  const peakDayValue = rideMetricsLoading
    ? '…'
    : rideAnalytics && rideMetrics.peakDayRequests > 0
      ? rideMetrics.peakDayLabel
      : '—';
  const peakPressureValue = rideMetricsLoading
    ? '…'
    : !rideAnalytics || rideMetrics.peakPressureHour == null
      ? '—'
      : rideMetrics.peakPressureHasNoAvailableDriver
        ? 'Sem oferta'
        : `${formatAdminRideDecimal(rideMetrics.peakPressureRequestsPerDriver)}×`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xl, flexGrow: 1 }}>
        <Header title="Admin" subtitle="Horizonte / CE" onBack={() => router.back()} />

        {error ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
        ) : null}

        <Section title="AÇÕES PENDENTES">
          <Grid>
            <AdminStatCard
              style={CELL}
              label="Aguardando aprovação"
              value={loadingValue(pendingCount)}
              onPress={() => openList(VERIFICATION_STATUS.PENDING_REVIEW)}
            />
            <AdminStatCard
              style={CELL}
              label="Correções enviadas"
              value={loadingValue(correctionCount)}
              onPress={() => openList(VERIFICATION_STATUS.CORRECTION_REQUESTED)}
            />
            <AdminStatCard
              style={CELL}
              label="Documentos com alerta"
              value={loadingValue(alertCount)}
              onPress={() => openList('all')}
            />
          </Grid>
        </Section>

        <Section title="MOTORISTAS">
          <Grid>
            <AdminStatCard
              style={CELL}
              label="Em análise"
              value={loadingValue(pendingCount)}
              onPress={() => openList(VERIFICATION_STATUS.PENDING_REVIEW)}
            />
            <AdminStatCard
              style={CELL}
              label="Aprovados"
              value={loadingValue(approvedCount)}
              onPress={() => openList(VERIFICATION_STATUS.APPROVED)}
            />
            <AdminStatCard
              style={CELL}
              label="Correção solicitada"
              value={loadingValue(correctionCount)}
              onPress={() => openList(VERIFICATION_STATUS.CORRECTION_REQUESTED)}
            />
            <AdminStatCard
              style={CELL}
              label="Recusados"
              value={loadingValue(rejectedCount)}
              onPress={() => openList(VERIFICATION_STATUS.REJECTED)}
            />
            <AdminStatCard
              style={CELL}
              label="Suspensos"
              value={loadingValue(suspendedCount)}
              onPress={() => openList(VERIFICATION_STATUS.SUSPENDED)}
            />
            <AdminStatCard
              style={CELL}
              label="Todos"
              value={loadingValue(drivers.length)}
              onPress={() => openList('all')}
            />
          </Grid>
        </Section>

        <Section title="CORRIDAS">
          <RidePeriodSelector selectedDays={rideRangeDays} onSelect={setRideRangeDays} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Atualizar indicadores de corridas"
            disabled={rideMetricsLoading}
            onPress={() => setRideMetricsRefreshKey((value) => value + 1)}
            style={({ pressed }) => ({
              alignSelf: 'flex-start',
              borderRadius: radius.full,
              borderWidth: 1,
              borderColor: colors.primary,
              backgroundColor: colors.primaryTint,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              opacity: rideMetricsLoading ? 0.5 : pressed ? 0.65 : 1,
            })}
          >
            <Text style={[{ fontFamily, color: colors.primary }, typography.small]}>
              {rideMetricsLoading ? 'ATUALIZANDO…' : '↻ ATUALIZAR'}
            </Text>
          </Pressable>

          {rideMetricsError ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>
                {rideMetricsError}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setRideMetricsRefreshKey((value) => value + 1)}
                style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.65 : 1 })}
              >
                <Text style={[{ fontFamily, color: colors.primary }, typography.small]}>
                  TENTAR NOVAMENTE
                </Text>
              </Pressable>
            </View>
          ) : null}

          <Grid>
            <AdminStatCard
              style={CELL}
              label="Solicitações"
              value={rideValue(rideMetrics.requests)}
              onPress={openRideDashboard}
            />
            <AdminStatCard
              style={CELL}
              label="Atribuídas"
              value={rideValue(rideMetrics.assigned)}
              hint={rideRateHint(rideMetrics.assignmentRate)}
              onPress={openRideDashboard}
            />
            <AdminStatCard
              style={CELL}
              label="Iniciadas"
              value={rideValue(rideMetrics.started)}
              hint={rideRateHint(rideMetrics.startRate)}
              onPress={openRideDashboard}
            />
            <AdminStatCard
              style={CELL}
              label="Concluídas"
              value={rideValue(rideMetrics.completed)}
              hint={rideRateHint(rideMetrics.completionRate)}
              onPress={openRideDashboard}
            />
            <AdminStatCard
              style={CELL}
              label="Sem motorista"
              value={rideValue(rideMetrics.noDriverAvailable)}
              hint={rideRateHint(rideMetrics.unservedRate)}
              onPress={openRideDashboard}
            />
            <AdminStatCard
              style={CELL}
              label="Canceladas"
              value={rideValue(rideMetrics.cancelled)}
              hint={rideRateHint(rideMetrics.cancellationRate)}
              onPress={openRideDashboard}
            />
          </Grid>

          {rideMetrics.ridesTruncated ? (
            <Text style={[{ fontFamily, color: colors.warning }, typography.small]}>
              Totais parciais: a consulta atingiu o limite de segurança.
            </Text>
          ) : null}
        </Section>

        <Section title="PICOS E DEMANDA">
          <Grid>
            <AdminStatCard
              style={CELL}
              label="Hora com mais solicitações"
              value={peakDemandValue}
              hint={rideAnalytics && rideMetrics.peakDemandRequests > 0
                ? `${rideMetrics.peakDemandRequests} pedido(s)`
                : undefined}
              onPress={openRideDashboard}
            />
            <AdminStatCard
              style={CELL}
              label="Hora crítica sem motorista"
              value={peakUnservedValue}
              hint={rideAnalytics && rideMetrics.peakUnservedRequests > 0
                ? `${rideMetrics.peakUnservedRequests} pedido(s) não atendido(s)`
                : undefined}
              onPress={openRideDashboard}
            />
            <AdminStatCard
              style={CELL}
              label="Dia mais ativo"
              value={peakDayValue}
              hint={rideAnalytics && rideMetrics.peakDayRequests > 0
                ? `${rideMetrics.peakDayRequests} pedido(s)`
                : undefined}
              onPress={openRideDashboard}
            />
            <AdminStatCard
              style={CELL}
              label="Pressão máxima"
              value={peakPressureValue}
              hint={rideAnalytics && rideMetrics.peakPressureHour != null
                ? `${formatAdminRideHour(rideMetrics.peakPressureHour)} · ${rideMetrics.peakPressureRequests} pedido(s)`
                : undefined}
              onPress={openRideDashboard}
            />
            <AdminStatCard
              style={CELL}
              label="Solicitações Moto"
              value={rideValue(rideMetrics.motoRequests)}
              hint={rideAnalytics
                ? `${formatAdminRideRate(rideMetrics.motoCompletionRate)} concluídas`
                : undefined}
              onPress={openRideDashboard}
            />
            <AdminStatCard
              style={CELL}
              label="Solicitações Carro"
              value={rideValue(rideMetrics.carRequests)}
              hint={rideAnalytics
                ? `${formatAdminRideRate(rideMetrics.carCompletionRate)} concluídas`
                : undefined}
              onPress={openRideDashboard}
            />
          </Grid>
        </Section>

        <Section title="OPERAÇÃO E RECEITA">
          <Grid>
            <AdminStatCard
              style={CELL}
              label="Online no último snapshot"
              value={rideValue(rideMetrics.onlineDrivers)}
              onPress={openRideDashboard}
            />
            <AdminStatCard
              style={CELL}
              label="Disponíveis no último snapshot"
              value={rideValue(rideMetrics.availableDrivers)}
              onPress={openRideDashboard}
            />
            <AdminStatCard
              style={CELL}
              label="Comissão capturada"
              value={rideMetricsLoading ? '…' : rideAnalytics
                ? formatBRL(rideMetrics.commissionCapturedCentavos)
                : '—'}
              hint={rideAnalytics
                ? rideMetrics.commissionCaptureRate == null
                  ? 'Sem comissão esperada'
                  : formatAdminRideRate(rideMetrics.commissionCaptureRate)
                : undefined}
              onPress={openRideDashboard}
            />
            <AdminStatCard
              style={CELL}
              label="Comissão esperada"
              value={rideMetricsLoading ? '…' : rideAnalytics
                ? formatBRL(rideMetrics.commissionExpectedCentavos)
                : '—'}
              onPress={openRideDashboard}
            />
          </Grid>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
