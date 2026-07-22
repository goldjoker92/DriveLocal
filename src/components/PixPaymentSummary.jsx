// Shared Pix charge presentation used by both passenger and driver screens.
// It renders only server-generated data. Never build or alter the Pix payload here.

import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { formatBRL } from '../utils/format';

export default function PixPaymentSummary({
  amountCentavos,
  payload,
  instruction,
  showPayload = false,
}) {
  const hasAmount = amountCentavos != null && Number.isFinite(Number(amountCentavos));

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

      {payload ? (
        <View style={{ alignSelf: 'center', padding: spacing.sm, backgroundColor: '#FFFFFF' }}>
          <QRCode value={payload} size={200} />
        </View>
      ) : (
        <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
          Gerando cobrança…
        </Text>
      )}

      {showPayload && payload ? (
        <Text selectable style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
          {payload}
        </Text>
      ) : null}
    </>
  );
}
