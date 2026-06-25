// AppButton
// Pressable button with three variants:
//   primary   - solid brand blue (default)
//   secondary - light blue tint
//   ghost     - transparent with border

import { Pressable, Text } from 'react-native';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

export default function AppButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}) {
  const backgroundColor =
    variant === 'primary'
      ? colors.primary
      : variant === 'secondary'
        ? colors.primaryTint
        : 'transparent';

  const textColor = variant === 'primary' ? colors.white : colors.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.md,
          alignItems: 'center',
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <Text style={[{ fontFamily, color: textColor }, typography.bodyBold]}>
        {title}
      </Text>
    </Pressable>
  );
}
