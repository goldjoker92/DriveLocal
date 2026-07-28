import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import AppCard from './AppCard';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { formatBRL } from '../utils/format';
import { deriveDriverActiveRideCard } from '../utils/driverActiveRideCard';
import {
  getAcceptedPassengerPhotoDownloadUrl,
  isAcceptedPassengerPhotoPath,
} from '../services/passengerPublicPhotoService';

function shortRideId(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return null;
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function RouteRow({ marker, label, value, muted = false }) {
  return (
    <View style={styles.routeRow}>
      <Text style={[styles.routeMarker, muted && styles.routeMarkerMuted]}>{marker}</Text>
      <View style={styles.routeCopy}>
        <Text style={styles.routeLabel}>{label}</Text>
        <Text style={[styles.routeValue, muted && styles.routeValueMuted]}>{value}</Text>
      </View>
    </View>
  );
}

export default function DriverActiveRideCard({ offer, status = null }) {
  const card = useMemo(
    () => deriveDriverActiveRideCard(offer, status),
    [offer, status]
  );
  const lastTrace = useRef(null);
  const identity = card.passengerIdentity;
  const verifiedPath = identity?.photoVerified === true
    && isAcceptedPassengerPhotoPath(identity?.photoStoragePath)
    ? identity.photoStoragePath
    : null;
  const [photoUrl, setPhotoUrl] = useState(null);

  useEffect(() => {
    if (!card.visible) return;
    const trace = {
      scope: 'driver_active_ride',
      event: 'card.rendered',
      rideId: shortRideId(card.rideId),
      cardVersion: card.version,
      status: card.status,
      vehicleType: card.vehicle.type,
      destinationReleased: card.destinationReleased,
      passengerIdentityAvailable: Boolean(identity),
      passengerPhotoVerified: Boolean(verifiedPath),
    };
    const signature = JSON.stringify(trace);
    if (lastTrace.current === signature) return;
    lastTrace.current = signature;
    console.info('[DRIVER_ACTIVE_RIDE] card.rendered', { ...trace, atMs: Date.now() });
  }, [
    card.visible,
    card.rideId,
    card.version,
    card.status,
    card.vehicle.type,
    card.destinationReleased,
    identity,
    verifiedPath,
  ]);

  useEffect(() => {
    let active = true;
    setPhotoUrl(null);
    if (!card.visible || !verifiedPath) return () => { active = false; };

    console.log('[DRIVER_ACTIVE_RIDE] passenger_photo.load_requested', {
      scope: 'driver_active_ride',
      event: 'passenger_photo.load_requested',
      rideId: shortRideId(card.rideId),
      atMs: Date.now(),
    });

    getAcceptedPassengerPhotoDownloadUrl(verifiedPath)
      .then((url) => {
        if (!active) return;
        setPhotoUrl(url);
        console.log('[DRIVER_ACTIVE_RIDE] passenger_photo.load_succeeded', {
          scope: 'driver_active_ride',
          event: 'passenger_photo.load_succeeded',
          rideId: shortRideId(card.rideId),
          atMs: Date.now(),
        });
      })
      .catch((error) => {
        if (!active) return;
        console.warn('[DRIVER_ACTIVE_RIDE] passenger_photo.load_failed', {
          scope: 'driver_active_ride',
          event: 'passenger_photo.load_failed',
          rideId: shortRideId(card.rideId),
          errorCode: error?.code || 'PHOTO_LOAD_FAILED',
          atMs: Date.now(),
        });
      });

    return () => { active = false; };
  }, [card.visible, card.rideId, verifiedPath]);

  if (!card.visible) return null;

  const initial = card.passengerFirstName.slice(0, 1).toUpperCase();
  const fareLabel = card.fareCentavos == null
    ? 'Carregando valor…'
    : formatBRL(card.fareCentavos);

  return (
    <AppCard style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>CORRIDA ATIVA</Text>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>ATIVA</Text>
        </View>
      </View>

      <View style={styles.identityRow}>
        <View style={styles.avatar}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.photo} resizeMode="cover" />
          ) : (
            <Text style={styles.initial}>{initial}</Text>
          )}
        </View>
        <View style={styles.identityCopy}>
          <Text style={styles.passengerName}>{card.passengerFirstName}</Text>
          <Text style={styles.vehicleText}>{`${card.vehicle.emoji} ${card.vehicle.label}`}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.routeStack}>
        <RouteRow marker="●" label="Embarque" value={card.pickupLabel} />
        <View style={styles.routeConnector} />
        <RouteRow
          marker="○"
          label="Destino"
          value={card.destinationLabel}
          muted={!card.destinationReleased}
        />
      </View>

      <View style={styles.priceRow}>
        <Text style={styles.priceLabel}>Valor da corrida</Text>
        <Text style={styles.priceValue}>{fareLabel}</Text>
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  eyebrow: {
    flex: 1,
    fontFamily,
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.successBg,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.success,
  },
  liveText: {
    fontFamily,
    color: colors.success,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.primaryTint,
  },
  photo: { width: '100%', height: '100%' },
  initial: {
    fontFamily,
    color: colors.primary,
    fontSize: 23,
    fontWeight: '800',
  },
  identityCopy: { flex: 1, gap: 3 },
  passengerName: {
    fontFamily,
    color: colors.text,
    ...typography.h3,
  },
  vehicleText: {
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
  },
  divider: { height: 1, backgroundColor: colors.border },
  routeStack: { position: 'relative', gap: spacing.sm },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  routeMarker: {
    width: 18,
    fontFamily,
    color: colors.primary,
    fontSize: 18,
    lineHeight: 22,
    textAlign: 'center',
  },
  routeMarkerMuted: { color: colors.textFaint },
  routeCopy: { flex: 1, gap: 2 },
  routeLabel: {
    fontFamily,
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  routeValue: {
    fontFamily,
    color: colors.text,
    ...typography.small,
  },
  routeValueMuted: { color: colors.textMuted },
  routeConnector: {
    position: 'absolute',
    left: 8,
    top: 22,
    width: 2,
    height: 31,
    backgroundColor: colors.border,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  priceLabel: {
    flex: 1,
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
  },
  priceValue: {
    fontFamily,
    color: colors.text,
    ...typography.h3,
    flexShrink: 1,
    textAlign: 'right',
  },
});
