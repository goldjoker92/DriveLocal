// Pending drivers (route "/drivers-pending"). Iteration 1A.
// Lists drivers where verificationStatus == "pending_review" from Firestore.

import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import DriverStatusBadge from '../../components/DriverStatusBadge';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth, db } from '../../config/firebase';
import { getPendingDrivers } from '../../services/driverService';

export default function DriversPending() {
  const router = useRouter();
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Garde admin : l'utilisateur courant doit exister dans admins/{uid}.
  useEffect(() => {
    let active = true;
    const uid = auth.currentUser && auth.currentUser.uid;
    console.log('[ADMIN] guard check drivers-pending uid=', uid);
    if (!uid) {
      router.replace('/(auth)/login');
      return undefined;
    }
    getDoc(doc(db, 'admins', uid))
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          console.log('[ADMIN] guard failed drivers-pending -> /(auth)/login');
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

  useEffect(() => {
    let active = true;
    getPendingDrivers()
      .then((list) => {
        if (active) setPending(list);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os motoristas pendentes.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function driverName(d) {
    return d.fullName || d.displayName || d.email || d.id;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Motoristas pendentes" onBack={() => router.back()} />
        <AppCard>
          {loading ? (
            <AdminTableRow label="Carregando..." />
          ) : error ? (
            <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
          ) : pending.length === 0 ? (
            <AdminTableRow label="Nenhum motorista pendente" />
          ) : (
            pending.map((d) => (
              <AdminTableRow
                key={d.id}
                label={driverName(d)}
                right={<DriverStatusBadge status="pending" />}
              />
            ))
          )}
        </AppCard>

        {/* One detail link per pending driver, carrying the real driverId. */}
        {pending.map((d) => (
          <AppButton
            key={`open-${d.id}`}
            title={`Abrir detalhe — ${driverName(d)}`}
            variant="secondary"
            onPress={() =>
              router.push({ pathname: '/(admin)/driver-detail', params: { driverId: d.id } })
            }
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
