import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';

function Shortcut({ label, accessibilityLabel, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.sm,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <Text style={[{ fontFamily, color: colors.primary }, typography.small]}>
        {label}
      </Text>
    </Pressable>
  );
}

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
        justifyContent: 'flex-end',
        flexDirection: 'row',
        gap: spacing.xs,
      }}
    >
      <Shortcut
        label="Ajuda e suporte"
        accessibilityLabel="Abrir ajuda e suporte"
        onPress={() => router.push({
          pathname: '/support-center',
          params: { source: 'driver_home' },
        })}
      />
      <Shortcut
        label="Privacidade e conta"
        accessibilityLabel="Abrir privacidade e conta"
        onPress={() => router.push('/privacy-center')}
      />
    </View>
  );
}