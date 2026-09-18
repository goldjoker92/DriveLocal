// useRideNotifications — wires real Android FCM handling across foreground,
// background and killed states using expo-notifications.
//
// Notification taps preserve rideId/offerId, are restricted to safe routes and
// are deduplicated. A cold-start route is held until Firebase auth is ready.

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { auth } from '../config/firebase';
import {
  registerForPushNotifications,
  presentForegroundRideOfferAlert,
} from '../services/notificationsService';
import { logRideClientEvent } from '../utils/clientRideLog';
import {
  notificationDataFromResponse,
  buildNotificationRouteTarget,
} from '../utils/notificationNavigation';

const FOREGROUND_SOUND_EVENTS = new Set(['offer_created', 'ride_arrived']);
const REGISTRATION_DEDUPE_MS = 60_000;

let handlerConfigured = false;
let registrationUid = null;
let registrationPromise = null;
let registrationCompletedAtMs = 0;

function configureHandlerOnce() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification?.request?.content?.data || {};
      const eventType = String(data.eventType || '');

      // A ride offer arriving in the foreground is re-presented on the custom V4
      // channel by the received-listener below (that is the only way to get the
      // DriveLocal 30s sound, vibration and light while the app is open). If we
      // ALSO let the handler sound the original here, the driver hears the alert
      // twice, so the offer stays silent at this stage and the re-presented copy
      // carries the sound. The re-presented copy is flagged so it is never
      // itself re-presented, which would loop.
      const isOffer = eventType === 'offer_created';
      const isRepresented = data.foregroundRepresented === true;
      const shouldPlaySound = isRepresented
        ? true
        : FOREGROUND_SOUND_EVENTS.has(eventType) && !isOffer;

      return {
        shouldShowBanner: true,
        shouldShowList: true,
        // On Android, a foreground notification with sound disabled may not
        // display the drop-down banner. Arrival is treated as a critical visible
        // update; the offer's banner is carried by the re-presented V4 copy.
        shouldPlaySound,
        shouldSetBadge: false,
      };
    },
  });
}

function registerAuthenticatedUserOnce(user) {
  const uid = user?.uid || null;
  if (!uid) return Promise.resolve(null);

  if (registrationPromise && registrationUid === uid) return registrationPromise;
  if (registrationUid === uid && Date.now() - registrationCompletedAtMs < REGISTRATION_DEDUPE_MS) {
    return Promise.resolve(null);
  }

  registrationUid = uid;
  registrationPromise = registerForPushNotifications(null)
    .finally(() => {
      registrationCompletedAtMs = Date.now();
      registrationPromise = null;
    });
  return registrationPromise;
}

export function useRideNotifications() {
  const router = useRouter();
  const seenIds = useRef(new Set());
  const pendingTarget = useRef(null);
  const authReady = useRef(false);

  function navigateFromResponse(response) {
    const data = notificationDataFromResponse(response);
    const target = buildNotificationRouteTarget(data);
    if (!target) return;
    if (data.notificationId && seenIds.current.has(data.notificationId)) return;
    if (data.notificationId) seenIds.current.add(data.notificationId);

    if (!authReady.current || !auth.currentUser) {
      pendingTarget.current = target;
      return;
    }
    router.push(target);
  }

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    configureHandlerOnce();

    const unsubAuth = auth.onAuthStateChanged((user) => {
      authReady.current = true;
      if (user) {
        registerAuthenticatedUserOnce(user).catch(() => undefined);
        if (pendingTarget.current) {
          const target = pendingTarget.current;
          pendingTarget.current = null;
          router.push(target);
        }
      } else {
        registrationUid = null;
        registrationCompletedAtMs = 0;
      }
    });

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification?.request?.content?.data || {};
      logRideClientEvent('ride.notification.received', {
        rideId: typeof data.rideId === 'string' ? data.rideId : null,
        eventType: typeof data.eventType === 'string' ? data.eventType : 'unknown',
        notificationId: typeof data.notificationId === 'string' ? data.notificationId : null,
        appState: 'foreground',
      });

      // Make a foreground offer impossible to miss: re-post it on the custom V4
      // channel so it carries the DriveLocal sound, vibration and light exactly
      // like a background offer. The already re-presented copy is skipped to
      // avoid an infinite loop. Best effort: a failure leaves the default
      // foreground banner untouched.
      if (
        String(data.eventType || '') === 'offer_created'
        && data.foregroundRepresented !== true
      ) {
        presentForegroundRideOfferAlert(data).catch(() => undefined);
      }
    });
    const responseSub = Notifications.addNotificationResponseReceivedListener((resp) => {
      navigateFromResponse(resp);
    });
    Notifications.getLastNotificationResponseAsync()
      .then((resp) => {
        if (resp) navigateFromResponse(resp);
      })
      .catch(() => undefined);

    return () => {
      unsubAuth();
      receivedSub.remove();
      responseSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
