// Pix payment (route "/pix-payment"). Real direct passenger->driver Pix.
//
// The Pix "copia e cola" payload and amount come from the passenger's own ride
// document (server-generated at ride finish) via a secured Firestore listener.
// The QR IMAGE is intentionally not rendered here: a QR renderer package is not
// installed (see the audit report) and is NOT faked. "Já paguei" is a declaration
// only; the driver confirms receipt. No fake success screen.

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { formatBRL } from '../../utils/format';
import { copyToClipboard } from '../../utils/clipboard';
import { listenToRide, markPassengerPixSent, reportPaymentIssue } from '../../services/ridesService';

export default function PixPayment() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;

  const [ride, setRide] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!rideId) return undefined;
    return listenToRide(
      rideId,
      (r) => {
        if (!r) return;
        setRide(r);
        if (r.status === 'completed') router.replace({ pathname: '/ride-completed', params: { rideId } });
      },
      () => setError('Não foi possível carregar a corrida.')
    );
  }, [rideId, router]);

  const payload = ride && ride.paymentPixPayload;
  const amount = ride && ride.paymentAmountCentavos;

  async function onCopy() {
    if (!payload) return;
    await copyToClipboard(payload);
    setCopied(true);
  }
  async function run(action, fn, reason) {
    if (busy) return;
    setBusy(action);
    setError('');
    try {
      await fn(rideId, reason);
    } catch (e) {
      setError((e && e.message) || 'Não foi possível concluir. Tente novamente.');
    } finally {
      setBusy('');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Pagamento Pix" onBack={() => router.back()} />
        <AppCard>
          <Text style={[{ fontFamily, color: colors.text, alignSelf: 'center' }, typography.h3]}>
            {amount != null ? formatBRL(amount) : '—'}
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            Leia o QR Code ou use o Pix copia e cola. Pague somente por este código.
          </Text>
          {payload ? (
            <View style={{ alignSelf: 'center', padding: spacing.sm, backgroundColor: '#FFFFFF' }}>
              <QRCode value={payload} size={200} />
            </View>
          ) : null}
          {payload ? (
            <Text selectable style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>{payload}</Text>
          ) : (
            <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>Gerando cobrança…</Text>
          )}
          <AppButton title={copied ? 'Código copiado' : 'Copiar código Pix'} onPress={onCopy} disabled={!payload} />
        </AppCard>

        <AppButton title={busy === 'paid' ? 'Enviando…' : 'Já paguei'} onPress={() => run('paid', markPassengerPixSent)} disabled={!!busy} />
        <AppButton title="Problema no pagamento" variant="ghost" onPress={() => run('issue', reportPaymentIssue, 'passageiro_reportou')} disabled={!!busy} />
        {error ? <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
