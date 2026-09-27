import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import AppBadge from './AppBadge';
import AppCard from './AppCard';
import DriverStatusBadge from './DriverStatusBadge';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import {
  driverPhotoStatus,
  hasApprovedDriverPhoto,
} from '../constants/driverPhoto';
import { getDriverPhotoDownloadUrl } from '../services/driverPhotoService';
import { founderNumberLabel, isFounderDriver } from '../utils/driverCockpit';
import {
  driverCockpitDisplayName,
  driverCockpitVehicle,
} from '../utils/driverCockpitSummary';

function photoStatusCopy(status, hasPublicPhoto) {
  if (status === 'pending') return { label: 'Nova foto em análise', tone: 'warning' };
  if (status === 'rejected') return { label: 'Nova foto recusada', tone: 'danger' };
  if (hasPublicPhoto) return { label: 'Foto aprovada', tone: 'success' };
  return { label: 'Foto necessária', tone: 'neutral' };
}

function approvalStatusCopy(driver, founder, founderNumber) {
  if (driver?.verificationStatus !== 'approved') return 'Cadastro ainda não aprovado';
  if (founder) return `Motorista aprovado • Fundador ${founderNumber || ''}`.trim();
  return 'Motorista aprovado';
}

export default function DriverCockpitProfileCard({ driver, online, onPhotoPress, availabilityPresentation }) {
  const displayName = useMemo(() => driverCockpitDisplayName(driver), [
    driver?.displayName,
    driver?.fullName,
  ]);
  const vehicle = useMemo(() => driverCockpitVehicle(driver), [
    driver?.vehicleType,
    driver?.vehicleBrand,
    driver?.vehicleMake,
    driver?.vehicleModel,
    driver?.vehicleColor,
    driver?.vehiclePlate,
    driver?.plate,
  ]);
  const status = driverPhotoStatus(driver);
  const approvedPhoto = hasApprovedDriverPhoto(driver);
  const photoCopy = photoStatusCopy(status, approvedPhoto);
  const founder = isFounderDriver(driver);
  const founderNumber = founderNumberLabel(driver);
  const approvedPath = approvedPhoto ? driver?.driverPhotoPublicPath : null;
  const [photoUrl, setPhotoUrl] = useState(null);

  useEffect(() => {
    let active = true;
    setPhotoUrl(null);
    if (!approvedPath) return () => { active = false; };

    console.log('[DRIVER_COCKPIT] profile_photo.load_requested', {
      scope: 'driver_cockpit',
      event: 'profile_photo.load_requested',
      hasApprovedPhoto: true,
      atMs: Date.now(),
    });
    getDriverPhotoDownloadUrl(approvedPath)
      .then((url) => {
        if (!active) return;
        setPhotoUrl(url);
        console.log('[DRIVER_COCKPIT] profile_photo.load_succeeded', {
          scope: 'driver_cockpit',
          event: 'profile_photo.load_succeeded',
          hasApprovedPhoto: true,
          atMs: Date.now(),
        });
      })
      .catch((error) => {
        if (!active) return;
        console.warn('[DRIVER_COCKPIT] profile_photo.load_failed', {
          scope: 'driver_cockpit',
          event: 'profile_photo.load_failed',
          hasApprovedPhoto: true,
          errorCode: error?.code || 'PHOTO_LOAD_FAILED',
          atMs: Date.now(),
        });
      });

    return () => { active = false; };
  }, [approvedPath]);

  const approvalCopy = approvalStatusCopy(driver, founder, founderNumber);

  return (
    <AppCard style={styles.card}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Gerenciar foto do motorista"
          onPress={onPhotoPress}
          style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
        >
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.photo} resizeMode="cover" />
          ) : (
            <Text style={styles.initial}>{displayName.slice(0, 1).toUpperCase()}</Text>
          )}
        </Pressable>

        <View style={styles.identityCopy}>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.approval}>{approvalCopy}</Text>
          <View style={styles.badges}>
            {availabilityPresentation ? (
              <AppBadge label={availabilityPresentation.badge} tone={availabilityPresentation.tone} />
            ) : <DriverStatusBadge status={online ? 'online' : 'offline'} />}
            <AppBadge label={photoCopy.label} tone={photoCopy.tone} />
          </View>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.vehicleRow}>
        <Text style={styles.vehicleEmoji}>{vehicle.emoji}</Text>
        <View style={styles.vehicleCopy}>
          <Text style={styles.vehiclePrimary}>{`${vehicle.typeLabel} • ${vehicle.primary}`}</Text>
          {vehicle.secondary ? <Text style={styles.vehicleSecondary}>{vehicle.secondary}</Text> : null}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={approvedPhoto ? 'Ver ou trocar foto' : 'Enviar foto'}
        onPress={onPhotoPress}
        style={({ pressed }) => [styles.photoAction, pressed && styles.pressed]}
      >
        <Text style={styles.photoActionText}>
          {approvedPhoto ? 'Ver ou trocar minha foto' : 'Enviar minha foto'}
        </Text>
      </Pressable>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: radius.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTint,
    borderWidth: 2,
    borderColor: colors.border,
  },
  photo: { width: '100%', height: '100%' },
  initial: { fontFamily, color: colors.primary, fontSize: 28, fontWeight: '800' },
  identityCopy: { flex: 1, gap: spacing.xs },
  name: { fontFamily, color: colors.text, ...typography.h2 },
  approval: { fontFamily, color: colors.textMuted, ...typography.small },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  divider: { height: 1, backgroundColor: colors.border },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  vehicleEmoji: { fontSize: 22 },
  vehicleCopy: { flex: 1, gap: 2 },
  vehiclePrimary: { fontFamily, color: colors.text, ...typography.bodyBold },
  vehicleSecondary: { fontFamily, color: colors.textMuted, ...typography.small },
  photoAction: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  photoActionText: { fontFamily, color: colors.primary, ...typography.small, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});