// Admin dashboard (route "/dashboard"). BLOCK 11+12: real, bounded operational
// counts (pending drivers, disputed rides, active drivers) via admin-gated reads,
// plus safe navigation to the pilot admin operations. Counts use capped queries
// (a trailing "+" means the cap was reached) — no unbounded collection scans.

import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppButton from '../../components/AppButton';
import AdminStatCard from '../../components/AdminStatCard';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { listDriversByStatus, listDisputedRides } from '../../services/adminService';

const CAP = 50;
const fmt = (n) => (n >= CAP ? `${CAP}+` : String(n));

export default function Dashboard() {
  const router = useRouter();
  const [counts, setCounts] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [pending, active, disputed] = await Promise.all([
          listDriversByStatus('pending_review', CAP),
          listDriversByStatus('approved', CAP),
          listDisputedRides(CAP),
        ]);
        if (alive) setCounts({ pending: pending.length, active: active.length, disputed: disputed.length });
      } catch (e) {
        console.log('[ADMIN_DASHBOARD] counts error', e.message);
        if (alive) setError('Não foi possível carregar os indicadores.');
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Painel" subtitle="Horizonte / CE" onBack={() => router.back()} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md }}>
          <AdminStatCard style={{ width: '48%' }} label="Motoristas pendentes" value={counts ? fmt(counts.pending) : '…'} />
          <AdminStatCard style={{ width: '48%' }} label="Motoristas ativos" value={counts ? fmt(counts.active) : '…'} />
          <AdminStatCard style={{ width: '48%' }} label="Disputas abertas" value={counts ? fmt(counts.disputed) : '…'} hint={error || undefined} />
        </View>
        <AppButton title="Motoristas pendentes" onPress={() => router.push('/drivers-pending')} />
        <AppButton title="Disputas de corrida" variant="secondary" onPress={() => router.push('/ride-disputes')} />
        <AppButton title="Ajuste de saldo" variant="secondary" onPress={() => router.push('/wallet-adjust')} />
        <AppButton title="Recargas pendentes" variant="secondary" onPress={() => router.push('/topups-pending')} />
        <AppButton title="Corridas" variant="secondary" onPress={() => router.push('/rides')} />
        <AppButton title="Carteiras" variant="secondary" onPress={() => router.push('/wallets')} />
        <AppButton title="Relatórios" variant="secondary" onPress={() => router.push('/reports')} />
        <AppButton title="Painel resumido" variant="ghost" onPress={() => router.push('/admin-home')} />
      </ScrollView>
    </SafeAreaView>
  );
}
