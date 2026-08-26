// Real driver wallet (route "/wallet"). Balances come from drivers/{uid}; safe
// financial history comes from the authenticated getDriverWalletSnapshot callable.
// The app never writes wallet money and never reads raw financial collections.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import WalletCard from '../../components/WalletCard';
import DriverPixPaymentSheet from '../../components/DriverPixPaymentSheet';
import { colors } from '../../constants/colors';
import { MIN_WALLET_BALANCE_CENTAVOS } from '../../constants/pricingConfig';
import { radius, spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import {
  listenToDriverWallet,
  loadDriverWalletSnapshot,
} from '../../services/driverWalletService';
import { requestWalletTopupPix } from '../../services/paymentsService';
import {
  deriveDriverWalletView,
  formatTopupPreset,
  parseWalletTopupInput,
} from '../../utils/driverWallet';
import { formatDateBR } from '../../utils/driverCockpit';
import { formatBRL } from '../../utils/format';

const MAX_TIMEOUT_MS = 2_147_483_647;

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function HistoryRow({ item }) {
  const amountTone = item.direction === 'credit'
    ? styles.amountCredit
    : item.direction === 'debit'
      ? styles.amountDebit
      : styles.amountNeutral;

  return (
    <View style={styles.historyRow}>
      <View style={styles.historyCopy}>
        <Text style={styles.historyTitle}>{item.title}</Text>
        <Text style={styles.historyStatus}>{item.status}</Text>
        {item.detail ? <Text style={styles.historyDetail}>{item.detail}</Text> : null}
        {item.dateLabel ? <Text style={styles.historyDate}>{item.dateLabel}</Text> : null}
      </View>
      <Text style={[styles.historyAmount, amountTone]}>{item.amountLabel}</Text>
    </View>
  );
}

export default function Wallet() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const uid = auth.currentUser?.uid || null;
  const walletRequiredContext = firstParam(params.reason) === 'wallet_required';
  const [liveDriver, setLiveDriver] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payment, setPayment] = useState(null);
  const [generatingKey, setGeneratingKey] = useState(null);
  const [customValue, setCustomValue] = useState('');
  const [customError, setCustomError] = useState('');
  const [error, setError] = useState('');

  const loadHistory = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setHistoryLoading(true);
    else setRefreshing(true);
    try {
      const next = await loadDriverWalletSnapshot();
      setSnapshot(next);
      setClockNowMs(Date.now());
      setError('');
    } catch (loadError) {
      setError(loadError?.message || 'Não foi possível carregar o histórico da carteira.');
    } finally {
      setHistoryLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!uid) {
      setBalanceLoading(false);
      setHistoryLoading(false);
      setError('Entre novamente para abrir sua carteira.');
      return undefined;
    }

    const unsubscribe = listenToDriverWallet(
      uid,
      (next) => {
        setLiveDriver(next);
        setClockNowMs(Date.now());
        setBalanceLoading(false);
      },
      () => {
        setBalanceLoading(false);
        setError('Não foi possível acompanhar o saldo em tempo real.');
      }
    );
    loadHistory();
    return unsubscribe;
  }, [uid, loadHistory]);

  const wallet = useMemo(
    () => deriveDriverWalletView(liveDriver, snapshot, clockNowMs),
    [liveDriver, snapshot, clockNowMs]
  );

  useEffect(() => {
    if (!wallet.topupLocked || !wallet.topupUnlockAtMs) return undefined;
    const remainingMs = wallet.topupUnlockAtMs - Date.now();
    const delayMs = Math.max(50, Math.min(remainingMs + 100, MAX_TIMEOUT_MS));
    const timer = setTimeout(() => setClockNowMs(Date.now()), delayMs);
    return () => clearTimeout(timer);
  }, [wallet.topupLocked, wallet.topupUnlockAtMs]);

  const unlockDate = formatDateBR(wallet.topupUnlockAtMs);
  const anyGenerating = generatingKey != null;
  const walletReadyForWork = !balanceLoading
    && !wallet.topupLocked
    && wallet.availableCentavos > MIN_WALLET_BALANCE_CENTAVOS;
  const topupControlsDisabled = balanceLoading
    || !liveDriver
    || wallet.topupLocked
    || anyGenerating;

  async function onTopup(amountCentavos, key, { customAmount = false } = {}) {
    // Mobile guard comes before the payment service. The backend repeats the same
    // policy check before creating any Mercado Pago order.
    if (balanceLoading || !liveDriver || wallet.topupLocked || anyGenerating) return;
    setGeneratingKey(key);
    setError('');
    try {
      const result = await requestWalletTopupPix(amountCentavos, { customAmount });
      setPayment(result);
      if (customAmount) setCustomValue('');
      await loadHistory({ silent: true });
    } catch (topupError) {
      setError(topupError?.message || 'Não foi possível gerar o Pix. Tente novamente.');
    } finally {
      setGeneratingKey(null);
    }
  }

  async function onCustomTopup() {
    if (balanceLoading || !liveDriver || wallet.topupLocked || anyGenerating) return;
    const parsed = parseWalletTopupInput(customValue);
    if (!parsed.valid) {
      setCustomError(parsed.error);
      return;
    }
    setCustomError('');
    await onTopup(parsed.amountCentavos, 'custom', { customAmount: true });
  }

  const onPaymentStatusChange = useCallback((status) => {
    if (status && status !== 'pending') loadHistory({ silent: true });
  }, [loadHistory]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Header title="Carteira" onBack={() => router.back()} />

        <WalletCard
          balanceCents={balanceLoading ? null : wallet.balanceCentavos}
          availableCents={balanceLoading ? null : wallet.availableCentavos}
          heldCents={balanceLoading ? null : wallet.heldCentavos}
          topupLocked={wallet.topupLocked}
        />

        {walletRequiredContext ? (
          <AppCard style={[
            styles.workContextCard,
            wallet.topupLocked
              ? styles.workContextInfo
              : walletReadyForWork
                ? styles.workContextSuccess
                : styles.workContextWarning,
          ]}>
            <Text style={styles.workContextEyebrow}>POR QUE VOCÊ VEIO PARA A CARTEIRA</Text>
            <Text style={styles.workContextTitle}>
              {wallet.topupLocked
                ? 'Nenhuma recarga é necessária agora'
                : walletReadyForWork
                  ? 'Saldo liberado para voltar a trabalhar'
                  : 'Recarga necessária para voltar a trabalhar'}
            </Text>
            <Text style={styles.workContextText}>
              {wallet.topupLocked
                ? `Sua taxa da plataforma ainda está zerada. Enquanto esse benefício estiver ativo, o wallet não bloqueia suas corridas${unlockDate ? ` e as recargas ficam liberadas em ${unlockDate}` : ''}.`
                : walletReadyForWork
                  ? `Seu saldo disponível é ${formatBRL(wallet.availableCentavos)}, acima do limite de ${formatBRL(MIN_WALLET_BALANCE_CENTAVOS)}. O servidor fará uma nova verificação quando você voltar ao painel.`
                  : `Seu saldo disponível é ${formatBRL(wallet.availableCentavos)}. Para ficar disponível, ele deve estar acima de ${formatBRL(MIN_WALLET_BALANCE_CENTAVOS)} e também cobrir a reserva da taxa da plataforma da próxima corrida. A recarga Pix mínima é R$ 10,00.`}
            </Text>
            {wallet.topupLocked || walletReadyForWork ? (
              <AppButton
                title="VOLTAR AO PAINEL DO MOTORISTA"
                onPress={() => router.replace('/driver-home')}
              />
            ) : (
              <Text style={styles.workContextInstruction}>
                Escolha um valor abaixo. O saldo só será liberado após a confirmação do Mercado Pago.
              </Text>
            )}
          </AppCard>
        ) : null}

        {payment ? (
          <DriverPixPaymentSheet
            payment={payment}
            title="Recarga do saldo DriveLocal"
            statusLabels={{
              paid: 'Pagamento confirmado — saldo sendo atualizado!',
              pending: 'Aguardando pagamento da recarga…',
            }}
            onStatusChange={onPaymentStatusChange}
            onClose={() => {
              setPayment(null);
              loadHistory({ silent: true });
            }}
          />
        ) : (
          <AppCard style={styles.topupCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderCopy}>
                <Text style={styles.sectionTitle}>Adicionar saldo com Pix</Text>
                <Text style={styles.sectionCopy}>
                  O saldo é creditado somente após a confirmação do Mercado Pago.
                </Text>
                {!wallet.topupLocked ? (
                  <Text style={styles.thresholdCopy}>
                    {`Para receber corridas com taxa da plataforma ativa, mantenha o saldo disponível acima de ${formatBRL(MIN_WALLET_BALANCE_CENTAVOS)}. A recarga mínima é R$ 10,00.`}
                  </Text>
                ) : null}
              </View>
            </View>

            {wallet.topupLocked ? (
              <View style={styles.lockedBox}>
                <Text style={styles.lockedTitle}>
                  Nenhuma recarga é necessária enquanto sua taxa da plataforma estiver zerada.
                </Text>
                <Text style={styles.lockedCopy}>
                  {unlockDate
                    ? `As recargas serão liberadas em ${unlockDate}.`
                    : 'A data de liberação está sendo carregada.'}
                </Text>
              </View>
            ) : null}

            <View style={styles.presetGrid}>
              {wallet.topupPresets.map((amount) => {
                const key = `preset-${amount}`;
                return (
                  <View key={amount} style={styles.presetCell}>
                    <AppButton
                      title={generatingKey === key
                        ? 'Gerando…'
                        : formatTopupPreset(amount, wallet.topupLocked)}
                      onPress={() => onTopup(amount, key)}
                      disabled={topupControlsDisabled}
                    />
                  </View>
                );
              })}
            </View>

            <View style={styles.customBox}>
              <AppInput
                label="Outro valor"
                value={customValue}
                onChangeText={(value) => {
                  setCustomValue(value);
                  if (customError) setCustomError('');
                }}
                placeholder="R$ 10,00 a R$ 200,00"
                keyboardType="decimal-pad"
                maxLength={9}
                editable={!topupControlsDisabled}
                accessibilityLabel="Outro valor para recarga"
              />
              {customError ? <Text style={styles.fieldError}>{customError}</Text> : null}
              <AppButton
                title={wallet.topupLocked
                  ? '🔒 Outro valor'
                  : generatingKey === 'custom'
                    ? 'Gerando…'
                    : 'Gerar Pix — outro valor'}
                onPress={onCustomTopup}
                disabled={topupControlsDisabled}
              />
              <Text style={styles.limitCopy}>Mínimo R$ 10,00 • máximo R$ 200,00</Text>
            </View>
          </AppCard>
        )}

        <AppCard style={styles.historyCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderCopy}>
              <Text style={styles.sectionTitle}>Histórico da carteira</Text>
              <Text style={styles.sectionCopy}>
                Recargas, reservas, liberações, capturas e status Pix reais.
              </Text>
            </View>
            <AppButton
              title={refreshing ? 'Atualizando…' : 'Atualizar'}
              variant="ghost"
              onPress={() => loadHistory({ silent: true })}
              disabled={refreshing || historyLoading}
            />
          </View>

          {historyLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.sectionCopy}>Carregando movimentos reais…</Text>
            </View>
          ) : wallet.history.length > 0 ? (
            <View style={styles.historyList}>
              {wallet.history.map((item) => <HistoryRow key={item.id} item={item} />)}
            </View>
          ) : (
            <Text style={styles.emptyHistory}>Nenhum movimento registrado ainda.</Text>
          )}
        </AppCard>

        {error ? (
          <AppCard style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </AppCard>
        ) : null}
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
  workContextCard: { gap: spacing.sm, borderWidth: 1 },
  workContextWarning: { backgroundColor: colors.warningBg, borderColor: colors.warning },
  workContextSuccess: { backgroundColor: colors.successBg, borderColor: colors.success },
  workContextInfo: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  workContextEyebrow: {
    fontFamily,
    color: colors.textMuted,
    ...typography.caption,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  workContextTitle: { fontFamily, color: colors.text, ...typography.h3 },
  workContextText: { fontFamily, color: colors.text, ...typography.small, lineHeight: 19 },
  workContextInstruction: {
    fontFamily,
    color: colors.warning,
    ...typography.bodyBold,
    lineHeight: 20,
  },
  topupCard: { gap: spacing.lg },
  historyCard: { gap: spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sectionHeaderCopy: { flex: 1, gap: spacing.xs },
  sectionTitle: {
    fontFamily,
    color: colors.text,
    ...typography.bodyBold,
  },
  sectionCopy: {
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
    lineHeight: 19,
  },
  thresholdCopy: {
    fontFamily,
    color: colors.warning,
    ...typography.small,
    lineHeight: 19,
  },
  lockedBox: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.accentTint,
  },
  lockedTitle: {
    fontFamily,
    color: colors.success,
    ...typography.bodyBold,
  },
  lockedCopy: {
    fontFamily,
    color: colors.text,
    ...typography.small,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  presetCell: {
    minWidth: '47%',
    flexGrow: 1,
  },
  customBox: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  fieldError: {
    fontFamily,
    color: colors.danger,
    ...typography.small,
  },
  limitCopy: {
    fontFamily,
    color: colors.textFaint,
    ...typography.caption,
    textAlign: 'center',
  },
  historyList: { gap: 0 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyCopy: { flex: 1, gap: 2 },
  historyTitle: {
    fontFamily,
    color: colors.text,
    ...typography.bodyBold,
  },
  historyStatus: {
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
  },
  historyDetail: {
    fontFamily,
    color: colors.textMuted,
    ...typography.caption,
  },
  historyDate: {
    fontFamily,
    color: colors.textFaint,
    ...typography.caption,
  },
  historyAmount: {
    maxWidth: '38%',
    fontFamily,
    ...typography.bodyBold,
    textAlign: 'right',
  },
  amountCredit: { color: colors.success },
  amountDebit: { color: colors.danger },
  amountNeutral: { color: colors.text },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  emptyHistory: {
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  errorCard: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.danger,
  },
  errorText: {
    fontFamily,
    color: colors.danger,
    ...typography.small,
  },
});
