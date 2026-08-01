// Shared form screen wrapper.
// Keeps focused fields and actions reachable while the software keyboard is open.

import { forwardRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';

const KeyboardSafeScreen = forwardRef(function KeyboardSafeScreen(
  {
    children,
    contentContainerStyle,
    style,
    edges = ['top', 'bottom'],
    keyboardVerticalOffset = 0,
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <ScrollView
          ref={ref}
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});

export default KeyboardSafeScreen;
