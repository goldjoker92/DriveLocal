// WalletCard
// Real driver wallet summary: available, held and total centavos from Firestore.
// Missing values remain loading states and are never rendered as a fake R$ 0,00.

import { StyleSheet, Text, View } from 'react-native';
import AppCard from './AppCard';
import AppBadge from './AppBadge';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { formatBRL } from '../utils/format';
import { WALLET_FALLBACK_LOW_THRESHOLD_CENTS } from '../constants/walletRules';

function money(value) {
  return Number.isInteger(value) && value >= 0 ? formatBRL(value) : 'Carregando…';
}

export default function WalletCard({
  balanceCents = null,
  availableCents = null,
  heldCents = null,
  topupLocked = false,
}) {
  const low = !topupLocked
    && Number.isInteger(availableCents)
    && availableCents <= WALLET_FALLBACK_LOW_THRESHOLD_CENTS;

  return (
    <AppCard style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.caption}>Saldo disponível</Text>
        {topupLocked ? (
          <AppBadge label="Comissão 0%" tone="success" />
        ) : low ? (
          <AppBadge label="Saldo baixo" tone="warning" />
        ) : null}
      </View>

      <Text style={styles.available}>{money(availableCents)}</Text>

      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.label}>Saldo reservado</Text>
        <Text style={styles.value}>{money(heldCents)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Saldo total</Text>
        <Text style={styles.value}>{money(balanceCents)}</Text>
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  caption: {
    flex: 1,
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
  },
  available: {
    fontFamily,
    color: colors.text,
    ...typography.h1,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  label: {
    flex: 1,
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
  },
  value: {
    fontFamily,
    color: colors.text,
    ...typography.bodyBold,
    textAlign: 'right',
  },
});
