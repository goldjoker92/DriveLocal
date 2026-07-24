// Admin drivers list (route "/(admin)/drivers").
// Filterable, bounded admin view with direct access to profile-photo review.

import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppBadge from '../../components/AppBadge';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { driverPhotoStatus } from '../../constants/driverPhoto';
import { auth, db } from '../../config/firebase';
import { getAllDrivers } from '../../services/driverService';
import {
  VERIFICATION_STATUS,
  verificationLabel,
  verificationTone,
  documentsLabel,
} from '../../constants/driverStatuses';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';
import { logDriverPhotoEvent } from '../../utils/driverPhotoLog';

const TABS = [
  { key: VERIFICATION_STATUS.PENDING_REVIEW, label: 'Em análise' },
  { key: VERIFICATION_STATUS.APPROVED, label: 'Aprovados' },
  { key: VERIFICATION_STATUS.CORRECTION_REQUESTED, label: 'Correção' },
  { key: VERIFICATION_STATUS.REJECTED, label: 'Recusados' },
  { key: VERIFICATION_STATUS.SUSPENDED, label: 'Suspensos' },
  { key: 'all', label: 'Todos' },
];

function formatDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function'
    ? value.toDate()
    : value instanceof Date
      ? value
      : null;
  if (!date) return null;
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function driverName(driver) {
  return driver.fullName || driver.displayName || driver.email || driver.id;
}

function photoBadge(status) {
  const map = {
    approved: { label: 'Foto aprovada', tone: 'success' },
    pending: { label: 'Foto em análise', tone: 'warning' },
    rejected: { label: 'Foto a corrigir', tone: 'danger' },
    missing: { label: 'Sem foto', tone: 'neutral' },
  };
  return map[status] || map.missing;
}

function DriverCard({ driver, onPress, onPhotoPress }) {
  const vehicle = driver.vehicleType
    ? VEHICLE_LABELS_PT_BR[driver.vehicleType] || driver.vehicleType
    : '—';
  const brandModel = [driver.vehicleBrand, driver.vehicleModel].filter(Boolean).join(' ') || '—';
  const plate = driver.vehiclePlate || driver.plate || '—';
  const submitted = formatDate(driver.submittedAt);
  const photoStatus = driverPhotoStatus(driver);
  const photo = photoBadge(photoStatus);
  const photoNeedsAction = photoStatus === 'pending' || photoStatus === 'rejected';

  return (
    <AppCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
        <Text style={[{ fontFamily, color: colors.text, flexShrink: 1 }, typography.bodyBold]}>
          {driverName(driver)}
        </Text>
        <AppBadge
          label={verificationLabel(driver.verificationStatus)}
          tone={verificationTone(driver.verificationStatus)}
        />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        <AppBadge label={photo.label} tone={photo.tone} />
        {photoNeedsAction ? <AppBadge label="Ação necessária" tone="warning" /> : null}
      </View>

      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        {vehicle} · {brandModel}
      </Text>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>Placa: {plate}</Text>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        {documentsLabel(driver.documentsStatus)}
      </Text>
      {submitted ? (
        <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
          Enviado em {submitted}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs }}>
        <Pressable onPress={onPress} hitSlop={8}>
          <Text style={[{ fontFamily, color: colors.primary }, typography.bodyBold]}>Ver cadastro ›</Text>
        </Pressable>
        <Pressable onPress={onPhotoPress} hitSlop={8}>
          <Text
            style={[
              { fontFamily, color: photoNeedsAction ? colors.warning : colors.primary },
              typography.bodyBold,
            ]}
          >
            {photoStatus === 'pending' ? 'Revisar foto ›' : 'Ver foto ›'}
          </Text>
        </Pressable>
      </View>
    </AppCard>
  );
}

export default function DriversList() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const initialStatus = typeof params.status === 'string' ? params.status : 'all';
  const [activeTab, setActiveTab] = useState(initialStatus);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const uid = auth.currentUser?.uid;
    console.log('[ADMIN] guard check drivers uid=', uid);
    if (!uid) {
      router.replace('/(auth)/login');
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
  }, [router]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getAllDrivers()
      .then((list) => {
        if (!active) return;
        setDrivers(list);
        setError('');
      })
      .catch((loadError) => {
        console.log('[ADMIN] drivers list error', loadError?.message || 'unknown');
        if (active) setError('Não foi possível carregar os motoristas.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (activeTab === 'all') return drivers;
    return drivers.filter((driver) => driver.verificationStatus === activeTab);
  }, [drivers, activeTab]);

  function openDetail(driverId) {
    console.log('[ADMIN] open driver-detail driverId=', driverId);
    router.push({ pathname: '/(admin)/driver-detail', params: { driverId } });
  }

  function openPhoto(driver) {
    logDriverPhotoEvent('admin.list_open_review', {
      driverId: driver.id,
      status: driverPhotoStatus(driver),
      hasCandidate: Boolean(driver.driverPhotoCandidatePublicPath),
      hasApprovedPhoto: Boolean(driver.driverPhotoPublicPath),
    });
    router.push({ pathname: '/(admin)/driver-photo-review', params: { driverId: driver.id } });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Motoristas" subtitle="Horizonte / CE" onBack={() => router.back()} />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {TABS.map((tab) => {
            const selected = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={{
                  paddingVertical: spacing.xs,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.background,
                }}
              >
                <Text
                  style={[
                    { fontFamily, color: selected ? colors.white : colors.textMuted },
                    typography.small,
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
        ) : loading ? (
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>Carregando…</Text>
        ) : filtered.length === 0 ? (
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>
            Nenhum motorista nesta categoria.
          </Text>
        ) : (
          filtered.map((driver) => (
            <DriverCard
              key={driver.id}
              driver={driver}
              onPress={() => openDetail(driver.id)}
              onPhotoPress={() => openPhoto(driver)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
