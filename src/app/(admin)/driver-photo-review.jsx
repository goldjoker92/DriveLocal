// Admin review for the passenger-facing driver photo.
// Only the sanitized private candidate is displayed. Approval/rejection is bound
// to the exact candidate version loaded on this screen.

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
import { doc, getDoc } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import AppBadge from '../../components/AppBadge';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import {
  DRIVER_PHOTO_REJECTION_REASONS,
  driverPhotoStatus,
  hasApprovedDriverPhoto,
  rejectionReasonLabel,
} from '../../constants/driverPhoto';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';
import { auth, db } from '../../config/firebase';
import { approveDriverPhoto, rejectDriverPhoto } from '../../services/adminService';
import { getDriver } from '../../services/driverService';
import { getDriverPhotoDownloadUrl } from '../../services/driverPhotoService';
import { firstName } from '../../utils/driverPhoto';
import { logDriverPhotoEvent } from '../../utils/driverPhotoLog';
import { showConfirmAlert } from '../../utils/alertUtils';

function PassengerCard({ uri, driver, approved = false }) {
  const vehicle = VEHICLE_LABELS_PT_BR[driver?.vehicleType] || 'Veículo';
  const details = [driver?.vehicleBrand, driver?.vehicleModel, driver?.vehicleColor]
    .filter(Boolean)
    .join(' • ');

  return (
    <View style={styles.passengerCard}>
      {uri ? (
        <Image source={{ uri }} style={styles.avatar} resizeMode="cover" />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={{ fontSize: 36 }}>👤</Text>
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.driverName}>
          {firstName(driver?.fullName || driver?.displayName)}
        </Text>
        <Text style={approved ? styles.approved : styles.pending}>
          {approved ? 'Foto verificada ✓' : 'Candidata à aprovação'}
        </Text>
        <Text style={styles.muted}>{vehicle}{details ? ` • ${details}` : ''}</Text>
        <Text style={styles.plate}>Placa {driver?.vehiclePlate || driver?.plate || '—'}</Text>
      </View>
    </View>
  );
}

function statusBadge(status) {
  if (status === 'approved') return { label: 'Foto aprovada', tone: 'success' };
  if (status === 'pending') return { label: 'Em análise', tone: 'warning' };
  if (status === 'rejected') return { label: 'Recusada', tone: 'danger' };
  return { label: 'Sem foto', tone: 'neutral' };
}

function staleActionMessage(error) {
  const reason = error?.details?.metadata?.reason || error?.metadata?.reason;
  if (reason === 'PHOTO_CANDIDATE_CHANGED' || reason === 'PHOTO_NOT_PENDING') {
    return 'A foto mudou desde que esta tela foi aberta. Atualize antes de decidir.';
  }
  return null;
}

export default function DriverPhotoReview() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const driverId = typeof params.driverId === 'string' ? params.driverId : null;
  const [driver, setDriver] = useState(null);
  const [candidateUrl, setCandidateUrl] = useState(null);
  const [currentUrl, setCurrentUrl] = useState(null);
  const [selectedReason, setSelectedReason] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const uid = auth.currentUser?.uid;
    if (!uid || !driverId) {
      setLoading(false);
      return undefined;
    }

    getDoc(doc(db, 'admins', uid))
      .then((snapshot) => {
        if (active && !snapshot.exists()) router.replace('/(auth)/login');
      })
      .catch(() => {
        if (active) router.replace('/(auth)/login');
      });

    return () => {
      active = false;
    };
  }, [driverId, router]);

  async function load() {
    if (!driverId) return;
    setLoading(true);
    setError('');
    const startedAt = Date.now();
    try {
      const data = await getDriver(driverId);
      setDriver(data);
      setCandidateUrl(null);
      setCurrentUrl(null);

      const loads = [];
      if (data?.driverPhotoCandidatePublicPath) {
        loads.push(
          getDriverPhotoDownloadUrl(data.driverPhotoCandidatePublicPath, {
            allowPrivateCandidate: true,
          }).then(setCandidateUrl)
        );
      }
      if (hasApprovedDriverPhoto(data)) {
        loads.push(getDriverPhotoDownloadUrl(data.driverPhotoPublicPath).then(setCurrentUrl));
      }
      await Promise.all(loads);

      logDriverPhotoEvent('admin.review_loaded', {
        driverId,
        version: data?.driverPhotoCandidateVersion,
        status: driverPhotoStatus(data),
        hasApprovedPhoto: hasApprovedDriverPhoto(data),
        hasCandidate: Boolean(data?.driverPhotoCandidatePublicPath),
        durationMs: Date.now() - startedAt,
      });
    } catch (loadError) {
      setError('Não foi possível carregar a foto. Verifique sua conexão e tente novamente.');
      logDriverPhotoEvent('admin.review_load_failed', {
        driverId,
        code: loadError?.code,
        message: loadError?.message,
      }, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [driverId]);

  function approve() {
    const version = driver?.driverPhotoCandidateVersion;
    if (!version) {
      setError('Versão da foto indisponível. Atualize a tela.');
      return;
    }
    showConfirmAlert({
      title: 'Aprovar esta foto?',
      message: 'A cópia recortada será liberada aos passageiros nas próximas corridas aceitas.',
      confirmText: 'Aprovar foto',
      onConfirm: async () => {
        setBusy(true);
        setError('');
        try {
          logDriverPhotoEvent('admin.approve_pressed', {
            driverId,
            version,
            status: driver?.driverPhotoReviewStatus,
          });
          await approveDriverPhoto(driverId, version);
          await load();
        } catch (approveError) {
          setError(staleActionMessage(approveError)
            || 'Não foi possível aprovar a foto. Ela continua privada e sem alteração.');
          logDriverPhotoEvent('admin.approve_failed', {
            driverId,
            version,
            code: approveError?.code,
            message: approveError?.message,
          }, 'error');
        } finally {
          setBusy(false);
        }
      },
    });
  }

  function reject() {
    const version = driver?.driverPhotoCandidateVersion;
    if (!version) {
      setError('Versão da foto indisponível. Atualize a tela.');
      return;
    }
    if (!selectedReason) {
      setError('Escolha o motivo da recusa da foto.');
      return;
    }

    showConfirmAlert({
      title: 'Solicitar nova foto?',
      message: hasApprovedDriverPhoto(driver)
        ? 'A foto atual aprovada continuará visível. Somente esta candidata será recusada.'
        : 'O motorista voltará para a correção e precisará enviar outra foto.',
      confirmText: 'Recusar foto',
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        setError('');
        try {
          logDriverPhotoEvent('admin.reject_pressed', {
            driverId,
            version,
            reasonCode: selectedReason,
          });
          await rejectDriverPhoto(
            driverId,
            version,
            selectedReason,
            reasonDetail.trim()
          );
          setSelectedReason('');
          setReasonDetail('');
          await load();
        } catch (rejectError) {
          setError(staleActionMessage(rejectError)
            || 'Não foi possível registrar a recusa. Nenhuma foto foi alterada.');
          logDriverPhotoEvent('admin.reject_failed', {
            driverId,
            version,
            reasonCode: selectedReason,
            code: rejectError?.code,
            message: rejectError?.message,
          }, 'error');
        } finally {
          setBusy(false);
        }
      },
    });
  }

  const status = driverPhotoStatus(driver);
  const pendingReview = status === 'pending';
  const badge = statusBadge(status);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Header title="Revisão da foto" subtitle="Foto pública do motorista" onBack={() => router.back()} />

        {loading ? (
          <AppCard style={styles.loadingCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Carregando foto privada…</Text>
          </AppCard>
        ) : !driver ? (
          <AppCard><Text style={styles.error}>Motorista não encontrado.</Text></AppCard>
        ) : (
          <>
            <AppCard>
              <View style={styles.titleRow}>
                <Text style={styles.title}>{driver.fullName || driver.displayName || 'Motorista'}</Text>
                <AppBadge label={badge.label} tone={badge.tone} />
              </View>
              <Text style={styles.muted}>
                Analise o rosto, a clareza e a correspondência com o cadastro. A imagem original não é publicada.
              </Text>
            </AppCard>

            {hasApprovedDriverPhoto(driver) && currentUrl ? (
              <AppCard>
                <Text style={styles.section}>FOTO ATUAL APROVADA</Text>
                <PassengerCard uri={currentUrl} driver={driver} approved />
                {pendingReview ? (
                  <Text style={styles.muted}>Ela permanece ativa enquanto a candidata abaixo é analisada.</Text>
                ) : null}
              </AppCard>
            ) : null}

            <AppCard>
              <Text style={styles.section}>CANDIDATA — RENDIMENTO PARA O PASSAGEIRO</Text>
              <PassengerCard uri={candidateUrl} driver={driver} />
              {!candidateUrl ? <Text style={styles.error}>Arquivo candidato indisponível.</Text> : null}
            </AppCard>

            {status === 'rejected' ? (
              <AppCard style={styles.rejectedCard}>
                <Text style={styles.rejectedTitle}>Última candidata recusada</Text>
                <Text style={styles.muted}>
                  {driver.driverPhotoRejectionReason
                    || rejectionReasonLabel(driver.driverPhotoRejectionCode)}
                </Text>
              </AppCard>
            ) : null}

            {pendingReview ? (
              <>
                <AppCard>
                  <Text style={styles.section}>MOTIVO, SE A FOTO FOR RECUSADA</Text>
                  <View style={styles.reasonWrap}>
                    {DRIVER_PHOTO_REJECTION_REASONS.map((item) => {
                      const selected = selectedReason === item.code;
                      return (
                        <Pressable
                          key={item.code}
                          onPress={() => setSelectedReason(item.code)}
                          style={[styles.reasonChip, selected && styles.reasonChipSelected]}
                        >
                          <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>
                            {item.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <AppInput
                    label="Detalhe para o motorista (opcional)"
                    value={reasonDetail}
                    onChangeText={setReasonDetail}
                    placeholder="Explique de forma curta e objetiva"
                  />
                </AppCard>

                {error ? <Text style={styles.error}>{error}</Text> : null}
                <AppButton
                  title={busy ? 'Processando…' : 'Aprovar foto'}
                  onPress={approve}
                  disabled={busy || !candidateUrl}
                />
                <AppButton
                  title={busy ? 'Processando…' : 'Solicitar nova foto'}
                  variant="secondary"
                  onPress={reject}
                  disabled={busy}
                />
              </>
            ) : (
              <>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <AppButton title="Atualizar" variant="secondary" onPress={load} disabled={busy} />
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md, flexGrow: 1 },
  loadingCard: { alignItems: 'center', gap: spacing.md },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  title: { flex: 1, fontFamily, color: colors.text, ...typography.h3 },
  section: { fontFamily, color: colors.textMuted, letterSpacing: 0.7, ...typography.caption },
  passengerCard: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.card },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  driverName: { fontFamily, color: colors.text, ...typography.h3 },
  approved: { fontFamily, color: colors.success, ...typography.small, fontWeight: '700' },
  pending: { fontFamily, color: colors.warning, ...typography.small, fontWeight: '700' },
  plate: { fontFamily, color: colors.text, ...typography.bodyBold },
  muted: { fontFamily, color: colors.textMuted, ...typography.small },
  error: { fontFamily, color: colors.danger, ...typography.small },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reasonChip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  reasonChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  reasonText: { fontFamily, color: colors.textMuted, ...typography.small },
  reasonTextSelected: { color: colors.white },
  rejectedCard: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  rejectedTitle: { fontFamily, color: colors.danger, ...typography.bodyBold },
});
