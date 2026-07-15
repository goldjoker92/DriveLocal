// Select route (route "/select-route"). Real passenger location flow (BLOCK
// 07+08 finalization).
//
// Coordinates are produced by REAL providers only — expo-location GPS and the
// native geocoder (resolveAddressToCoords). There are NO typeahead autocomplete
// suggestions here: live suggestions require a Places provider that is not yet
// configured (see the audit report — ADDRESS_SEARCH_PROVIDER_CONFIGURATION_REQUIRED)
// and are intentionally NOT faked. There is also no interactive map marker
// (react-native-maps is not installed). A free-text field without RESOLVED
// coordinates cannot continue — coordinates are never invented from text.

import { useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';
import { getCurrentLocationWithAddress, resolveAddressToCoords } from '../../services/locationService';

// Map selection is not implemented yet (react-native-maps absent), so the
// fallback must not promise map adjustment.
const GPS_DENIED_MSG =
  'Não foi possível acessar sua localização. Busque e selecione um endereço para continuar.';

export default function SelectRoute() {
  const router = useRouter();
  const [vehicleType, setVehicleType] = useState('moto');

  const [pickupText, setPickupText] = useState('');
  const [pickup, setPickup] = useState(null); // { lat, lng, label } once resolved
  const [destText, setDestText] = useState('');
  const [destination, setDestination] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  async function useMyLocation() {
    setBusy('gps');
    setNotice('');
    const res = await getCurrentLocationWithAddress();
    setBusy('');
    if (res.status !== 'ok') {
      // Permission denied / lookup error: keep address search available; do not
      // re-prompt automatically.
      setNotice(GPS_DENIED_MSG);
      return;
    }
    const label = res.addressText || 'Minha localização atual';
    setPickup({ lat: res.lat, lng: res.lng, label });
    setPickupText(label);
  }

  async function resolve(field) {
    setBusy(field);
    setNotice('');
    const text = field === 'pickup' ? pickupText : destText;
    const res = await resolveAddressToCoords(text);
    setBusy('');
    if (res.status !== 'ok') {
      setNotice('Endereço não encontrado. Verifique e tente novamente.');
      if (field === 'pickup') setPickup(null);
      else setDestination(null);
      return;
    }
    const point = { lat: res.lat, lng: res.lng, label: res.addressText };
    if (field === 'pickup') setPickup(point);
    else setDestination(point);
  }

  // A request is allowed only when BOTH endpoints have RESOLVED coordinates.
  const canContinue = !!pickup && !!destination;

  function goToPrice() {
    if (!canContinue) return;
    router.push({
      pathname: '/confirm-price',
      params: {
        vehicleType,
        pickupLat: String(pickup.lat),
        pickupLng: String(pickup.lng),
        pickupLabel: pickup.label,
        destLat: String(destination.lat),
        destLng: String(destination.lng),
        destLabel: destination.label,
      },
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Para onde vamos?" onBack={() => router.back()} />

        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Veículo</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {['moto', 'car'].map((v) => (
              <AppButton
                key={v}
                title={VEHICLE_LABELS_PT_BR[v]}
                variant={vehicleType === v ? 'primary' : 'ghost'}
                onPress={() => setVehicleType(v)}
              />
            ))}
          </View>
        </AppCard>

        <AppCard>
          <AppInput
            label="Origem"
            value={pickupText}
            onChangeText={(t) => { setPickupText(t); setPickup(null); }}
            placeholder="Endereço de partida"
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <AppButton title="Usar minha localização" onPress={useMyLocation} disabled={busy === 'gps'} />
            <AppButton title={busy === 'pickup' ? 'Buscando…' : 'Buscar'} variant="ghost" onPress={() => resolve('pickup')} />
          </View>
          {pickup ? (
            <Text style={[{ fontFamily, color: colors.success || colors.textMuted }, typography.caption]}>
              Origem confirmada: {pickup.label}
            </Text>
          ) : null}
        </AppCard>

        <AppCard>
          <AppInput
            label="Destino"
            value={destText}
            onChangeText={(t) => { setDestText(t); setDestination(null); }}
            placeholder="Endereço de destino"
          />
          <AppButton title={busy === 'destination' ? 'Buscando…' : 'Buscar'} variant="ghost" onPress={() => resolve('destination')} />
          {destination ? (
            <Text style={[{ fontFamily, color: colors.success || colors.textMuted }, typography.caption]}>
              Destino confirmado: {destination.label}
            </Text>
          ) : null}
        </AppCard>

        {notice ? (
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{notice}</Text>
        ) : null}

        <AppButton title="Ver preço" onPress={goToPrice} disabled={!canContinue} />
      </ScrollView>
    </SafeAreaView>
  );
}
