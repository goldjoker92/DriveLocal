import { StyleSheet, Text, View } from 'react-native';
import AppButton from './AppButton';
import AppCard from './AppCard';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';

export default function DriverActiveRideNavigationCard({
  navigation,
  modeLabel,
  onOpenWaze,
  onOpenGoogleMaps,
  disabled = false,
}) {
  if (!navigation) return null;

  const point = navigation.point;
  const address = point?.label || (navigation.kind === 'pickup'
    ? 'Carregando local de embarque…'
    : 'Carregando destino…');

  return (
    <AppCard style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>NAVEGAÇÃO</Text>
          <Text style={styles.title}>{navigation.title}</Text>
        </View>
        <Text style={styles.mode}>{modeLabel}</Text>
      </View>

      <Text style={[styles.address, !point && styles.addressPending]}>{address}</Text>

      <View style={styles.actions}>
        <AppButton
          title="Abrir no Waze"
          onPress={onOpenWaze}
          disabled={disabled || !point}
        />
        <AppButton
          title="Abrir no Google Maps"
          variant="secondary"
          onPress={onOpenGoogleMaps}
          disabled={disabled || !point}
        />
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerCopy: { flex: 1, gap: spacing.xs },
  eyebrow: {
    fontFamily,
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  title: {
    fontFamily,
    color: colors.text,
    ...typography.bodyBold,
  },
  mode: {
    fontFamily,
    color: colors.primary,
    ...typography.caption,
    textAlign: 'right',
  },
  address: {
    fontFamily,
    color: colors.text,
    ...typography.small,
    lineHeight: 19,
  },
  addressPending: { color: colors.textFaint },
  actions: { gap: spacing.sm },
});
