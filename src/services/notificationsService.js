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
// No mock notification tokens are used. Diagnostic persistence deliberately
// stores only a safe status; the FCM token is never written to AsyncStorage or
// printed in logs.

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { httpsCallable } from "firebase/functions";
import { Platform } from "react-native";

import { functions } from "../config/firebase";
import {
  DRIVER_ARRIVAL_VIBRATION_PATTERN,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SOUNDS,
  RIDE_OFFER_CHANNEL_CAPABILITIES,
  RIDE_OFFER_VIBRATION_PATTERN,
} from "../constants/notificationChannels";

const INSTALLATION_ID_KEY = "drivelocal.installationId";
const NOTIFICATION_STATUS_KEY = "drivelocal.notificationRegistrationStatus.v1";
const REGISTRATION_FRESH_MS = 24 * 60 * 60 * 1000;

function safeRole(role) {
  return ["driver", "passenger", "admin"].includes(role) ? role : null;
}

function safeReasonCode(value) {
  const text = String(value || "unknown").trim();
  const normalized = text.replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 80);
  return normalized || "unknown";
}

// Any unknown value degrades to LEGACY_V1: a wrong capability would route an
// offer to a channel that does not exist on the device.
function safeRideOfferChannelCapability(value) {
  if (value === RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V4) {
    return RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V4;
  }
  if (value === RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V3) {
    return RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V3;
  }
  if (value === RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V2) {
    return RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V2;
  }
  return RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1;
}

function traceNotificationReadiness(event, details = {}, level = "log") {
  const method = console[level] || console.log;
  method(`[DRIVER_NOTIFICATIONS] ${event}`, {
    scope: "driver_notifications",
    event,
    atMs: Date.now(),
    ...details,
  });
}

async function writeNotificationRegistrationState(status, details = {}) {
  const safeState = {
    status,
    atMs: Date.now(),
    role: safeRole(details.role),
    appVersion: details.appVersion || null,
    canAskAgain: typeof details.canAskAgain === "boolean" ? details.canAskAgain : null,
    reasonCode: details.reasonCode ? safeReasonCode(details.reasonCode) : null,
    rideOfferChannelCapability: safeRideOfferChannelCapability(
      details.rideOfferChannelCapability,
    ),
  };

  try {
    await AsyncStorage.setItem(NOTIFICATION_STATUS_KEY, JSON.stringify(safeState));
  } catch (_error) {
    // Diagnostics must never make notification registration fail.
  }

  return safeState;
}

async function readNotificationRegistrationState() {
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_STATUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.status !== "string") return null;
    return {
      status: parsed.status,
      atMs: Number(parsed.atMs || 0) || 0,
      role: safeRole(parsed.role),
      appVersion: parsed.appVersion || null,
      canAskAgain: typeof parsed.canAskAgain === "boolean" ? parsed.canAskAgain : null,
      reasonCode: parsed.reasonCode ? safeReasonCode(parsed.reasonCode) : null,
      rideOfferChannelCapability: safeRideOfferChannelCapability(
        parsed.rideOfferChannelCapability,
      ),
    };
  } catch (_error) {
    return null;
  }
}

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
 * - The legacy ride-offer channel remains untouched as a permanent fallback.
 * - V4 adds the repeated 30-second sound only after Android confirms it is usable.
 * - Driver arrival has its own MAX channel, bundled sound and strong vibration.
 * - Other ride status updates remain on the existing HIGH channel.
 *
 * The dedicated arrival channel uses a new immutable id. Android only lets an
 * application change a channel's name and description after the channel exists;
 * its sound and vibration remain under the user's system settings.
 */
export function isRideOfferSoundChannelReady(channel) {
  return Boolean(
    channel
      && channel.id === NOTIFICATION_CHANNELS.RIDE_OFFERS_V4
      && channel.sound === "custom"
      && Number(channel.importance) >= Number(Notifications.AndroidImportance.HIGH)
      && channel.enableVibrate === true,
  );
}

// Android keeps a deleted channel's settings if the same id is recreated later,
// so superseded channels are removed but never recreated. Best effort: one failed
// cleanup must not prevent the other channel or token registration from succeeding.
async function removeSupersededRideOfferChannels() {
  if (typeof Notifications.deleteNotificationChannelAsync !== "function") return;
  const supersededChannelIds = [
    NOTIFICATION_CHANNELS.RIDE_OFFERS_V2,
    NOTIFICATION_CHANNELS.RIDE_OFFERS_V3,
  ];
  for (const channelId of supersededChannelIds) {
    try {
      await Notifications.deleteNotificationChannelAsync(channelId);
      traceNotificationReadiness("ride_offer_channel.superseded_removed", {
        channelId,
      });
    } catch (error) {
      traceNotificationReadiness("ride_offer_channel.superseded_remove_failed", {
        channelId,
        reasonCode: safeReasonCode(error?.code || error?.name || "unknown"),
      }, "warn");
    }
  }
}

async function ensureRideOfferSoundChannel() {
  try {
    await Notifications.setNotificationChannelAsync(
      NOTIFICATION_CHANNELS.RIDE_OFFERS_V4,
      {
        name: "Novas corridas (som DriveLocal)",
        description: "Alerta prioritário para novas ofertas de corrida.",
        importance: Notifications.AndroidImportance.MAX,
        sound: NOTIFICATION_SOUNDS.RIDE_OFFER,
        vibrationPattern: [...RIDE_OFFER_VIBRATION_PATTERN],
        enableVibrate: true,
        enableLights: true,
        lightColor: "#2563EB",
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      },
    );

    const channel = await Notifications.getNotificationChannelAsync(
      NOTIFICATION_CHANNELS.RIDE_OFFERS_V4,
    );
    if (isRideOfferSoundChannelReady(channel)) {
      traceNotificationReadiness("ride_offer_channel.v4_ready", {
        capability: RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V4,
        importance: Number(channel.importance),
        sound: "custom",
        vibrationEnabled: true,
      });
      await removeSupersededRideOfferChannels();
      return RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V4;
    }

    traceNotificationReadiness("ride_offer_channel.fallback_v1", {
      capability: RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1,
      reason: "v4_verification_failed",
      channelPresent: Boolean(channel),
      importance: Number(channel?.importance || 0),
      sound: channel?.sound || "none",
      vibrationEnabled: channel?.enableVibrate === true,
    }, "warn");
  } catch (error) {
    traceNotificationReadiness("ride_offer_channel.fallback_v1", {
      capability: RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1,
      reason: "v4_setup_failed",
      reasonCode: safeReasonCode(error?.code || error?.name || "unknown"),
    }, "warn");
  }

  return RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1;
}

export async function ensureAndroidChannels() {
  if (Platform.OS !== "android") {
    return RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1;
  }

  await Notifications.setNotificationChannelAsync(
    NOTIFICATION_CHANNELS.RIDE_OFFERS,
    {
      name: "Corridas disponíveis",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [...RIDE_OFFER_VIBRATION_PATTERN],
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

  await Notifications.setNotificationChannelAsync(
    NOTIFICATION_CHANNELS.DRIVER_ARRIVAL,
    {
      name: "Motorista chegou",
      description: "Alerta prioritário quando o motorista chega ao embarque.",
      importance: Notifications.AndroidImportance.MAX,
      sound: NOTIFICATION_SOUNDS.DRIVER_ARRIVAL,
      vibrationPattern: [...DRIVER_ARRIVAL_VIBRATION_PATTERN],
      enableVibrate: true,
      enableLights: true,
      lightColor: "#2563EB",
      showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    },
  );

  // V4 is deliberately last and isolated: a custom-sound problem must never
  // prevent permission/token registration through the working legacy channel.
  return ensureRideOfferSoundChannel();
}

const appVersion =
  Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? null;

/**
 * Reads the safe local registration receipt plus the current Android permission.
 * It never asks for permission and never requests or returns the FCM token.
 */
export async function getPushNotificationDiagnosticState({
  nowMs = Date.now(),
  freshForMs = REGISTRATION_FRESH_MS,
} = {}) {
  if (Platform.OS !== "android") {
    return { status: "unsupported", permissionGranted: false, canAskAgain: false };
  }

  if (!Device.isDevice) {
    return { status: "device_unsupported", permissionGranted: false, canAskAgain: false };
  }

  let permission;
  try {
    permission = await Notifications.getPermissionsAsync();
  } catch (error) {
    return {
      status: "diagnostic_failed",
      permissionGranted: false,
      canAskAgain: null,
      reasonCode: safeReasonCode(error?.code || error?.name || "permission_read_failed"),
    };
  }

  const permissionGranted = permission?.granted === true || permission?.status === "granted";
  if (!permissionGranted) {
    return {
      status: "permission_required",
      permissionGranted: false,
      canAskAgain: permission?.canAskAgain !== false,
    };
  }

  const stored = await readNotificationRegistrationState();
  if (!stored) {
    return {
      status: "registration_required",
      permissionGranted: true,
      canAskAgain: permission?.canAskAgain !== false,
      registeredAtMs: 0,
    };
  }

  if (stored.status === "registered") {
    const ageMs = Math.max(0, Number(nowMs) - Number(stored.atMs || 0));
    return {
      status: ageMs <= freshForMs ? "registered" : "registration_stale",
      permissionGranted: true,
      canAskAgain: permission?.canAskAgain !== false,
      registeredAtMs: stored.atMs,
      ageMs,
      role: stored.role,
      rideOfferChannelCapability: stored.rideOfferChannelCapability,
    };
  }

  return {
    status: stored.status === "permission_denied" ? "permission_required" : stored.status,
    permissionGranted: true,
    canAskAgain: permission?.canAskAgain !== false,
    registeredAtMs: stored.atMs,
    reasonCode: stored.reasonCode,
    role: stored.role,
    rideOfferChannelCapability: stored.rideOfferChannelCapability,
  };
}

/**
 * Requests notification permission, obtains the real native Android FCM token
 * and registers it server-side.
 *
 * Returns the native FCM token when registration succeeds, otherwise null.
 * Registration failures are persisted only as privacy-safe status codes.
 */
export async function registerForPushNotifications(role) {
  const startedAt = Date.now();
  const normalizedRole = safeRole(role);
  let stage = "preflight";
  let rideOfferChannelCapability = RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1;

  traceNotificationReadiness("registration.requested", {
    role: normalizedRole,
  });

  try {
    if (Platform.OS !== "android" || !Device.isDevice) {
      await writeNotificationRegistrationState("device_unsupported", {
        role: normalizedRole,
        appVersion,
      });
      traceNotificationReadiness("registration.not_available", {
        role: normalizedRole,
        reason: Platform.OS !== "android" ? "unsupported_platform" : "physical_device_required",
        durationMs: Date.now() - startedAt,
      }, "warn");
      return null;
    }

    stage = "channels";
    rideOfferChannelCapability = await ensureAndroidChannels();

    stage = "permission";
    const currentPermissions = await Notifications.getPermissionsAsync();
    let permissionGranted = currentPermissions?.granted === true
      || currentPermissions?.status === "granted";
    let canAskAgain = currentPermissions?.canAskAgain !== false;

    if (!permissionGranted && canAskAgain) {
      const requestedPermissions = await Notifications.requestPermissionsAsync();
      permissionGranted = requestedPermissions?.granted === true
        || requestedPermissions?.status === "granted";
      canAskAgain = requestedPermissions?.canAskAgain !== false;
    }

    if (!permissionGranted) {
      await writeNotificationRegistrationState("permission_denied", {
        role: normalizedRole,
        appVersion,
        canAskAgain,
      });
      traceNotificationReadiness("registration.permission_missing", {
        role: normalizedRole,
        canAskAgain,
        durationMs: Date.now() - startedAt,
      }, "warn");
      return null;
    }

    stage = "device_token";
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    const token = devicePushToken?.data;

    if (!token) {
      await writeNotificationRegistrationState("token_missing", {
        role: normalizedRole,
        appVersion,
        reasonCode: "empty_native_token",
      });
      traceNotificationReadiness("registration.token_missing", {
        role: normalizedRole,
        durationMs: Date.now() - startedAt,
      }, "warn");
      return null;
    }

    stage = "server_sync";
    const installationId = await getInstallationId();
    const syncNotificationToken = httpsCallable(
      functions,
      "syncNotificationTokenSecure",
    );

    const tokenRegistrationPayload = {
      token,
      installationId,
      platform: "android",
      appVersion,
      role: normalizedRole,
      rideOfferChannelCapability,
    };

    try {
      await syncNotificationToken(tokenRegistrationPayload);
    } catch (error) {
      const code = String(error?.code || "").toLowerCase();
      const oldBackendRejectedCapability = code === "functions/invalid-argument"
        || code === "invalid-argument";
      if (!oldBackendRejectedCapability) throw error;

      // Deploy-order fallback: an older backend rejects the new optional field.
      // Retrying the exact legacy payload keeps existing notifications working.
      traceNotificationReadiness("registration.capability_fallback", {
        role: normalizedRole,
        reason: "backend_capability_not_supported",
        capability: RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1,
      }, "warn");
      const { rideOfferChannelCapability: _unsupported, ...legacyPayload } =
        tokenRegistrationPayload;
      await syncNotificationToken(legacyPayload);
      rideOfferChannelCapability = RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1;
    }

    await writeNotificationRegistrationState("registered", {
      role: normalizedRole,
      appVersion,
      rideOfferChannelCapability,
    });
    traceNotificationReadiness("registration.succeeded", {
      role: normalizedRole,
      durationMs: Date.now() - startedAt,
      result: "registered",
      rideOfferChannelCapability,
    });

    return token;
  } catch (error) {
    const reasonCode = safeReasonCode(error?.code || error?.name || "unknown");
    await writeNotificationRegistrationState("sync_failed", {
      role: normalizedRole,
      appVersion,
      reasonCode: `${stage}:${reasonCode}`,
    });
    traceNotificationReadiness("registration.failed", {
      role: normalizedRole,
      stage,
      reasonCode,
      durationMs: Date.now() - startedAt,
      result: "not_registered",
    }, "warn");
    return null;
  }
}

/**
 * Disables the notification token associated with this application install.
 * Logout continues even if the backend cannot disable it.
 */
export async function disablePushNotifications() {
  try {
    if (Platform.OS !== "android") return;

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
    await writeNotificationRegistrationState("disabled", { appVersion });
    traceNotificationReadiness("registration.disabled", { result: "disabled" });
  } catch (error) {
    traceNotificationReadiness("registration.disable_failed", {
      reasonCode: safeReasonCode(error?.code || error?.name || "unknown"),
      result: "best_effort_failed",
    }, "warn");
  }
}

export const NOTIFICATION_DIAGNOSTIC_POLICY = Object.freeze({
  registrationFreshMs: REGISTRATION_FRESH_MS,
});
