// DriverPixPaymentSheet
// Minimal real-payment UI for a Mercado Pago Pix charge (subscription or wallet
// top-up). Shows the amount, the QR image when available, the Pix
// copia-e-cola value (selectable, with a copy action), the expiration, and the
// PT-BR status. Polls the backend for status and stops on a final status.
//
// No mock payment result: the payment object comes from createDriverPixPayment.

import { useEffect, useRef, useState } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import AppCard from './AppCard';
import AppButton from './AppButton';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { formatBRL } from '../utils/format';
import { getPaymentStatus, isFinalPaymentStatus } from '../services/paymentsService';
import { copyToClipboard } from '../utils/clipboard';
import useTemporaryMaxBrightness from '../hooks/useTemporaryMaxBrightness';

const POLL_INTERVAL_MS = 5000;

// PT-BR labels for each normalized status.
const STATUS_LABEL = {
  pending: 'Aguardando pagamento…',
  paid: 'Pagamento confirmado!',
  expired: 'Pix expirado. Gere um novo.',
  cancelled: 'Pagamento cancelado.',
  failed: 'Falha no pagamento. Tente novamente.',
  refunded: 'Pagamento estornado.',
  manual_review: 'Em análise. Aguarde a confirmação.',
};

export default function DriverPixPaymentSheet({
  payment,
  onClose,
  onStatusChange,
  title = 'Pagar com Pix',
  statusLabels,
}) {
  const [status, setStatus] = useState(payment ? payment.status : null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const timerRef = useRef(null);
  const { width } = useWindowDimensions();

  const localPaymentId = payment ? payment.localPaymentId : null;
  const qrSize = Math.min(260, Math.max(180, width - (spacing.lg * 5)));
  useTemporaryMaxBrightness(Boolean(payment?.qrCodeBase64));

  useEffect(() => {
    setStatus(payment ? payment.status : null);
    setCopied(false);
    setCopyError('');
  }, [payment?.localPaymentId, payment?.status]);

  useEffect(() => {
    if (status && onStatusChange) onStatusChange(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    if (!localPaymentId || isFinalPaymentStatus(status)) return undefined;
    let cancelled = false;

    async function poll() {
      try {
        const res = await getPaymentStatus(localPaymentId);
        if (cancelled) return;
        setStatus(res.status);
        if (!isFinalPaymentStatus(res.status)) {
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (_e) {
        // Transient error — retry on the next tick without surfacing internals.
        if (!cancelled) timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }
    timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [localPaymentId, status]);

  if (!payment) return null;

  async function onCopy() {
    if (!payment.qrCode) return;
    const copiedSuccessfully = await copyToClipboard(payment.qrCode);
    setCopied(copiedSuccessfully);
    setCopyError(copiedSuccessfully
      ? ''
      : 'Não foi possível copiar. Pressione o código e escolha Copiar.');
  }

  const labels = { ...STATUS_LABEL, ...(statusLabels || {}) };
  const label = labels[status] || labels.pending;

  return (
    <AppCard>
      <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>{title}</Text>

      <Text style={[{ fontFamily, color: colors.text, alignSelf: 'center' }, typography.bodyBold]}>
        {formatBRL(payment.amountCentavos)}
      </Text>

      {payment.qrCodeBase64 ? (
        <View style={{ alignSelf: 'center', padding: spacing.md, backgroundColor: '#FFFFFF' }}>
          <Image
            style={{ width: qrSize, height: qrSize, borderRadius: radius.md }}
            source={{ uri: `data:image/png;base64,${payment.qrCodeBase64}` }}
            contentFit="contain"
          />
        </View>
      ) : (
        <View
          style={{
            alignSelf: 'center',
            width: 180,
            height: 180,
            borderRadius: radius.md,
            backgroundColor: colors.primaryTint,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
            QR indisponível
          </Text>
        </View>
      )}

      {payment.qrCode ? (
        <View
          style={{
            padding: spacing.sm,
            borderRadius: radius.md,
            backgroundColor: colors.primaryTint,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text selectable style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            {payment.qrCode}
          </Text>
        </View>
      ) : null}

      <AppButton
        title={copied ? 'Código copiado' : 'Copiar código Pix'}
        onPress={onCopy}
        disabled={!payment.qrCode}
      />
      {copyError ? (
        <Text style={[{ fontFamily, color: colors.warning }, typography.small]}>{copyError}</Text>
      ) : null}

      <Text style={[{ fontFamily, color: colors.textMuted, alignSelf: 'center' }, typography.small]}>
        {label}
      </Text>

      {payment.expiration ? (
        <Text style={[{ fontFamily, color: colors.textFaint, alignSelf: 'center' }, typography.caption]}>
          {`Expira às ${new Date(payment.expiration).toLocaleTimeString('pt-BR')}`}
        </Text>
      ) : null}

      {onClose ? <AppButton title="Fechar" onPress={onClose} /> : null}
    </AppCard>
  );
}
