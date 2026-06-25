// Admin home (route "/admin-home").
// Placeholder dashboard: KPI tiles + a simple drivers table from mock data.

import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AdminStatCard from '../../components/AdminStatCard';
import AdminTableRow from '../../components/AdminTableRow';
import DriverStatusBadge from '../../components/DriverStatusBadge';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockDrivers } from '../../mock/mockDrivers';
import { mockUsers } from '../../mock/mockUsers';
import { mockRides } from '../../mock/mockRides';

export default function AdminHome() {
  const router = useRouter();
  const approved = mockDrivers.filter((d) => d.approved).length;
  const pending = mockDrivers.filter((d) => !d.approved).length;
  const passengers = mockUsers.filter((u) => u.role === 'passenger').length;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['top', 'bottom']}
    >
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Admin" subtitle="Horizonte / CE" onBack={() => router.back()} />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          <AdminStatCard label="Motoristas aprovados" value={String(approved)} />
          <AdminStatCard label="Aguardando aprovação" value={String(pending)} />
          <AdminStatCard label="Passageiros" value={String(passengers)} />
          <AdminStatCard label="Corridas (mock)" value={String(mockRides.length)} />
        </View>

        <AppCard>
          {mockDrivers.map((d) => (
            <AdminTableRow
              key={d.id}
              label={d.name}
              right={<DriverStatusBadge status={d.approved ? 'online' : 'pending'} />}
            />
          ))}
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
