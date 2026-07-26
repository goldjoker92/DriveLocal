import { StyleSheet, Text, View } from 'react-native';
import AppButton from './AppButton';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

export default function DriverActiveRideActionBar({ action, onPress }) {
  if (!action) return null;

  return (
    <View style={styles.bar}>
      <Text style={styles.label}>PRÓXIMA AÇÃO</Text>
      <AppButton
        title={action.title}
        onPress={() => onPress(action)}
        disabled={action.disabled}
        style={styles.button}
      />
      {action.unavailableReason ? (
        <Text style={styles.waiting}>Aguardando os dados seguros da corrida…</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  label: {
    fontFamily,
    color: colors.textFaint,
    ...typography.caption,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  button: {
    minHeight: 54,
    justifyContent: 'center',
  },
  waiting: {
    fontFamily,
    color: colors.textMuted,
    ...typography.caption,
    textAlign: 'center',
  },
});
