// Server quote first. Only an explicit confirmation creates a ride and dispatches.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { formatBRL } from '../../utils/format';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';
import { auth } from '../../config/firebase';
import { getRideQuote, requestRide } from '../../services/ridesService';

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function messageFor(error) {
  const code = String(error?.details?.code || error?.code || '');
  if (code.includes('QUOTE_EXPIRED')) return 'O preço expirou. Recalcule para continuar.';
  if (code.includes('QUOTE_MISMATCH')) return 'O trajeto mudou. Recalcule o preço.';
  if (code.includes('QUOTE_USED')) return 'Esta corrida já foi confirmada. Verifique suas corridas.';
  if (code.includes('OUT_OF_SERVICE_AREA')) {
    return 'A origem e o destino precisam estar dentro de Horizonte.';
  }
  return error?.details?.message || 'Não foi possível calcular o preço. Tente novamente.';
}

export default function ConfirmPrice() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const vehicleType = params.vehicleType === 'car' ? 'car' : 'moto';
  const pickup = { lat: num(params.pickupLat), lng: num(params.pickupLng), label: params.pickupLabel || '' };
  const destination = { lat: num(params.destLat), lng: num(params.destLng), label: params.destLabel || '' };
  const hasCoords = pickup.lat != null && pickup.lng != null
    && destination.lat != null && destination.lng != null;

  const [quote, setQuote] = useState(null);
  const [loadingQuote, setLoadingQuote] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);
  const submittingRef = useRef(false);
  // The same key survives a network retry. A newly calculated quote gets a new key.
  const idempotencyKeyRef = useRef(null);

  const refreshQuote = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setQuote(null);
    setError('');
    setLoadingQuote(true);
    idempotencyKeyRef.current = null;
    if (!hasCoords) {
      setLoadingQuote(false);
      setError('Endereços inválidos. Volte e selecione os pontos novamente.');
      return;
    }
    try {
      const result = await getRideQuote({ vehicleType, pickup, destination });
      if (sequence === requestSequence.current) setQuote(result);
    } catch (quoteError) {
      if (sequence === requestSequence.current) setError(messageFor(quoteError));
    } finally {
      if (sequence === requestSequence.current) setLoadingQuote(false);
    }
  }, [vehicleType, pickup.lat, pickup.lng, pickup.label,
    destination.lat, destination.lng, destination.label, hasCoords]);

  useEffect(() => {
    refreshQuote();
    return () => { requestSequence.current += 1; };
  }, [refreshQuote]);

  useEffect(() => {
    if (!quote) return undefined;
    const timeout = setTimeout(() => {
      setQuote(null);
      setError('O preço expirou. Recalcule para continuar.');
    }, Math.max(0, quote.expiresAtMs - Date.now()));
    return () => clearTimeout(timeout);
  }, [quote]);

  async function handleConfirm() {
    if (submittingRef.current || !quote) return;
    if (Date.now() >= quote.expiresAtMs) {
      setQuote(null);
      setError('O preço expirou. Recalcule para continuar.');
      return;
    }
    if (!auth.currentUser?.uid) {
      setError('Faça login para pedir uma corrida.');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const ride = await requestRide({
        vehicleType, pickup, destination, quoteId: quote.quoteId, idempotencyKeyRef,
      });
      if (!ride?.rideId) throw new Error('Corrida sem identificador. Tente novamente.');
      router.replace({ pathname: '/searching', params: { rideId: ride.rideId } });
    } catch (submitError) {
      const code = String(submitError?.details?.code || submitError?.code || '');
      if (code.includes('QUOTE_EXPIRED') || code.includes('QUOTE_MISMATCH')) setQuote(null);
      setError(messageFor(submitError));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Preço da corrida" onBack={() => router.back()} />
        <AppCard>
          <AdminTableRow label="Origem" value={pickup.label || '—'} />
          <AdminTableRow label="Destino" value={destination.label || '—'} />
          <AdminTableRow label="Veículo" value={VEHICLE_LABELS_PT_BR[vehicleType]} />
        </AppCard>
        <AppCard>
          {loadingQuote ? (
            <View style={{ alignItems: 'center', gap: spacing.sm }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ fontFamily, color: colors.textMuted }}>Calculando o preço…</Text>
            </View>
          ) : quote ? (
            <>
              <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>Preço da corrida</Text>
              <Text style={[{ fontFamily, color: colors.text }, typography.h1]}>
                {formatBRL(quote.estimatedFareCentavos)}
              </Text>
              <AdminTableRow label="Distância estimada" value={`${(quote.routeDistanceMeters / 1000).toFixed(1).replace('.', ',')} km`} />
              <AdminTableRow label="Duração estimada" value={`${Math.ceil(quote.routeDurationSeconds / 60)} min`} />
              {quote.peakApplied ? (
                <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
                  Adicional de horário de pico incluído no preço.
                </Text>
              ) : null}
              <AdminTableRow label="Pagamento" value="Pix direto ao motorista" />
            </>
          ) : (
            <Text style={{ fontFamily, color: colors.textMuted }}>Calcule o preço para continuar.</Text>
          )}
        </AppCard>
        {error ? (
          <Text accessibilityLiveRegion="polite" style={[{ fontFamily, color: colors.danger }, typography.small]}>
            {error}
          </Text>
        ) : null}
        <AppButton title="Editar locais" variant="ghost" onPress={() => router.back()} disabled={submitting} />
        {!quote && !loadingQuote ? (
          <AppButton title="Recalcular preço" onPress={refreshQuote} disabled={submitting || !hasCoords} />
        ) : null}
        <AppButton
          title={submitting ? 'Buscando motorista…' : 'Confirmar e buscar motorista'}
          onPress={handleConfirm}
          disabled={!quote || loadingQuote || submitting}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
