// Admin route group layout. Screens render their own header.

import { Pressable, Text, View } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';

import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { fontFamily, typography } from '../../constants/typography';

export default function AdminLayout() {
  const pathname = usePathname();
  const router = useRouter();
  const showOperationalShortcuts = String(pathname || '').toLowerCase().includes('dashboard');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {showOperationalShortcuts ? (
        <View
          style={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.xs,
            flexDirection: 'row',
            justifyContent: 'flex-end',
            gap: spacing.sm,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir alertas operacionais"
            onPress={() => router.push('/admin-alerts')}
            style={({ pressed }) => ({
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>
              Alertas
            </Text>
          </Pressable>
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
              Tickets
            </Text>
          </Pressable>
        </View>
      ) : null}
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
}
