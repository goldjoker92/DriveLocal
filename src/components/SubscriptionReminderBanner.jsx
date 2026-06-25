// SubscriptionReminderBanner
// Warning banner reminding the driver about their subscription free window.
// Pass daysLeft to show a countdown; omit it for the generic message.

import { View, Text } from 'react-native';
import { colors } from '../constants/colors';
import { spacing, radius } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { SUBSCRIPTION_DEFAULT_FREE_DAYS } from '../constants/subscriptionRules';

export default function SubscriptionReminderBanner({ daysLeft }) {
  const text =
    typeof daysLeft === 'number'
      ? `Assinatura gratuita: ${daysLeft} dia(s) restantes`
      : `Assinatura gratuita por ${SUBSCRIPTION_DEFAULT_FREE_DAYS} dias`;

  return (
    <View
      style={{
        backgroundColor: colors.warningBg,
        borderRadius: radius.md,
        padding: spacing.md,
        borderWidth: 1,
        borderColor: colors.warning,
      }}
    >
      <Text style={[{ fontFamily, color: colors.warning }, typography.small]}>
        {text}
      </Text>
    </View>
  );
}
