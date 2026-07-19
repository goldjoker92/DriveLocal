// Notifications client service (Android-first).
//
// Obtains the REAL native device FCM token through
// expo-notifications getDevicePushTokenAsync.
//
// This is NOT an Expo Push Token because notifications are sent directly
// through Firebase Admin Messaging from the backend.
//
// The device token is registered or disabled through the secure callable
// Cloud Function syncNotificationTokenSecure.
//
// No mock notification tokens are used.

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { httpsCallable } from "firebase/functions";
import { Platform } from "react-native";

import { functions } from "../config/firebase";
import { NOTIFICATION_CHANNELS } from "../constants/notificationChannels";

const INSTALLATION_ID_KEY = "drivelocal.installationId";

/**
 * Returns a stable identifier for this application installation.
 *
 * The identifier is persisted in AsyncStorage and is used to namespace the
 * notification-token document for each physical device/application install.
 */
async function getInstallationId() {
  let installationId = await AsyncStorage.getItem(INSTALLATION_ID_KEY);

  if (!installationId) {
    installationId = [
      "inst",
      Date.now().toString(36),
      Math.random().toString(36).slice(2, 10),
    ].join("_");

    await AsyncStorage.setItem(INSTALLATION_ID_KEY, installationId);
  }

  return installationId;
}

/**
 * Creates the Android notification channels used by DriveLocal.
 *
 * Android notification channels must exist before notifications are delivered.
 *
 * - Ride offers use MAX importance because they are time-sensitive.
 * - Ride status updates use HIGH importance.
 * - Both channels use vibration.
 *
 * Do not set `sound: 'default'` here.
 *
 * In the current Expo notifications implementation, a value passed to `sound`
 * can be interpreted as the name of a custom native sound file. Passing
 * "default" therefore produces:
 *
 * expo-notifications: Custom sound 'default' not found in native app.
 *
 * Omitting the property prevents that native warning.
 */
export async function ensureAndroidChannels() {
  if (Platform.OS !== "android") {
    return;
  }

  await Notifications.setNotificationChannelAsync(
    NOTIFICATION_CHANNELS.RIDE_OFFERS,
    {
      name: "Corridas disponíveis",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
    },
  );

  await Notifications.setNotificationChannelAsync(
    NOTIFICATION_CHANNELS.RIDE_STATUS,
    {
      name: "Status da corrida",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
    },
  );
}

const appVersion =
  Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? null;

/**
 * Requests notification permission, obtains the real native Android FCM token
 * and registers it server-side.
 *
 * Returns:
 * - The native FCM token when registration succeeds.
 * - null when notifications are unavailable, permission is denied, the device
 *   is unsupported, or registration fails.
 *
 * Notification registration must never prevent the application from starting,
 * so failures are intentionally handled without throwing to the UI.
 */
export async function registerForPushNotifications(role) {
  try {
    if (Platform.OS !== "android" || !Device.isDevice) {
      return null;
    }

    // Channels must be created before requesting the token or receiving
    // Android notifications.
    await ensureAndroidChannels();

    const currentPermissions = await Notifications.getPermissionsAsync();

    let permissionGranted = currentPermissions.granted;

    if (!permissionGranted && currentPermissions.canAskAgain) {
      const requestedPermissions =
        await Notifications.requestPermissionsAsync();

      permissionGranted = requestedPermissions.granted;
    }

    if (!permissionGranted) {
      return null;
    }

    // Returns the native Firebase Cloud Messaging token, not an Expo token.
    const devicePushToken = await Notifications.getDevicePushTokenAsync();

    const token = devicePushToken?.data;

    if (!token) {
      return null;
    }

    const installationId = await getInstallationId();

    const syncNotificationToken = httpsCallable(
      functions,
      "syncNotificationTokenSecure",
    );

    await syncNotificationToken({
      token,
      installationId,
      platform: "android",
      appVersion,
      role: role ?? null,
    });

    return token;
  } catch (error) {
    // Token registration is best-effort and must never break application
    // startup. Avoid logging the FCM token or other sensitive information.
    if (__DEV__) {
      console.warn(
        "[notifications] Unable to register the device notification token.",
        error instanceof Error ? error.message : String(error),
      );
    }

    return null;
  }
}

/**
 * Disables the notification token associated with this application
 * installation.
 *
 * The backend marks the token as inactive when the user signs out.
 * This operation is best-effort and must not block logout.
 */
export async function disablePushNotifications() {
  try {
    if (Platform.OS !== "android") {
      return;
    }

    const installationId = await getInstallationId();

    const syncNotificationToken = httpsCallable(
      functions,
      "syncNotificationTokenSecure",
    );

    await syncNotificationToken({
      installationId,
      platform: "android",
      enabled: false,
    });
  } catch (error) {
    // Logout must continue even when the backend cannot disable the token.
    if (__DEV__) {
      console.warn(
        "[notifications] Unable to disable the device notification token.",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
