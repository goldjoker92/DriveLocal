// Driver route group layout. Keeps a single offer listener alive across every
// driver screen so an online driver cannot miss an offer while viewing the home,
// wallet or another cockpit screen.

import { useEffect, useRef } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { auth } from '../../config/firebase';
import { listenToMyOffer } from '../../services/ridesService';

export default function DriverLayout() {
  const router = useRouter();
  const segments = useSegments();
  const lastOfferId = useRef(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;

    return listenToMyOffer(uid, (offer) => {
      if (!offer?.offerId) return;
      const alreadyOnOfferScreen = segments.includes('ride-request');
      if (offer.status === 'accepted') {
        router.replace({ pathname: '/active-ride', params: { rideId: offer.rideId } });
        return;
      }
      if (offer.status !== 'offered' || Number(offer.expiresAtMs || 0) <= Date.now()) return;
      if (alreadyOnOfferScreen && lastOfferId.current === offer.offerId) return;
      lastOfferId.current = offer.offerId;
      router.push({ pathname: '/ride-request', params: { offerId: offer.offerId } });
    });
  }, [router, segments]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
