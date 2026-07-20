// Driver route group layout. Keeps one offer listener and one inexpensive
// foreground GPS safety pulse alive across every driver screen.

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { auth } from '../../config/firebase';
import { getDriver } from '../../services/driverService';
import { refreshDriverOnlineHeartbeat } from '../../services/driverLocationTracking';
import { listenToMyOffer } from '../../services/ridesService';

const FOREGROUND_HEARTBEAT_INTERVAL_MS = 60_000;

export default function DriverLayout() {
  const router = useRouter();
  const segments = useSegments();
  const lastOfferId = useRef(null);

  useEffect(() => {
    let active = true;

    async function pulse() {
      if (!active) return;
      try {
        await refreshDriverOnlineHeartbeat();
      } catch (error) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.log(
            '[DRIVER_LOCATION] foreground heartbeat error',
            error?.code || error?.message || 'unknown'
          );
        }
      }
    }

    pulse();
    const timer = setInterval(pulse, FOREGROUND_HEARTBEAT_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') pulse();
    });

    return () => {
      active = false;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;

    return listenToMyOffer(uid, async (offer) => {
      if (!offer?.offerId) return;

      if (offer.status === 'accepted') {
        try {
          const driver = await getDriver(uid);
          if (driver?.activeRideId && driver.activeRideId === offer.rideId) {
            router.replace({ pathname: '/active-ride', params: { rideId: driver.activeRideId } });
          }
        } catch (_error) {
          // Screen listeners and push notifications remain available.
        }
        return;
      }

      if (offer.status !== 'offered' || Number(offer.expiresAtMs || 0) <= Date.now()) return;
      const alreadyOnOfferScreen = segments.includes('ride-request');
      if (alreadyOnOfferScreen && lastOfferId.current === offer.offerId) return;
      lastOfferId.current = offer.offerId;
      router.push({ pathname: '/ride-request', params: { offerId: offer.offerId } });
    });
  }, [router, segments]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
