// Notifications client service (Android-first). Obtains the REAL native device
// FCM token via expo-notifications getDevicePushTokenAsync — NOT an Expo push
// token — because sending happens through Firebase Admin Messaging on the
// backend. Registers/disables the token through the secure callable
// syncNotificationTokenSecure. No mock tokens.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { NOTIFICATION_CHANNELS } from '../constants/notificationChannels';

const INSTALLATION_ID_KEY = 'drivelocal.installationId';

// A stable per-install id (persisted). Namespaces the token document per device.
async function getInstallationId() {
  let id = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
  if (!id) {
    id = `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(INSTALLATION_ID_KEY, id);
  }
  return id;
}

// Android channels MUST exist before token retrieval / delivery.
// Offers = MAX importance; status = HIGH importance; both with sound + vibration.
export async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.RIDE_OFFERS, {
    name: 'Corridas disponíveis',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
  });
  await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.RIDE_STATUS, {
    name: 'Status da corrida',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
  });
}

const appVersion =
  (Constants.expoConfig && Constants.expoConfig.version) || Constants.nativeAppVersion || null;

// Requests permission, gets the native FCM token, and registers it server-side.
// Returns the token string, or null when unavailable (permission denied / web /
// emulator without FCM). Never throws to the caller.
export async function registerForPushNotifications(role) {
  try {
    if (Platform.OS !== 'android' || !Device.isDevice) return null;
    await ensureAndroidChannels();
    const perm = await Notifications.getPermissionsAsync();
    let granted = perm.granted;
    if (!granted && perm.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return null;

    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (!token) return null;
    const installationId = await getInstallationId();
    const call = httpsCallable(functions, 'syncNotificationTokenSecure');
    await call({ token, installationId, platform: 'android', appVersion, role: role || null });
    return token;
  } catch (_e) {
    // Token registration must never break app startup.
    return null;
  }
}

// Disables this device's token on logout (server marks it inactive).
export async function disablePushNotifications() {
  try {
    if (Platform.OS !== 'android') return;
    const installationId = await getInstallationId();
    const call = httpsCallable(functions, 'syncNotificationTokenSecure');
    await call({ installationId, platform: 'android', enabled: false });
  } catch (_e) {
    // best effort
  }
}
