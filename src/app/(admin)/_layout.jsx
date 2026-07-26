// Admin route group layout. Screens render their own header.

import { Pressable, Text, View } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';

import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { fontFamily, typography } from '../../constants/typography';

export default function AdminLayout() {
  const pathname = usePathname();
  const router = useRouter();
  const showSupport = String(pathname || '').toLowerCase().includes('dashboard');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {showSupport ? (
        <View
          style={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.xs,
            alignItems: 'flex-end',
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir tickets de suporte"
            onPress={() => router.push('/support-tickets')}
            style={({ pressed }) => ({
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <Text style={[{ fontFamily, color: colors.primary }, typography.small]}>
              Tickets de suporte
            </Text>
          </Pressable>
        </View>
      ) : null}
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
}