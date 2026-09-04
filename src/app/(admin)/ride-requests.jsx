// Legacy route kept for old links. Ride counters now live in the privacy-safe
// admin command center instead of a raw pending-request Firestore listener.

import { Redirect } from 'expo-router';

export default function RideRequestsRedirect() {
  return <Redirect href="/(admin)/dashboard" />;
}
