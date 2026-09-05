// Android background-reliability tip for the driver cockpit.
//
// Shown only after the app actually lost its background service at least once
// (see src/utils/driverBackgroundReliability.js). Purpose: without a battery
// optimization exemption, Android kills the location service, the driver keeps
// seeing "disponível" and stops receiving rides without understanding why.
//
// Deliberately opens the generic app settings screen: no new dependency, and no
// sensitive REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission to justify on Play.

import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import AppButton from './AppButton';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';
import {
  dismissBackgroundReliabilityTip,
  resolveBackgroundTipVisibility,
} from '../services/driverBackgroundReliabilityStore';

const NS = '[DRIVER_BACKGROUND]';

export default function DriverBatteryTipCard() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    resolveBackgroundTipVisibility()
      .then((decision) => {
        if (active) setVisible(decision.show === true);
      })
      .catch(() => {
        // Advice only: never let this block the cockpit.
        if (active) setVisible(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const openSettings = useCallback(async () => {
    try {
      console.log(`${NS} settings.open_requested`);
      await Linking.openSettings();
      console.log(`${NS} settings.open_succeeded`);
    } catch (error) {
      console.warn(`${NS} settings.open_failed`, {
        reason: error?.code || error?.message || 'unknown',
      });
    }
  }, []);

  const dismiss = useCallback(async () => {
    setVisible(false);
    await dismissBackgroundReliabilityTip().catch(() => undefined);
  }, []);

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>⚠️ O Android pode estar cortando seu trabalho</Text>
      <Text style={styles.body}>
        Notamos que o DriveLocal parou de enviar sua localização em segundo plano.
        Quando isso acontece, você continua vendo “disponível”, mas deixa de receber corridas.
      </Text>
      <Text style={styles.body}>
        Nas configurações do app, desative a otimização de bateria e permita o
        início automático do DriveLocal.
      </Text>
      <AppButton title="Abrir configurações do app" onPress={openSettings} />
      <AppButton title="Entendi" variant="secondary" onPress={dismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.warningBg,
    borderColor: colors.warning,
    gap: spacing.sm,
  },
  title: { fontFamily, color: colors.text, ...typography.bodyBold },
  body: { fontFamily, color: colors.textMuted, ...typography.small },
});
