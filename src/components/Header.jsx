// Header
// Screen header: optional back link, title, optional subtitle, optional
// right-side element (e.g. a status badge).

import { View, Text, Pressable } from 'react-native';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';

export default function Header({ title, subtitle, onBack, right }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 24,
        }}
      >
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={8}>
            <Text style={[{ fontFamily, color: colors.primary }, typography.bodyBold]}>
              {'‹ Voltar'}
            </Text>
          </Pressable>
        ) : (
          <View />
        )}
        {right ?? null}
      </View>
      <Text style={[{ fontFamily, color: colors.text }, typography.h1]}>{title}</Text>
      {subtitle ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
