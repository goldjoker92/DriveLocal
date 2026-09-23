// AppBadge
// Small pill label. Base for DriverStatusBadge and other status chips.
//   tone: 'success' | 'warning' | 'danger' | 'neutral' (default)

import { View, Text } from 'react-native';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

const TONES = {
  success: { bg: colors.successBg, fg: colors.success },
  warning: { bg: colors.warningBg, fg: colors.warning },
  danger: { bg: colors.dangerBg, fg: colors.danger },
  neutral: { bg: colors.primaryTint, fg: colors.primary },
};

export default function AppBadge({ label, tone = 'neutral', style }) {
  const t = TONES[tone] || TONES.neutral;

  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          backgroundColor: t.bg,
          paddingVertical: spacing.xs,
          paddingHorizontal: spacing.sm,
          borderRadius: radius.pill,
        },
        style,
      ]}
    >
      <Text style={[{ fontFamily, color: t.fg }, typography.caption]}>{label}</Text>
    </View>
  );
}
