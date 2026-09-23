// Passenger ride request (route "/request-ride").
//
// Real secure flow:
//   1. suggest City Pack locations locally, then Google Places through a secure
//      callable only when the local pack has no strong answer;
//   2. resolve both points to real coordinates (selected Places result, GPS or
//      native geocoder);
//   3. show the server-priced confirmation screen without creating a ride;
//   4. only explicit confirmation creates a ride and starts dispatch.
//
// The client never writes rideRequests directly and never supplies fare,
// distance, duration, commission or service-area values.

import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import AddressAutocompleteInput from '../../components/AddressAutocompleteInput';
import KeyboardSafeScreen from '../../components/KeyboardSafeScreen';
import LocationActionButton from '../../components/LocationActionButton';
import { colors } from '../../constants/colors';
import { spacing, radius } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { getPassenger } from '../../services/passengerService';
import {
  getCurrentLocationWithAddress,
  resolveAddressToCoords,
} from '../../services/locationService';
import { showAppAlert } from '../../utils/alertUtils';
import { logRideClientEvent } from '../../utils/clientRideLog';
import { goBackOrReplace } from '../../utils/navigation';
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

function hasCoordinates(lat, lng) {
  if (lat == null || lng == null || lat === '' || lng === '') return false;
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
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
  const originReferenceRef = useRef(null);
  const destinationRef = useRef(null);

  const [passenger, setPassenger] = useState(null);

  const [originText, setOriginText] = useState(
    typeof params.originText === 'string' ? params.originText : ''
  );
  const [originReferenceText, setOriginReferenceText] = useState('');
  const [originLat, setOriginLat] = useState(null);
  const [originLng, setOriginLng] = useState(null);
  const [originSource, setOriginSource] = useState('manual');
  const [gpsFound, setGpsFound] = useState(false);

  const [destinationText, setDestinationText] = useState(
    typeof params.destinationText === 'string' ? params.destinationText : ''
  );
  const [destinationLat, setDestinationLat] = useState(null);
  const [destinationLng, setDestinationLng] = useState(null);
  const [destinationSource, setDestinationSource] = useState('manual');

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

  function openPassengerProfile() {
    logRideClientEvent('ride.request.profile_selected', {
      route: '/passenger-profile',
      action: 'router.push',
    });
    router.push('/passenger-profile');
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
      logRideClientEvent(
        'ride.request.pickup_gps_denied',
        { step: 'pickup_gps', durationMs: Date.now() - startedAt },
        'warning'
      );
      showAppAlert('Localização', 'Permissão negada. Digite seu endereço de origem manualmente.');
      return;
    }
    if (result.status === 'error') {
      logRideClientEvent(
        'ride.request.pickup_gps_failed',
        { step: 'pickup_gps', durationMs: Date.now() - startedAt },
        'warning'
      );
      showAppAlert('Localização', 'Não foi possível obter sua localização. Digite o endereço manualmente.');
      return;
    }

    setOriginLat(result.lat);
    setOriginLng(result.lng);
    setOriginSource('gps');
    if (result.addressText) setOriginText(result.addressText);
    setGpsFound(true);

    logRideClientEvent('ride.request.pickup_gps_succeeded', {
      step: 'pickup_gps',
      originSource: 'gps',
      hasPickupCoordinates: true,
      originTextLength: result.addressText?.length || 0,
      durationMs: Date.now() - startedAt,
    });
  }

  function applyOriginSuggestion(result) {
    setOriginText(result.label);
    setOriginLat(result.lat);
    setOriginLng(result.lng);
    setOriginSource(result.source);
    setGpsFound(false);
    logRideClientEvent('ride.request.place_selected', {
      step: 'pickup',
      provider: result.source,
      hasPickupCoordinates: hasCoordinates(result.lat, result.lng),
    });
  }

  function applyDestinationSuggestion(result) {
    setDestinationText(result.label);
    setDestinationLat(result.lat);
    setDestinationLng(result.lng);
    setDestinationSource(result.source);
    logRideClientEvent('ride.request.place_selected', {
      step: 'destination',
      provider: result.source,
      hasDestinationCoordinates: hasCoordinates(result.lat, result.lng),
    });
  }

  async function resolveRidePoint({ text, knownLat, knownLng, step }) {
    if (hasCoordinates(knownLat, knownLng)) {
      logRideClientEvent('ride.request.geocode_skipped', {
        step,
        hasPickupCoordinates: step === 'pickup' ? true : undefined,
        hasDestinationCoordinates: step === 'destination' ? true : undefined,
      });
      return { status: 'ok', lat: Number(knownLat), lng: Number(knownLng) };
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

  async function prepareFareQuote() {
    if (!passenger || submitting) return;

    setSubmitting(true);
    setError('');
    const startedAt = Date.now();

    logRideClientEvent('ride.request.submit_started', {
      action: 'prepareFareQuote',
      vehicleType,
      originSource,
      destinationSource,
      hasPickupCoordinates: hasCoordinates(originLat, originLng),
      hasDestinationCoordinates: hasCoordinates(destinationLat, destinationLng),
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
        knownLat: destinationLat,
        knownLng: destinationLng,
        step: 'destination',
      });
      if (destinationResult.status !== 'ok') {
        throw new Error('Não encontramos o destino. Informe rua, número, bairro ou um ponto conhecido.');
      }

      const pickupLabel = [originText.trim(), originReferenceText.trim()]
        .filter(Boolean)
        .join(' — ');

      logRideClientEvent('ride.request.navigation_to_quote', {
        action: 'router.push',
        vehicleType,
        durationMs: Date.now() - startedAt,
      });
      router.push({
        pathname: '/confirm-price',
        params: {
          vehicleType,
          pickupLat: String(pickupResult.lat),
          pickupLng: String(pickupResult.lng),
          pickupLabel,
          destLat: String(destinationResult.lat),
          destLng: String(destinationResult.lng),
          destLabel: destinationText.trim(),
        },
      });
    } catch (submitError) {
      logRideClientEvent(
        'ride.request.submit_failed',
        {
          action: 'prepareFareQuote',
          vehicleType,
          durationMs: Date.now() - startedAt,
          error: submitError,
        },
        'error'
      );
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

    prepareFareQuote();
  }

  return (
    <KeyboardSafeScreen
      scrollViewProps={{
        contentContainerStyle: { paddingBottom: spacing.xxl * 2 },
      }}
    >
      <Header
        title="Pedir corrida"
        subtitle="Embarque e destino em Horizonte / CE"
        onBack={() => goBackOrReplace(router, '/passenger-home')}
        right={
          <Pressable
            onPress={openPassengerProfile}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Abrir meu perfil"
            style={{
              minHeight: 44,
              paddingHorizontal: spacing.sm,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={[{ fontFamily, color: colors.primary }, typography.bodyBold]}>
              👤 Perfil
            </Text>
          </Pressable>
        }
      />

      <AppCard>
        <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Origem</Text>
        <LocationActionButton
          loading={loadingLocation}
          found={gpsFound}
          onPress={handleUseMyLocation}
          disabled={submitting}
        />
        {gpsFound ? (
          <Text style={[{ fontFamily, color: colors.success }, typography.small]}>
            Localização encontrada. Confira o endereço antes de pedir a corrida.
          </Text>
        ) : null}
        <AddressAutocompleteInput
          label="Rua, bairro ou ponto de referência"
          value={originText}
          onChangeText={(text) => {
            setOriginText(text);
            setOriginSource('manual');
            setOriginLat(null);
            setOriginLng(null);
            setGpsFound(false);
          }}
          onSuggestionSelected={applyOriginSuggestion}
          disabled={submitting}
          placeholder="Ex: Hospital Municipal ou Rua José de Alencar"
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => originReferenceRef.current?.focus()}
        />
        <AppInput
          ref={originReferenceRef}
          label="Complemento / referência"
          value={originReferenceText}
          onChangeText={(text) => {
            setOriginReferenceText(text);
          }}
          placeholder="Ex: em frente à farmácia, portão azul"
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => destinationRef.current?.focus()}
        />
      </AppCard>

      <AppCard>
        <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Destino</Text>
        <AddressAutocompleteInput
          ref={destinationRef}
          label="Para onde você vai?"
          value={destinationText}
          onChangeText={(text) => {
            setDestinationText(text);
            setDestinationLat(null);
            setDestinationLng(null);
            setDestinationSource('manual');
          }}
          onSuggestionSelected={applyDestinationSuggestion}
          disabled={submitting}
          placeholder="Ex: IFCE, Centro ou endereço completo"
          returnKeyType="done"
        />
      </AppCard>

      <AppCard>
        <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Tipo de veículo</Text>
        <View style={{ marginTop: spacing.sm }}>
          <VehiclePicker
            value={vehicleType}
            onChange={(type) => {
              setVehicleType(type);
            }}
          />
        </View>
      </AppCard>

      {error ? (
        <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
      ) : null}

      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        Você verá o preço antes de confirmar. Pagamento direto por Pix ao motorista.
      </Text>

      <AppButton
        title={submitting ? 'Localizando trajeto…' : 'Ver preço'}
        onPress={validateAndSubmit}
        disabled={submitting || !passenger}
      />
    </KeyboardSafeScreen>
  );
}
