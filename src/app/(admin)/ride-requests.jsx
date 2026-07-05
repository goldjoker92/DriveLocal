// Admin ride requests (route "/(admin)/ride-requests"). Iteration 3A.
// Read-only live list of PENDING passenger ride requests. No accept, no
// dispatch, no assignment — those are later iterations. Admin-only guard.

import { useEffect, useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth, db } from '../../config/firebase';
import { RIDE_REQUEST_PENDING } from '../../constants/rideRequestStatuses';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';

export default function RideRequests() {
  const router = useRouter();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Admin guard: the current user must exist in admins/{uid}.
  useEffect(() => {
    let active = true;
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      router.replace('/(auth)/login');
      return undefined;
    }
    getDoc(doc(db, 'admins', uid))
      .then((snap) => {
        if (active && !snap.exists()) router.replace('/(auth)/login');
      })
      .catch(() => {
        if (active) router.replace('/(auth)/login');
      });
    return () => {
      active = false;
    };
  }, []);

  // Live listener on pending ride requests.
  useEffect(() => {
    const q = query(collection(db, 'rideRequests'), where('status', '==', RIDE_REQUEST_PENDING));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setRequests(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError('');
      },
      (e) => {
        console.log('[ADMIN] ride-requests snapshot error', e.message);
        setError('Não foi possível carregar as solicitações.');
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Solicitações de corrida" subtitle="Pendentes — Horizonte / CE" onBack={() => router.back()} />

        {error ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
        ) : null}

        {loading ? (
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>Carregando…</Text>
        ) : requests.length === 0 ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>
              Nenhuma solicitação pendente.
            </Text>
          </AppCard>
        ) : (
          requests.map((r) => (
            <AppCard key={r.id}>
              <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
                {r.passengerName || 'Passageiro'}
              </Text>
              <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
                {(VEHICLE_LABELS_PT_BR[r.vehicleType] || r.vehicleType || '—')} · {r.passengerPhone || '—'}
              </Text>
              <View style={{ marginTop: spacing.xs, gap: 2 }}>
                <Text style={[{ fontFamily, color: colors.text }, typography.small]}>
                  Origem: {r.originText || '—'}
                </Text>
                {r.originReferenceText ? (
                  <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
                    Ref: {r.originReferenceText}
                  </Text>
                ) : null}
                <Text style={[{ fontFamily, color: colors.text }, typography.small]}>
                  Destino: {r.destinationText || '—'}
                </Text>
              </View>
            </AppCard>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
