import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import AppCard from './AppCard';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import { safeAcceptedPassengerFirstName } from '../utils/passengerPublicIdentity';
import {
  getAcceptedPassengerPhotoDownloadUrl,
  isAcceptedPassengerPhotoPath,
} from '../services/passengerPublicPhotoService';

function shortRideId(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return null;
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

export default function AcceptedPassengerIdentityCard({ identity, rideId = null }) {
  const firstName = useMemo(
    () => safeAcceptedPassengerFirstName(identity),
    [identity?.firstName]
  );
  const initial = firstName.slice(0, 1).toUpperCase();
  const verifiedPath = identity?.photoVerified === true
    && isAcceptedPassengerPhotoPath(identity?.photoStoragePath)
    ? identity.photoStoragePath
    : null;
  const [photoUrl, setPhotoUrl] = useState(null);

  useEffect(() => {
    let active = true;
    setPhotoUrl(null);
    if (!verifiedPath) return () => { active = false; };

    console.log('[PASSENGER_PUBLIC_IDENTITY] photo.load_requested', {
      scope: 'passenger_public_identity',
      event: 'photo.load_requested',
      rideId: shortRideId(rideId),
      photoVerified: true,
      atMs: Date.now(),
    });

    getAcceptedPassengerPhotoDownloadUrl(verifiedPath)
      .then((url) => {
        if (!active) return;
        setPhotoUrl(url);
        console.log('[PASSENGER_PUBLIC_IDENTITY] photo.load_succeeded', {
          scope: 'passenger_public_identity',
          event: 'photo.load_succeeded',
          rideId: shortRideId(rideId),
          photoVerified: true,
          atMs: Date.now(),
        });
      })
      .catch((error) => {
        if (!active) return;
        console.warn('[PASSENGER_PUBLIC_IDENTITY] photo.load_failed', {
          scope: 'passenger_public_identity',
          event: 'photo.load_failed',
          rideId: shortRideId(rideId),
          photoVerified: true,
          errorCode: error?.code || 'PHOTO_LOAD_FAILED',
          atMs: Date.now(),
        });
      });

    return () => { active = false; };
  }, [verifiedPath, rideId]);

  return (
    <AppCard>
      <View style={styles.row}>
        <View style={styles.avatar}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.photo} resizeMode="cover" />
          ) : (
            <Text style={styles.initial}>{initial}</Text>
          )}
        </View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>PASSAGEIRO</Text>
          <Text style={styles.name}>{firstName}</Text>
          <Text style={styles.detail}>
            {photoUrl ? 'Foto pública verificada' : 'Identificação pelo primeiro nome'}
          </Text>
        </View>
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.primaryTint,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  initial: {
    fontFamily,
    color: colors.primary,
    fontSize: 24,
    fontWeight: '700',
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    fontFamily,
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  name: {
    fontFamily,
    color: colors.text,
    ...typography.h3,
  },
  detail: {
    fontFamily,
    color: colors.textMuted,
    ...typography.caption,
  },
});
