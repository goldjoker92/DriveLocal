import { StyleSheet, Text, View } from 'react-native';
import AppCard from './AppCard';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';

const GPS_COPY = Object.freeze({
  active: 'GPS ATIVO',
  checking: 'GPS VERIFICANDO',
  attention: 'GPS REQUER ATENÇÃO',
  stopped: 'GPS ENCERRADO',
});

function StepBar({ active, completed }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.stepBar,
        completed && styles.stepBarCompleted,
        active && styles.stepBarActive,
      ]}
    />
  );
}

export default function DriverActiveRideStageCard({ stage, trackingState = 'checking' }) {
  if (!stage) return null;

  const gpsActive = trackingState === 'active';
  const gpsAttention = trackingState === 'attention';
  const gpsStopped = trackingState === 'stopped';

  return (
    <AppCard style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>{`ETAPA ${stage.index || 0} DE ${stage.total || 4}`}</Text>
        <View
          style={[
            styles.gpsBadge,
            gpsActive
              ? styles.gpsBadgeActive
              : gpsAttention
                ? styles.gpsBadgeAttention
                : gpsStopped
                  ? styles.gpsBadgeStopped
                  : styles.gpsBadgePending,
          ]}
        >
          <View
            style={[
              styles.gpsDot,
              gpsActive
                ? styles.gpsDotActive
                : gpsAttention
                  ? styles.gpsDotAttention
                  : gpsStopped
                    ? styles.gpsDotStopped
                    : styles.gpsDotPending,
            ]}
          />
          <Text
            style={[
              styles.gpsText,
              gpsActive
                ? styles.gpsTextActive
                : gpsAttention
                  ? styles.gpsTextAttention
                  : gpsStopped
                    ? styles.gpsTextStopped
                    : styles.gpsTextPending,
            ]}
          >
            {GPS_COPY[trackingState] || GPS_COPY.checking}
          </Text>
        </View>
      </View>

      <View style={styles.progressRow}>
        {Array.from({ length: stage.total || 4 }, (_, index) => {
          const stepNumber = index + 1;
          return (
            <StepBar
              key={stepNumber}
              completed={stepNumber < stage.index}
              active={stepNumber === stage.index}
            />
          );
        })}
      </View>

      <View style={styles.copy}>
        <Text style={styles.title}>{stage.label}</Text>
        <Text style={styles.helper}>{stage.helper}</Text>
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  eyebrow: {
    flex: 1,
    fontFamily,
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  gpsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  gpsBadgeActive: { backgroundColor: colors.successBg },
  gpsBadgePending: { backgroundColor: colors.warningBg },
  gpsBadgeAttention: { backgroundColor: colors.dangerBg },
  gpsBadgeStopped: { backgroundColor: colors.primaryTint },
  gpsDot: { width: 7, height: 7, borderRadius: radius.full },
  gpsDotActive: { backgroundColor: colors.success },
  gpsDotPending: { backgroundColor: colors.warning },
  gpsDotAttention: { backgroundColor: colors.danger },
  gpsDotStopped: { backgroundColor: colors.textFaint },
  gpsText: {
    fontFamily,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.35,
  },
  gpsTextActive: { color: colors.success },
  gpsTextPending: { color: colors.warning },
  gpsTextAttention: { color: colors.danger },
  gpsTextStopped: { color: colors.textMuted },
  progressRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  stepBar: {
    flex: 1,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.border,
  },
  stepBarCompleted: { backgroundColor: colors.primaryTint },
  stepBarActive: { backgroundColor: colors.primary },
  copy: { gap: spacing.xs },
  title: {
    fontFamily,
    color: colors.text,
    ...typography.h3,
  },
  helper: {
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
    lineHeight: 19,
  },
});
