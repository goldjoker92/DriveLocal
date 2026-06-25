// WalletCard
// Shows the driver's wallet balance. Flags a low balance with a warning,
// unless the driver is in an active founder/commission-free window.

import { View, Text } from 'react-native';
import AppCard from './AppCard';
import AppBadge from './AppBadge';
import { colors } from '../constants/colors';
import { typography, fontFamily } from '../constants/typography';
import { formatBRL } from '../utils/format';
import { WALLET_FALLBACK_LOW_THRESHOLD_CENTS } from '../constants/walletRules';

export default function WalletCard({ balanceCents = 0, isFounderActive = false }) {
  const low =
    !isFounderActive && balanceCents <= WALLET_FALLBACK_LOW_THRESHOLD_CENTS;

  return (
    <AppCard>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          Saldo da carteira
        </Text>
        {isFounderActive ? (
          <AppBadge label="Fundador ativo" tone="success" />
        ) : low ? (
          <AppBadge label="Saldo baixo" tone="warning" />
        ) : null}
      </View>
      <Text style={[{ fontFamily, color: colors.text }, typography.h1]}>
        {formatBRL(balanceCents)}
      </Text>
    </AppCard>
  );
}
