// ============================================================
// Admin home / console dashboard (route "/(admin)/admin-home").
// Iteration 1C — operational admin console for driver approval.
//
// Data: a single real-time Firestore listener on the "drivers" collection.
// All counts are derived client-side. KPI tiles are clickable and navigate to
// the filtered drivers list. Rides + Financeiro are placeholders ("Em breve")
// because those modules do not exist yet — we never show fake data as real.
//
// Admin-only: the screen mounts an admins/{uid} guard. Snapshot errors are
// surfaced as a UI message, never a red screen.
// ============================================================

import { useEffect, useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import Header from '../../components/Header';
import AdminStatCard from '../../components/AdminStatCard';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth, db } from '../../config/firebase';
import { VERIFICATION_STATUS } from '../../constants/driverStatuses';
import { RIDE_REQUEST_PENDING } from '../../constants/rideRequestStatuses';

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

// Small note shown once under a "coming soon" section (never inside each card).
function ComingSoonNote({ children }) {
  return (
    <Text style={[{ fontFamily, color: colors.textFaint }, typography.small]}>{children}</Text>
  );
}

// Width for one cell of the 2-column grid.
const CELL = { width: '48%' };

export default function AdminHome() {
  const router = useRouter();
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Iteration 3A: live count of pending passenger ride requests.
  const [rideRequestsPending, setRideRequestsPending] = useState(0);
  const [reqLoading, setReqLoading] = useState(true);

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

  // Real-time count of pending ride requests. Errors are logged, not shown, so
  // they never disrupt the drivers console. (Iteration 3A.)
  useEffect(() => {
    const q = query(collection(db, 'rideRequests'), where('status', '==', RIDE_REQUEST_PENDING));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setRideRequestsPending(snapshot.size);
        setReqLoading(false);
      },
      (e) => {
        console.log('[ADMIN] admin-home rideRequests snapshot error', e.message);
        setReqLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Counts per verificationStatus.
  const countBy = (status) => drivers.filter((d) => d.verificationStatus === status).length;
  const pendingCount = countBy(VERIFICATION_STATUS.PENDING_REVIEW);
  const approvedCount = countBy(VERIFICATION_STATUS.APPROVED);
  const correctionCount = countBy(VERIFICATION_STATUS.CORRECTION_REQUESTED);
  const rejectedCount = countBy(VERIFICATION_STATUS.REJECTED);
  const suspendedCount = countBy(VERIFICATION_STATUS.SUSPENDED);
  // "Documentos com alerta": drivers flagged as possible duplicates.
  const alertCount = drivers.filter((d) => d.duplicateCheckStatus === 'warning').length;

  // Navigate to the drivers list filtered by a verificationStatus (or "all").
  function openList(status) {
    console.log('[ADMIN] open drivers list status=', status);
    router.push({ pathname: '/(admin)/drivers', params: { status } });
  }

  const loadingValue = (value) => (loading ? '…' : String(value));

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

        {/* SOLICITAÇÕES DE CORRIDA — real pending count (Iteration 3A). Clickable. */}
        <Section title="SOLICITAÇÕES DE CORRIDA">
          <Grid>
            <AdminStatCard
              style={CELL}
              label="Corridas pendentes"
              value={reqLoading ? '…' : String(rideRequestsPending)}
              onPress={() => router.push('/(admin)/ride-requests')}
            />
          </Grid>
        </Section>

        {/* CORRIDAS — module not built yet: real zeros + single "em breve" note, never mock. */}
        <Section title="CORRIDAS">
          <Grid>
            <AdminStatCard style={CELL} label="Hoje" value="0" />
            <AdminStatCard style={CELL} label="Mês" value="0" />
            <AdminStatCard style={CELL} label="Ano" value="0" />
          </Grid>
          <ComingSoonNote>Em breve após ativação das corridas</ComingSoonNote>
        </Section>

        {/* FINANCEIRO — module not built yet. */}
        <Section title="FINANCEIRO">
          <Grid>
            <AdminStatCard style={CELL} label="Comissões hoje" value="R$0,00" />
            <AdminStatCard style={CELL} label="Comissões mês" value="R$0,00" />
            <AdminStatCard style={CELL} label="Saldo baixo" value="0" />
          </Grid>
          <ComingSoonNote>Em breve</ComingSoonNote>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
