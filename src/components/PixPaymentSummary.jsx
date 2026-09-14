// Shared Pix charge presentation used by both passenger and driver screens.
// It renders only server-generated data. Never build or alter the Pix payload here.

import { Text, useWindowDimensions, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { formatBRL } from '../utils/format';
import useTemporaryMaxBrightness from '../hooks/useTemporaryMaxBrightness';

export default function PixPaymentSummary({
  amountCentavos,
  payload,
  instruction,
  primaryAction = null,
  qrInstruction = null,
  showPayload = false,
}) {
  const { width } = useWindowDimensions();
  const hasAmount = amountCentavos != null && Number.isFinite(Number(amountCentavos));
  const qrSize = Math.min(300, Math.max(180, width - (spacing.lg * 4)));
  const quietZone = Math.max(16, Math.round(qrSize * 0.06));
  useTemporaryMaxBrightness(Boolean(payload));

  return (
    <>
      <Text style={[{ fontFamily, color: colors.text, alignSelf: 'center' }, typography.h3]}>
        {hasAmount ? formatBRL(Number(amountCentavos)) : '—'}
      </Text>

      {instruction ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          {instruction}
        </Text>
      ) : null}

      {primaryAction}

      {qrInstruction ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
          {qrInstruction}
        </Text>
      ) : null}

      {payload ? (
        <View
          accessibilityLabel="QR Code Pix"
          style={{
            alignSelf: 'center',
            padding: spacing.sm,
            backgroundColor: '#FFFFFF',
            borderRadius: spacing.sm,
          }}
        >
          <QRCode
            value={payload}
            size={qrSize}
            ecl="H"
            quietZone={quietZone}
            color="#000000"
            backgroundColor="#FFFFFF"
          />
        </View>
      ) : (
        <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
          Gerando cobrança…
        </Text>
      )}

      {showPayload && payload ? (
        <View
          style={{
            padding: spacing.sm,
            borderRadius: spacing.sm,
            backgroundColor: colors.primaryTint,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={[{ fontFamily, color: colors.text }, typography.small]}>
            Código Pix copia e cola
          </Text>
          <Text
            selectable
            accessibilityLabel="Código Pix copia e cola"
            style={[{ fontFamily, color: colors.textMuted, lineHeight: 18 }, typography.caption]}
          >
            {payload}
          </Text>
        </View>
      ) : null}
    </>
  );
}
