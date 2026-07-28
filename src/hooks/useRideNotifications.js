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
import { registerForPushNotifications } from '../services/notificationsService';
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
      const eventType = notification?.request?.content?.data?.eventType;
      const shouldPlaySound = FOREGROUND_SOUND_EVENTS.has(String(eventType || ''));
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        // On Android, a foreground notification with sound disabled may not display
        // the drop-down banner. Arrival is therefore treated as a critical visible
        // update, just like a new ride offer.
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
