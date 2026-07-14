// Active ride (route "/active-ride"). Step 1 frontend only — mock ride.
//
// DriveLocal MVP 0.1 uses EXTERNAL navigation only (Google Maps / Waze).
// No in-app turn-by-turn, no live tracking, no moving driver marker, no
// background GPS. We just open the external app with the right coordinates.
//
// Simple two-phase driver UX:
//   Phase 1 "Buscar passageiro"  -> navigate to ride.pickup (pickup coords)
//   Phase 2 "Levar ao destino"   -> navigate to ride.destination (destination coords)
// The phase-specific "Abrir no Google Maps / Waze" buttons target whichever
// point matches the current phase. A shortcuts card also exposes all four
// concepts explicitly (pickup/destination x Google Maps/Waze).

import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AppBadge from '../../components/AppBadge';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { mockRides } from '../../mock/mockRides';
import { formatBRL } from '../../utils/format';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';
import { openGoogleMapsToPoint, openWazeToPoint } from '../../utils/maps';

export default function ActiveRide() {
  const router = useRouter();
  const params = useLocalSearchParams();
  // PricingV1 bridge: carry the real rideId (when present) through to finish-ride
  // so commission is settled against the real ride document.
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;
  const ride = mockRides[0]; // mock active ride display

  // phase: 'pickup'  -> driving to the passenger
  //        'arrived' -> at pickup, waiting for passenger to board
  //        'dropoff' -> driving the passenger to the destination
  const [phase, setPhase] = useState('pickup');

  const goingToDestination = phase === 'dropoff';

  // Phase 1 navigates to pickup; Phase 2 navigates to destination.
  const navPoint = goingToDestination ? ride.destination : ride.pickup;
  const stepLabel = goingToDestination ? 'Levar passageiro ao destino' : 'Buscar passageiro';
  const stepAddress = goingToDestination ? ride.destination.address : ride.pickup.address;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title="Corrida ativa"
          subtitle={stepLabel}
          onBack={() => router.back()}
          right={<AppBadge label={goingToDestination ? 'Fase 2' : 'Fase 1'} />}
        />

        {/* Ride summary */}
        <AppCard>
          <AdminTableRow label="Passageiro" value={ride.passengerName} />
          <AdminTableRow label="Veículo" value={VEHICLE_LABELS_PT_BR[ride.vehicleType]} />
          <AdminTableRow label="Origem (buscar)" value={ride.pickup.address} />
          <AdminTableRow label="Destino" value={ride.destination.address} />
          <AdminTableRow label="Valor" value={formatBRL(ride.fareCents)} />
          <AdminTableRow label="Pagamento" value="Pix direto ao motorista" />
          <AdminTableRow label="Status pagamento" value="Pendente (placeholder)" />
          <AdminTableRow label="Próxima ação" value={goingToDestination ? 'Finalizar corrida' : 'Cheguei ao local'} />
        </AppCard>

        {/* Current-phase navigation. Buttons open the external app with the
            correct coordinates already filled — the driver never types it. */}
        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>{stepLabel}</Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{stepAddress}</Text>
          <AppButton title="Abrir no Google Maps" onPress={() => openGoogleMapsToPoint(navPoint)} />
          <AppButton title="Abrir no Waze" variant="secondary" onPress={() => openWazeToPoint(navPoint)} />
        </AppCard>

        {/* Explicit shortcuts for all four navigation concepts. */}
        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Navegação (atalhos)</Text>
          <AppButton title="Abrir rota no Google Maps" onPress={() => openGoogleMapsToPoint(ride.pickup)} />
          <AppButton title="Abrir rota no Waze" variant="secondary" onPress={() => openWazeToPoint(ride.pickup)} />
          <AppButton title="Abrir destino no Google Maps" onPress={() => openGoogleMapsToPoint(ride.destination)} />
          <AppButton title="Abrir destino no Waze" variant="secondary" onPress={() => openWazeToPoint(ride.destination)} />
        </AppCard>

        {/* Primary action depends on the current phase. */}
        {phase === 'pickup' ? (
          <AppButton title="Cheguei ao local" onPress={() => setPhase('arrived')} />
        ) : null}
        {phase === 'arrived' ? (
          <AppButton title="Passageiro embarcou" onPress={() => setPhase('dropoff')} />
        ) : null}
        {phase === 'dropoff' ? (
          <AppButton
            title="Finalizar corrida"
            onPress={() =>
              router.push(rideId ? { pathname: '/finish-ride', params: { rideId } } : '/finish-ride')
            }
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
