// Real driver subscription (route "/subscription-plans"). Commercial state comes
// from drivers/{uid}; price, eligibility and activation remain server-authoritative.
// A pending Mercado Pago Pix can be restored after an app restart.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppBadge from '../../components/AppBadge';
import AppButton from '../../components/AppButton';
import AppCard from '../../components/AppCard';
import DriverPixPaymentSheet from '../../components/DriverPixPaymentSheet';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import {
  listenToDriverSubscription,
  loadDriverSubscriptionSnapshot,
} from '../../services/driverSubscriptionService';
import { requestSubscriptionPix } from '../../services/paymentsService';
import {
  DRIVER_SUBSCRIPTION_MODE,
  deriveDriverSubscriptionView,
} from '../../utils/driverSubscription';

const RESTORABLE_PAYMENT_STATUSES = new Set(['pending', 'manual_review']);

function modeBadge(mode) {
  const map = {
    [DRIVER_SUBSCRIPTION_MODE.FOUNDER_FREE]: { label: 'GRÁTIS', tone: 'success' },
    [DRIVER_SUBSCRIPTION_MODE.RIDE_GRACE]: { label: 'PERÍODO INICIAL', tone: 'success' },
    [DRIVER_SUBSCRIPTION_MODE.ACTIVE]: { label: 'ATIVA', tone: 'success' },
    [DRIVER_SUBSCRIPTION_MODE.REQUIRED_COMMISSION_FREE]: { label: 'NECESSÁRIA', tone: 'warning' },
    [DRIVER_SUBSCRIPTION_MODE.REQUIRED_STANDARD]: { label: 'NECESSÁRIA', tone: 'danger' },
    [DRIVER_SUBSCRIPTION_MODE.UNAVAILABLE]: { label: 'INDISPONÍVEL', tone: 'neutral' },
  };
  return map[mode] || map[DRIVER_SUBSCRIPTION_MODE.UNAVAILABLE];
}

function SubscriptionPlanCard({ plan, selected }) {
  return (
    <View style={[styles.planCard, selected && styles.planCardSelected]}>
      <View style={styles.planHeader}>
        <Text style={styles.planVehicle}>{`${plan.vehicleEmoji} ${plan.vehicleLabel}`}</Text>
        {selected ? <AppBadge label="SEU PLANO" tone="success" /> : null}
      </View>
      <Text style={styles.planPrice}>{`${plan.priceLabel} / ${plan.periodLabel}`}</Text>
      <Text style={styles.planCommission}>{`Comissão padrão: ${plan.commissionLabel}`}</Text>
    </View>
  );
}

function RuleRow({ item }) {
  return (
    <View style={styles.ruleRow}>
      <View style={styles.ruleTopRow}>
        <Text style={styles.ruleLabel}>{item.label}</Text>
        <Text style={styles.ruleValue}>{item.value}</Text>
      </View>
      <Text style={styles.ruleDetail}>{item.detail}</Text>
    </View>
  );
}

function CommercialRulesCard({ view }) {
  return (
    <AppCard style={styles.rulesCard}>
      <View style={styles.rulesHeader}>
        <View style={styles.rulesHeaderCopy}>
          <Text style={styles.eyebrow}>SUAS REGRAS — SEM SURPRESAS</Text>
          <Text style={styles.profileTitle}>{view.profileTitle}</Text>
          <Text style={styles.profileDetail}>{view.profileDetail}</Text>
        </View>
        <AppBadge label={view.founder ? 'FUNDADOR' : 'Nº 101+'} tone="success" />
      </View>

      <View style={styles.disclosureBox}>
        <Text style={styles.disclosureText}>{view.noSurpriseText}</Text>
      </View>

      <View style={styles.ruleSections}>
        {view.ruleSections.map((section, index) => (
          <View key={section.key} style={styles.ruleSection}>
            {index > 0 ? <View style={styles.ruleDivider} /> : null}
            <Text style={styles.ruleSectionTitle}>{section.title}</Text>
            <View style={styles.ruleList}>
              {section.items.map((item) => <RuleRow key={`${section.key}-${item.key}`} item={item} />)}
            </View>
          </View>
        ))}
      </View>
    </AppCard>
  );
}

export default function SubscriptionPlans() {
  const router = useRouter();
  const uid = auth.currentUser?.uid || null;
  const [driver, setDriver] = useState(null);
  const [driverLoading, setDriverLoading] = useState(true);
  const [serverConfirmed, setServerConfirmed] = useState(false);
  const [snapshotStatus, setSnapshotStatus] = useState('loading');
  const [payment, setPayment] = useState(null);
  const [paymentVisible, setPaymentVisible] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [clockNowMs, setClockNowMs] = useState(Date.now());
  const [driverError, setDriverError] = useState('');
  const [snapshotError, setSnapshotError] = useState('');
  const [paymentError, setPaymentError] = useState('');

  const loadPaymentSnapshot = useCallback(async () => {
    setSnapshotStatus('loading');
    setSnapshotError('');
    try {
      const snapshot = await loadDriverSubscriptionSnapshot();
      const restored = snapshot?.payment || null;
      setPayment(restored);
      setPaymentStatus(restored?.status || null);
      setPaymentVisible(Boolean(restored));
      setSnapshotStatus('ready');
    } catch (loadError) {
      setSnapshotStatus('failed');
      setSnapshotError(
        loadError?.message
        || 'Não foi possível restaurar um pagamento de assinatura em andamento.'
      );
    }
  }, []);

  useEffect(() => {
    if (!uid) {
      setDriverLoading(false);
      setSnapshotStatus('failed');
      setDriverError('Entre novamente para consultar sua assinatura.');
      return undefined;
    }

    const unsubscribe = listenToDriverSubscription(
      uid,
      (next, metadata = {}) => {
        setDriver(next);
        setServerConfirmed(metadata.confirmed === true);
        setDriverLoading(false);
        if (next) setDriverError('');
      },
      (listenerError) => {
        setDriverLoading(false);
        setServerConfirmed(false);
        setDriverError(
          listenerError?.message
          || 'Não foi possível acompanhar sua assinatura em tempo real.'
        );
      }
    );
    loadPaymentSnapshot();
    return unsubscribe;
  }, [uid, loadPaymentSnapshot]);

  const view = useMemo(
    () => deriveDriverSubscriptionView(driver, clockNowMs),
    [driver, clockNowMs]
  );

  // Keep an already-open screen aligned with day 60 and paid-plan expiration.
  useEffect(() => {
    if (!view.transitionAtMs) return undefined;
    const delayMs = Math.min(
      Math.max(250, view.transitionAtMs - Date.now() + 250),
      2_147_000_000
    );
    const timer = setTimeout(() => setClockNowMs(Date.now()), delayMs);
    return () => clearTimeout(timer);
  }, [view.transitionAtMs]);

  const badge = modeBadge(view.mode);
  const pendingPayment = Boolean(
    payment?.localPaymentId
    && RESTORABLE_PAYMENT_STATUSES.has(paymentStatus || payment.status)
  );
  const activationPending = paymentStatus === 'paid' && !view.paidSubscriptionActive;
  const paymentContextReady = serverConfirmed && snapshotStatus === 'ready';
  const paymentDisabled = busy
    || activationPending
    || !paymentContextReady
    || !view.paymentEnabled;
  const visibleErrors = [...new Set([
    driverError,
    snapshotError,
    paymentError,
  ].filter(Boolean))];

  async function onPaySubscription() {
    // A server-confirmed driver snapshot and a successful pending-payment lookup are
    // required before creating a new order. The backend repeats all policy checks.
    if (paymentDisabled || pendingPayment) return;
    setBusy(true);
    setPaymentError('');
    console.info('[DRIVER_SUBSCRIPTION] payment.create_started', {
      scope: 'driver_subscription',
      event: 'payment.create_started',
      mode: view.mode,
      vehicleType: view.currentPlan?.vehicleType || null,
      renewal: view.mode === DRIVER_SUBSCRIPTION_MODE.ACTIVE,
      atMs: Date.now(),
    });
    try {
      const result = await requestSubscriptionPix();
      setPayment(result);
      setPaymentStatus(result?.status || 'pending');
      setPaymentVisible(true);
      console.info('[DRIVER_SUBSCRIPTION] payment.create_succeeded', {
        scope: 'driver_subscription',
        event: 'payment.create_succeeded',
        status: result?.status || null,
        hasPaymentId: Boolean(result?.localPaymentId),
        atMs: Date.now(),
      });
    } catch (paymentFailure) {
      console.warn('[DRIVER_SUBSCRIPTION] payment.create_failed', {
        scope: 'driver_subscription',
        event: 'payment.create_failed',
        mode: view.mode,
        reason: paymentFailure?.code || paymentFailure?.message || 'unknown',
        atMs: Date.now(),
      });
      setPaymentError(
        paymentFailure?.message
        || 'Não foi possível gerar o Pix. Tente novamente.'
      );
    } finally {
      setBusy(false);
    }
  }

  const onPaymentStatusChange = useCallback((status) => {
    if (!status) return;
    setPaymentStatus(status);
    setPayment((current) => current ? { ...current, status } : current);
    console.info('[DRIVER_SUBSCRIPTION] payment.status_changed', {
      scope: 'driver_subscription',
      event: 'payment.status_changed',
      status,
      atMs: Date.now(),
    });
  }, []);

  function closePayment() {
    setPaymentVisible(false);
  }

  function resumePayment() {
    if (pendingPayment) setPaymentVisible(true);
  }

  function paymentHelpText() {
    if (driverLoading) return 'Carregando sua assinatura…';
    if (!serverConfirmed) return 'Confirmando seus dados com o servidor…';
    if (snapshotStatus === 'loading') return 'Verificando pagamentos em andamento…';
    if (snapshotStatus === 'failed') {
      return 'Verifique pagamentos em andamento antes de gerar um novo Pix.';
    }
    if (activationPending) {
      return 'Pagamento confirmado. Atualizando a ativação da assinatura…';
    }
    if (view.paymentReason === 'vehicle_unknown') {
      return 'Informe um tipo de veículo válido para continuar.';
    }
    if (view.mode === DRIVER_SUBSCRIPTION_MODE.FOUNDER_FREE) {
      return 'Nenhum pagamento é necessário durante sua assinatura gratuita.';
    }
    if (view.mode === DRIVER_SUBSCRIPTION_MODE.RIDE_GRACE) {
      return 'O pagamento será liberado após a quinta corrida ou no fim dos 60 dias.';
    }
    return view.renewalDetail
      || 'O plano é ativado somente após a confirmação do Mercado Pago.';
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Header title="Assinatura" subtitle="Plano e regras do motorista" onBack={() => router.back()} />

        {driverLoading ? (
          <AppCard style={styles.loadingCard}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.muted}>Carregando sua assinatura real…</Text>
          </AppCard>
        ) : !driver ? (
          <AppCard>
            <Text style={styles.errorText}>Cadastro de motorista não encontrado.</Text>
          </AppCard>
        ) : (
          <>
            <AppCard style={styles.statusCard}>
              <View style={styles.statusHeader}>
                <View style={styles.statusCopy}>
                  <Text style={styles.eyebrow}>SUA ASSINATURA</Text>
                  <Text style={styles.statusTitle}>{view.statusTitle}</Text>
                </View>
                <AppBadge label={badge.label} tone={badge.tone} />
              </View>
              <Text style={styles.statusDetail}>{view.statusDetail}</Text>
              {view.progressLabel ? (
                <View style={styles.progressBox}>
                  <Text style={styles.progressText}>{view.progressLabel}</Text>
                </View>
              ) : null}
              <View style={styles.commercialRow}>
                <View style={styles.commercialMetric}>
                  <Text style={styles.metricLabel}>Comissão atual</Text>
                  <Text style={styles.metricValue}>{view.commissionLabel || '—'}</Text>
                  <Text style={styles.metricDetail}>{view.commissionDetail}</Text>
                </View>
                <View style={styles.commercialMetric}>
                  <Text style={styles.metricLabel}>Seu plano mensal</Text>
                  <Text style={styles.metricValue}>{view.currentPlan?.priceLabel || '—'}</Text>
                  <Text style={styles.metricDetail}>
                    {view.currentPlan
                      ? `${view.currentPlan.periodDays} dias`
                      : 'Veículo não informado'}
                  </Text>
                </View>
              </View>
            </AppCard>

            <CommercialRulesCard view={view} />

            <AppCard style={styles.catalogCard}>
              <Text style={styles.sectionTitle}>Planos mensais</Text>
              <Text style={styles.muted}>
                O valor é definido pelo veículo aprovado no cadastro. Não é possível escolher outro plano no pagamento.
              </Text>
              <View style={styles.planList}>
                {view.catalog.map((plan) => (
                  <SubscriptionPlanCard
                    key={plan.vehicleType}
                    plan={plan}
                    selected={plan.vehicleType === view.currentPlan?.vehicleType}
                  />
                ))}
              </View>
            </AppCard>

            {paymentVisible && payment ? (
              <DriverPixPaymentSheet
                payment={payment}
                title="Assinatura via Pix"
                statusLabels={{
                  paid: 'Pagamento confirmado — assinatura ativada!',
                  pending: 'Aguardando pagamento…',
                }}
                onStatusChange={onPaymentStatusChange}
                onClose={closePayment}
              />
            ) : (
              <AppCard style={styles.actionCard}>
                {pendingPayment ? (
                  <AppButton title="RETOMAR PIX PENDENTE" onPress={resumePayment} />
                ) : (
                  <AppButton
                    title={busy ? 'GERANDO PIX…' : view.paymentButtonTitle}
                    onPress={onPaySubscription}
                    disabled={paymentDisabled}
                  />
                )}
                <Text style={styles.actionHelp}>{paymentHelpText()}</Text>
                {snapshotStatus === 'failed' ? (
                  <AppButton
                    title="Verificar pagamento novamente"
                    variant="secondary"
                    onPress={loadPaymentSnapshot}
                  />
                ) : null}
              </AppCard>
            )}
          </>
        )}

        {visibleErrors.map((message) => (
          <AppCard key={message} style={styles.errorCard}>
            <Text style={styles.errorText}>{message}</Text>
          </AppCard>
        ))}

        <AppButton
          title="Voltar ao painel"
          variant="ghost"
          onPress={() => router.replace('/driver-home')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    flexGrow: 1,
  },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusCard: { gap: spacing.md },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  statusCopy: { flex: 1, gap: spacing.xs },
  eyebrow: {
    fontFamily,
    color: colors.textFaint,
    ...typography.caption,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  statusTitle: { fontFamily, color: colors.text, ...typography.h2 },
  statusDetail: { fontFamily, color: colors.textMuted, ...typography.body },
  progressBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.successBg,
  },
  progressText: { fontFamily, color: colors.success, ...typography.bodyBold },
  commercialRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  commercialMetric: {
    flexGrow: 1,
    flexBasis: 135,
    gap: 3,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  metricLabel: { fontFamily, color: colors.textMuted, ...typography.caption },
  metricValue: { fontFamily, color: colors.primary, ...typography.h3 },
  metricDetail: { fontFamily, color: colors.textMuted, ...typography.caption },
  rulesCard: { gap: spacing.md },
  rulesHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rulesHeaderCopy: { flex: 1, gap: 3 },
  profileTitle: { fontFamily, color: colors.text, ...typography.h3 },
  profileDetail: { fontFamily, color: colors.textMuted, ...typography.small },
  disclosureBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  disclosureText: {
    fontFamily,
    color: colors.text,
    ...typography.small,
    lineHeight: 19,
  },
  ruleSections: { gap: spacing.md },
  ruleSection: { gap: spacing.sm },
  ruleDivider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm },
  ruleSectionTitle: { fontFamily, color: colors.text, ...typography.bodyBold },
  ruleList: { gap: spacing.sm },
  ruleRow: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  ruleTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  ruleLabel: { flex: 1, fontFamily, color: colors.textMuted, ...typography.small },
  ruleValue: {
    flexShrink: 1,
    fontFamily,
    color: colors.primary,
    ...typography.bodyBold,
    textAlign: 'right',
  },
  ruleDetail: { fontFamily, color: colors.textMuted, ...typography.caption, lineHeight: 17 },
  catalogCard: { gap: spacing.md },
  sectionTitle: { fontFamily, color: colors.text, ...typography.bodyBold },
  muted: { fontFamily, color: colors.textMuted, ...typography.small },
  planList: { gap: spacing.sm },
  planCard: {
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  planCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  planVehicle: { fontFamily, color: colors.text, ...typography.bodyBold },
  planPrice: { fontFamily, color: colors.primary, ...typography.h3 },
  planCommission: { fontFamily, color: colors.textMuted, ...typography.small },
  actionCard: { gap: spacing.md },
  actionHelp: {
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
    textAlign: 'center',
    lineHeight: 19,
  },
  errorCard: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  errorText: { fontFamily, color: colors.danger, ...typography.small },
});
