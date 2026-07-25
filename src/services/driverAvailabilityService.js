// Driver work-session client. Availability is server-authoritative: the app asks
// to start/stop working and receives the session id that every GPS point must use.

import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

const setDriverAvailabilitySecure = httpsCallable(functions, 'setDriverAvailabilitySecure');

function normalizedResult(response) {
  const data = response?.data || {};
  return {
    driverId: data.driverId || null,
    availabilityStatus: data.availabilityStatus === 'online' ? 'online' : 'offline',
    availabilitySessionId: data.availabilitySessionId || null,
    availabilityUpdatedAtMs: Number(data.availabilityUpdatedAtMs || 0) || null,
    activeRideId: data.activeRideId || null,
    replay: data.replay === true,
  };
}

export async function startDriverWorkSession() {
  const response = await setDriverAvailabilitySecure({ availabilityStatus: 'online' });
  const result = normalizedResult(response);
  if (result.availabilityStatus !== 'online' || !result.availabilitySessionId) {
    const error = new Error('DRIVER_WORK_SESSION_NOT_OPENED');
    error.code = 'DRIVER_WORK_SESSION_NOT_OPENED';
    throw error;
  }
  return result;
}

export async function stopDriverWorkSession(availabilitySessionId = null) {
  const payload = { availabilityStatus: 'offline' };
  if (availabilitySessionId) payload.availabilitySessionId = availabilitySessionId;
  const response = await setDriverAvailabilitySecure(payload);
  return normalizedResult(response);
}
