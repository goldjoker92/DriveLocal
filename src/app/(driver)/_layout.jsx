// Driver route group layout. Keeps a single offer listener alive across every
// driver screen so an online driver cannot miss an offer while viewing the home,
// wallet or another cockpit screen.

import { useEffect, useRef } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { auth } from '../../config/firebase';
import { getDriver } from '../../services/driverService';
import { listenToMyOffer } from '../../services/ridesService';

export default function DriverLayout() {
  const router = useRouter();
  const segments = useSegments();
  const lastOfferId = useRef(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;

    return listenToMyOffer(uid, async (offer) => {
      if (!offer?.offerId) return;

      // After acceptance, drivers/{uid}.activeRideId is the source of truth. An
      // old accepted offer must never reopen a completed or cancelled ride.
      if (offer.status === 'accepted') {
        try {
          const driver = await getDriver(uid);
          if (driver?.activeRideId && driver.activeRideId === offer.rideId) {
            router.replace({ pathname: '/active-ride', params: { rideId: driver.activeRideId } });
          }
        } catch (_error) {
          // The screen-level listeners and push notification remain available;
          // do not redirect from stale or unverifiable local state.
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
