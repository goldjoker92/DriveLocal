// Root navigation layout.
// A single headerless Stack. Each route group has its own _layout, and each
// screen renders its own Header, so there are no nested headers.

import '../services/driverLocationTracking';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../constants/colors';
import { useRideNotifications } from '../hooks/useRideNotifications';

export default function RootLayout() {
  // Real Android FCM handling (foreground/background/killed) + token sync.
  useRideNotifications();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
