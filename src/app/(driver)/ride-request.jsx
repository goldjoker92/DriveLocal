// Incoming ride request (route "/ride-request"). Step 1 UI + PricingV1 bridge.
//
// When a real rideId is passed (route param), this screen accepts a REAL pending
// rideRequest: it checks per-ride eligibility with canDriverReceiveRide, persists
// driverId via acceptRideRequest, and forwards the rideId to the active ride.
// Without a rideId it keeps the original Step 1 mock behavior (mockRides[1]).
//
// TODO(ride-flow): real dispatch (matching pending requests to nearby drivers)
// is a later iteration — this only persists the assignment for one known ride.

import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import RideRequestCard from '../../components/RideRequestCard';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { mockRides } from '../../mock/mockRides';
import { auth } from '../../config/firebase';
import { getDriver } from '../../services/driverService';
import { getRideRequest, acceptRideRequest } from '../../services/rideRequestService';
import { canDriverReceiveRide } from '../../utils/driverEligibility';

export default function RideRequest() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;
  const ride = mockRides[1]; // mock display for a ride currently searching
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState('');

  async function handleAccept() {
    // No real ride: keep the original mock navigation.
    if (!rideId) {
      router.replace('/active-ride');
      return;
    }
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      setAcceptError('Faça login como motorista para aceitar.');
      return;
    }
    setAccepting(true);
    setAcceptError('');
    try {
      const [driver, realRide] = await Promise.all([getDriver(uid), getRideRequest(rideId)]);
      if (!realRide) {
        setAcceptError('Corrida não encontrada.');
        return;
      }
      // Per-ride eligibility is the source of truth (approved, not blocked,
      // vehicle match, subscription/trial, wallet if commission applies).
      const check = canDriverReceiveRide(driver, {
        vehicleType: realRide.vehicleType,
        distanceKm: realRide.distanceKm,
      });
      if (!check.eligible) {
        console.log('[DriverEligibility] accept blocked reason=', check.reason);
        setAcceptError('Você ainda não pode aceitar esta corrida.');
        return;
      }
      await acceptRideRequest(rideId, uid);
      router.replace({ pathname: '/active-ride', params: { rideId } });
    } catch (e) {
      console.log('[RIDE_REQUEST] accept error', e.code || e.message);
      setAcceptError('Não foi possível aceitar a corrida. Tente novamente.');
    } finally {
      setAccepting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Nova corrida" subtitle="Aceite para iniciar" onBack={() => router.back()} />
        <RideRequestCard
          ride={ride}
          onAccept={accepting ? () => {} : handleAccept}
          onDecline={() => router.replace('/driver-home')}
        />
        {acceptError ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{acceptError}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
