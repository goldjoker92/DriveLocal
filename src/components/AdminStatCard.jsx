// AdminStatCard
// A single KPI tile for the admin dashboard: big value + small label.
// Designed to sit in a wrapping row of cards.

import { Text } from 'react-native';
import AppCard from './AppCard';
import { colors } from '../constants/colors';
import { typography, fontFamily } from '../constants/typography';

export default function AdminStatCard({ label, value }) {
  return (
    <AppCard style={{ flex: 1, minWidth: 140 }}>
      <Text style={[{ fontFamily, color: colors.text }, typography.h1]}>{value}</Text>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        {label}
      </Text>
    </AppCard>
  );
}
