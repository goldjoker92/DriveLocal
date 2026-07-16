// Active ride (route "/active-ride"). Real BLOCK 09+10 driver lifecycle.
//
// External navigation only (Waze / Google Maps deep links) — no in-app
// turn-by-turn, no live tracking. The driver reads only their own accepted offer
// (secured listener) for the EXACT pickup, and the EXACT destination once it is
// revealed at ride start. Local status advances from each secure callable's
// return; there is no fake success state. The driver cannot read the passenger's
// ride document (Rules), so status is driven by the driver's own actions.

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { openGoogleMapsToPoint, openWazeToPoint } from '../../utils/maps';
import {
  listenToMyOffer, markDriverArrived, startRide, finishRide, confirmDriverPixReceived, cancelRide, reportPaymentIssue,
} from '../../services/ridesService';

export default function ActiveRide() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;

  const [offer, setOffer] = useState(null); // own accepted offer (exactPickup / exactDestination)
  const [status, setStatus] = useState('assigned');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) return undefined;
    return listenToMyOffer(uid, (o) => o && setOffer(o), () => {});
  }, []);

  async function act(key, fn) {
    if (busy) return;
    setBusy(key);
    setError('');
    try {
      const res = await fn(rideId);
      if (res && res.status) setStatus(res.status);
      // Terminal states return the driver to the home panel.
      if (res && ['completed', 'cancelled', 'disputed'].includes(res.status)) router.replace('/driver-home');
    } catch (e) {
      setError((e && e.message) || 'Não foi possível concluir. Tente novamente.');
    } finally {
      setBusy('');
    }
  }

  async function openNav(point, which) {
    if (!point) return;
    setError('');
    try {
      if (which === 'waze') await openWazeToPoint(point);
      else await openGoogleMapsToPoint(point);
    } catch (_e) {
      setError(which === 'waze' ? 'Não foi possível abrir o Waze. Tente o Google Maps.' : 'Não foi possível abrir o Google Maps. Tente o Waze.');
    }
  }

  const pickup = offer && offer.exactPickup;
  const destination = offer && offer.exactDestination;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Corrida ativa" onBack={() => router.back()} />

        {(status === 'assigned' || status === 'driver_arrived') && pickup ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Ir buscar o passageiro</Text>
            <View style={{ gap: spacing.sm }}>
              <AppButton title="Abrir no Waze" onPress={() => openNav(pickup, 'waze')} />
              <AppButton title="Abrir no Google Maps" onPress={() => openNav(pickup, 'gmaps')} />
            </View>
          </AppCard>
        ) : null}

        {status === 'assigned' ? (
          <AppButton title={busy === 'arrive' ? 'Enviando…' : 'Cheguei ao local'} onPress={() => act('arrive', markDriverArrived)} disabled={!!busy} />
        ) : null}
        {status === 'driver_arrived' ? (
          <AppButton title={busy === 'start' ? 'Enviando…' : 'Passageiro embarcou'} onPress={() => act('start', startRide)} disabled={!!busy} />
        ) : null}

        {status === 'in_progress' ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Levar ao destino</Text>
            {destination ? (
              <View style={{ gap: spacing.sm }}>
                <AppButton title="Abrir no Waze" onPress={() => openNav(destination, 'waze')} />
                <AppButton title="Abrir no Google Maps" onPress={() => openNav(destination, 'gmaps')} />
              </View>
            ) : (
              <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>Carregando destino…</Text>
            )}
            <AppButton title={busy === 'finish' ? 'Enviando…' : 'Finalizar corrida'} onPress={() => act('finish', finishRide)} disabled={!!busy} />
          </AppCard>
        ) : null}

        {status === 'awaiting_payment' || status === 'payment_marked_sent' ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Pagamento</Text>
            <AppButton title={busy === 'confirm' ? 'Enviando…' : 'Pagamento recebido'} onPress={() => act('confirm', confirmDriverPixReceived)} disabled={!!busy} />
            <AppButton title="Problema no pagamento" variant="ghost" onPress={() => act('issue', (id) => reportPaymentIssue(id, 'motorista_reportou'))} disabled={!!busy} />
          </AppCard>
        ) : null}

        {status === 'assigned' || status === 'driver_arrived' ? (
          <AppButton title="Cancelar corrida" variant="ghost" onPress={() => act('cancel', (id) => cancelRide(id, 'motorista_cancelou'))} disabled={!!busy} />
        ) : null}

        {error ? <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
