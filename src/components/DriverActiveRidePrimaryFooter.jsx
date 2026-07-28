import { StyleSheet, Text, View } from 'react-native';
import AppButton from './AppButton';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';

const UNAVAILABLE_COPY = Object.freeze({
  pickup_missing: 'Carregando o local de embarque…',
  destination_missing: 'Carregando o destino da corrida…',
  paymentPayload_missing: 'Carregando os dados do Pix…',
});

export default function DriverActiveRidePrimaryFooter({ action, onPress }) {
  if (!action) return null;

  const unavailableCopy = action.unavailableReason
    ? UNAVAILABLE_COPY[action.unavailableReason] || 'Aguardando os dados da corrida…'
    : null;

  return (
    <View style={styles.footer} testID="driver-active-ride-primary-footer">
      {unavailableCopy ? (
        <Text style={styles.helper}>{unavailableCopy}</Text>
      ) : null}
      <AppButton
        title={action.title}
        onPress={onPress}
        disabled={action.disabled}
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  helper: {
    fontFamily,
    color: colors.textMuted,
    ...typography.caption,
    textAlign: 'center',
  },
  button: {
    minHeight: 56,
    justifyContent: 'center',
  },
});
