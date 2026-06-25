// RideRequestCard
// One ride request/summary card. Pass onAccept/onDecline to show the
// driver action buttons; omit them to render a read-only summary.

import { View, Text } from 'react-native';
import AppCard from './AppCard';
import AppButton from './AppButton';
import AppBadge from './AppBadge';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { formatBRL, formatDistanceKm } from '../utils/format';
import { VEHICLE_LABELS_PT_BR } from '../constants/vehicleTypes';

// Local label/value row — kept private to this card on purpose.
function InfoRow({ label, value }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        {label}
      </Text>
      <Text
        style={[
          { fontFamily, color: colors.text, flexShrink: 1, textAlign: 'right' },
          typography.small,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export default function RideRequestCard({ ride, onAccept, onDecline }) {
  if (!ride) return null;

  return (
    <AppCard>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <AppBadge label={VEHICLE_LABELS_PT_BR[ride.vehicleType] || ride.vehicleType} />
        <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
          {formatBRL(ride.fareCents)}
        </Text>
      </View>

      <InfoRow label="Origem" value={ride.pickup?.address} />
      <InfoRow label="Destino" value={ride.destination?.address} />
      <InfoRow label="Distância" value={formatDistanceKm(ride.distanceMeters)} />

      {onAccept || onDecline ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
          {onAccept ? (
            <View style={{ flex: 1 }}>
              <AppButton title="Aceitar" onPress={onAccept} />
            </View>
          ) : null}
          {onDecline ? (
            <View style={{ flex: 1 }}>
              <AppButton title="Recusar" variant="ghost" onPress={onDecline} />
            </View>
          ) : null}
        </View>
      ) : null}
    </AppCard>
  );
}
