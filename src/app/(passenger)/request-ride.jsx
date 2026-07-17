// Passenger ride request (route "/request-ride").
//
// Real secure flow:
//   1. collect/confirm pickup + destination labels;
//   2. resolve both points to real coordinates (GPS or native geocoder);
//   3. call createRideRequestSecure, where routing, geofence, pricing and dispatch
//      remain server-authoritative;
//   4. continue to /searching with the returned quote summary.
//
// The client never writes rideRequests directly and never supplies fare,
// distance, duration, commission or service-area values.

import { useEffect, useRef, useState } from 'react';
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
import {
  getCurrentLocationWithAddress,
  resolveAddressToCoords,
} from '../../services/locationService';
import { requestRide } from '../../services/ridesService';
import { checkOriginServiceArea } from '../../utils/serviceArea';
import { showAppAlert, showConfirmAlert } from '../../utils/alertUtils';
import { logRideClientEvent } from '../../utils/clientRideLog';
import { VEHICLE_TYPES, VEHICLE_LABELS_PT_BR, VEHICLE_MOTO } from '../../constants/vehicleTypes';

const OUT_OF_AREA_MSG =
  'No momento, a DriveLocal atende apenas corridas com embarque e destino dentro de Horizonte.';

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
            <Text
              style={[
                { fontFamily, color: selected ? colors.primary : colors.textMuted },
                typography.bodyBold,
              ]}
            >
              {VEHICLE_LABELS_PT_BR[type]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function geocoderQuery(text) {
  const clean = String(text || '').trim();
  if (/horizonte/i.test(clean)) return `${clean}, Ceará, Brasil`;
  return `${clean}, Horizonte, Ceará, Brasil`;
}

function clientRideErrorMessage(error) {
  const details = error?.details && typeof error.details === 'object' ? error.details : null;
  const code = details?.code || error?.code || '';

  if (String(code).includes('OUT_OF_SERVICE_AREA')) return OUT_OF_AREA_MSG;
  if (String(code).includes('RIDE_IN_PROGRESS')) return 'Você já tem uma corrida em andamento.';
  if (details?.message) return String(details.message);
  return error?.message || 'Não foi possível pedir a corrida. Tente novamente.';
}

export default function RequestRide() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const idempotencyKeyRef = useRef(null);

  const [passenger, setPassenger] = useState(null);

  const [originText, setOriginText] = useState(
    typeof params.originText === 'string' ? params.originText : ''
  );
  const [originReferenceText, setOriginReferenceText] = useState('');
  const [originLat, setOriginLat] = useState(null);
  const [originLng, setOriginLng] = useState(null);
  const [originCity, setOriginCity] = useState('');
  const [originState, setOriginState] = useState('');
  const [originSource, setOriginSource] = useState('manual');
  const [gpsFound, setGpsFound] = useState(false);

  const [destinationText, setDestinationText] = useState(
    typeof params.destinationText === 'string' ? params.destinationText : ''
  );

  const [vehicleType, setVehicleType] = useState(VEHICLE_MOTO);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      router.replace('/passenger-register');
      return;
    }

    getPassenger(uid)
      .then((profile) => {
        if (!profile) {
          showAppAlert(
            'Conta',
            'Complete seu cadastro de passageiro para pedir uma corrida.',
            () => router.replace('/passenger-register')
          );
          return;
        }
        setPassenger(profile);
      })
      .catch((loadError) => {
        logRideClientEvent('ride.request.passenger_load_failed', { error: loadError }, 'error');
        setError('Não foi possível carregar seu perfil. Tente novamente.');
      });
  }, [router]);

  function resetRequestAttempt() {
    // A new input combination must receive a new idempotency key. Network retries
    // without input changes keep the existing key and cannot create duplicates.
    idempotencyKeyRef.current = null;
  }

  async function handleUseMyLocation() {
    setError('');
    setLoadingLocation(true);
    setGpsFound(false);
    const startedAt = Date.now();

    logRideClientEvent('ride.request.pickup_gps_started', {
      step: 'pickup_gps',
      originSource: 'gps',
    });

    const result = await getCurrentLocationWithAddress();
    setLoadingLocation(false);

    if (result.status === 'denied') {
      logRideClientEvent('ride.request.pickup_gps_denied', {
        step: 'pickup_gps',
        durationMs: Date.now() - startedAt,
      }, 'warning');
      showAppAlert('Localização', 'Permissão negada. Digite seu endereço de origem manualmente.');
      return;
    }
    if (result.status === 'error') {
      logRideClientEvent('ride.request.pickup_gps_failed', {
        step: 'pickup_gps',
        durationMs: Date.now() - startedAt,
      }, 'warning');
      showAppAlert('Localização', 'Não foi possível obter sua localização. Digite o endereço manualmente.');
      return;
    }

    setOriginLat(result.lat);
    setOriginLng(result.lng);
    setOriginCity(result.city || '');
    setOriginState(result.state || '');
    setOriginSource('gps');
    if (result.addressText) setOriginText(result.addressText);
    setGpsFound(true);
    resetRequestAttempt();

    logRideClientEvent('ride.request.pickup_gps_succeeded', {
      step: 'pickup_gps',
      originSource: 'gps',
      hasPickupCoordinates: true,
      originTextLength: result.addressText?.length || 0,
      durationMs: Date.now() - startedAt,
    });
  }

  async function resolveRidePoint({ text, knownLat, knownLng, step }) {
    const existingLat = Number(knownLat);
    const existingLng = Number(knownLng);
    if (Number.isFinite(existingLat) && Number.isFinite(existingLng)) {
      logRideClientEvent('ride.request.geocode_skipped', {
        step,
        hasPickupCoordinates: step === 'pickup' ? true : undefined,
        hasDestinationCoordinates: step === 'destination' ? true : undefined,
      });
      return { status: 'ok', lat: existingLat, lng: existingLng };
    }

    const startedAt = Date.now();
    logRideClientEvent('ride.request.geocode_started', {
      step,
      originTextLength: step === 'pickup' ? text.length : undefined,
      destinationTextLength: step === 'destination' ? text.length : undefined,
    });

    const result = await resolveAddressToCoords(geocoderQuery(text));
    logRideClientEvent(
      result.status === 'ok' ? 'ride.request.geocode_succeeded' : 'ride.request.geocode_failed',
      {
        step,
        resultStatus: result.status,
        hasPickupCoordinates: step === 'pickup' ? result.status === 'ok' : undefined,
        hasDestinationCoordinates: step === 'destination' ? result.status === 'ok' : undefined,
        durationMs: Date.now() - startedAt,
      },
      result.status === 'ok' ? 'info' : 'warning'
    );
    return result;
  }

  async function createSecureRide() {
    if (!passenger || submitting) return;

    setSubmitting(true);
    setError('');
    const startedAt = Date.now();

    logRideClientEvent('ride.request.submit_started', {
      action: 'requestRide',
      vehicleType,
      originSource,
      hasPickupCoordinates: Number.isFinite(Number(originLat)) && Number.isFinite(Number(originLng)),
      hasDestinationCoordinates: false,
      originTextLength: originText.trim().length,
      destinationTextLength: destinationText.trim().length,
    });

    try {
      const pickupResult = await resolveRidePoint({
        text: originText.trim(),
        knownLat: originLat,
        knownLng: originLng,
        step: 'pickup',
      });
      if (pickupResult.status !== 'ok') {
        throw new Error('Não encontramos o endereço de origem. Informe rua, número e bairro.');
      }

      const destinationResult = await resolveRidePoint({
        text: destinationText.trim(),
        knownLat: null,
        knownLng: null,
        step: 'destination',
      });
      if (destinationResult.status !== 'ok') {
        throw new Error('Não encontramos o destino. Informe rua, número, bairro ou um ponto conhecido.');
      }

      const pickupLabel = [originText.trim(), originReferenceText.trim()]
        .filter(Boolean)
        .join(' — ');

      const ride = await requestRide({
        vehicleType,
        pickup: {
          lat: pickupResult.lat,
          lng: pickupResult.lng,
          label: pickupLabel,
        },
        destination: {
          lat: destinationResult.lat,
          lng: destinationResult.lng,
          label: destinationText.trim(),
        },
        idempotencyKeyRef,
      });

      logRideClientEvent('ride.request.navigation_to_searching', {
        action: 'router.replace',
        rideId: ride?.rideId,
        resultStatus: ride?.status,
        vehicleType,
        durationMs: Date.now() - startedAt,
        ride,
      });

      router.replace({
        pathname: '/searching',
        params: {
          rideId: ride.rideId,
          status: ride.status || 'searching',
          vehicleType: ride.vehicleType || vehicleType,
          estimatedFareCentavos: String(ride.estimatedFareCentavos ?? ''),
          routeDistanceMeters: String(ride.routeDistanceMeters ?? ''),
          routeDurationSeconds: String(ride.routeDurationSeconds ?? ''),
        },
      });
    } catch (submitError) {
      logRideClientEvent('ride.request.submit_failed', {
        action: 'requestRide',
        vehicleType,
        durationMs: Date.now() - startedAt,
        error: submitError,
      }, 'error');
      setError(clientRideErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  function validateAndSubmit() {
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

    // Early UX check for a GPS-derived pickup. The secure backend still validates
    // pickup and destination against the official Horizonte polygon.
    const area = checkOriginServiceArea({
      city: originCity,
      state: originState,
      source: originSource,
    });
    if (area.status === 'blocked') {
      showAppAlert('Fora da área', OUT_OF_AREA_MSG);
      return;
    }
    if (area.status === 'undetermined' && originSource === 'gps') {
      showConfirmAlert({
        title: 'Confirme sua origem',
        message: 'Não conseguimos confirmar sua cidade. Confirme que o endereço de origem está em Horizonte.',
        confirmText: 'Está em Horizonte',
        cancelText: 'Corrigir',
        onConfirm: createSecureRide,
      });
      return;
    }

    createSecureRide();
  }

  function goBackSafely() {
    if (router.canGoBack()) router.back();
    else router.replace('/passenger-home');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Pedir corrida" subtitle="Embarque e destino em Horizonte / CE" onBack={goBackSafely} />

        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Origem</Text>
          <AppButton
            title={loadingLocation ? 'Localizando...' : 'Usar minha localização atual'}
            variant="secondary"
            onPress={handleUseMyLocation}
            disabled={loadingLocation || submitting}
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
            onChangeText={(text) => {
              setOriginText(text);
              setOriginSource('manual');
              setOriginLat(null);
              setOriginLng(null);
              setGpsFound(false);
              resetRequestAttempt();
            }}
            placeholder="Ex: Rua José de Alencar, Centro"
          />
          <AppInput
            label="Complemento / referência"
            value={originReferenceText}
            onChangeText={(text) => {
              setOriginReferenceText(text);
              resetRequestAttempt();
            }}
            placeholder="Ex: em frente à farmácia, portão azul"
          />
        </AppCard>

        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Destino</Text>
          <AppInput
            label="Para onde você vai?"
            value={destinationText}
            onChangeText={(text) => {
              setDestinationText(text);
              resetRequestAttempt();
            }}
            placeholder="Ex: Rua Presidente Castelo Branco, Centro"
          />
        </AppCard>

        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Tipo de veículo</Text>
          <View style={{ marginTop: spacing.sm }}>
            <VehiclePicker
              value={vehicleType}
              onChange={(type) => {
                setVehicleType(type);
                resetRequestAttempt();
              }}
            />
          </View>
        </AppCard>

        {error ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
        ) : null}

        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          O preço é calculado pelo servidor antes da busca. Pagamento direto por Pix ao motorista.
        </Text>

        <AppButton
          title={submitting ? 'Calculando preço e buscando...' : 'Pedir corrida'}
          onPress={validateAndSubmit}
          disabled={submitting || !passenger}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
