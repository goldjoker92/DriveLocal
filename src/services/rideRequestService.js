// Ride request service (Iteration 3A). Creates a passenger ride request in
// Firestore and lets the admin read pending requests. NO dispatch, NO matching,
// NO pricing, NO payment, NO Pix — a request is just created with status
// "pending". Driver accept/dispatch is a later iteration.

import {
  addDoc,
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import {
  RIDE_REQUEST_PENDING,
  RIDE_REQUEST_ACCEPTED,
  RIDE_REQUEST_COMPLETED,
} from '../constants/rideRequestStatuses';
import { SERVICE_AREA_HORIZONTE_CE_BR } from '../constants/serviceAreaIds';

// Creates rideRequests/{auto-id}. `data` carries passenger + origin/destination.
// serviceAreaId, status and the driver-assignment fields are set here so every
// document is consistent. Returns the new document id.
export async function createRideRequest(data) {
  const d = data || {};
  const payload = {
    passengerId: d.passengerId,
    passengerName: d.passengerName || '',
    passengerPhone: d.passengerPhone || '',
    originText: d.originText || '',
    originReferenceText: d.originReferenceText || '',
    originLat: d.originLat != null ? d.originLat : null,
    originLng: d.originLng != null ? d.originLng : null,
    originCity: d.originCity || 'Horizonte',
    originState: d.originState || 'CE',
    destinationText: d.destinationText || '',
    destinationLat: null, // 3A: destination is manual text only, not geocoded.
    destinationLng: null,
    vehicleType: d.vehicleType,
    serviceAreaId: d.serviceAreaId || SERVICE_AREA_HORIZONTE_CE_BR,
    status: RIDE_REQUEST_PENDING,
    acceptedDriverId: null,
    assignedDriverId: null,
    // PricingV1 fields (null when the caller has no pricing — e.g. the 3A
    // request-ride flow that does not compute a price). All money is centavos.
    ridePriceCentavos: d.ridePriceCentavos != null ? d.ridePriceCentavos : null,
    driverAmountCentavos:
      d.driverAmountCentavos != null ? d.driverAmountCentavos : (d.ridePriceCentavos != null ? d.ridePriceCentavos : null),
    // Final commission is computed + debited at completion (walletCommission).
    platformFeeCentavos: 0,
    distanceKm: d.distanceKm != null ? d.distanceKm : null,
    paymentMethod: d.paymentMethod || 'pix_direct_to_driver',
    pricingVersion: d.pricingVersion || null,
    // Lifecycle / settlement fields for the accepted -> completed bridge.
    driverId: null,
    acceptedAt: null,
    completedAt: null,
    commissionSettled: false,
    commissionSettledAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  console.log(
    '[RIDE_REQUEST] create passengerId=', payload.passengerId,
    'vehicleType=', payload.vehicleType,
    'priceCentavos=', payload.ridePriceCentavos
  );
  const ref = await addDoc(collection(db, 'rideRequests'), payload);
  return ref.id;
}

// Reads rideRequests/{rideId}. Returns { id, ...data } or null when missing.
export async function getRideRequest(rideId) {
  const snap = await getDoc(doc(db, 'rideRequests', rideId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// PricingV1 bridge: a driver accepts a pending ride request. Persists driverId
// and moves the request to "accepted". This is a minimal assignment, NOT full
// dispatch — no matching, no locking waves (deferred). Per-ride eligibility
// (canDriverReceiveRide) should be checked by the caller before accepting.
export async function acceptRideRequest(rideId, driverId) {
  console.log('[RIDE_REQUEST] accept rideId=', rideId, 'driverId=', driverId);
  await updateDoc(doc(db, 'rideRequests', rideId), {
    driverId,
    acceptedDriverId: driverId, // keep the legacy field consistent
    status: RIDE_REQUEST_ACCEPTED,
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// PricingV1 bridge: marks a ride completed. Does NOT touch money — the wallet
// commission is settled separately and idempotently by walletCommission
// (debitCommissionFromWallet). Safe to call before that settlement.
export async function completeRideRequest(rideId) {
  console.log('[RIDE_REQUEST] complete rideId=', rideId);
  await updateDoc(doc(db, 'rideRequests', rideId), {
    status: RIDE_REQUEST_COMPLETED,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// Admin: returns all pending ride requests. The admin console filters/sorts
// client-side, so no composite index is needed.
export async function getPendingRideRequests() {
  const q = query(collection(db, 'rideRequests'), where('status', '==', RIDE_REQUEST_PENDING));
  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}
