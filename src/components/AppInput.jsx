// AppInput
// Labeled text input. Keep styling here so all forms look consistent.

import { forwardRef } from 'react';
import { View, Text, TextInput } from 'react-native';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

const AppInput = forwardRef(function AppInput(
  {
    label,
    value,
    onChangeText,
    placeholder,
    keyboardType = 'default',
    secureTextEntry = false,
    style,
    ...textInputProps
  },
  ref
) {
  return (
    <View style={[{ gap: spacing.xs }, style]}>
      {label ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          {label}
        </Text>
      ) : null}
      <TextInput
        {...textInputProps}
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        style={[
          {
            fontFamily,
            color: colors.text,
            backgroundColor: colors.background,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.lg,
          },
          typography.body,
          textInputProps.style,
        ]}
      />
    </View>
  );
});

export default AppInput;
