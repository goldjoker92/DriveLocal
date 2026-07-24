// Guided driver profile-photo capture.
// Camera-only, front-facing capture -> passenger preview -> private candidate upload.
// The currently approved public photo is never replaced until an admin approves
// the new candidate.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';
import { driverPhotoStatus, hasApprovedDriverPhoto, rejectionReasonLabel } from '../../constants/driverPhoto';
import { auth } from '../../config/firebase';
import { getDriver } from '../../services/driverService';
import {
  getDriverPhotoDownloadUrl,
  submitDriverPhotoCandidate,
} from '../../services/driverPhotoService';
import { uploadDriverPhotoCandidate } from '../../services/storageService';
import {
  createDriverPhotoVersion,
  firstName,
  validateDriverPhotoAsset,
} from '../../utils/driverPhoto';
import { logDriverPhotoEvent } from '../../utils/driverPhotoLog';

const GUIDE_ITEMS = [
  'Olhe diretamente para a câmera.',
  'Mostre o rosto inteiro e os ombros.',
  'Retire capacete, boné e óculos escuros.',
  'Fique sozinho em um local bem iluminado.',
];

function GuideFrame() {
  return (
    <View style={styles.guideStage}>
      <View style={styles.faceOval} />
      <View style={styles.shoulders} />
      <Text style={styles.guideStageTitle}>Centralize o rosto</Text>
      <Text style={styles.guideStageText}>Cabeça e ombros dentro da área</Text>
    </View>
  );
}

function PassengerPreview({ uri, driver }) {
  const vehicle = VEHICLE_LABELS_PT_BR[driver?.vehicleType] || 'Veículo';
  const vehicleLine = [driver?.vehicleBrand, driver?.vehicleModel, driver?.vehicleColor]
    .filter(Boolean)
    .join(' • ');

  return (
    <View style={styles.passengerCard}>
      <Image source={{ uri }} style={styles.previewAvatar} resizeMode="cover" />
      <View style={styles.previewCopy}>
        <Text style={styles.previewName}>{firstName(driver?.fullName || driver?.displayName)}</Text>
        <Text style={styles.previewVerified}>Foto em análise</Text>
        <Text style={styles.previewVehicle}>{vehicle}{vehicleLine ? ` • ${vehicleLine}` : ''}</Text>
        <Text style={styles.previewPlate}>Placa {driver?.vehiclePlate || driver?.plate || '—'}</Text>
      </View>
    </View>
  );
}

export default function DriverPhoto() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const returnTo = typeof params.returnTo === 'string' ? params.returnTo : 'documents';
  const uid = auth.currentUser?.uid;

  const [driver, setDriver] = useState(null);
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState(null);
  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!uid) {
      setLoading(false);
      return undefined;
    }

    const startedAt = Date.now();
    getDriver(uid)
      .then(async (data) => {
        if (!active) return;
        setDriver(data);
        if (hasApprovedDriverPhoto(data)) {
          try {
            const url = await getDriverPhotoDownloadUrl(data.driverPhotoPublicPath);
            if (active) setCurrentPhotoUrl(url);
          } catch (photoError) {
            logDriverPhotoEvent('current_photo.load_failed', {
              driverId: uid,
              status: data?.driverPhotoReviewStatus,
              code: photoError?.code,
              message: photoError?.message,
            }, 'warn');
          }
        }
        logDriverPhotoEvent('screen.loaded', {
          driverId: uid,
          status: driverPhotoStatus(data),
          hasApprovedPhoto: hasApprovedDriverPhoto(data),
          durationMs: Date.now() - startedAt,
        });
      })
      .catch((loadError) => {
        if (active) setError('Não foi possível carregar o status da sua foto.');
        logDriverPhotoEvent('screen.load_failed', {
          driverId: uid,
          code: loadError?.code,
          message: loadError?.message,
        }, 'warn');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [uid]);

  async function takePhoto() {
    if (busy) return;
    setError('');
    const startedAt = Date.now();
    logDriverPhotoEvent('camera.permission_requested', { driverId: uid, source: 'front_camera' });

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Autorize a câmera para tirar sua foto de motorista.');
        logDriverPhotoEvent('camera.permission_denied', { driverId: uid, source: 'front_camera' }, 'warn');
        return;
      }

      logDriverPhotoEvent('camera.opened', { driverId: uid, source: 'front_camera' });
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
        cameraType: ImagePicker.CameraType.front,
        exif: false,
      });

      if (result.canceled || !result.assets?.[0]) {
        logDriverPhotoEvent('camera.cancelled', { driverId: uid, source: 'front_camera' });
        return;
      }

      const candidate = result.assets[0];
      const validation = validateDriverPhotoAsset(candidate);
      if (!validation.valid) {
        setError(validation.message);
        logDriverPhotoEvent('capture.rejected_locally', {
          driverId: uid,
          code: validation.code,
          width: candidate.width,
          height: candidate.height,
        }, 'warn');
        return;
      }

      setAsset(candidate);
      logDriverPhotoEvent('capture.ready_for_preview', {
        driverId: uid,
        source: 'front_camera',
        width: validation.width,
        height: validation.height,
        durationMs: Date.now() - startedAt,
      });
    } catch (cameraError) {
      setError('Não foi possível abrir a câmera. Tente novamente.');
      logDriverPhotoEvent('camera.failed', {
        driverId: uid,
        source: 'front_camera',
        code: cameraError?.code,
        message: cameraError?.message,
      }, 'error');
    }
  }

  async function usePhoto() {
    if (!uid || !asset || busy) return;
    setBusy(true);
    setProgress(0);
    setError('');
    const version = createDriverPhotoVersion();
    const startedAt = Date.now();

    logDriverPhotoEvent('candidate.workflow_started', {
      driverId: uid,
      version,
      action: hasApprovedDriverPhoto(driver) ? 'replace' : 'initial',
    });

    try {
      const uploaded = await uploadDriverPhotoCandidate({
        driverId: uid,
        version,
        asset,
        onProgress: setProgress,
      });
      await submitDriverPhotoCandidate({
        driverId: uid,
        version,
        originalPath: uploaded.originalPath,
        publicCandidatePath: uploaded.publicCandidatePath,
      });
      setDriver((current) => ({
        ...current,
        driverPhotoReviewStatus: 'pending',
        driverPhotoCandidateVersion: version,
        selfieStatus: 'submitted',
      }));
      setSubmitted(true);
      logDriverPhotoEvent('candidate.workflow_succeeded', {
        driverId: uid,
        version,
        status: 'pending',
        durationMs: Date.now() - startedAt,
      });
    } catch (uploadError) {
      setError(uploadError?.message || 'Não foi possível enviar a foto. Tente novamente.');
      logDriverPhotoEvent('candidate.workflow_failed', {
        driverId: uid,
        version,
        code: uploadError?.code,
        message: uploadError?.message,
        durationMs: Date.now() - startedAt,
      }, 'error');
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    logDriverPhotoEvent('screen.finished', {
      driverId: uid,
      status: submitted ? 'pending' : driverPhotoStatus(driver),
      action: returnTo,
    });
    if (returnTo === 'home') router.replace('/(driver)/driver-home');
    else router.replace('/(driver)/documents');
  }

  const status = driverPhotoStatus(driver);
  const replacing = hasApprovedDriverPhoto(driver);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Header
          title="Sua foto de motorista"
          subtitle="Ajude o passageiro a reconhecer você"
          onBack={() => router.back()}
        />

        {loading ? (
          <AppCard style={styles.centerCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Carregando sua foto…</Text>
          </AppCard>
        ) : submitted ? (
          <AppCard style={styles.successCard}>
            <View style={styles.successIcon}><Text style={styles.successIconText}>✓</Text></View>
            <Text style={styles.successTitle}>Foto enviada para análise</Text>
            <Text style={styles.successText}>
              {replacing
                ? 'Sua foto atual continua visível aos passageiros até a nova foto ser aprovada.'
                : 'A administração verificará se a foto está clara e corresponde ao seu cadastro.'}
            </Text>
            <AppButton title="Continuar" onPress={finish} />
          </AppCard>
        ) : asset ? (
          <>
            <AppCard>
              <Text style={styles.sectionTitle}>CONFIRA O RENDIMENTO PARA O PASSAGEIRO</Text>
              <PassengerPreview uri={asset.uri} driver={driver} />
              <Text style={styles.muted}>
                O recorte público será quadrado, sem metadados da câmera. A foto original ficará privada para análise.
              </Text>
            </AppCard>

            {busy ? (
              <AppCard>
                <Text style={styles.progressTitle}>Enviando com segurança… {progress}%</Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progress}%` }]} />
                </View>
              </AppCard>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <AppButton title={busy ? 'Enviando…' : 'Usar esta foto'} onPress={usePhoto} disabled={busy} />
            <AppButton
              title="Tirar outra"
              variant="secondary"
              onPress={() => {
                setAsset(null);
                setError('');
                takePhoto();
              }}
              disabled={busy}
            />
          </>
        ) : (
          <>
            {currentPhotoUrl ? (
              <AppCard>
                <Text style={styles.sectionTitle}>FOTO ATUAL APROVADA</Text>
                <Image source={{ uri: currentPhotoUrl }} style={styles.currentPhoto} resizeMode="cover" />
                <Text style={styles.successText}>Esta foto continua ativa até uma substituta ser aprovada.</Text>
              </AppCard>
            ) : null}

            <AppCard>
              <GuideFrame />
              <Text style={styles.guideTitle}>{replacing ? 'Tirar uma nova foto' : 'Como tirar uma boa foto'}</Text>
              {GUIDE_ITEMS.map((item) => (
                <View key={item} style={styles.guideRow}>
                  <Text style={styles.check}>✓</Text>
                  <Text style={styles.guideItem}>{item}</Text>
                </View>
              ))}
              <View style={styles.privacyBox}>
                <Text style={styles.privacyTitle}>Uso da foto</Text>
                <Text style={styles.privacyText}>
                  Após aprovação, somente a cópia pública recortada será mostrada aos passageiros quando você aceitar uma corrida.
                </Text>
              </View>
            </AppCard>

            {status === 'pending' ? (
              <AppCard style={styles.pendingCard}>
                <Text style={styles.pendingTitle}>Nova foto em análise</Text>
                <Text style={styles.muted}>Você pode enviar outra foto; a mais recente será analisada.</Text>
              </AppCard>
            ) : null}

            {status === 'rejected' ? (
              <AppCard style={styles.rejectedCard}>
                <Text style={styles.rejectedTitle}>A foto precisa ser refeita</Text>
                <Text style={styles.muted}>
                  {driver?.driverPhotoRejectionReason
                    || rejectionReasonLabel(driver?.driverPhotoRejectionCode)}
                </Text>
              </AppCard>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <AppButton title="Abrir câmera frontal" onPress={takePhoto} disabled={busy} />
            <Text style={styles.cameraOnly}>Por segurança, a galeria não está disponível para esta foto.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md, flexGrow: 1 },
  centerCard: { alignItems: 'center', gap: spacing.md },
  sectionTitle: { fontFamily, color: colors.textMuted, letterSpacing: 0.7, ...typography.caption },
  muted: { fontFamily, color: colors.textMuted, ...typography.small },
  guideStage: {
    height: 250,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  faceOval: {
    width: 126,
    height: 164,
    borderRadius: 70,
    borderWidth: 3,
    borderColor: colors.primary,
    backgroundColor: colors.background,
    zIndex: 2,
  },
  shoulders: {
    position: 'absolute',
    bottom: 34,
    width: 210,
    height: 82,
    borderTopLeftRadius: 110,
    borderTopRightRadius: 110,
    borderWidth: 3,
    borderBottomWidth: 0,
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  guideStageTitle: { position: 'absolute', top: 14, fontFamily, color: colors.primary, ...typography.bodyBold },
  guideStageText: { position: 'absolute', bottom: 10, fontFamily, color: colors.textMuted, ...typography.caption },
  guideTitle: { fontFamily, color: colors.text, ...typography.h3 },
  guideRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  check: { fontFamily, color: colors.success, fontWeight: '900', fontSize: 16 },
  guideItem: { flex: 1, fontFamily, color: colors.text, ...typography.small },
  privacyBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primaryTint, gap: spacing.xs },
  privacyTitle: { fontFamily, color: colors.primary, ...typography.bodyBold },
  privacyText: { fontFamily, color: colors.text, ...typography.small },
  passengerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  previewAvatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.card },
  previewCopy: { flex: 1, gap: 3 },
  previewName: { fontFamily, color: colors.text, ...typography.h3 },
  previewVerified: { fontFamily, color: colors.warning, ...typography.small, fontWeight: '700' },
  previewVehicle: { fontFamily, color: colors.textMuted, ...typography.small },
  previewPlate: { fontFamily, color: colors.text, ...typography.bodyBold },
  currentPhoto: { width: 132, height: 132, borderRadius: 66, alignSelf: 'center', backgroundColor: colors.card },
  pendingCard: { backgroundColor: colors.warningBg, borderColor: colors.warning },
  pendingTitle: { fontFamily, color: colors.warning, ...typography.bodyBold },
  rejectedCard: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  rejectedTitle: { fontFamily, color: colors.danger, ...typography.bodyBold },
  cameraOnly: { fontFamily, color: colors.textFaint, textAlign: 'center', ...typography.caption },
  progressTitle: { fontFamily, color: colors.primary, ...typography.bodyBold },
  progressTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  successCard: { alignItems: 'center', gap: spacing.md, backgroundColor: colors.successBg },
  successIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
  successIconText: { fontFamily, color: colors.white, fontSize: 42, lineHeight: 48, fontWeight: '800' },
  successTitle: { fontFamily, color: colors.success, textAlign: 'center', ...typography.h3 },
  successText: { fontFamily, color: colors.text, textAlign: 'center', ...typography.small },
  error: { fontFamily, color: colors.danger, ...typography.small },
});
