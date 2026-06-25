// Passenger route group layout. Screens render their own header.

import { Stack } from 'expo-router';

export default function PassengerLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
