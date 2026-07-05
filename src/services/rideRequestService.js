// Ride request service (Iteration 3A). Creates a passenger ride request in
// Firestore and lets the admin read pending requests. NO dispatch, NO matching,
// NO pricing, NO payment, NO Pix — a request is just created with status
// "pending". Driver accept/dispatch is a later iteration.

import {
  addDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { RIDE_REQUEST_PENDING } from '../constants/rideRequestStatuses';
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
    serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
    status: RIDE_REQUEST_PENDING,
    acceptedDriverId: null,
    assignedDriverId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  console.log('[RIDE_REQUEST] create passengerId=', payload.passengerId, 'vehicleType=', payload.vehicleType);
  const ref = await addDoc(collection(db, 'rideRequests'), payload);
  return ref.id;
}

// Admin: returns all pending ride requests. The admin console filters/sorts
// client-side, so no composite index is needed.
export async function getPendingRideRequests() {
  const q = query(collection(db, 'rideRequests'), where('status', '==', RIDE_REQUEST_PENDING));
  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}
