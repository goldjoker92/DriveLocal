// Root navigation layout.
// A single headerless Stack. Each route group has its own _layout, and each
// screen renders its own Header, so there are no nested headers.

import '../services/driverLocationTracking';
import { useEffect } from 'react';
import { Stack, usePathname } from 'expo-router';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import AppErrorBoundary from '../components/AppErrorBoundary';
import NetworkRecoveryGuard from '../components/NetworkRecoveryGuard';
import DriverDeviceHealthGuard from '../components/DriverDeviceHealthGuard';
import DriverPassengerWaitGuard from '../components/DriverPassengerWaitGuard';
import RideQuickMessagesGuard from '../components/RideQuickMessagesGuard';
import AccountPrivacyShortcut from '../components/AccountPrivacyShortcut';
import SupportShortcut from '../components/SupportShortcut';
import { auth } from '../config/firebase';
import { colors } from '../constants/colors';
import { useRideNotifications } from '../hooks/useRideNotifications';
import {
  installGlobalErrorHandler,
  setCurrentCrashRoute,
} from '../services/clientErrorReporter';
import {
  getDriverTrackingSession,
  stopDriverOnlineTracking,
} from '../services/driverLocationTracking';

function shortId(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return null;
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

// Install once, before route components mount. The reporter preserves React
// Native's original fatal handler after scheduling the privacy-safe report.
installGlobalErrorHandler();

export default function RootLayout() {
  const pathname = usePathname();

  // Real Android FCM handling (foreground/background/killed) + token sync.
  useRideNotifications();

  useEffect(() => {
    setCurrentCrashRoute(pathname);
  }, [pathname]);

  useEffect(() => {
    let disposed = false;
    let reconciliation = Promise.resolve();

    async function reconcileRestoredAccount(user) {
      if (typeof auth.authStateReady === 'function') {
        await auth.authStateReady();
      }
      if (disposed) return;

      const authenticatedUid = auth.currentUser?.uid || user?.uid || null;
      const trackingSession = await getDriverTrackingSession();
      if (disposed || !trackingSession?.driverId) return;
      if (authenticatedUid === trackingSession.driverId) return;

      console.warn('[AUTH_TRACKING_CLEANUP] stale_native_session_detected', {
        scope: 'auth_tracking_cleanup',
        event: 'stale_native_session_detected',
        authenticatedUid: shortId(authenticatedUid),
        trackingDriverId: shortId(trackingSession.driverId),
        trackingRideId: shortId(trackingSession.rideId),
        reason: authenticatedUid ? 'account_mismatch' : 'signed_out_restore',
        atMs: Date.now(),
      });

      // A native Android location task can survive a DEV reload or a previous test
      // account. Never let that stale driver session run under a passenger/admin
      // account. This only clears the local task; server leases remain authoritative.
      await stopDriverOnlineTracking();

      console.log('[AUTH_TRACKING_CLEANUP] stale_native_session_stopped', {
        scope: 'auth_tracking_cleanup',
        event: 'stale_native_session_stopped',
        authenticatedUid: shortId(authenticatedUid),
        trackingDriverId: shortId(trackingSession.driverId),
        atMs: Date.now(),
      });
    }

    const unsubscribe = auth.onAuthStateChanged((user) => {
      reconciliation = reconciliation
        .then(() => reconcileRestoredAccount(user))
        .catch((error) => {
          console.warn('[AUTH_TRACKING_CLEANUP] stale_native_session_stop_failed', {
            scope: 'auth_tracking_cleanup',
            event: 'stale_native_session_stop_failed',
            reason: error?.code || error?.message || 'unknown',
            atMs: Date.now(),
          });
        });
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return (
    <AppErrorBoundary route={pathname}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            {/* Never replays actions automatically; restores only an existing ride. */}
            <NetworkRecoveryGuard route={pathname} />
            {/* Silent when healthy; visible only on operational driver routes. */}
            <DriverDeviceHealthGuard route={pathname} />
            {/* Visible only after the driver has announced arrival at the pickup. */}
            <DriverPassengerWaitGuard route={pathname} />
            {/* Server-catalogued messages only; no free text or contact exposure. */}
            <RideQuickMessagesGuard route={pathname} />
            {/* Support is callable-only and automatically receives safe ride context. */}
            <SupportShortcut route={pathname} />
            {/* Temporary compact entry until the full cockpit redesign lands. */}
            <AccountPrivacyShortcut route={pathname} />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            />
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AppErrorBoundary>
  );
}
