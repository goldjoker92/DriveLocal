// Incoming targeted ride offer (route "/ride-request").
// Before acceptance only a generic/coarsened pickup region is shown. Acceptance
// and refusal are server-authoritative; expired offers close automatically.

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { formatBRL, formatDistanceKm } from '../../utils/format';
import { auth } from '../../config/firebase';
import { listenToMyOffer, acceptOffer, declineOffer } from '../../services/ridesService';
import { openWazeToPoint, openGoogleMapsToPoint } from '../../utils/maps';

export default function RideRequest() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const requestedOfferId = typeof params.offerId === 'string' ? params.offerId : null;
  const [offer, setOffer] = useState(null);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [acceptError, setAcceptError] = useState('');
  const [accepted, setAccepted] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;
    return listenToMyOffer(uid, (o) => {
      if (requestedOfferId && o?.offerId !== requestedOfferId && o?.status !== 'accepted') return;
      setOffer(o);
      if (o?.status === 'accepted' && o.exactPickup) {
        setAccepted({ rideId: o.rideId, pickup: o.exactPickup, vehicleType: o.vehicleType });
      }
    }, () => setOffer(null));
  }, [requestedOfferId]);

  useEffect(() => {
    if (!offer?.expiresAtMs || offer.status !== 'offered') return undefined;
    let expiring = false;
    const tick = async () => {
      const remaining = Math.max(0, Math.ceil((Number(offer.expiresAtMs) - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0 && !expiring) {
        expiring = true;
        try { await declineOffer(offer.offerId, 'expired'); } catch (_error) {}
        setOffer(null);
        router.replace('/driver-home');
      }
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [offer?.offerId, offer?.expiresAtMs, offer?.status, router]);

  async function handleAccept() {
    if (!offer || accepting || secondsLeft <= 0) return;
    setAccepting(true);
    setAcceptError('');
    try {
      const result = await acceptOffer(offer.offerId);
      setAccepted(result);
    } catch (e) {
      setAcceptError(e?.message || 'Não foi possível aceitar a corrida. Talvez outro motorista tenha aceitado antes.');
    } finally {
      setAccepting(false);
    }
  }

  async function handleDecline() {
    if (!offer || declining) return;
    setDeclining(true);
    setAcceptError('');
    try {
      await declineOffer(offer.offerId, 'driver_declined');
      router.replace('/driver-home');
    } catch (e) {
      setAcceptError(e?.message || 'Não foi possível recusar a oferta.');
    } finally {
      setDeclining(false);
    }
  }

  async function openNav(which) {
    if (!accepted?.pickup) return;
    setAcceptError('');
    try {
      if (which === 'waze') await openWazeToPoint(accepted.pickup, accepted.vehicleType);
      else await openGoogleMapsToPoint(accepted.pickup, accepted.vehicleType);
    } catch (_e) {
      setAcceptError(which === 'waze'
        ? 'Não foi possível abrir o Waze. Tente o Google Maps.'
        : 'Não foi possível abrir o Google Maps. Tente o Waze.');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Nova corrida" subtitle={accepted ? 'Corrida aceita' : `Responda em ${secondsLeft}s`} />

        {accepted ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Corrida aceita!</Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              O endereço exato do embarque já está liberado.
            </Text>
            <View style={{ gap: spacing.sm }}>
              <AppButton title="Abrir no Waze" onPress={() => openNav('waze')} />
              <AppButton title="Abrir no Google Maps" onPress={() => openNav('gmaps')} />
            </View>
            <AppButton title="Ir para a corrida" variant="ghost"
              onPress={() => router.replace({ pathname: '/active-ride', params: { rideId: accepted.rideId } })} />
          </AppCard>
        ) : offer ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Corrida disponível</Text>
            <Text style={[{ fontFamily, color: secondsLeft <= 5 ? colors.danger : colors.primary }, typography.bodyBold]}>
              {secondsLeft}s para responder
            </Text>
            <AdminTableRow label="Embarque" value={offer.pickupPreview?.label || 'Região do embarque'} />
            <AdminTableRow label="Distância até o embarque" value={formatDistanceKm(offer.distanceToPickupMeters)} />
            <AdminTableRow label="Valor estimado" value={formatBRL(offer.estimatedFareCentavos)} />
            <AdminTableRow label="Destino" value="Liberado após o início da corrida" />
            <AppButton title={accepting ? 'Aceitando…' : 'Aceitar corrida'} onPress={handleAccept}
              disabled={accepting || declining || secondsLeft <= 0} />
            <AppButton title={declining ? 'Recusando…' : 'Recusar'} variant="ghost" onPress={handleDecline}
              disabled={accepting || declining} />
          </AppCard>
        ) : (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.textMuted, textAlign: 'center' }, typography.small]}>
              Nenhuma corrida disponível no momento.
            </Text>
          </AppCard>
        )}

        {acceptError ? <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{acceptError}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
