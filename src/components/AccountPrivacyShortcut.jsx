import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';

export default function AccountPrivacyShortcut({ route }) {
  const router = useRouter();
  const path = String(route || '').toLowerCase();
  if (!path.includes('driver-home')) return null;

  return (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.xs,
        backgroundColor: colors.background,
        alignItems: 'flex-end',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abrir privacidade e conta"
        onPress={() => router.push('/privacy-center')}
        style={({ pressed }) => ({
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <Text style={[{ fontFamily, color: colors.primary }, typography.small]}>
          Privacidade e conta
        </Text>
      </Pressable>
    </View>
  );
}
