// AdminStatCard
// A single compact KPI tile: big value + small label (+ optional hint line).
// Layout-neutral: the PARENT decides the width (e.g. a 2-column grid passes
// style={{ width: '48%' }}). We intentionally do NOT set flex/minWidth here —
// flex:1 on flex-wrap children is unreliable on Android and caused cards to
// overlap. When onPress is provided the whole tile is tappable.

import { View, Text, Pressable } from 'react-native';
import AppCard from './AppCard';
import { colors } from '../constants/colors';
import { typography, fontFamily } from '../constants/typography';

export default function AdminStatCard({ label, value, hint, onPress, style }) {
  const inner = (
    <AppCard style={{ width: '100%' }}>
      {/* Value stays on one line so it can never wrap behind the label. */}
      <Text style={[{ fontFamily, color: colors.text }, typography.h2]} numberOfLines={1}>
        {value}
      </Text>
      {/* Long labels wrap freely within the card (no fixed height). */}
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{label}</Text>
      {hint ? (
        <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>{hint}</Text>
      ) : null}
    </AppCard>
  );

  if (!onPress) return <View style={style}>{inner}</View>;
  return <Pressable onPress={onPress} style={style}>{inner}</Pressable>;
}
