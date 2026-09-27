import { ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Several alerts can coexist (network, GPS, fleet announcement). Keep their
// full text/actions scrollable without consuming the whole cockpit at large
// font sizes. Recompute on rotation; never shrink or truncate the user's font.
export default function OperationalAlertsViewport({ children, testID }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const usableHeight = Math.max(0, height - insets.top - insets.bottom);
  return (
    <ScrollView
      testID={testID}
      style={{ flexGrow: 0, flexShrink: 1, maxHeight: Math.max(48, Math.floor(usableHeight * 0.28)) }}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}
