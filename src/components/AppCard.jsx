// AppCard
// Rounded, bordered surface used to group related content/rows.
// Base building block for WalletCard, RideRequestCard, AdminStatCard, etc.

import { View } from 'react-native';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';

export default function AppCard({ children, style }) {
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.lg,
          gap: spacing.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
