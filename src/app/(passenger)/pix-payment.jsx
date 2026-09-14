// Passenger Pix payment screen (route "/pix-payment").
//
// The backend creates one immutable charge (amount + Pix copia e cola) when the
// driver finishes the ride. The passenger may declare that the transfer was sent,
// but only the driver's receipt confirmation changes the ride to "completed".

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import PixPaymentSummary from '../../components/PixPaymentSummary';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { formatBRL } from '../../utils/format';
import { copyToClipboard } from '../../utils/clipboard';
import { logRideClientEvent } from '../../utils/clientRideLog';
import { listenToRide, markPassengerPixSent, reportPaymentIssue } from '../../services/ridesService';

const SUCCESS_VISIBLE_MS = 5000;

export default function PixPayment() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;

  const [ride, setRide] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');

  useEffect(() => {
    if (!rideId) return undefined;
    return listenToRide(
      rideId,
      (nextRide) => {
        if (!nextRide) return;
        setRide(nextRide);
      },
      () => setError('Não foi possível carregar a corrida.')
    );
  }, [rideId]);

  const status = ride?.status;
  const payload = ride?.paymentPixPayload;
  const amount = ride?.paymentAmountCentavos;

  useEffect(() => {
    if (!rideId || !status) return;
    logRideClientEvent('pix.passenger.screen_status_changed', {
      rideId,
      status,
      amountCentavos: amount,
      hasPayload: !!payload,
    });
  }, [rideId, status, amount, payload]);

  useEffect(() => {
    if (!rideId || status !== 'completed') return undefined;

    logRideClientEvent('pix.passenger.success_feedback_started', {
      rideId,
      visibleForMs: SUCCESS_VISIBLE_MS,
    });

    const timeout = setTimeout(() => {
      logRideClientEvent('pix.passenger.success_feedback_finished', { rideId });
      router.replace({ pathname: '/ride-completed', params: { rideId } });
    }, SUCCESS_VISIBLE_MS);

    return () => clearTimeout(timeout);
  }, [rideId, status, router]);

  async function onCopy() {
    if (!payload) return;
    const copiedSuccessfully = await copyToClipboard(payload);
    setCopied(copiedSuccessfully);
    setCopyError(copiedSuccessfully
      ? ''
      : 'Não foi possível copiar. Pressione o código abaixo e escolha Copiar.');
    logRideClientEvent(
      copiedSuccessfully ? 'pix.passenger.payload_copied' : 'pix.passenger.payload_copy_failed',
      { rideId },
      copiedSuccessfully ? 'log' : 'warn'
    );
  }

  async function run(action, fn, reason) {
    if (!rideId || busy) return;
    setBusy(action);
    setError('');
    try {
      await fn(rideId, reason);
    } catch (e) {
      const message = e?.message || 'Não foi possível concluir. Tente novamente.';
      setError(message);
      logRideClientEvent('pix.passenger.ui_action_failed', {
        rideId,
        action,
        status,
        error: e,
      }, 'error');
    } finally {
      setBusy('');
    }
  }

  const paymentOpen = status === 'awaiting_payment' || status === 'payment_marked_sent';
  const disputed = status === 'disputed';
  const completed = status === 'completed';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Pagamento Pix" onBack={() => router.back()} />

        {completed ? (
          <AppCard>
            <View
              style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                alignSelf: 'center',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.success,
              }}
            >
              <Text style={{ fontFamily, color: '#FFFFFF', fontSize: 52, lineHeight: 58 }}>✓</Text>
            </View>
            <Text style={[{ fontFamily, color: colors.success, textAlign: 'center' }, typography.h3]}>
              Pagamento confirmado
            </Text>
            <Text style={[{ fontFamily, color: colors.text, textAlign: 'center' }, typography.bodyBold]}>
              {amount != null ? formatBRL(amount) : 'Valor registrado'}
            </Text>
            <Text style={[{ fontFamily, color: colors.textMuted, textAlign: 'center' }, typography.small]}>
              Motorista e passageiro receberam a confirmação. Esta tela fechará em 5 segundos.
            </Text>
          </AppCard>
        ) : (
          <AppCard>
            <PixPaymentSummary
              amountCentavos={amount}
              payload={payload}
              showPayload
              instruction="Pague neste telefone usando o Pix copia e cola. O valor da corrida já está preenchido."
              primaryAction={(
                <View style={{ gap: spacing.xs }}>
                  <AppButton
                    title={copied ? 'Código copiado' : 'Copiar código Pix'}
                    onPress={onCopy}
                    disabled={!payload}
                  />
                  {copyError ? (
                    <Text style={[{ fontFamily, color: colors.warning }, typography.small]}>
                      {copyError}
                    </Text>
                  ) : null}
                </View>
              )}
              qrInstruction="O QR Code abaixo pode ser escaneado por outro aparelho."
            />
          </AppCard>
        )}

        {status === 'payment_marked_sent' ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.warning }, typography.bodyBold]}>
              Pagamento informado
            </Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Aguardando o motorista verificar a própria conta. Isso ainda não é uma confirmação de recebimento.
            </Text>
          </AppCard>
        ) : null}

        {disputed ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.warning }, typography.bodyBold]}>
              Pagamento em conferência
            </Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              A tela permanece aberta e o valor da corrida continua registrado para conferência e suporte.
            </Text>
          </AppCard>
        ) : null}

        {status === 'awaiting_payment' ? (
          <AppButton
            title={busy === 'paid' ? 'Enviando…' : 'Já paguei'}
            onPress={() => run('paid', markPassengerPixSent)}
            disabled={!!busy || !payload}
          />
        ) : null}

        {paymentOpen ? (
          <AppButton
            title="Problema no pagamento"
            variant="ghost"
            onPress={() => run('issue', reportPaymentIssue, 'passageiro_reportou')}
            disabled={!!busy}
          />
        ) : null}

        {error ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
              Nenhum dado de pagamento foi apagado. Confira o valor e tente novamente.
            </Text>
          </AppCard>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
