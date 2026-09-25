import { useEffect, useState } from 'react';
import {
  BackHandler,
  Linking,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import AppButton from '../components/AppButton';
import { auth } from '../config/firebase';
import { APP_BUILD_NUMBER } from '../config/runtimeEnvironment';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

const ANDROID_PACKAGE = 'com.drivelocal.app';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=' + ANDROID_PACKAGE;
const PLAY_MARKET_URL = 'market://details?id=' + ANDROID_PACKAGE;
// Compatibility fallback for the first mandatory-update rollout. Every server
// redirect also carries its live minimum so future releases are not hard-coded.
const FIRST_REQUIRED_DRIVER_BUILD_NUMBER = 17;

function normalizedRequiredBuildNumber(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : FIRST_REQUIRED_DRIVER_BUILD_NUMBER;
}

export default function UpdateRequired() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [opening, setOpening] = useState(false);
  const requiredBuildNumber = normalizedRequiredBuildNumber(
    params.minimumBuildNumber
  );
  const updateInstalled = APP_BUILD_NUMBER >= requiredBuildNumber;

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => true
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!updateInstalled) return undefined;

    let active = true;
    async function returnToApp() {
      // Firebase normally preserves the session across a Play Store update.
      // Wait for restoration before choosing the destination so an updated
      // driver never falls back into registration by mistake.
      if (typeof auth.authStateReady === 'function') {
        await auth.authStateReady();
      }
      if (!active) return;
      router.replace(auth.currentUser ? '/driver-home' : '/');
    }

    returnToApp().catch((error) => {
      console.warn('[DRIVER_UPDATE] post_update_redirect_failed', {
        scope: 'driver_update',
        event: 'post_update_redirect_failed',
        currentBuildNumber: APP_BUILD_NUMBER,
        requiredBuildNumber,
        reason: error?.code || error?.message || 'unknown',
        atMs: Date.now(),
      });
    });

    return () => {
      active = false;
    };
  }, [requiredBuildNumber, router, updateInstalled]);

  async function openPlayStore() {
    if (opening || updateInstalled) return;
    setOpening(true);
    try {
      const canOpenMarket = await Linking.canOpenURL(PLAY_MARKET_URL);
      await Linking.openURL(canOpenMarket ? PLAY_MARKET_URL : PLAY_STORE_URL);
    } catch (_error) {
      await Linking.openURL(PLAY_STORE_URL);
    } finally {
      setOpening(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.icon}>
          <Text style={styles.iconText}>↻</Text>
        </View>
        <Text style={styles.title}>
          {updateInstalled ? 'Atualização concluída' : 'Atualização necessária'}
        </Text>
        <Text style={styles.body}>
          {updateInstalled
            ? 'Abrindo seu cockpit…'
            : 'Esta versão não é mais compatível. Atualize o DriveLocal na Google Play para continuar.'}
        </Text>
        {!updateInstalled ? (
          <>
            <AppButton
              title={opening ? 'Abrindo Google Play…' : 'Atualizar agora'}
              onPress={openPlayStore}
              disabled={opening}
              style={styles.button}
            />
            <Text style={styles.help}>
              Não desinstale o aplicativo. Atualize pela Google Play e abra o
              DriveLocal novamente.
            </Text>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    backgroundColor: colors.primaryTint,
    marginBottom: spacing.lg,
  },
  iconText: {
    fontFamily,
    fontSize: 40,
    color: colors.primary,
  },
  title: {
    ...typography.h1,
    fontFamily,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  body: {
    ...typography.body,
    fontFamily,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 24,
  },
  notice: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningBg,
  },
  noticeText: {
    ...typography.body,
    fontFamily,
    color: colors.warning,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.xl,
  },
  help: {
    ...typography.caption,
    fontFamily,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
