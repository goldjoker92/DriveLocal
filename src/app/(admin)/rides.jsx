// Legacy route kept for old links. The previous screen displayed mock rides;
// redirect to the real aggregated command center so fake data is never shown.

import { Redirect } from 'expo-router';

export default function RidesRedirect() {
  return <Redirect href="/(admin)/dashboard" />;
}
