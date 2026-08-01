// MobileShell
// Centers the app in a mobile-width column (max ~420px) on a calm background.
// On web this gives an elegant "app shell" feel (subtle side borders + soft
// shadow) without looking like a heavy phone mockup. Scrolls, safe-area aware.

import { Platform, View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const BG = '#F7F8FA';

export default function MobileShell({ children }) {
  return (
    <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center' }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 420,
          backgroundColor: BG,
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderColor: '#ECEFF3',
          shadowColor: '#0F172A',
          shadowOpacity: 0.05,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 10 },
        }}
      >
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingVertical: 22,
              paddingBottom: 48,
              gap: 20,
              flexGrow: 1,
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </SafeAreaView>
      </View>
    </View>
  );
}
