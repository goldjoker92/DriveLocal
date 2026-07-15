// Incoming ride offer (route "/ride-request"). BLOCK 08 real flow.
//
// The driver reads ONLY their own targeted offer via a secured Firestore
// listener (driverOffers where driverId == uid). Acceptance goes through the
// secure callable acceptDriverOfferSecure (first valid acceptance wins,
// transactional, with the commission wallet hold). The client never writes the
// ride, offer, wallet, or driver financial fields.
//
// After acceptance the driver navigates to the PICKUP with Waze or Google Maps.
// Destination navigation is connected in BLOCK 09+10.

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { formatBRL, formatDistanceKm } from '../../utils/format';
import { auth } from '../../config/firebase';
import { listenToMyOffer, acceptOffer } from '../../services/ridesService';
import { openWazeToPoint, openGoogleMapsToPoint } from '../../utils/maps';

export default function RideRequest() {
  const router = useRouter();
  const [offer, setOffer] = useState(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState('');
  const [accepted, setAccepted] = useState(null); // { pickup, ... } after winning

  useEffect(() => {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) return undefined;
    const unsubscribe = listenToMyOffer(uid, (o) => setOffer(o), () => setOffer(null));
    return unsubscribe;
  }, []);

  async function handleAccept() {
    if (!offer || accepting) return;
    setAccepting(true);
    setAcceptError('');
    try {
      const result = await acceptOffer(offer.offerId);
      setAccepted(result); // carries the exact pickup for navigation
    } catch (e) {
      // Stable PT-BR message from the backend (e.g. corrida já aceita, oferta expirada).
      setAcceptError((e && e.message) || 'Não foi possível aceitar a corrida.');
    } finally {
      setAccepting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Nova corrida" subtitle="Aceite para iniciar" onBack={() => router.back()} />

        {accepted ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Corrida aceita!</Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Vá até o local de embarque do passageiro.
            </Text>
            <View style={{ gap: spacing.sm }}>
              <AppButton title="Abrir no Waze" onPress={() => openWazeToPoint(accepted.pickup)} />
              <AppButton
                title="Abrir no Google Maps"
                onPress={() => openGoogleMapsToPoint(accepted.pickup)}
              />
            </View>
            <AppButton title="Ir para a corrida" variant="ghost" onPress={() => router.replace({ pathname: '/active-ride', params: { rideId: accepted.rideId } })} />
          </AppCard>
        ) : offer ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Corrida disponível</Text>
            <AdminTableRow label="Embarque" value={offer.pickupPreview ? offer.pickupPreview.label : '—'} />
            <AdminTableRow label="Distância até o embarque" value={formatDistanceKm(offer.distanceToPickupMeters)} />
            <AdminTableRow label="Valor estimado" value={formatBRL(offer.estimatedFareCentavos)} />
            <AppButton title={accepting ? 'Aceitando…' : 'Aceitar corrida'} onPress={handleAccept} disabled={accepting} />
            <AppButton title="Recusar" variant="ghost" onPress={() => router.replace('/driver-home')} />
          </AppCard>
        ) : (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.textMuted, textAlign: 'center' }, typography.small]}>
              Nenhuma corrida disponível no momento.
            </Text>
          </AppCard>
        )}

        {acceptError ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{acceptError}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
