import { useEffect, useState } from 'react';
import {
  BackHandler,
  Linking,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AppButton from '../components/AppButton';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

const ANDROID_PACKAGE = 'com.drivelocal.app';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=' + ANDROID_PACKAGE;
const PLAY_MARKET_URL = 'market://details?id=' + ANDROID_PACKAGE;

export default function UpdateRequired() {
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => true
    );
    return () => subscription.remove();
  }, []);

  async function openPlayStore() {
    if (opening) return;
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
        <Text style={styles.title}>Atualização obrigatória</Text>
        <Text style={styles.body}>
          Para continuar disponível e receber novas corridas, instale a versão
          mais recente do DriveLocal.
        </Text>
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Esta atualização corrige a presença dos motoristas e evita corridas
            perdidas.
          </Text>
        </View>
        <AppButton
          title={opening ? 'Abrindo Google Play…' : 'Atualizar agora'}
          onPress={openPlayStore}
          disabled={opening}
          style={styles.button}
        />
        <Text style={styles.help}>
          Depois da atualização, abra o DriveLocal novamente.
        </Text>
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
