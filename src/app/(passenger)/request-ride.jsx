// Request ride (route "/request-ride"). Iteration 3A.
// Minimal Uber-like ASSISTED form to create a rideRequest with status "pending".
//   Origin:  "Usar minha localização atual" (GPS + reverse geocode) OR manual text
//            + optional complemento/referência. Passenger always confirms the text.
//   Destination: manual text only (no geocoding in 3A).
// NO MapView, NO dispatch, NO matching, NO pricing, NO payment/Pix, NO Waze/Maps,
// NO push. Service-area block is a SIMPLE city/state check (no polygon geofence).

import { useEffect, useState } from 'react';
import { ScrollView, View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing, radius } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { getPassenger } from '../../services/passengerService';
import { getCurrentLocationWithAddress } from '../../services/locationService';
import { createRideRequest } from '../../services/rideRequestService';
import { checkOriginServiceArea } from '../../utils/serviceArea';
import { showAppAlert, showConfirmAlert } from '../../utils/alertUtils';
import { VEHICLE_TYPES, VEHICLE_LABELS_PT_BR, VEHICLE_MOTO } from '../../constants/vehicleTypes';

const OUT_OF_AREA_MSG =
  'No momento, a DriveLocal atende apenas corridas dentro de Horizonte.';

// Two-option vehicle selector (moto / carro).
function VehiclePicker({ value, onChange }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      {VEHICLE_TYPES.map((type) => {
        const selected = value === type;
        return (
          <Pressable
            key={type}
            onPress={() => onChange(type)}
            style={{
              flex: 1,
              paddingVertical: spacing.md,
              borderRadius: radius.md,
              borderWidth: 1,
              alignItems: 'center',
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? colors.primaryTint : colors.background,
            }}
          >
            <Text style={[{ fontFamily, color: selected ? colors.primary : colors.textMuted }, typography.bodyBold]}>
              {VEHICLE_LABELS_PT_BR[type]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function RequestRide() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const [passenger, setPassenger] = useState(null);

  // Origin state.
  const [originText, setOriginText] = useState(typeof params.originText === 'string' ? params.originText : '');
  const [originReferenceText, setOriginReferenceText] = useState('');
  const [originLat, setOriginLat] = useState(null);
  const [originLng, setOriginLng] = useState(null);
  const [originCity, setOriginCity] = useState('');
  const [originState, setOriginState] = useState('');
  const [originSource, setOriginSource] = useState('manual'); // 'manual' | 'gps'
  const [gpsFound, setGpsFound] = useState(false);

  // Destination (manual text only in 3A).
  const [destinationText, setDestinationText] = useState(
    typeof params.destinationText === 'string' ? params.destinationText : ''
  );

  const [vehicleType, setVehicleType] = useState(VEHICLE_MOTO);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Must be a signed-in passenger. Load the profile for name + WhatsApp.
  useEffect(() => {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      router.replace('/passenger-register');
      return;
    }
    getPassenger(uid)
      .then((p) => {
        if (!p) {
          showAppAlert('Conta', 'Complete seu cadastro de passageiro para pedir uma corrida.', () =>
            router.replace('/passenger-register')
          );
          return;
        }
        setPassenger(p);
      })
      .catch((e) => {
        console.log('[REQUEST_RIDE] load passenger error', e.message);
        setError('Não foi possível carregar seu perfil. Tente novamente.');
      });
  }, []);

  // "Usar minha localização atual": permission -> position -> reverse geocode.
  // If the address is found we pre-fill it; the passenger still confirms it.
  async function handleUseMyLocation() {
    setError('');
    setLoadingLocation(true);
    setGpsFound(false);
    const res = await getCurrentLocationWithAddress();
    setLoadingLocation(false);

    if (res.status === 'denied') {
      showAppAlert('Localização', 'Permissão negada. Digite seu endereço de origem manualmente.');
      return;
    }
    if (res.status === 'error') {
      showAppAlert('Localização', 'Não foi possível obter sua localização. Digite o endereço manualmente.');
      return;
    }

    setOriginLat(res.lat);
    setOriginLng(res.lng);
    setOriginCity(res.city || '');
    setOriginState(res.state || '');
    setOriginSource('gps');
    if (res.addressText) setOriginText(res.addressText);
    setGpsFound(true);
  }

  // Writes the rideRequest after validation + the simple service-area check.
  async function doCreate() {
    if (!passenger) return;
    setSubmitting(true);
    setError('');
    try {
      const rideId = await createRideRequest({
        passengerId: auth.currentUser.uid,
        passengerName: passenger.fullName || '',
        passengerPhone: passenger.whatsApp || '',
        originText: originText.trim(),
        originReferenceText: originReferenceText.trim(),
        originLat,
        originLng,
        // V1 only serves Horizonte-CE; accepted requests are stored with the
        // active area's city/state (source of truth = serviceArea config).
        originCity: 'Horizonte',
        originState: 'CE',
        destinationText: destinationText.trim(),
        vehicleType,
      });
      console.log('[REQUEST_RIDE] created rideId=', rideId);
      showAppAlert(
        'Corrida solicitada',
        'Sua solicitação foi registrada. Em breve conectaremos você a um motorista local.',
        () => router.replace('/(passenger)/passenger-home')
      );
    } catch (e) {
      console.log('[REQUEST_RIDE] create error', e.code || e.message);
      setError('Não foi possível registrar sua corrida. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit() {
    setError('');
    if (!originText.trim()) {
      setError('Informe o endereço de origem.');
      return;
    }
    if (!destinationText.trim()) {
      setError('Informe o destino.');
      return;
    }
    if (!vehicleType) {
      setError('Escolha moto ou carro.');
      return;
    }

    // Simple service-area check (no polygon). Only GPS can hard-block; manual
    // entry assumes Horizonte-CE per the locked 3A rules.
    const area = checkOriginServiceArea({ city: originCity, state: originState, source: originSource });
    if (area.status === 'blocked') {
      showAppAlert('Fora da área', OUT_OF_AREA_MSG);
      return;
    }
    if (area.status === 'undetermined') {
      // Could not confirm the city from GPS: ask the passenger to confirm the
      // origin is in Horizonte instead of hard-blocking by coordinates.
      showConfirmAlert({
        title: 'Confirme sua origem',
        message: 'Não conseguimos confirmar sua cidade. Confirme que o endereço de origem está em Horizonte.',
        confirmText: 'Está em Horizonte',
        cancelText: 'Corrigir',
        onConfirm: doCreate,
      });
      return;
    }

    doCreate();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Pedir corrida" subtitle="Horizonte / CE" onBack={() => router.back()} />

        {/* Origin */}
        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Origem</Text>
          <AppButton
            title={loadingLocation ? 'Localizando...' : 'Usar minha localização atual'}
            variant="secondary"
            onPress={handleUseMyLocation}
            disabled={loadingLocation}
            style={{ marginTop: spacing.sm }}
          />
          {gpsFound ? (
            <Text style={[{ fontFamily, color: colors.success }, typography.small]}>
              Localização encontrada. Confira o endereço antes de pedir a corrida.
            </Text>
          ) : null}
          <AppInput
            label="Rua, bairro ou ponto de referência"
            value={originText}
            onChangeText={(t) => {
              // Editing the text means it is now the passenger's manual origin.
              setOriginText(t);
              setOriginSource('manual');
            }}
            placeholder="Ex: Rua José de Alencar, Centro"
          />
          <AppInput
            label="Complemento / referência"
            value={originReferenceText}
            onChangeText={setOriginReferenceText}
            placeholder="Ex: em frente à farmácia, portão azul"
          />
        </AppCard>

        {/* Destination */}
        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Destino</Text>
          <AppInput
            label="Para onde você vai?"
            value={destinationText}
            onChangeText={setDestinationText}
            placeholder="Ex: Centro, Hospital, Supermercado X, Rua..."
          />
        </AppCard>

        {/* Vehicle */}
        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Tipo de veículo</Text>
          <View style={{ marginTop: spacing.sm }}>
            <VehiclePicker value={vehicleType} onChange={setVehicleType} />
          </View>
        </AppCard>

        {error ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
        ) : null}

        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          Pagamento direto por Pix ao motorista.
        </Text>

        <AppButton
          title={submitting ? 'Enviando...' : 'Pedir corrida'}
          onPress={handleSubmit}
          disabled={submitting || !passenger}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
