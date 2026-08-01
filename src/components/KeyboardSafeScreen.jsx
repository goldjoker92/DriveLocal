// Shared form screen wrapper.
// RootLayout handles the keyboard viewport globally. This wrapper adds the
// scroll, focus-tap and bottom-spacing behavior required by long forms.

import { forwardRef } from 'react';
import { Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';

const KeyboardSafeScreen = forwardRef(function KeyboardSafeScreen(
  {
    children,
    contentContainerStyle,
    style,
    edges = ['top', 'bottom'],
    backgroundColor = colors.background,
    scrollViewProps = {},
  },
  ref
) {
  const {
    contentContainerStyle: scrollContentContainerStyle,
    keyboardShouldPersistTaps = 'handled',
    keyboardDismissMode = Platform.OS === 'ios' ? 'interactive' : 'on-drag',
    ...restScrollViewProps
  } = scrollViewProps;

  return (
    <SafeAreaView
      style={[{ flex: 1, backgroundColor }, style]}
      edges={edges}
    >
      <ScrollView
        ref={ref}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        keyboardDismissMode={keyboardDismissMode}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          {
            padding: spacing.lg,
            paddingBottom: spacing.xxl,
            gap: spacing.md,
            flexGrow: 1,
          },
          contentContainerStyle,
          scrollContentContainerStyle,
        ]}
        {...restScrollViewProps}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
});

export default KeyboardSafeScreen;
