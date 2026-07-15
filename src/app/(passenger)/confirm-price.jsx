// Confirm price (route "/confirm-price"). Step 1 passenger flow.
//
// PricingV1: the DriveLocal price now comes from the real pricing foundation
// (utils/ridePricing.js + constants/pricingConfig.js) instead of a hardcoded
// mock fare. Service-area validation uses checkRideServiceArea() — a ride is
// refused ONLY when pickup or destination is outside Horizonte, never because
// the distance is over 10 km (long local rides inside Horizonte are valid).
//
// The ride origin/destination here still come from mockRides (Step 1). Real
// geocoded points + Firestore ride creation are wired in a later step — see the
// TODO(ride-flow) block below for exactly which fields to persist.

import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockRides } from '../../mock/mockRides';
import { formatBRL, formatDistanceKm } from '../../utils/format';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';
import { PRICING_VERSION } from '../../constants/pricingConfig';
import { getRidePricing } from '../../utils/ridePricing';
import { checkRideServiceArea } from '../../utils/serviceArea';
import { auth } from '../../config/firebase';
import { requestRide } from '../../services/ridesService';

// PT-BR copy shown when the ride is outside the Horizonte service area.
const OUT_OF_AREA_MSG =
  'No momento, a DriveLocal atende apenas corridas dentro de Horizonte.';

export default function ConfirmPrice() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const ride = mockRides[0]; // Step 1 mock origin/destination + vehicle/distance.

  // Distance in km (pricing tiers are in km; mock stores meters). All money below
  // is integer centavos.
  const distanceKm = (ride.distanceMeters || 0) / 1000;

  // Service-area check. The mock ride is inside Horizonte, so we pass manual
  // pickup/destination points (never hard-blocked). Real GPS points plug in here
  // later without changing this screen — see utils/serviceArea.js.
  const serviceAreaResult = checkRideServiceArea({
    pickup: { city: 'Horizonte', state: 'CE', source: 'manual' },
    destination: { city: 'Horizonte', state: 'CE', source: 'manual' },
  });

  // Price from the pricing foundation. driver is null (no driver assigned yet),
  // so commission is only informational here — the wallet debit happens later,
  // at ride completion (see finish-ride + services/walletCommission.js).
  const pricing = getRidePricing(ride.vehicleType, distanceKm, serviceAreaResult, null);
  const outOfArea = !pricing.ok;

  console.log(
    '[PricingV1] confirm-price vehicleType=',
    ride.vehicleType,
    'distanceKm=',
    distanceKm,
    'ok=',
    pricing.ok,
    'priceCentavos=',
    pricing.ok ? pricing.ridePriceCentavos : null
  );

  // Snapshot of what a real ride document must persist when created/confirmed.
  // TODO(ride-flow): when confirm-price is connected to real ride creation, call
  // rideRequestService.createRideRequest() (or the ride doc writer) with these
  // fields. platformFeeCentavos stays 0 until a driver is assigned and the ride
  // completes; the final fee is computed + debited in services/walletCommission.js.
  const priceSnapshot = pricing.ok
    ? {
        ridePriceCentavos: pricing.ridePriceCentavos,
        driverAmountCentavos: pricing.driverAmountCentavos,
        platformFeeCentavos: 0,
        vehicleType: ride.vehicleType,
        distanceKm,
        serviceAreaId: ride.serviceAreaId || null,
        pricingVersion: PRICING_VERSION,
        paymentMethod: 'pix_direct_to_driver',
      }
    : null;

  const [requestError, setRequestError] = useState('');

  async function handleRequest() {
    if (outOfArea) return;
    const uid = auth.currentUser && auth.currentUser.uid;

    // Create the ride through the SECURE callable: the backend geofences the
    // points, measures the real route, prices it, and dispatches targeted offers.
    // The displayed price above is only an estimate; the authoritative fare is the
    // server quote returned here. The client never writes rideRequests directly.
    if (uid) {
      try {
        setSubmitting(true);
        setRequestError('');
        const result = await requestRide({
          vehicleType: ride.vehicleType,
          pickup: { lat: ride.pickup.lat, lng: ride.pickup.lng, label: ride.pickup.address },
          destination: { lat: ride.destination.lat, lng: ride.destination.lng, label: ride.destination.address },
        });
        router.push({ pathname: '/searching', params: { rideId: result.rideId } });
        return;
      } catch (e) {
        // Stable PT-BR message from the backend when available.
        setRequestError((e && e.message) || 'Não foi possível pedir a corrida. Tente novamente.');
        return;
      } finally {
        setSubmitting(false);
      }
    }

    setRequestError('Faça login para pedir uma corrida.');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Confirmar corrida" onBack={() => router.back()} />
        <AppCard>
          <AdminTableRow label="Origem" value={ride.pickup.address} />
          <AdminTableRow label="Destino" value={ride.destination.address} />
          <AdminTableRow label="Veículo" value={VEHICLE_LABELS_PT_BR[ride.vehicleType]} />
          <AdminTableRow label="Distância" value={formatDistanceKm(ride.distanceMeters)} />
          {outOfArea ? (
            <AdminTableRow label="Preço" value="Fora da área" />
          ) : (
            <AdminTableRow label="Preço" value={formatBRL(pricing.ridePriceCentavos)} />
          )}
          <AdminTableRow label="Pagamento" value="Pix direto ao motorista" />
        </AppCard>
        {outOfArea ? (
          <AdminTableRow label={OUT_OF_AREA_MSG} />
        ) : null}
        <AppButton
          title={submitting ? 'Enviando…' : 'Pedir corrida'}
          onPress={handleRequest}
          disabled={outOfArea || submitting}
        />
        {requestError ? (
          <AdminTableRow label={requestError} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
