// useRideNotifications — wires real Android FCM handling across the three app
// states (foreground / background / killed) using expo-notifications.
//
// Patterns (adapted, DriveLocal routes only):
//   - single initialization guard (handler + channels set once);
//   - Android channels created before token retrieval;
//   - token (re)synced when Firebase auth becomes ready; disabled on logout;
//   - received listener (foreground): the OS presents it; we do NOT auto-navigate
//     and add no duplicate local notification;
//   - response listener (background tap) and cold-start initial response route
//     ONCE to the ride/offer route in the payload;
//   - a route is held pending until auth + router are ready;
//   - notificationId dedupe prevents double navigation.
//
// Payloads carry strings only; navigation uses the safe `route` field.

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { auth } from '../config/firebase';
import { registerForPushNotifications } from '../services/notificationsService';

let handlerConfigured = false;
function configureHandlerOnce() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  // Foreground: present the banner; never play a duplicate local fallback.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// Safe app routes a notification is allowed to open.
const ALLOWED_ROUTES = new Set([
  '/ride-request', '/active-ride', '/driver-home', '/driver-accepted',
  '/searching', '/pix-payment', '/ride-completed', '/passenger-home',
]);

export function useRideNotifications() {
  const router = useRouter();
  const seenIds = useRef(new Set()); // notificationId dedupe (anti-double-nav)
  const pendingRoute = useRef(null); // held until auth + router are ready
  const authReady = useRef(false);

  function extractRoute(response) {
    const content = response && response.notification && response.notification.request
      && response.notification.request.content;
    const data = (content && content.data) || {};
    const id = data.notificationId ? String(data.notificationId) : null;
    const route = data.route ? String(data.route) : null;
    return { id, route };
  }

  function navigateFromResponse(response) {
    const { id, route } = extractRoute(response);
    if (!route || !ALLOWED_ROUTES.has(route)) return;
    if (id && seenIds.current.has(id)) return; // already handled
    if (id) seenIds.current.add(id);
    if (!authReady.current || !auth.currentUser) {
      pendingRoute.current = route; // defer until ready
      return;
    }
    router.push(route);
  }

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    configureHandlerOnce();

    // Register the token once auth is ready; disable is handled by logout flow.
    const unsubAuth = auth.onAuthStateChanged((user) => {
      authReady.current = true;
      if (user) {
        registerForPushNotifications(null);
        // Flush a route deferred during cold start.
        if (pendingRoute.current) {
          const r = pendingRoute.current;
          pendingRoute.current = null;
          router.push(r);
        }
      }
    });

    // Foreground receipt: presented by the OS; no auto-navigation, no fallback.
    const receivedSub = Notifications.addNotificationReceivedListener(() => {});
    // Background tap.
    const responseSub = Notifications.addNotificationResponseReceivedListener((resp) => {
      navigateFromResponse(resp);
    });
    // Killed / cold start: the response that launched the app.
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
