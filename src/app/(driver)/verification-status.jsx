// Driver verification status (route "/verification-status"). Iteration 1B + 2A.
//
// Real-time listener on drivers/{uid}. Iteration 2A behaviour:
//   - approved            -> show "Motorista aprovado" + "Ir para o painel"
//                            (no brutal auto-redirect; the driver taps to enter)
//   - pending_review      -> waiting message
//   - correction_requested-> show reason + "Corrigir cadastro" / "Reenviar para análise"
//   - rejected            -> generic message only (never the internal reason)
//   - suspended           -> blocked message
//
// Business principle: the admin decision on drivers/{uid} is the source of truth.

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
import { auth, db } from '../../config/firebase';
import { submitForReview } from '../../services/driverService';

// PT-BR labels for the persistent verification statuses.
const STATUS_LABELS_PT_BR = {
  draft: 'Cadastro em andamento',
  pending_review: 'Aguardando aprovação',
  approved: 'Motorista aprovado',
  correction_requested: 'Correção solicitada',
  rejected: 'Cadastro recusado',
  suspended: 'Cadastro suspenso',
};

// Maps a verification status to the colored badge tone.
function badgeStatus(status) {
  if (status === 'approved') return 'online';
  if (status === 'pending_review' || status === 'correction_requested') return 'pending';
  return 'offline';
}

// Formate un Timestamp Firestore / Date en "28/06/2026 às 14:52".
function formatDateTime(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : value instanceof Date ? value : null;
  if (!date) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} às ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function VerificationStatus() {
  const router = useRouter();
  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [actionError, setActionError] = useState('');

  // Écoute en temps réel le document driver. On NE redirige PAS brutalement à
  // l'approbation : le chauffeur voit "Motorista aprovado" puis appuie sur
  // "Ir para o painel".
  useEffect(() => {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      setLoading(false);
      return undefined;
    }
    const unsubscribe = onSnapshot(
      doc(db, 'drivers', uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        setDriver(data);
        setLoading(false);
        console.log('[DRIVER_STATUS] verificationStatus=', data && data.verificationStatus);
      },
      (e) => {
        console.log('[DRIVER_STATUS] listener error', e.message);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const status = driver && driver.verificationStatus;
  const submittedAtLabel = driver ? formatDateTime(driver.submittedAt) : null;

  // Reenvia o cadastro para análise (volta para pending_review). O listener
  // atualiza a tela automaticamente.
  async function handleResend() {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) return;
    setActionError('');
    setResending(true);
    try {
      console.log('[DRIVER_STATUS] resubmitting for review');
      await submitForReview(uid);
    } catch (e) {
      console.log('[DRIVER_STATUS] resubmit error', e.message);
      setActionError('Não foi possível reenviar para análise. Tente novamente.');
    } finally {
      setResending(false);
    }
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
              {submittedAtLabel ? (
                <AdminTableRow label="Enviado em" value={submittedAtLabel} />
              ) : null}

              {/* Aprovado : mensagem positiva, sem redirecionamento automático. */}
              {status === 'approved' ? (
                <Text style={[{ fontFamily, color: colors.success }, typography.small]}>
                  Seu cadastro foi aprovado. Bem-vindo à DriveLocal!
                </Text>
              ) : null}

              {/* Correção solicitada : mostra o motivo (se houver). */}
              {status === 'correction_requested' ? (
                <Text style={[{ fontFamily, color: colors.warning }, typography.small]}>
                  {driver.correctionReason || driver.correctionComment
                    ? `O que precisa ser corrigido: ${driver.correctionReason || driver.correctionComment}`
                    : 'A administração solicitou uma correção no seu cadastro.'}
                </Text>
              ) : null}

              {/* Recusado : mensagem genérica. Nunca expor o motivo interno. */}
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

              {/* Suspenso : conta bloqueada. */}
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

        {/* Ações por status. */}
        {status === 'approved' ? (
          <AppButton
            title="Ir para o painel"
            onPress={() => router.replace('/(driver)/driver-home')}
          />
        ) : null}

        {status === 'correction_requested' ? (
          <>
            <AppButton
              title="Corrigir cadastro"
              onPress={() => router.push('/(driver)/profile')}
            />
            <AppButton
              title={resending ? 'Reenviando…' : 'Reenviar para análise'}
              variant="secondary"
              onPress={handleResend}
              disabled={resending}
            />
            {actionError ? (
              <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{actionError}</Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
