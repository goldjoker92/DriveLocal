// ============================================================
// Admin drivers list (route "/(admin)/drivers").
// Iteration 1C — filterable list of drivers by verificationStatus.
//
// Accepts an optional ?status= param (from the dashboard KPI tiles) to preselect
// a tab. "all" (or missing) shows every driver. Data is fetched once with
// getAllDrivers() (admin-only per Firestore rules) and filtered client-side, so
// no composite index is required. Errors are shown as UI, never a red screen.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppBadge from '../../components/AppBadge';
import { colors } from '../../constants/colors';
import { spacing, radius } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth, db } from '../../config/firebase';
import { getAllDrivers } from '../../services/driverService';
import {
  VERIFICATION_STATUS,
  verificationLabel,
  verificationTone,
  documentsLabel,
} from '../../constants/driverStatuses';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';

// Filter tabs. "all" is a virtual value (no status filter).
const TABS = [
  { key: VERIFICATION_STATUS.PENDING_REVIEW, label: 'Em análise' },
  { key: VERIFICATION_STATUS.APPROVED, label: 'Aprovados' },
  { key: VERIFICATION_STATUS.CORRECTION_REQUESTED, label: 'Correção' },
  { key: VERIFICATION_STATUS.REJECTED, label: 'Recusados' },
  { key: VERIFICATION_STATUS.SUSPENDED, label: 'Suspensos' },
  { key: 'all', label: 'Todos' },
];

// Formats a Firestore Timestamp/Date as "28/06/2026".
function formatDate(value) {
  if (!value) return null;
  const date =
    typeof value.toDate === 'function' ? value.toDate() : value instanceof Date ? value : null;
  if (!date) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function driverName(d) {
  return d.fullName || d.displayName || d.email || d.id;
}

// One driver card in the list.
function DriverCard({ driver, onPress }) {
  const vehicle = driver.vehicleType ? VEHICLE_LABELS_PT_BR[driver.vehicleType] || driver.vehicleType : '—';
  const brandModel = [driver.vehicleBrand, driver.vehicleModel].filter(Boolean).join(' ') || '—';
  const plate = driver.vehiclePlate || driver.plate || '—';
  const submitted = formatDate(driver.submittedAt);

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

      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        {vehicle} · {brandModel}
      </Text>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        Placa: {plate}
      </Text>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        {documentsLabel(driver.documentsStatus)}
      </Text>
      {submitted ? (
        <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
          Enviado em {submitted}
        </Text>
      ) : null}

      <Pressable onPress={onPress} hitSlop={8} style={{ alignSelf: 'flex-start', marginTop: spacing.xs }}>
        <Text style={[{ fontFamily, color: colors.primary }, typography.bodyBold]}>Ver cadastro ›</Text>
      </Pressable>
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

  // Garde admin : l'utilisateur courant doit exister dans admins/{uid}.
  useEffect(() => {
    let active = true;
    const uid = auth.currentUser && auth.currentUser.uid;
    console.log('[ADMIN] guard check drivers uid=', uid);
    if (!uid) {
      router.replace('/(auth)/login');
      return undefined;
    }
    getDoc(doc(db, 'admins', uid))
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          console.log('[ADMIN] guard failed drivers -> /(auth)/login');
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

  // Fetch all drivers once; filter client-side by tab.
  useEffect(() => {
    let active = true;
    setLoading(true);
    getAllDrivers()
      .then((list) => {
        if (active) {
          setDrivers(list);
          setError('');
        }
      })
      .catch((e) => {
        console.log('[ADMIN] drivers list error', e.message);
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
    return drivers.filter((d) => d.verificationStatus === activeTab);
  }, [drivers, activeTab]);

  function openDetail(driverId) {
    console.log('[ADMIN] open driver-detail driverId=', driverId);
    router.push({ pathname: '/(admin)/driver-detail', params: { driverId } });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Motoristas" subtitle="Horizonte / CE" onBack={() => router.back()} />

        {/* Filter tabs */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={{
                  paddingVertical: spacing.xs,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primary : colors.background,
                }}
              >
                <Text
                  style={[
                    { fontFamily, color: active ? colors.white : colors.textMuted },
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
          filtered.map((d) => <DriverCard key={d.id} driver={d} onPress={() => openDetail(d.id)} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
