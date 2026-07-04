// Driver home / cockpit (route "/driver-home"). Iteration 2A.
//
// Reads the signed-in approved driver from Firestore (drivers/{uid}) and shows a
// clean operational cockpit: status, benefits, availability, subscription,
// commission, Saldo DriveLocal and an "em breve" rides section.
//
// Business principle: the admin decision on drivers/{uid} is the source of
// truth. This screen only reads and interprets it. No real rides, dispatch,
// wallet recharge, Pix, IAP or subscription payment happen here (Iteration 2A).

import { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AppBadge from '../../components/AppBadge';
import DriverStatusBadge from '../../components/DriverStatusBadge';
import WalletCard from '../../components/WalletCard';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing, radius } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { FOUNDER_LABEL_PT_BR } from '../../constants/founderOfferRules';
import { WALLET_FALLBACK_LOW_THRESHOLD_CENTS } from '../../constants/walletRules';
import { auth } from '../../config/firebase';
import { getDriver, setDriverAvailability } from '../../services/driverService';
import { isFounderCommissionFreeActive } from '../../services/founderService';
import {
  AVAILABILITY,
  formatDateBR,
  isFounderDriver,
  founderNumberLabel,
  commissionFreeUntilMs,
  subscriptionFreeUntilMs,
  benefitWarning,
  rideBlockReasonLabel,
  deriveEligibility,
  subscriptionDisplay,
  commissionDisplay,
} from '../../utils/driverCockpit';

// Section title inside a card (matches the admin console wording style).
function SectionTitle({ children }) {
  return (
    <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>{children}</Text>
  );
}

// Plain body line, muted by default.
function Line({ children, tone = 'muted' }) {
  const color =
    tone === 'text' ? colors.text
    : tone === 'success' ? colors.success
    : tone === 'warning' ? colors.warning
    : colors.textMuted;
  return <Text style={[{ fontFamily, color }, typography.small]}>{children}</Text>;
}

export default function DriverHome() {
  const router = useRouter();
  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [availability, setAvailability] = useState(AVAILABILITY.OFFLINE);
  const [availabilityError, setAvailabilityError] = useState('');
  const [savingAvailability, setSavingAvailability] = useState(false);

  useEffect(() => {
    let active = true;
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      setLoading(false);
      return undefined;
    }
    getDriver(uid)
      .then((data) => {
        if (!active) return;
        setDriver(data);
        setAvailability(
          data && data.availabilityStatus === AVAILABILITY.AVAILABLE
            ? AVAILABILITY.AVAILABLE
            : AVAILABILITY.OFFLINE
        );
        console.log(
          '[DRIVER_HOME] loaded status=',
          data && data.verificationStatus,
          'founder=',
          isFounderDriver(data),
          'availability=',
          data && data.availabilityStatus
        );
      })
      .catch((e) => {
        console.log('[DRIVER_HOME] load error', e.message);
        if (active) setError('Não foi possível carregar seu cadastro.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const nowMs = Date.now();
  const uid = auth.currentUser && auth.currentUser.uid;
  const displayName = driver && (driver.displayName || driver.fullName || driver.email);
  const founderActive = isFounderCommissionFreeActive(driver);
  const eligibility = deriveEligibility(driver);
  const subscription = subscriptionDisplay(driver, nowMs);
  const commission = commissionDisplay(driver, nowMs);
  const isAvailable = availability === AVAILABILITY.AVAILABLE;

  // Toggle to available — only allowed when the admin decision makes the driver
  // eligible. Never fails silently: an ineligible driver sees the reason.
  async function goAvailable() {
    setAvailabilityError('');
    if (!eligibility.eligible) {
      console.log('[AVAILABILITY] blocked reason=', eligibility.reasonCode);
      setAvailabilityError(rideBlockReasonLabel(eligibility.reasonCode));
      return;
    }
    if (!uid) return;
    setSavingAvailability(true);
    setAvailability(AVAILABILITY.AVAILABLE); // optimistic
    try {
      await setDriverAvailability(uid, AVAILABILITY.AVAILABLE);
      console.log('[AVAILABILITY] driver is now available');
    } catch (e) {
      console.log('[AVAILABILITY] update error', e.message);
      setAvailability(AVAILABILITY.OFFLINE); // revert
      setAvailabilityError('Não foi possível atualizar sua disponibilidade.');
    } finally {
      setSavingAvailability(false);
    }
  }

  async function goOffline() {
    setAvailabilityError('');
    if (!uid) return;
    setSavingAvailability(true);
    setAvailability(AVAILABILITY.OFFLINE); // optimistic
    try {
      await setDriverAvailability(uid, AVAILABILITY.OFFLINE);
      console.log('[AVAILABILITY] driver is now offline');
    } catch (e) {
      console.log('[AVAILABILITY] update error', e.message);
      setAvailability(AVAILABILITY.AVAILABLE); // revert
      setAvailabilityError('Não foi possível atualizar sua disponibilidade.');
    } finally {
      setSavingAvailability(false);
    }
  }

  // Benefit expiry warnings (only speak up near/after expiry).
  const commissionWarn = benefitWarning('Sua comissão gratuita', commissionFreeUntilMs(driver), nowMs);
  const subscriptionWarn = benefitWarning('Sua assinatura gratuita', subscriptionFreeUntilMs(driver), nowMs);

  const founderLabel = (() => {
    const num = founderNumberLabel(driver);
    return num ? `${FOUNDER_LABEL_PT_BR} ${num}` : FOUNDER_LABEL_PT_BR;
  })();

  const balanceCents = (driver && driver.balanceCents) || 0;
  const walletBlocked =
    balanceCents <= WALLET_FALLBACK_LOW_THRESHOLD_CENTS &&
    (driver &&
      (driver.walletStatus === 'required' || driver.walletStatus === 'blocked'));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title="Motorista"
          subtitle={loading ? 'Carregando…' : displayName}
          onBack={() => router.back()}
          right={<DriverStatusBadge status={isAvailable ? 'online' : 'offline'} />}
        />

        {loading ? (
          <AppCard>
            <AdminTableRow label="Carregando…" />
          </AppCard>
        ) : error ? (
          <AppCard>
            <Line tone="warning">{error}</Line>
          </AppCard>
        ) : !driver ? (
          <AppCard>
            <AdminTableRow label="Cadastro não encontrado" />
          </AppCard>
        ) : (
          <>
            {/* STATUS */}
            <AppCard>
              <SectionTitle>STATUS</SectionTitle>
              <AppBadge label="Motorista aprovado" tone="success" />
              {driver.approvalNumber ? (
                <AdminTableRow label="Número de aprovação" value={`#${driver.approvalNumber}`} />
              ) : null}
            </AppCard>

            {/* BENEFÍCIOS */}
            <AppCard>
              <SectionTitle>BENEFÍCIOS</SectionTitle>
              {isFounderDriver(driver) ? <AppBadge label={founderLabel} tone="success" /> : null}
              {commission.mode === 'free' ? (
                <Line tone="success">{`Comissão 0% até ${formatDateBR(commission.dateMs)}`}</Line>
              ) : null}
              {subscription.mode === 'free' ? (
                <Line tone="success">{`Assinatura grátis até ${formatDateBR(subscription.dateMs)}`}</Line>
              ) : null}
              {commissionWarn ? <Line tone="warning">{commissionWarn}</Line> : null}
              {subscriptionWarn ? <Line tone="warning">{subscriptionWarn}</Line> : null}
              {!isFounderDriver(driver) &&
              commission.mode !== 'free' &&
              subscription.mode !== 'free' ? (
                <Line>Nenhum benefício ativo no momento.</Line>
              ) : null}
            </AppCard>

            {/* DISPONIBILIDADE */}
            <AppCard>
              <SectionTitle>DISPONIBILIDADE</SectionTitle>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <AppButton
                  title="Disponível"
                  variant={isAvailable ? 'primary' : 'secondary'}
                  onPress={goAvailable}
                  disabled={savingAvailability}
                  style={{ flex: 1 }}
                />
                <AppButton
                  title="Indisponível"
                  variant={!isAvailable ? 'primary' : 'secondary'}
                  onPress={goOffline}
                  disabled={savingAvailability}
                  style={{ flex: 1 }}
                />
              </View>
              {!eligibility.eligible ? (
                <View
                  style={{
                    backgroundColor: colors.warningBg,
                    borderRadius: radius.md,
                    padding: spacing.md,
                    gap: spacing.xs,
                  }}
                >
                  <Text style={[{ fontFamily, color: colors.warning }, typography.bodyBold]}>
                    Você ainda não pode ficar disponível.
                  </Text>
                  <Text style={[{ fontFamily, color: colors.text }, typography.small]}>
                    {rideBlockReasonLabel(eligibility.reasonCode)}
                  </Text>
                </View>
              ) : null}
              {availabilityError ? <Line tone="warning">{availabilityError}</Line> : null}
            </AppCard>

            {/* ASSINATURA */}
            <AppCard>
              <SectionTitle>ASSINATURA</SectionTitle>
              {subscription.mode === 'free' ? (
                <Line tone="success">{`Assinatura grátis até ${formatDateBR(subscription.dateMs)}`}</Line>
              ) : subscription.mode === 'active' ? (
                <Line tone="text">Assinatura ativa.</Line>
              ) : (
                <>
                  <Line tone="text">Para receber corridas, ative sua assinatura.</Line>
                  <Line>Após ativar sua assinatura, você terá 0% de comissão por 60 dias.</Line>
                  <AppButton title="Ativar assinatura — em breve" variant="secondary" disabled />
                </>
              )}
            </AppCard>

            {/* COMISSÃO */}
            <AppCard>
              <SectionTitle>COMISSÃO</SectionTitle>
              {commission.mode === 'free' ? (
                <>
                  <Line tone="success">{`Comissão 0% até ${formatDateBR(commission.dateMs)}`}</Line>
                  <Line>Você recebe 100% do valor das corridas durante este período.</Line>
                </>
              ) : (
                <>
                  <Line tone="text">Comissão padrão: 15% por corrida concluída.</Line>
                  <Line>A taxa será descontada do seu Saldo DriveLocal quando as comissões forem ativadas.</Line>
                </>
              )}
            </AppCard>

            {/* SALDO DRIVELOCAL */}
            <AppCard>
              <SectionTitle>SALDO DRIVELOCAL</SectionTitle>
              <WalletCard balanceCents={balanceCents} isFounderActive={founderActive} />
              <Line>Será usado para pagar taxas da plataforma quando as comissões forem ativadas.</Line>
              {walletBlocked ? (
                <Line tone="warning">Recarregue seu saldo para receber corridas.</Line>
              ) : null}
              <AppButton title="Ver carteira" variant="ghost" onPress={() => router.push('/wallet')} />
            </AppCard>

            {/* PRÓXIMAS CORRIDAS / EM BREVE */}
            <AppCard>
              <SectionTitle>PRÓXIMAS CORRIDAS</SectionTitle>
              <Line>Em breve. As corridas serão ativadas em uma próxima etapa.</Line>
            </AppCard>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
