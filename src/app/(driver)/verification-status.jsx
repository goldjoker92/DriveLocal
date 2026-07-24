// Driver verification status. The admin decision on drivers/{uid} is the source
// of truth. Corrections return through the validated onboarding screens; this
// page never bypasses document/photo completeness checks.

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AppBadge from '../../components/AppBadge';
import AdminTableRow from '../../components/AdminTableRow';
import DriverStatusBadge from '../../components/DriverStatusBadge';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import {
  driverPhotoStatus,
  hasApprovedDriverPhoto,
  rejectionReasonLabel,
} from '../../constants/driverPhoto';
import { auth, db } from '../../config/firebase';
import { logDriverPhotoEvent } from '../../utils/driverPhotoLog';

const STATUS_LABELS_PT_BR = {
  draft: 'Cadastro em andamento',
  pending_review: 'Aguardando aprovação',
  approved: 'Motorista aprovado',
  correction_requested: 'Correção solicitada',
  rejected: 'Cadastro recusado',
  suspended: 'Cadastro suspenso',
};

function badgeStatus(status) {
  if (status === 'approved') return 'online';
  if (status === 'pending_review' || status === 'correction_requested') return 'pending';
  return 'offline';
}

function formatDateTime(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function'
    ? value.toDate()
    : value instanceof Date
      ? value
      : null;
  if (!date) return null;
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} às ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function PhotoCorrectionCard({ driver, onRetake }) {
  const reason = driver?.driverPhotoRejectionReason
    || rejectionReasonLabel(driver?.driverPhotoRejectionCode);
  return (
    <AppCard>
      <AppBadge label="Foto a corrigir" tone="danger" />
      <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
        Tire uma nova foto de motorista
      </Text>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        Motivo: {reason}
      </Text>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        A câmera mostrará o enquadramento e a prévia exata que o passageiro verá.
      </Text>
      <AppButton title="Refazer foto" onPress={onRetake} />
    </AppCard>
  );
}

export default function VerificationStatus() {
  const router = useRouter();
  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setLoading(false);
      return undefined;
    }
    const unsubscribe = onSnapshot(
      doc(db, 'drivers', uid),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : null;
        setDriver(data);
        setLoading(false);
        console.log('[DRIVER_STATUS] verificationStatus=', data?.verificationStatus);
      },
      (error) => {
        console.log('[DRIVER_STATUS] listener error', error?.message || 'unknown');
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const status = driver?.verificationStatus;
  const submittedAtLabel = driver ? formatDateTime(driver.submittedAt) : null;
  const photoStatus = driverPhotoStatus(driver);
  const initialPhotoCorrection = status === 'correction_requested'
    && photoStatus === 'rejected'
    && !hasApprovedDriverPhoto(driver);

  function openPhotoCorrection() {
    logDriverPhotoEvent('status.open_photo_correction', {
      driverId: auth.currentUser?.uid,
      status: photoStatus,
      hasApprovedPhoto: hasApprovedDriverPhoto(driver),
      action: 'retake',
    });
    router.push({
      pathname: '/(driver)/driver-photo',
      params: { returnTo: 'documents' },
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Status da verificação" onBack={() => router.back()} />

        <AppCard>
          {loading ? (
            <AdminTableRow label="Carregando…" />
          ) : !driver ? (
            <AdminTableRow label="Cadastro não encontrado" />
          ) : (
            <>
              <DriverStatusBadge status={badgeStatus(status)} />
              <AdminTableRow label="Status" value={STATUS_LABELS_PT_BR[status] || status} />
              {submittedAtLabel ? <AdminTableRow label="Enviado em" value={submittedAtLabel} /> : null}

              {status === 'approved' ? (
                <Text style={[{ fontFamily, color: colors.success }, typography.small]}>
                  Seu cadastro foi aprovado. Bem-vindo à DriveLocal!
                </Text>
              ) : null}

              {status === 'pending_review' ? (
                <View style={{ gap: spacing.xs }}>
                  <Text style={[{ fontFamily, color: colors.warning }, typography.bodyBold]}>
                    Cadastro em análise
                  </Text>
                  <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
                    A foto e os documentos serão verificados pela administração.
                  </Text>
                  <AppBadge
                    label={photoStatus === 'approved' ? 'Foto aprovada' : 'Foto em análise'}
                    tone={photoStatus === 'approved' ? 'success' : 'warning'}
                  />
                </View>
              ) : null}

              {status === 'correction_requested' && !initialPhotoCorrection ? (
                <Text style={[{ fontFamily, color: colors.warning }, typography.small]}>
                  {driver.correctionReason || driver.correctionComment
                    ? `O que precisa ser corrigido: ${driver.correctionReason || driver.correctionComment}`
                    : 'A administração solicitou uma correção no seu cadastro.'}
                </Text>
              ) : null}

              {status === 'rejected' ? (
                <View style={{ gap: spacing.xs }}>
                  <Text style={[{ fontFamily, color: colors.danger }, typography.bodyBold]}>
                    Cadastro não aprovado
                  </Text>
                  <Text style={[{ fontFamily, color: colors.text }, typography.small]}>
                    No momento, não foi possível aprovar seu cadastro para operar na DriveLocal.
                  </Text>
                  <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
                    Se acredita que houve um erro, entre em contato com o suporte.
                  </Text>
                </View>
              ) : null}

              {status === 'suspended' ? (
                <View style={{ gap: spacing.xs }}>
                  <Text style={[{ fontFamily, color: colors.danger }, typography.bodyBold]}>
                    Conta suspensa
                  </Text>
                  <Text style={[{ fontFamily, color: colors.text }, typography.small]}>
                    Sua conta está temporariamente bloqueada. Entre em contato com o suporte.
                  </Text>
                </View>
              ) : null}
            </>
          )}
        </AppCard>

        {initialPhotoCorrection ? (
          <PhotoCorrectionCard driver={driver} onRetake={openPhotoCorrection} />
        ) : null}

        {status === 'approved' ? (
          <AppButton title="Ir para o painel" onPress={() => router.replace('/(driver)/driver-home')} />
        ) : null}

        {status === 'correction_requested' && !initialPhotoCorrection ? (
          <>
            <AppButton title="Corrigir dados do cadastro" onPress={() => router.push('/(driver)/profile')} />
            <AppButton
              title="Revisar documentos e reenviar"
              variant="secondary"
              onPress={() => router.push('/(driver)/documents')}
            />
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
              O reenvio é feito na tela de documentos, depois que todos os itens obrigatórios estiverem válidos.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
