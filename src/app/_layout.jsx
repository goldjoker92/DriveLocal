// Root navigation layout.
// A single headerless Stack. Each route group has its own _layout, and each
// screen renders its own Header, so there are no nested headers.

import '../services/driverLocationTracking';
import { useEffect } from 'react';
import { Stack, usePathname } from 'expo-router';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import AppErrorBoundary from '../components/AppErrorBoundary';
import AuthSessionGate from '../components/AuthSessionGate';
import NetworkRecoveryGuard from '../components/NetworkRecoveryGuard';
import DriverDeviceHealthGuard from '../components/DriverDeviceHealthGuard';
import DriverPassengerWaitGuard from '../components/DriverPassengerWaitGuard';
import RideQuickMessagesGuard from '../components/RideQuickMessagesGuard';
import AccountPrivacyShortcut from '../components/AccountPrivacyShortcut';
import SupportShortcut from '../components/SupportShortcut';
import { LocationDisclosureProvider } from '../contexts/LocationDisclosureContext';
import { auth } from '../config/firebase';
import { colors } from '../constants/colors';
import { useRideNotifications } from '../hooks/useRideNotifications';
import {
  installGlobalErrorHandler,
  setCurrentCrashRoute,
} from '../services/clientErrorReporter';
import { getDriver } from '../services/driverService';
import { remoteWorkSessionRecoverable } from '../utils/driverWorkSession';
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

      let staleReason = null;
      if (!authenticatedUid) {
        staleReason = 'signed_out_restore';
      } else if (authenticatedUid !== trackingSession.driverId) {
        staleReason = 'account_mismatch';
      } else if (!trackingSession.rideId) {
        // The same Firebase account may be restored with an old online work session.
        // Validate the server lease globally, not only while a driver screen is open.
        let remoteDriver;
        try {
          remoteDriver = await getDriver(authenticatedUid);
        } catch (error) {
          console.warn('[AUTH_TRACKING_CLEANUP] remote_session_validation_failed', {
            scope: 'auth_tracking_cleanup',
            event: 'remote_session_validation_failed',
            authenticatedUid: shortId(authenticatedUid),
            reason: error?.code || error?.message || 'unknown',
            atMs: Date.now(),
          });
          return;
        }

        const sessionMatches = Boolean(
          remoteDriver?.availabilityStatus === 'online'
          && remoteDriver?.availabilitySessionId
          && remoteDriver.availabilitySessionId === trackingSession.availabilitySessionId
          && remoteWorkSessionRecoverable(remoteDriver)
        );
        if (sessionMatches) return;

        staleReason = !remoteDriver
          ? 'driver_missing'
          : remoteDriver.availabilityStatus !== 'online'
            ? 'remote_offline'
            : remoteDriver.availabilitySessionId !== trackingSession.availabilitySessionId
              ? 'session_mismatch'
              : 'lease_expired';
      } else {
        // Active rides have their own recovery path. Never discard one from the root
        // reconciler solely because an availability lease changed during the ride.
        return;
      }

      console.warn('[AUTH_TRACKING_CLEANUP] stale_native_session_detected', {
        scope: 'auth_tracking_cleanup',
        event: 'stale_native_session_detected',
        authenticatedUid: shortId(authenticatedUid),
        trackingDriverId: shortId(trackingSession.driverId),
        trackingRideId: shortId(trackingSession.rideId),
        localSessionId: shortId(trackingSession.availabilitySessionId),
        reason: staleReason,
        atMs: Date.now(),
      });

      // A native Android location task can survive a DEV reload, an account switch,
      // or an expired seven-minute server lease. Stop the stale local task so it can
      // no longer generate repeated Firestore permission-denied publications.
      await stopDriverOnlineTracking();

      console.log('[AUTH_TRACKING_CLEANUP] stale_native_session_stopped', {
        scope: 'auth_tracking_cleanup',
        event: 'stale_native_session_stopped',
        authenticatedUid: shortId(authenticatedUid),
        trackingDriverId: shortId(trackingSession.driverId),
        reason: staleReason,
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
          <LocationDisclosureProvider>
            <StatusBar style="dark" />
            <KeyboardAvoidingView
              style={{ flex: 1, backgroundColor: colors.background }}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
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
              {/* Cold-start only: hides public auth routes until Firebase restores a session. */}
              <AuthSessionGate route={pathname} />
            </KeyboardAvoidingView>
          </LocationDisclosureProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AppErrorBoundary>
  );
}
