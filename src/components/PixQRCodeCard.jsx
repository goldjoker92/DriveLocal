// PixQRCodeCard
// Placeholder Pix payment card. The real QR code is generated in a later
// step; for now this shows the layout and the Pix key.

import { View, Text } from 'react-native';
import AppCard from './AppCard';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

export default function PixQRCodeCard({ pixKey = 'chave-pix@drivelocal', amountLabel }) {
  return (
    <AppCard>
      <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>
        Pagar com Pix
      </Text>

      <View
        style={{
          alignSelf: 'center',
          width: 160,
          height: 160,
          borderRadius: radius.md,
          backgroundColor: colors.primaryTint,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={[{ fontFamily, color: colors.primary }, typography.small]}>
          QR Code
        </Text>
        <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
          (placeholder)
        </Text>
      </View>

      {amountLabel ? (
        <Text
          style={[{ fontFamily, color: colors.text, alignSelf: 'center' }, typography.bodyBold]}
        >
          {amountLabel}
        </Text>
      ) : null}
      <Text
        style={[{ fontFamily, color: colors.textMuted, alignSelf: 'center' }, typography.small]}
      >
        {pixKey}
      </Text>
    </AppCard>
  );
}
