// AdminTableRow
// One row for simple admin tables / lists: left label + right value or a
// custom right-side element (badge, button, etc.).

import { View, Text } from 'react-native';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

export default function AdminTableRow({ label, value, right }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: spacing.md,
      }}
    >
      <Text style={[{ fontFamily, color: colors.text, flexShrink: 1 }, typography.body]}>
        {label}
      </Text>
      {right ??
        (value ? (
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            {value}
          </Text>
        ) : null)}
    </View>
  );
}
