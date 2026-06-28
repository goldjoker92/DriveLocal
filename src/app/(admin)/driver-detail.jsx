// ============================================================
// Driver detail (route "/driver-detail"). Iteration 1B.
// Vue admin complète : identité, véhicule, statuts, doublons, documents,
// historique et actions approuver/rejeter. Garde admin au montage.
// ============================================================

import { useEffect, useState } from 'react';
import { ScrollView, View, Text, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing, radius } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { VEHICLE_LABELS_PT_BR, VEHICLE_MOTO } from '../../constants/vehicleTypes';
import { auth, db } from '../../config/firebase';
import { getDriver, approveDriver, rejectDriver } from '../../services/driverService';
import { formatCPF } from '../../utils/validation';

// Documents affichables avec leur champ URL sur le document driver.
const DOC_LINKS = [
  { label: '📷 Selfie', field: 'selfieUrl' },
  { label: '📷 CNH frente', field: 'cnhFrenteUrl' },
  { label: '📷 CNH verso', field: 'cnhVersoUrl' },
  { label: '📷 CRLV', field: 'crlvUrl' },
  { label: '📷 Foto do veículo', field: 'vehiclePhotoUrl' },
  { label: '📷 Certificado Motofretista', field: 'motofreteUrl', motoOnly: true },
];

// Formate un Timestamp/Date en "28/06/2026 às 14:33".
function formatDateTime(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : value instanceof Date ? value : null;
  if (!date) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} às ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Variante courte "28/06/2026 14:33" pour l'historique.
function formatShort(value) {
  if (!value) return '—';
  const date = typeof value.toDate === 'function' ? value.toDate() : value instanceof Date ? value : null;
  if (!date) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
    console.log('[ADMIN] guard check uid=', uid);
    if (!uid) {
      router.replace('/(auth)/login');
      return undefined;
    }
    getDoc(doc(db, 'admins', uid))
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          console.log('[ADMIN] guard failed -> /(auth)/login');
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

  // Charge le document driver.
  useEffect(() => {
    let active = true;
    if (!driverId) {
      setLoading(false);
      return undefined;
    }
    getDriver(driverId)
      .then((data) => {
        if (active) setDriver(data);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [driverId]);

  // Approbation.
  async function handleApprove() {
    setError('');
    setSubmitting(true);
    try {
      const adminUid = auth.currentUser && auth.currentUser.uid;
      console.log('[ADMIN] approveDriver driverId=', driverId);
      await approveDriver(driverId, adminUid);
      router.replace('/(admin)/drivers-pending');
    } catch (e) {
      console.log('[ADMIN] approveDriver error', e.message);
      setError('Não foi possível aprovar o motorista.');
      setSubmitting(false);
    }
  }

  // Rejet avec motif.
  async function handleReject() {
    setError('');
    setSubmitting(true);
    try {
      const adminUid = auth.currentUser && auth.currentUser.uid;
      console.log('[ADMIN] rejectDriver driverId=', driverId, 'reason=', reason.trim());
      await rejectDriver(driverId, adminUid, reason.trim());
      router.replace('/(admin)/drivers-pending');
    } catch (e) {
      console.log('[ADMIN] rejectDriver error', e.message);
      setError('Não foi possível rejeitar o motorista.');
      setSubmitting(false);
    }
  }

  // Ouvre l'URL d'un document.
  function openDoc(url) {
    if (url) Linking.openURL(url);
  }

  const isMoto = driver && driver.vehicleType === VEHICLE_MOTO;
  const history = (driver && Array.isArray(driver.statusHistory) ? [...driver.statusHistory] : []).sort(
    (a, b) => toMillis(a.changedAt) - toMillis(b.changedAt)
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Detalhe do motorista" onBack={() => router.back()} />

        {loading ? (
          <AppCard>
            <AdminTableRow label="Carregando..." />
          </AppCard>
        ) : !driver ? (
          <AppCard>
            <AdminTableRow label="Motorista não encontrado" />
          </AppCard>
        ) : (
          <>
            {/* Alerte doublon */}
            {driver.duplicateCheckStatus === 'warning' ? (
              <View
                style={{
                  backgroundColor: colors.warningBg,
                  borderColor: colors.warning,
                  borderWidth: 1,
                  borderRadius: radius.md,
                  padding: spacing.md,
                }}
              >
                <Text style={[{ fontFamily, color: colors.warning }, typography.bodyBold]}>
                  Atenção: possível duplicata detectada. Verifique CPF, telefone, placa e chave Pix.
                </Text>
              </View>
            ) : null}

            {/* IDENTIFICAÇÃO */}
            <AppCard>
              <SectionTitle>IDENTIFICAÇÃO</SectionTitle>
              <AdminTableRow label="ID técnico" value={driver.uid || driverId} />
              {driver.approvalNumber ? (
                <AdminTableRow label="Número de aprovação" value={`#${driver.approvalNumber}`} />
              ) : null}
              <AdminTableRow label="Inscrito em" value={formatDateTime(driver.createdAt) || '—'} />
              <AdminTableRow label="Enviado em" value={formatDateTime(driver.submittedAt) || '—'} />
            </AppCard>

            {/* INFORMAÇÕES PESSOAIS */}
            <AppCard>
              <SectionTitle>INFORMAÇÕES PESSOAIS</SectionTitle>
              <AdminTableRow label="Nome" value={driver.fullName || '—'} />
              <AdminTableRow label="E-mail" value={driver.email || '—'} />
              <AdminTableRow label="CPF" value={driver.cpf ? formatCPF(driver.cpf) : '—'} />
              <AdminTableRow label="WhatsApp" value={driver.whatsApp || driver.phone || '—'} />
              <AdminTableRow label="Tipo de chave Pix" value={driver.pixKeyType || '—'} />
              <AdminTableRow label="Chave Pix" value={driver.pixKey || '—'} />
              <AdminTableRow label="Área de serviço" value={driver.serviceAreaId || '—'} />
            </AppCard>

            {/* VEÍCULO */}
            <AppCard>
              <SectionTitle>VEÍCULO</SectionTitle>
              <AdminTableRow
                label="Tipo"
                value={driver.vehicleType ? VEHICLE_LABELS_PT_BR[driver.vehicleType] : '—'}
              />
              <AdminTableRow label="Marca" value={driver.vehicleBrand || '—'} />
              <AdminTableRow label="Modelo" value={driver.vehicleModel || '—'} />
              <AdminTableRow label="Cor" value={driver.vehicleColor || '—'} />
              <AdminTableRow label="Placa" value={driver.vehiclePlate || driver.plate || '—'} />
              <AdminTableRow label="Ano" value={driver.vehicleYear ? String(driver.vehicleYear) : '—'} />
            </AppCard>

            {/* STATUTS */}
            <AppCard>
              <SectionTitle>STATUS</SectionTitle>
              <AdminTableRow label="verificationStatus" value={driver.verificationStatus || '—'} />
              <AdminTableRow label="profileStatus" value={driver.profileStatus || '—'} />
              <AdminTableRow label="vehicleStatus" value={driver.vehicleStatus || '—'} />
              <AdminTableRow label="documentsStatus" value={driver.documentsStatus || '—'} />
              <AdminTableRow label="selfieStatus" value={driver.selfieStatus || '—'} />
              <AdminTableRow label="duplicateCheckStatus" value={driver.duplicateCheckStatus || '—'} />
            </AppCard>

            {/* DOCUMENTS */}
            <AppCard>
              <SectionTitle>DOCUMENTOS</SectionTitle>
              {DOC_LINKS.filter((d) => !d.motoOnly || isMoto).map((d) => {
                const url = driver[d.field];
                return (
                  <AdminTableRow
                    key={d.field}
                    label={d.label}
                    right={
                      url ? (
                        <Pressable onPress={() => openDoc(url)} hitSlop={8}>
                          <Text style={[{ fontFamily, color: colors.primary }, typography.bodyBold]}>Abrir</Text>
                        </Pressable>
                      ) : (
                        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>Não enviado</Text>
                      )
                    }
                  />
                );
              })}
            </AppCard>

            {/* HISTORIQUE */}
            <AppCard>
              <SectionTitle>HISTÓRICO</SectionTitle>
              {history.length === 0 ? (
                <AdminTableRow label="Sem histórico" />
              ) : (
                history.map((h, i) => (
                  <AdminTableRow
                    key={`${h.status}-${i}`}
                    label={`${formatShort(h.changedAt)} — ${h.status}`}
                    value={h.changedBy ? `(${h.changedBy})` : ''}
                  />
                ))
              )}
            </AppCard>

            {/* ACTIONS ADMIN */}
            {error ? (
              <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
            ) : null}
            <AppButton
              title={submitting ? 'Aprovando...' : 'Aprovar motorista'}
              onPress={handleApprove}
              disabled={submitting}
            />
            <AppInput
              label="Motivo da rejeição"
              value={reason}
              onChangeText={setReason}
              placeholder="Descreva o motivo"
            />
            <AppButton
              title={submitting ? 'Rejeitando...' : 'Rejeitar'}
              variant="ghost"
              onPress={handleReject}
              disabled={submitting}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
