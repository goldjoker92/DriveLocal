// ============================================================
// Driver detail (route "/(admin)/driver-detail"). Iteration 1C.
// Vue admin complète : résumé, identité, véhicule, statuts, doublons, documents,
// historique et actions (aprovar / solicitar correção / recusar) selon le statut.
// Garde admin au montage. Toutes les erreurs passent par un message UI.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import AppBadge from '../../components/AppBadge';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing, radius } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';
import { auth, db } from '../../config/firebase';
import {
  getDriver,
  requestDriverCorrection,
  activateDriverSubscription,
  resetDriverSubscription,
} from '../../services/driverService';
import { getPrivateDriverDocumentUrl } from '../../services/storageService';
// Sensitive driver mutations go through secure admin callables (BLOCK 11+12):
// the server derives the admin identity, allocates founder status atomically,
// and guards active-ride safety on suspension. The client sends no adminUid.
import {
  approveDriver,
  rejectDriver,
  suspendDriver,
  reactivateDriver,
} from '../../services/adminService';
import { formatCPF } from '../../utils/validation';
import {
  VERIFICATION_STATUS,
  verificationLabel,
  verificationTone,
} from '../../constants/driverStatuses';
import { showConfirmAlert } from '../../utils/alertUtils';
import {
  driverApprovalErrorReason,
  driverApprovalErrorMessage,
  hasCriminalCertificateForDriverApproval,
  hasPhotoApprovedForDriverApproval,
  requiresDuplicateApprovalReview,
} from '../../utils/adminDriverApproval';
import { requiresCriminalCertificate } from '../../utils/driverDocumentPolicy';

// Documents affichables avec leur champ URL sur le document driver.
const DOC_LINKS = [
  { label: '📷 Selfie', field: 'selfieUrl' },
  { label: '📷 CNH frente', field: 'cnhFrenteUrl' },
  { label: '📷 CNH verso', field: 'cnhVersoUrl' },
  { label: '📷 CRLV', field: 'crlvUrl' },
  { label: '📷 Foto do veículo', field: 'vehiclePhotoUrl' },
  {
    label: '📄 Antecedentes criminais',
    field: 'criminalCertificatePath',
    privatePath: true,
    policyOnly: true,
  },
];

// Formate un Timestamp/Date en "28/06/2026 às 14:33".
function formatDateTime(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : value instanceof Date ? value : null;
  if (!date) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} às ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Qui a fait l'action. On n'expose JAMAIS l'UID technique dans l'UI admin :
// tant qu'il n'y a pas de noms d'admin, on affiche "Admin".
function whoLabel(entry) {
  return entry && (entry.changedBy || entry.reviewedBy) ? 'Admin' : '—';
}

// Millisecondes d'un Timestamp/Date pour le tri.
function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
}

// Titre de section.
function SectionTitle({ children }) {
  return (
    <Text style={[{ fontFamily, color: colors.textMuted, marginTop: spacing.sm }, typography.caption]}>
      {children}
    </Text>
  );
}

// Bandeau d'information (statut en lecture seule).
function InfoBanner({ tone = 'neutral', title, body }) {
  const map = {
    success: { bg: colors.successBg, fg: colors.success },
    warning: { bg: colors.warningBg, fg: colors.warning },
    danger: { bg: colors.dangerBg, fg: colors.danger },
    neutral: { bg: colors.primaryTint, fg: colors.primary },
  };
  const c = map[tone] || map.neutral;
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs }}>
      <Text style={[{ fontFamily, color: c.fg }, typography.bodyBold]}>{title}</Text>
      {body ? <Text style={[{ fontFamily, color: colors.text }, typography.small]}>{body}</Text> : null}
    </View>
  );
}

// Une entrée d'historique, compacte : statut + Por / Data / Motivo.
// Ne rend jamais l'objet brut ni l'UID. `divider` sépare les entrées.
function HistoryItem({ entry, divider }) {
  const line = { fontFamily, color: colors.textMuted };
  return (
    <View
      style={{
        paddingVertical: spacing.sm,
        gap: 2,
        borderTopWidth: divider ? 1 : 0,
        borderTopColor: colors.border,
      }}
    >
      <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
        {verificationLabel(entry.status)}
      </Text>
      <Text style={[line, typography.small]}>Por: {whoLabel(entry)}</Text>
      <Text style={[line, typography.small]}>Data: {formatDateTime(entry.changedAt) || '—'}</Text>
      <Text style={[line, typography.small]}>Motivo: {entry.reason ? entry.reason : '—'}</Text>
    </View>
  );
}

export default function DriverDetail() {
  const router = useRouter();
  const { driverId } = useLocalSearchParams();
  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  // Garde admin : l'utilisateur courant doit exister dans admins/{uid}.
  useEffect(() => {
    let active = true;
    const uid = auth.currentUser && auth.currentUser.uid;
    console.log('[ADMIN_DRIVER_DETAIL] guard check uid=', uid);
    if (!uid) {
      router.replace('/(auth)/login');
      return undefined;
    }
    getDoc(doc(db, 'admins', uid))
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          console.log('[ADMIN_DRIVER_DETAIL] guard failed -> /(auth)/login');
          router.replace('/(auth)/login');
        }
      })
      .catch(() => {
        if (active) router.replace('/(auth)/login');
      });
    return () => {
      active = false;
    };
  }, []);

  // Charge (ou recharge) le document driver.
  const loadDriver = useCallback(() => {
    if (!driverId) {
      setLoading(false);
      return Promise.resolve();
    }
    return getDriver(driverId)
      .then((data) => {
        setDriver(data);
        console.log('[ADMIN_HISTORY] entries=', (data && data.statusHistory ? data.statusHistory.length : 0));
      })
      .catch((e) => {
        console.log('[ADMIN_DRIVER_DETAIL] load error', e.message);
        setError('Não foi possível carregar o motorista.');
      })
      .finally(() => setLoading(false));
  }, [driverId]);

  // Refresh after returning from the photo-review screen so the final approval
  // button immediately reflects the newly approved public photo.
  useFocusEffect(useCallback(() => {
    setLoading(true);
    loadDriver();
  }, [loadDriver]));

  const adminUid = () => auth.currentUser && auth.currentUser.uid;

  function openPhotoReview() {
    setError('');
    console.log('[ADMIN_DRIVER_DETAIL] photo review opened', {
      driverId,
      vehicleType: driver?.vehicleType || null,
      verificationStatus: driver?.verificationStatus || null,
      driverPhotoReviewStatus: driver?.driverPhotoReviewStatus || null,
    });
    router.push({ pathname: '/(admin)/driver-photo-review', params: { driverId } });
  }

  // Approbation — avec confirmation. Aucune commission prélevée ici (règle métier).
  function handleApprove() {
    // The backend requires an approved public photo for both cars and motorcycles.
    // Fail early with an actionable message; the callable repeats this check as
    // the security boundary in case the client state is stale.
    if (!hasPhotoApprovedForDriverApproval(driver, driverId)) {
      console.log('[ADMIN_DRIVER_DETAIL] approval blocked', {
        driverId,
        vehicleType: driver?.vehicleType || null,
        verificationStatus: driver?.verificationStatus || null,
        driverPhotoReviewStatus: driver?.driverPhotoReviewStatus || null,
        reason: 'DRIVER_PHOTO_APPROVAL_REQUIRED',
      });
      setError('Aprove primeiro a foto do motorista.');
      return;
    }
    if (!hasCriminalCertificateForDriverApproval(driver, driverId)) {
      console.log('[ADMIN_DRIVER_DETAIL] approval blocked', {
        driverId,
        vehicleType: driver?.vehicleType || null,
        verificationStatus: driver?.verificationStatus || null,
        criminalCertificateStatus: driver?.criminalCertificateStatus || null,
        reason: 'CRIMINAL_CERTIFICATE_REQUIRED',
      });
      setError('Envie e revise primeiro a certidão de antecedentes criminais.');
      return;
    }
    const duplicateReviewRequired = requiresDuplicateApprovalReview(driver);
    const duplicateOverrideReason = duplicateReviewRequired ? reason.trim() : null;
    if (duplicateReviewRequired && !duplicateOverrideReason) {
      console.log('[ADMIN_DRIVER_DETAIL] approval blocked', {
        driverId,
        vehicleType: driver?.vehicleType || null,
        verificationStatus: driver?.verificationStatus || null,
        driverPhotoReviewStatus: driver?.driverPhotoReviewStatus || null,
        duplicateCheckStatus: driver?.duplicateCheckStatus || null,
        reason: 'DUPLICATE_OVERRIDE_REASON_REQUIRED',
      });
      setError('Revise os dados duplicados e informe o motivo da aprovação manual.');
      return;
    }
    showConfirmAlert({
      title: 'Aprovar motorista?',
      message: duplicateReviewRequired
        ? 'Você confirma que revisou os possíveis dados duplicados e deseja aprovar manualmente este motorista?'
        : 'Este motorista poderá ficar disponível para corridas após aprovação.',
      confirmText: 'Aprovar',
      onConfirm: async () => {
        setError('');
        setSubmitting(true);
        try {
          console.log('[ADMIN_DRIVER_DETAIL] approval requested', {
            driverId,
            vehicleType: driver?.vehicleType || null,
            verificationStatus: driver?.verificationStatus || null,
            driverPhotoReviewStatus: driver?.driverPhotoReviewStatus || null,
            duplicateCheckStatus: driver?.duplicateCheckStatus || null,
            duplicateOverrideProvided: Boolean(duplicateOverrideReason),
          });
          await approveDriver(driverId, duplicateOverrideReason);
          setReason('');
          await loadDriver();
        } catch (e) {
          const failureReason = driverApprovalErrorReason(e);
          console.log('[ADMIN_DRIVER_DETAIL] approval failed', {
            driverId,
            vehicleType: driver?.vehicleType || null,
            verificationStatus: driver?.verificationStatus || null,
            driverPhotoReviewStatus: driver?.driverPhotoReviewStatus || null,
            duplicateCheckStatus: driver?.duplicateCheckStatus || null,
            code: e?.code || null,
            reason: failureReason,
            message: e?.message || 'unknown',
          });
          setError(driverApprovalErrorMessage(e));
          // The backend writes `review_required` during the first failed duplicate
          // scan. Reload so the admin can immediately provide an explicit reason
          // and retry without leaving this screen.
          if (failureReason === 'DUPLICATE_REVIEW_REQUIRED') await loadDriver();
        } finally {
          setSubmitting(false);
        }
      },
    });
  }

  // Demande de correction — nécessite un motif.
  function handleCorrection() {
    const text = reason.trim();
    if (!text) {
      setError('Informe o que precisa ser corrigido.');
      return;
    }
    showConfirmAlert({
      title: 'Solicitar correção',
      message: 'Informe o que precisa ser corrigido. O motorista poderá reenviar.',
      confirmText: 'Solicitar',
      onConfirm: async () => {
        setError('');
        setSubmitting(true);
        try {
          console.log('[ADMIN_DRIVER_DETAIL] correction requested driverId=', driverId, 'reason=', text);
          await requestDriverCorrection(driverId, adminUid(), text);
          setReason('');
          await loadDriver();
        } catch (e) {
          console.log('[ADMIN_DRIVER_DETAIL] correction error', e.message);
          setError('Não foi possível solicitar a correção.');
        } finally {
          setSubmitting(false);
        }
      },
    });
  }

  // Rejet — nécessite un motif, avec confirmation.
  function handleReject() {
    const text = reason.trim();
    if (!text) {
      setError('Informe o motivo da recusa.');
      return;
    }
    showConfirmAlert({
      title: 'Recusar cadastro?',
      message: 'O motorista não poderá receber corridas. Esta ação pode ser revista depois.',
      confirmText: 'Recusar',
      destructive: true,
      onConfirm: async () => {
        setError('');
        setSubmitting(true);
        try {
          console.log('[ADMIN_DRIVER_DETAIL] reject requested driverId=', driverId);
          await rejectDriver(driverId, text);
          setReason('');
          await loadDriver();
        } catch (e) {
          console.log('[ADMIN_DRIVER_DETAIL] reject error', e.message);
          setError('Não foi possível recusar o motorista.');
        } finally {
          setSubmitting(false);
        }
      },
    });
  }

  // Suspensão — motivo obrigatório. O backend recusa com segurança se o motorista
  // tiver uma corrida em andamento (nada é alterado nesse caso).
  function handleSuspend() {
    const text = reason.trim();
    if (!text) {
      setError('Informe o motivo da suspensão.');
      return;
    }
    showConfirmAlert({
      title: 'Suspender motorista?',
      message: 'O motorista deixará de receber corridas. Se houver uma corrida em andamento, a suspensão será recusada até a corrida terminar.',
      confirmText: 'Suspender',
      destructive: true,
      onConfirm: async () => {
        setError('');
        setSubmitting(true);
        try {
          await suspendDriver(driverId, text);
          setReason('');
          await loadDriver();
        } catch (e) {
          const conflict = e && (e.code === 'functions/failed-precondition' || /andamento|active ride/i.test(e.message || ''));
          setError(conflict ? 'Não é possível suspender: o motorista tem uma corrida em andamento.' : 'Não foi possível suspender o motorista.');
        } finally {
          setSubmitting(false);
        }
      },
    });
  }

  // Reativação — restaura o status aprovado. Não coloca o motorista online e não
  // altera o saldo.
  function handleReactivate() {
    showConfirmAlert({
      title: 'Reativar motorista?',
      message: 'O motorista volta a ficar aprovado. Ele NÃO fica online automaticamente e o saldo não é alterado.',
      confirmText: 'Reativar',
      onConfirm: async () => {
        setError('');
        setSubmitting(true);
        try {
          await reactivateDriver(driverId, reason.trim() || null);
          setReason('');
          await loadDriver();
        } catch (e) {
          setError('Não foi possível reativar o motorista.');
        } finally {
          setSubmitting(false);
        }
      },
    });
  }

  // Iteration 2B — admin/dev TEST action. Marks an approved non-founder driver's
  // subscription active (30 days) with 0% commission for 60 days, so #101+
  // ride-eligibility can be tested before real Pix payments exist. No money moves.
  function handleActivateSubscription() {
    showConfirmAlert({
      title: 'Marcar assinatura ativa',
      message: 'Ação de teste do admin: ativa a assinatura por 30 dias e 0% de comissão por 60 dias. Nenhum pagamento real é processado.',
      confirmText: 'Marcar ativa',
      onConfirm: async () => {
        setError('');
        setSubmitting(true);
        try {
          console.log('[ADMIN_DRIVER_DETAIL] activate subscription driverId=', driverId);
          await activateDriverSubscription(driverId);
          await loadDriver();
        } catch (e) {
          console.log('[ADMIN_DRIVER_DETAIL] activate subscription error', e.message);
          setError('Não foi possível marcar a assinatura como ativa.');
        } finally {
          setSubmitting(false);
        }
      },
    });
  }

  // Iteration 2B — admin/dev TEST action. Resets the subscription back to
  // "required" and forces availability offline, to re-test the blocked #101+ state.
  function handleResetSubscription() {
    showConfirmAlert({
      title: 'Resetar assinatura para teste',
      message: 'Ação de teste do admin: volta a assinatura para "obrigatória" e deixa o motorista indisponível.',
      confirmText: 'Resetar',
      destructive: true,
      onConfirm: async () => {
        setError('');
        setSubmitting(true);
        try {
          console.log('[ADMIN_DRIVER_DETAIL] reset subscription driverId=', driverId);
          await resetDriverSubscription(driverId);
          await loadDriver();
        } catch (e) {
          console.log('[ADMIN_DRIVER_DETAIL] reset subscription error', e.message);
          setError('Não foi possível resetar a assinatura.');
        } finally {
          setSubmitting(false);
        }
      },
    });
  }

  // Ouvre l'URL d'un document dans le navigateur (MVP).
  async function openDoc(value, privatePath = false) {
    if (!value) return;
    try {
      const url = privatePath ? await getPrivateDriverDocumentUrl(value) : value;
      await Linking.openURL(url);
    } catch (openError) {
      console.log('[ADMIN_DRIVER_DETAIL] document open failed', {
        privatePath,
        code: openError?.code || openError?.name || 'unknown',
      });
      setError('Não foi possível abrir o documento.');
    }
  }

  const status = driver && driver.verificationStatus;
  const photoApprovedForFinalApproval = hasPhotoApprovedForDriverApproval(driver, driverId);
  const criminalCertificateRequired = requiresCriminalCertificate(driver);
  const criminalCertificateReady = hasCriminalCertificateForDriverApproval(driver, driverId);
  const duplicateReviewRequired = requiresDuplicateApprovalReview(driver);
  // Founder protection (Iteration 2B): founder drivers must show benefit info
  // only — never the subscription test buttons, and their fields stay untouched.
  const isFounder =
    driver && (driver.founderEligible === true || driver.subscriptionStatus === 'free_founder');
  const history = (driver && Array.isArray(driver.statusHistory) ? [...driver.statusHistory] : []).sort(
    (a, b) => toMillis(a.changedAt) - toMillis(b.changedAt)
  );

  // Bloc d'actions selon le statut de vérification.
  function renderActions() {
    if (status === VERIFICATION_STATUS.PENDING_REVIEW) {
      return (
        <>
          {!photoApprovedForFinalApproval ? (
            <>
              <InfoBanner
                tone="warning"
                title="Aprovação da foto necessária"
                body="Revise e aprove a foto pública antes de aprovar o motorista."
              />
              <AppButton
                title="Revisar foto do motorista"
                variant="secondary"
                onPress={openPhotoReview}
                disabled={submitting}
              />
            </>
          ) : null}
          {criminalCertificateRequired && !criminalCertificateReady ? (
            <InfoBanner
              tone="warning"
              title="Certidão de antecedentes necessária"
              body="O motorista desta versão precisa enviar a certidão antes da aprovação."
            />
          ) : null}
          {duplicateReviewRequired ? (
            <InfoBanner
              tone="warning"
              title="Revisão de possível duplicata"
              body="Confira CPF, telefone, placa, chave Pix e e-mail. Para aprovar, registre abaixo o motivo da decisão manual."
            />
          ) : null}
          <AppInput
            label={duplicateReviewRequired
              ? 'Motivo da aprovação manual, correção ou recusa'
              : 'Motivo (para correção ou recusa)'}
            value={reason}
            onChangeText={setReason}
            placeholder="Descreva o que precisa ser corrigido ou o motivo da recusa"
          />
          <AppButton
            title={submitting ? 'Processando…' : 'Aprovar motorista'}
            onPress={handleApprove}
            disabled={submitting
              || !photoApprovedForFinalApproval
              || !criminalCertificateReady
              || (duplicateReviewRequired && !reason.trim())}
          />
          <AppButton
            title={submitting ? 'Processando…' : 'Solicitar correção'}
            variant="secondary"
            onPress={handleCorrection}
            disabled={submitting}
          />
          <AppButton
            title={submitting ? 'Processando…' : 'Recusar'}
            variant="ghost"
            onPress={handleReject}
            disabled={submitting}
          />
        </>
      );
    }
    if (status === VERIFICATION_STATUS.CORRECTION_REQUESTED) {
      return (
        <InfoBanner
          tone="warning"
          title="Correção solicitada"
          body={
            driver.correctionReason
              ? `Aguardando novo envio do motorista. Motivo: ${driver.correctionReason}`
              : 'Aguardando novo envio do motorista.'
          }
        />
      );
    }
    if (status === VERIFICATION_STATUS.APPROVED) {
      return (
        <>
          <InfoBanner
            tone="success"
            title="Motorista aprovado"
            body={driver.approvalNumber ? `Número de aprovação #${driver.approvalNumber}.` : null}
          />
          {isFounder ? (
            // Founder: benefit info only. No subscription activation button here,
            // and the subscription/founder fields are never overwritten.
            <InfoBanner
              tone="neutral"
              title="Motorista Fundador"
              body="Assinatura e comissão gratuitas durante o período fundador. Não é necessário ativar a assinatura."
            />
          ) : (
            // Approved non-founder (#101+): admin/dev test controls for subscription.
            <>
              <AppButton
                title={submitting ? 'Processando…' : 'Marcar assinatura ativa'}
                onPress={handleActivateSubscription}
                disabled={submitting}
              />
              <AppButton
                title={submitting ? 'Processando…' : 'Resetar assinatura para teste'}
                variant="ghost"
                onPress={handleResetSubscription}
                disabled={submitting}
              />
            </>
          )}
          <AppInput
            label="Motivo da suspensão"
            value={reason}
            onChangeText={setReason}
            placeholder="Descreva o motivo (obrigatório para suspender)"
          />
          <AppButton
            title={submitting ? 'Processando…' : 'Suspender motorista'}
            variant="ghost"
            onPress={handleSuspend}
            disabled={submitting}
          />
        </>
      );
    }
    if (status === VERIFICATION_STATUS.REJECTED) {
      return (
        <InfoBanner
          tone="danger"
          title="Cadastro recusado"
          body={driver.rejectionReason ? `Motivo: ${driver.rejectionReason}` : null}
        />
      );
    }
    if (status === VERIFICATION_STATUS.SUSPENDED) {
      return (
        <>
          <InfoBanner
            tone="danger"
            title="Motorista suspenso"
            body={driver.suspendedReason ? `Motivo: ${driver.suspendedReason}` : null}
          />
          <AppButton
            title={submitting ? 'Processando…' : 'Reativar motorista'}
            onPress={handleReactivate}
            disabled={submitting}
          />
        </>
      );
    }
    // draft (ou statut inconnu) : pas d'action possible.
    return (
      <InfoBanner
        tone="neutral"
        title="Cadastro em rascunho"
        body="O motorista ainda não enviou o cadastro para análise."
      />
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Detalhe do motorista" onBack={() => router.back()} />

        {loading ? (
          <AppCard>
            <AdminTableRow label="Carregando…" />
          </AppCard>
        ) : !driver ? (
          <AppCard>
            <AdminTableRow label="Motorista não encontrado" />
          </AppCard>
        ) : (
          <>
            {/* Alerte doublon */}
            {driver.duplicateCheckStatus === 'warning' ? (
              <InfoBanner
                tone="warning"
                title="Atenção: possível duplicata detectada."
                body="Verifique CPF, telefone, placa e chave Pix."
              />
            ) : null}

            {/* RESUMO */}
            <AppCard>
              <SectionTitle>RESUMO</SectionTitle>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
                <Text style={[{ fontFamily, color: colors.text, flexShrink: 1 }, typography.h3]}>
                  {driver.fullName || driver.displayName || driver.email || driverId}
                </Text>
                <AppBadge label={verificationLabel(status)} tone={verificationTone(status)} />
              </View>
              <AdminTableRow label="Área de serviço" value={driver.serviceAreaId || '—'} />
              <AdminTableRow label="Enviado em" value={formatDateTime(driver.submittedAt) || '—'} />
              <AdminTableRow label="Verificação de duplicata" value={driver.duplicateCheckStatus || '—'} />
            </AppCard>

            {/* IDENTIDADE */}
            <AppCard>
              <SectionTitle>IDENTIDADE</SectionTitle>
              <AdminTableRow label="Nome" value={driver.fullName || '—'} />
              <AdminTableRow label="CPF" value={driver.cpf ? formatCPF(driver.cpf) : '—'} />
              <AdminTableRow label="WhatsApp" value={driver.whatsApp || driver.phone || '—'} />
              <AdminTableRow label="E-mail" value={driver.email || '—'} />
              <AdminTableRow label="Tipo de chave Pix" value={driver.pixKeyType || '—'} />
              <AdminTableRow label="Chave Pix" value={driver.pixKey || '—'} />
            </AppCard>

            {/* VEÍCULO */}
            <AppCard>
              <SectionTitle>VEÍCULO</SectionTitle>
              <AdminTableRow
                label="Tipo"
                value={driver.vehicleType ? VEHICLE_LABELS_PT_BR[driver.vehicleType] || driver.vehicleType : '—'}
              />
              <AdminTableRow label="Marca" value={driver.vehicleBrand || '—'} />
              <AdminTableRow label="Modelo" value={driver.vehicleModel || '—'} />
              <AdminTableRow label="Cor" value={driver.vehicleColor || '—'} />
              <AdminTableRow label="Placa" value={driver.vehiclePlate || driver.plate || '—'} />
              <AdminTableRow label="Ano" value={driver.vehicleYear ? String(driver.vehicleYear) : '—'} />
            </AppCard>

            {/* STATUS (détail technique) */}
            <AppCard>
              <SectionTitle>STATUS</SectionTitle>
              <AdminTableRow label="verificationStatus" value={status || '—'} />
              <AdminTableRow label="profileStatus" value={driver.profileStatus || '—'} />
              <AdminTableRow label="vehicleStatus" value={driver.vehicleStatus || '—'} />
              <AdminTableRow label="documentsStatus" value={driver.documentsStatus || '—'} />
              <AdminTableRow label="selfieStatus" value={driver.selfieStatus || '—'} />
              <AdminTableRow label="duplicateCheckStatus" value={driver.duplicateCheckStatus || '—'} />
              <AdminTableRow
                label="Política de documentos"
                value={criminalCertificateRequired ? 'Certidão criminal v1' : 'Legado — sem bloqueio retroativo'}
              />
              {criminalCertificateRequired ? (
                <AdminTableRow
                  label="criminalCertificateStatus"
                  value={driver.criminalCertificateStatus || 'missing'}
                />
              ) : null}
            </AppCard>

            {/* ASSINATURA / OPERAÇÃO — bloc compact (Iteration 2B). */}
            <AppCard>
              <SectionTitle>ASSINATURA / OPERAÇÃO</SectionTitle>
              <AdminTableRow label="Assinatura" value={driver.subscriptionStatus || '—'} />
              <AdminTableRow label="Expira em" value={formatDateTime(driver.subscriptionExpiresAt) || '—'} />
              <AdminTableRow label="Comissão 0% até" value={formatDateTime(driver.commissionFreeUntil) || '—'} />
              <AdminTableRow
                label="Pode receber corridas"
                value={driver.canReceiveRides === true ? 'Sim' : 'Não'}
              />
              <AdminTableRow label="Motivo" value={driver.canReceiveRidesReason || '—'} />
              <AdminTableRow label="Carteira" value={driver.walletStatus || '—'} />
            </AppCard>

            {/* DOCUMENTOS */}
            <AppCard>
              <SectionTitle>DOCUMENTOS</SectionTitle>
              {DOC_LINKS.filter((d) => !d.policyOnly || criminalCertificateRequired).map((d) => {
                const value = driver[d.field];
                return (
                  <AdminTableRow
                    key={d.field}
                    label={d.label}
                    right={
                      value ? (
                        <Pressable onPress={() => openDoc(value, d.privatePath)} hitSlop={8}>
                          <Text style={[{ fontFamily, color: colors.primary }, typography.bodyBold]}>
                            Ver documento
                          </Text>
                        </Pressable>
                      ) : (
                        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>Não enviado</Text>
                      )
                    }
                  />
                );
              })}
            </AppCard>

            {/* HISTÓRICO — jamais d'objet brut ni d'UID; entrées compactes. */}
            <AppCard>
              <SectionTitle>HISTÓRICO</SectionTitle>
              {history.length === 0 ? (
                <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
                  Nenhum histórico ainda.
                </Text>
              ) : (
                history.map((h, i) => (
                  <HistoryItem key={`${h.status}-${i}`} entry={h} divider={i > 0} />
                ))
              )}
            </AppCard>

            {/* AÇÕES ADMIN */}
            <SectionTitle>AÇÕES</SectionTitle>
            {error ? (
              <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
            ) : null}
            {renderActions()}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
