// Admin driver-wallet overview (route "/(admin)/wallets").
// Reads only driver-owned balance aggregates already present on drivers/{uid}; raw
// wallet transactions and payment requests remain server-only.

import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppBadge from '../../components/AppBadge';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { WALLET_FALLBACK_LOW_THRESHOLD_CENTS } from '../../constants/walletRules';
import { auth, db } from '../../config/firebase';
import { getAllDrivers } from '../../services/driverService';
import { formatBRL } from '../../utils/format';
import { resolveCommercialPolicy } from '../../utils/commercialPolicy';

function safeCentavos(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function moneyLabel(value) {
  const amount = safeCentavos(value);
  return amount == null ? 'Não inicializado' : formatBRL(amount);
}

function driverName(driver) {
  return driver.fullName || driver.displayName || driver.email || 'Motorista sem nome';
}

function walletState(driver, nowMs = Date.now()) {
  const policy = resolveCommercialPolicy(driver, nowMs);
  const available = safeCentavos(driver.walletAvailableCentavos);
  if (available == null) return { label: 'Não inicializada', tone: 'neutral' };
  if (policy.freePeriodActive) return { label: 'Comissão 0%', tone: 'success' };
  if (available <= WALLET_FALLBACK_LOW_THRESHOLD_CENTS) {
    return { label: 'Saldo baixo', tone: 'warning' };
  }
  return { label: 'Operacional', tone: 'success' };
}

function DriverWalletCard({ driver }) {
  const state = walletState(driver);
  return (
    <AppCard>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: spacing.sm,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
            {driverName(driver)}
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
            {driver.vehicleType === 'moto' ? 'Moto' : driver.vehicleType === 'car' ? 'Carro' : 'Veículo não informado'}
          </Text>
        </View>
        <AppBadge label={state.label} tone={state.tone} />
      </View>

      <AdminTableRow
        label="Saldo disponível"
        value={moneyLabel(driver.walletAvailableCentavos)}
      />
      <AdminTableRow
        label="Saldo reservado"
        value={moneyLabel(driver.walletHeldCentavos)}
      />
      <AdminTableRow
        label="Saldo total"
        value={moneyLabel(driver.walletBalanceCentavos)}
      />
    </AppCard>
  );
}

export default function Wallets() {
  const router = useRouter();
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const uid = auth.currentUser?.uid;
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

    getAllDrivers()
      .then((list) => {
        if (!active) return;
        setDrivers(list);
        setError('');
        console.info('[ADMIN_WALLET] overview.loaded', {
          scope: 'admin_wallet',
          event: 'overview.loaded',
          driverCount: list.length,
          atMs: Date.now(),
        });
      })
      .catch((loadError) => {
        if (!active) return;
        console.warn('[ADMIN_WALLET] overview.failed', {
          scope: 'admin_wallet',
          event: 'overview.failed',
          reason: loadError?.code || loadError?.message || 'unknown',
          atMs: Date.now(),
        });
        setError('Não foi possível carregar as carteiras dos motoristas.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [router]);

  const orderedDrivers = useMemo(
    () => [...drivers].sort((left, right) => driverName(left).localeCompare(driverName(right), 'pt-BR')),
    [drivers]
  );

  const initializedCount = useMemo(
    () => drivers.filter((driver) => (
      safeCentavos(driver.walletBalanceCentavos) != null
      && safeCentavos(driver.walletAvailableCentavos) != null
      && safeCentavos(driver.walletHeldCentavos) != null
    )).length,
    [drivers]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Carteiras" subtitle="Saldos reais dos motoristas" onBack={() => router.back()} />

        <AppCard>
          <AdminTableRow label="Motoristas" value={String(drivers.length)} />
          <AdminTableRow label="Carteiras inicializadas" value={String(initializedCount)} />
        </AppCard>

        {error ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
        ) : loading ? (
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>Carregando carteiras…</Text>
        ) : orderedDrivers.length === 0 ? (
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>
            Nenhum motorista cadastrado.
          </Text>
        ) : (
          orderedDrivers.map((driver) => <DriverWalletCard key={driver.id} driver={driver} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
