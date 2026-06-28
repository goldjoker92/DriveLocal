// Admin home (route "/admin-home").
// Dashboard: KPI tiles + a drivers table. Drivers come from a single real-time
// Firestore listener on the "drivers" collection; counts are derived client-side.
// Passengers + rides KPIs stay mock for now.

import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { collection, onSnapshot } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminStatCard from '../../components/AdminStatCard';
import AdminTableRow from '../../components/AdminTableRow';
import DriverStatusBadge from '../../components/DriverStatusBadge';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { db } from '../../config/firebase';
import { mockUsers } from '../../mock/mockUsers';
import { mockRides } from '../../mock/mockRides';

// Maps a verification status to the colored badge (which only knows a few tones).
function badgeStatus(status) {
  if (status === 'approved') return 'online';
  if (status === 'pending_review') return 'pending';
  return 'offline';
}

export default function AdminHome() {
  const router = useRouter();
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'drivers'), (snapshot) => {
      setDrivers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const approvedCount = drivers.filter((d) => d.verificationStatus === 'approved').length;
  const pendingCount = drivers.filter((d) => d.verificationStatus === 'pending_review').length;
  const passengers = mockUsers.filter((u) => u.role === 'passenger').length;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['top', 'bottom']}
    >
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Admin" subtitle="Horizonte / CE" onBack={() => router.back()} />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          <AdminStatCard
            label="Motoristas aprovados"
            value={loading ? 'Carregando...' : String(approvedCount)}
          />
          <AdminStatCard
            label="Aguardando aprovação"
            value={loading ? 'Carregando...' : String(pendingCount)}
          />
          <AdminStatCard label="Passageiros" value={String(passengers)} />
          <AdminStatCard label="Corridas (mock)" value={String(mockRides.length)} />
        </View>

        <AppButton
          title="Ver motoristas pendentes"
          variant="secondary"
          onPress={() => router.push('/(admin)/drivers-pending')}
        />

        <AppCard>
          {drivers.map((d) => (
            <AdminTableRow
              key={d.id}
              label={d.fullName || d.displayName || d.email || d.id}
              right={<DriverStatusBadge status={badgeStatus(d.verificationStatus)} />}
            />
          ))}
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
