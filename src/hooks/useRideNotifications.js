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
import {
  notificationDataFromResponse,
  buildNotificationRouteTarget,
} from '../utils/notificationNavigation';

let handlerConfigured = false;
function configureHandlerOnce() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const eventType = notification?.request?.content?.data?.eventType;
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        // Offers are time-sensitive. Other status updates remain visible but do
        // not play an extra sound while the user already has the app open.
        shouldPlaySound: eventType === 'offer_created',
        shouldSetBadge: false,
      };
    },
  });
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
        registerForPushNotifications(null);
        if (pendingTarget.current) {
          const target = pendingTarget.current;
          pendingTarget.current = null;
          router.push(target);
        }
      }
    });

    // Foreground receipt is presented by the notification handler above.
    const receivedSub = Notifications.addNotificationReceivedListener(() => {});
    const responseSub = Notifications.addNotificationResponseReceivedListener((resp) => {
      navigateFromResponse(resp);
    });
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) navigateFromResponse(resp);
    });

    return () => {
      unsubAuth();
      receivedSub.remove();
      responseSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
