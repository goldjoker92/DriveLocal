// MapPlaceholder
// Static stand-in for the map. Real map (react-native-maps) arrives later.
// MVP rules: Android only, foreground location only, no in-app navigation.

import { View, Text } from 'react-native';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { DEFAULT_MAP_ZOOM } from '../constants/mapRules';

export default function MapPlaceholder({ height = 200, label = 'Mapa (placeholder)' }) {
  return (
    <View
      style={{
        height,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.primaryTint,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        overflow: 'hidden',
      }}
    >
      <Text style={[{ fontFamily, color: colors.primary }, typography.bodyBold]}>
        {label}
      </Text>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        Zoom padrão: {DEFAULT_MAP_ZOOM}
      </Text>
    </View>
  );
}
