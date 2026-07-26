import { Pressable, Text, View } from 'react-native';
import { useGlobalSearchParams, useRouter } from 'expo-router';

import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';

function firstString(value) {
  if (Array.isArray(value)) return value[0] || null;
  return typeof value === 'string' ? value : null;
}

function supportSource(route) {
  const path = String(route || '').toLowerCase();
  if (path.includes('active-ride')) return 'active_ride';
  if (path.includes('driver-accepted')) return 'driver_accepted';
  if (path.includes('pix-payment')) return 'pix_payment';
  if (path.includes('driver-home')) return 'driver_home';
  return null;
}

export default function SupportShortcut({ route }) {
  const router = useRouter();
  const params = useGlobalSearchParams();
  const source = supportSource(route);
  const rideId = firstString(params?.rideId);
  if (!source) return null;

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
        accessibilityLabel="Abrir ajuda e suporte"
        onPress={() => router.push({
          pathname: '/support-center',
          params: {
            source,
            ...(rideId ? { rideId } : {}),
          },
        })}
        style={({ pressed }) => ({
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <Text style={[{ fontFamily, color: colors.primary }, typography.small]}>
          Ajuda e suporte
        </Text>
      </Pressable>
    </View>
  );
}

export { supportSource };