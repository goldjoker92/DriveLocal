// Driver verification status (route "/verification-status"). Iteration 1B.
// Real-time listener on drivers/{uid}: when status becomes "approved" the driver
// is redirected automatically; "rejected" shows the admin reason.

import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import DriverStatusBadge from '../../components/DriverStatusBadge';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth, db } from '../../config/firebase';

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

  // Écoute en temps réel le document driver.
  useEffect(() => {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      setLoading(false);
      return undefined;
    }
    const unsubscribe = onSnapshot(doc(db, 'drivers', uid), (snap) => {
      const data = snap.exists() ? snap.data() : null;
      setDriver(data);
      setLoading(false);
      // Redirection automatique dès l'approbation.
      if (data && data.verificationStatus === 'approved') {
        console.log('[VERIFICATION_STATUS] status changed to approved -> redirecting');
        router.replace('/(driver)/driver-home');
      }
    });
    return () => unsubscribe();
  }, []);

  const status = driver && driver.verificationStatus;
  const submittedAtLabel = driver ? formatDateTime(driver.submittedAt) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Status da verificação" onBack={() => router.back()} />
        <AppCard>
          {loading ? (
            <AdminTableRow label="Carregando..." />
          ) : !driver ? (
            <AdminTableRow label="Cadastro não encontrado" />
          ) : (
            <>
              <DriverStatusBadge status={badgeStatus(status)} />
              <AdminTableRow label="Status" value={STATUS_LABELS_PT_BR[status] || status} />
              {submittedAtLabel ? (
                <AdminTableRow label="Enviado em" value={submittedAtLabel} />
              ) : null}
              {status === 'rejected' && driver.rejectionReason ? (
                <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>
                  {driver.rejectionReason}
                </Text>
              ) : null}
              {status === 'correction_requested' ? (
                <Text style={[{ fontFamily, color: colors.warning }, typography.small]}>
                  {driver.correctionReason
                    ? `O que precisa ser corrigido: ${driver.correctionReason}`
                    : 'A administração solicitou uma correção no seu cadastro.'}
                </Text>
              ) : null}
            </>
          )}
        </AppCard>
        {status === 'approved' ? (
          <AppButton
            title="Ir para o painel do motorista"
            onPress={() => router.replace('/(driver)/driver-home')}
          />
        ) : null}
        {status === 'correction_requested' ? (
          <AppButton
            title="Revisar e reenviar documentos"
            onPress={() => router.replace('/(driver)/documents')}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
