// DriverPixPaymentSheet
// Minimal real-payment UI for a Mercado Pago Pix charge (subscription or wallet
// top-up). Shows the amount, the QR image when available, the Pix
// copia-e-cola value (selectable, with a copy action), the expiration, and the
// PT-BR status. Polls the backend for status and stops on a final status.
//
// No mock payment result: the payment object comes from createDriverPixPayment.

import { useEffect, useRef, useState } from 'react';
import { View, Text, Platform } from 'react-native';
import { Image } from 'expo-image';
import AppCard from './AppCard';
import AppButton from './AppButton';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { formatBRL } from '../utils/format';
import { getPaymentStatus, isFinalPaymentStatus } from '../services/paymentsService';

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
  const timerRef = useRef(null);

  const localPaymentId = payment ? payment.localPaymentId : null;

  useEffect(() => {
    setStatus(payment ? payment.status : null);
    setCopied(false);
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

  function onCopy() {
    if (!payment.qrCode) return;
    // Web: use the Clipboard API. Native: the code is selectable (long-press to
    // copy) — no extra dependency required.
    if (Platform.OS === 'web' && globalThis.navigator && globalThis.navigator.clipboard) {
      globalThis.navigator.clipboard.writeText(payment.qrCode);
    }
    setCopied(true);
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
        <Image
          style={{ alignSelf: 'center', width: 180, height: 180, borderRadius: radius.md }}
          source={{ uri: `data:image/png;base64,${payment.qrCodeBase64}` }}
          contentFit="contain"
        />
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
        <Text
          selectable
          style={[{ fontFamily, color: colors.textMuted }, typography.caption]}
        >
          {payment.qrCode}
        </Text>
      ) : null}

      <AppButton
        title={copied ? 'Código copiado' : 'Copiar código Pix'}
        onPress={onCopy}
        disabled={!payment.qrCode}
      />

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
