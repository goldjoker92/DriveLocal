// Incoming targeted ride offer (route "/ride-request").
// Before acceptance only a generic/coarsened pickup region is shown. Acceptance
// and refusal remain server-authoritative; this screen only presents safe data.

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AnimatedAcceptRideButton from '../../components/AnimatedAcceptRideButton';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { formatBRL, formatDistanceKm } from '../../utils/format';
import {
  deriveRideOfferPresentation,
  formatPickupEta,
} from '../../utils/rideOfferPresentation';
import { logRideClientEvent } from '../../utils/clientRideLog';
import { auth } from '../../config/firebase';
import { getDriver } from '../../services/driverService';
import { listenToMyOffer, acceptOffer, declineOffer } from '../../services/ridesService';
import { openWazeToPoint, openGoogleMapsToPoint } from '../../utils/maps';

function InfoRow({ icon, label, value, detail, tone = 'default' }) {
  const valueColor = tone === 'success'
    ? colors.success
    : tone === 'warning'
      ? colors.warning
      : colors.text;

  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}><Text style={styles.infoIconText}>{icon}</Text></View>
      <View style={styles.infoCopy}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, { color: valueColor }]}>{value}</Text>
        {detail ? <Text style={styles.infoDetail}>{detail}</Text> : null}
      </View>
    </View>
  );
}

function StatusItem({ icon, title, detail, tone = 'default' }) {
  const backgroundColor = tone === 'success'
    ? colors.successBg
    : tone === 'warning'
      ? colors.warningBg
      : colors.primaryTint;

  return (
    <View style={styles.statusItem}>
      <View style={[styles.statusIcon, { backgroundColor }]}>
        <Text style={styles.statusIconText}>{icon}</Text>
      </View>
      <View style={styles.statusCopy}>
        <Text style={styles.statusTitle}>{title}</Text>
        <Text style={styles.statusDetail}>{detail}</Text>
      </View>
    </View>
  );
}

export default function RideRequest() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const requestedOfferId = typeof params.offerId === 'string' ? params.offerId : null;
  const [offer, setOffer] = useState(null);
  const [driver, setDriver] = useState(null);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [acceptError, setAcceptError] = useState('');
  const [accepted, setAccepted] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const lastLoggedOfferId = useRef(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;

    const profileStartedAt = Date.now();
    getDriver(uid)
      .then((data) => {
        setDriver(data);
        logRideClientEvent('ride.offer.business_context_loaded', {
          action: 'load_driver_context',
          status: data ? 'available' : 'missing',
          vehicleType: data?.vehicleType,
          durationMs: Date.now() - profileStartedAt,
        });
      })
      .catch((error) => {
        // Financial/status details are optional presentation; accepting still uses
        // the backend's authoritative validation if this self-profile read fails.
        logRideClientEvent('ride.offer.business_context_failed', {
          action: 'load_driver_context',
          durationMs: Date.now() - profileStartedAt,
          error,
        }, 'warning');
      });

    return listenToMyOffer(uid, (nextOffer) => {
      if (
        requestedOfferId
        && nextOffer?.offerId !== requestedOfferId
        && nextOffer?.status !== 'accepted'
      ) return;

      setOffer(nextOffer);
      if (nextOffer?.offerId && lastLoggedOfferId.current !== nextOffer.offerId) {
        lastLoggedOfferId.current = nextOffer.offerId;
        logRideClientEvent('ride.offer.screen_opened', {
          action: 'show_targeted_offer',
          rideId: nextOffer.rideId,
          status: nextOffer.status,
          vehicleType: nextOffer.vehicleType,
        });
      }
      if (nextOffer?.status === 'accepted' && nextOffer.exactPickup) {
        setAccepted({
          rideId: nextOffer.rideId,
          pickup: nextOffer.exactPickup,
          vehicleType: nextOffer.vehicleType,
        });
      }
    }, (error) => {
      logRideClientEvent('ride.offer.screen_listener_failed', {
        action: 'listen_targeted_offer',
        error,
      }, 'warning');
      setOffer(null);
    });
  }, [requestedOfferId]);

  useEffect(() => {
    if (!offer?.expiresAtMs || offer.status !== 'offered') return undefined;
    let expiring = false;

    const tick = async () => {
      const remaining = Math.max(0, Math.ceil((Number(offer.expiresAtMs) - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining !== 0 || expiring) return;

      expiring = true;
      logRideClientEvent('ride.offer.expiry_started', {
        action: 'expire_offer',
        rideId: offer.rideId,
        status: offer.status,
        vehicleType: offer.vehicleType,
      });
      try {
        await declineOffer(offer.offerId, 'expired');
      } catch (error) {
        logRideClientEvent('ride.offer.expiry_failed', {
          action: 'expire_offer',
          rideId: offer.rideId,
          error,
        }, 'warning');
      }
      setOffer(null);
      router.replace('/driver-home');
    };

    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [offer?.offerId, offer?.expiresAtMs, offer?.status, offer?.rideId, offer?.vehicleType, router]);

  async function handleAccept() {
    if (!offer || accepting || declining || secondsLeft <= 0) return;
    setAccepting(true);
    setAcceptError('');
    logRideClientEvent('ride.offer.accept_button_pressed', {
      action: 'accept_offer_ui',
      rideId: offer.rideId,
      status: offer.status,
      vehicleType: offer.vehicleType,
    });

    try {
      const result = await acceptOffer(offer.offerId);
      setAccepted(result);
      logRideClientEvent('ride.offer.accept_navigation_ready', {
        action: 'show_accepted_offer',
        rideId: result?.rideId || offer.rideId,
        resultStatus: result?.status,
        vehicleType: offer.vehicleType,
      });
    } catch (error) {
      logRideClientEvent('ride.offer.accept_ui_failed', {
        action: 'accept_offer_ui',
        rideId: offer.rideId,
        error,
      }, 'warning');
      setAcceptError(
        error?.message
        || 'Não foi possível aceitar a corrida. Talvez outro motorista tenha aceitado antes.'
      );
    } finally {
      setAccepting(false);
    }
  }

  async function handleDecline() {
    if (!offer || accepting || declining) return;
    setDeclining(true);
    setAcceptError('');
    logRideClientEvent('ride.offer.decline_button_pressed', {
      action: 'decline_offer_ui',
      rideId: offer.rideId,
      status: offer.status,
      vehicleType: offer.vehicleType,
    });

    try {
      await declineOffer(offer.offerId, 'driver_declined');
      router.replace('/driver-home');
    } catch (error) {
      logRideClientEvent('ride.offer.decline_ui_failed', {
        action: 'decline_offer_ui',
        rideId: offer.rideId,
        error,
      }, 'warning');
      setAcceptError(error?.message || 'Não foi possível recusar a oferta.');
    } finally {
      setDeclining(false);
    }
  }

  async function openNav(which) {
    if (!accepted?.pickup) return;
    setAcceptError('');
    try {
      if (which === 'waze') await openWazeToPoint(accepted.pickup, accepted.vehicleType);
      else await openGoogleMapsToPoint(accepted.pickup, accepted.vehicleType);
    } catch (_error) {
      setAcceptError(which === 'waze'
        ? 'Não foi possível abrir o Waze. Tente o Google Maps.'
        : 'Não foi possível abrir o Google Maps. Tente o Waze.');
    }
  }

  const presentation = offer ? deriveRideOfferPresentation(driver, offer, Date.now()) : null;
  const urgent = secondsLeft <= 5;
  const acceptDisabled = accepting || declining || secondsLeft <= 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Header
            title="Nova corrida"
            subtitle={accepted ? 'Corrida aceita' : 'Analise os detalhes antes de aceitar'}
          />

          {accepted ? (
            <AppCard>
              <Text style={styles.acceptedTitle}>Corrida aceita!</Text>
              <Text style={styles.muted}>O endereço exato do embarque já está liberado.</Text>
              <View style={styles.stack}>
                <AppButton title="Abrir no Waze" onPress={() => openNav('waze')} />
                <AppButton title="Abrir no Google Maps" onPress={() => openNav('gmaps')} />
              </View>
              <AppButton
                title="Ir para a corrida"
                variant="ghost"
                onPress={() => router.replace({
                  pathname: '/active-ride',
                  params: { rideId: accepted.rideId },
                })}
              />
            </AppCard>
          ) : offer && presentation ? (
            <>
              <AppCard style={styles.offerCard}>
                <View style={styles.offerHeader}>
                  <View style={styles.offerHeading}>
                    <Text style={styles.eyebrow}>OFERTA PARA {presentation.vehicleName.toUpperCase()}</Text>
                    <Text style={styles.offerTitle}>Corrida disponível</Text>
                  </View>
                  <View style={[styles.countdown, urgent && styles.countdownUrgent]}>
                    <Text style={[styles.countdownValue, urgent && styles.countdownUrgentText]}>
                      {secondsLeft}s
                    </Text>
                    <Text style={[styles.countdownLabel, urgent && styles.countdownUrgentText]}>
                      para responder
                    </Text>
                  </View>
                </View>

                <View style={styles.pickupBox}>
                  <Text style={styles.pickupIcon}>📍</Text>
                  <View style={styles.flex}>
                    <Text style={styles.label}>Embarque</Text>
                    <Text style={styles.pickupText}>
                      {offer.pickupPreview?.label || 'Região do embarque'}
                    </Text>
                  </View>
                </View>

                <View style={styles.moneyRow}>
                  <View style={styles.moneyBox}>
                    <Text style={styles.label}>Valor estimado</Text>
                    <Text style={styles.moneyValue}>{formatBRL(presentation.fareCentavos)}</Text>
                  </View>
                  <View style={[styles.moneyBox, styles.netBox]}>
                    <Text style={styles.label}>Você recebe</Text>
                    <Text style={[styles.moneyValue, styles.successText]}>
                      {formatBRL(presentation.driverNetCentavos)}
                    </Text>
                  </View>
                </View>

                <View style={styles.infoList}>
                  <InfoRow
                    icon="⏱"
                    label="Tempo até embarque"
                    value={formatPickupEta(presentation.pickupEtaMinutes)}
                  />
                  <InfoRow
                    icon="↔"
                    label="Distância até o embarque"
                    value={formatDistanceKm(offer.distanceToPickupMeters)}
                  />
                  <InfoRow
                    icon="%"
                    label="Comissão desta corrida"
                    value={presentation.commissionPercentLabel}
                    detail={presentation.commissionFree
                      ? 'Promo de 0% ativa'
                      : presentation.minimumGuaranteeApplied
                        ? 'Ajustada pela garantia mínima do motorista'
                        : `Taxa para ${presentation.vehicleName.toLowerCase()}`}
                    tone={presentation.commissionFree ? 'success' : 'default'}
                  />
                  <InfoRow
                    icon="PIX"
                    label="Pagamento"
                    value="Pix direto ao motorista"
                    detail="Você confirma após receber na sua conta."
                  />
                  <InfoRow
                    icon="🔒"
                    label="Destino"
                    value="Liberado após o início da corrida"
                  />
                </View>

                {presentation.acceptanceRate != null ? (
                  <View style={styles.acceptanceChip}>
                    <Text style={styles.acceptanceLabel}>Taxa de aceitação</Text>
                    <Text style={styles.acceptanceValue}>{presentation.acceptanceRate}%</Text>
                  </View>
                ) : null}
              </AppCard>

              {driver ? (
                <AppCard style={styles.statusCard}>
                  <Text style={styles.sectionTitle}>SEU STATUS NESTA OFERTA</Text>

                  {presentation.founderBenefitActive ? (
                    <StatusItem
                      icon="🎉"
                      title="Promo Fundador"
                      detail={`0% de comissão + assinatura grátis por 60 dias${presentation.founderBenefitUntilLabel ? `, até ${presentation.founderBenefitUntilLabel}` : ''}.`}
                      tone="success"
                    />
                  ) : presentation.commissionFree ? (
                    <StatusItem
                      icon="🎁"
                      title="Comissão promocional"
                      detail={`0% de comissão${presentation.commissionFreeUntilLabel ? ` até ${presentation.commissionFreeUntilLabel}` : ''}.`}
                      tone="success"
                    />
                  ) : null}

                  {!presentation.founderBenefitActive && presentation.paidPlanActive ? (
                    <StatusItem
                      icon="✓"
                      title="Plano ativo"
                      detail={`Plano ${presentation.vehicleName}: ${formatBRL(presentation.planCentavos)}/mês${presentation.subscriptionExpiresAtLabel ? `. Próximo pagamento: ${presentation.subscriptionExpiresAtLabel}` : ''}.`}
                      tone="success"
                    />
                  ) : null}

                  {!presentation.founder && !presentation.paidPlanActive && presentation.freeRidesRemaining > 0 ? (
                    <StatusItem
                      icon="📦"
                      title="Plano em breve"
                      detail={`${presentation.freeRidesRemaining} ${presentation.freeRidesRemaining === 1 ? 'corrida restante' : 'corridas restantes'} antes do plano. Plano ${presentation.vehicleName}: ${formatBRL(presentation.planCentavos)}/mês. Depois, ative o plano para continuar recebendo corridas.`}
                    />
                  ) : null}

                  {presentation.subscriptionRequired ? (
                    <StatusItem
                      icon="!"
                      title="Plano necessário"
                      detail="A elegibilidade será validada novamente pelo servidor ao aceitar."
                      tone="warning"
                    />
                  ) : null}
                </AppCard>
              ) : null}

              {driver ? (
                <AppCard style={presentation.walletLow ? styles.walletLowCard : styles.walletCard}>
                  <InfoRow
                    icon="👛"
                    label={presentation.walletLow ? 'Saldo baixo' : 'Saldo da carteira'}
                    value={formatBRL(presentation.walletBalanceCentavos)}
                    tone={presentation.walletLow ? 'warning' : 'default'}
                  />
                  {presentation.commissionFree ? (
                    <View style={styles.noDebitBox}>
                      <Text style={styles.noDebitTitle}>Débito nesta corrida: R$ 0,00</Text>
                      <Text style={styles.noDebitText}>
                        Nenhum débito será feito na carteira durante sua comissão de 0%.
                      </Text>
                    </View>
                  ) : presentation.walletLow ? (
                    <Text style={styles.warningText}>
                      Recarregue para continuar recebendo corridas.
                    </Text>
                  ) : (
                    <Text style={styles.muted}>
                      A comissão desta corrida será reservada ao aceitar.
                    </Text>
                  )}
                </AppCard>
              ) : null}
            </>
          ) : (
            <AppCard><Text style={styles.empty}>Nenhuma corrida disponível no momento.</Text></AppCard>
          )}

          {acceptError ? <Text style={styles.error}>{acceptError}</Text> : null}
        </ScrollView>

        {!accepted && offer ? (
          <View style={styles.actionDock}>
            <AnimatedAcceptRideButton
              onPress={handleAccept}
              disabled={acceptDisabled}
              loading={accepting}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Recusar corrida"
              onPress={handleDecline}
              disabled={accepting || declining}
              style={({ pressed }) => [
                styles.declineButton,
                pressed && styles.declinePressed,
                (accepting || declining) && styles.disabled,
              ]}
            >
              {declining ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
              <Text style={styles.declineText}>{declining ? 'Recusando…' : 'Recusar'}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  screen: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md, flexGrow: 1 },
  flex: { flex: 1 },
  stack: { gap: spacing.sm },
  offerCard: { backgroundColor: colors.background, borderColor: colors.primaryTint, gap: spacing.md },
  offerHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  offerHeading: { flex: 1 },
  eyebrow: { fontFamily, color: colors.primary, letterSpacing: 0.8, ...typography.caption },
  offerTitle: { fontFamily, color: colors.text, marginTop: spacing.xs, ...typography.h3 },
  countdown: { minWidth: 78, alignItems: 'center', borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.primaryTint },
  countdownUrgent: { backgroundColor: colors.dangerBg },
  countdownValue: { fontFamily, color: colors.primary, ...typography.bodyBold },
  countdownLabel: { fontFamily, color: colors.primary, marginTop: 1, ...typography.caption },
  countdownUrgentText: { color: colors.danger },
  pickupBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primaryTint },
  pickupIcon: { fontSize: 20 },
  label: { fontFamily, color: colors.textMuted, ...typography.caption },
  pickupText: { fontFamily, color: colors.text, marginTop: 2, ...typography.bodyBold },
  moneyRow: { flexDirection: 'row', gap: spacing.sm },
  moneyBox: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  netBox: { backgroundColor: colors.successBg, borderColor: colors.accentTint },
  moneyValue: { fontFamily, color: colors.text, marginTop: spacing.sm, ...typography.h3 },
  successText: { color: colors.success },
  infoList: { gap: spacing.xs },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
  infoIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primaryTint },
  infoIconText: { fontFamily, color: colors.primary, fontSize: 13, fontWeight: '700' },
  infoCopy: { flex: 1 },
  infoLabel: { fontFamily, color: colors.textMuted, ...typography.caption },
  infoValue: { fontFamily, marginTop: 2, ...typography.bodyBold },
  infoDetail: { fontFamily, color: colors.textMuted, marginTop: 2, ...typography.small },
  acceptanceChip: { alignSelf: 'flex-start', flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.primaryTint },
  acceptanceLabel: { fontFamily, color: colors.textMuted, ...typography.caption },
  acceptanceValue: { fontFamily, color: colors.primary, ...typography.small, fontWeight: '700' },
  statusCard: { backgroundColor: colors.background, gap: spacing.md },
  sectionTitle: { fontFamily, color: colors.textMuted, letterSpacing: 0.8, ...typography.caption },
  statusItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  statusIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  statusIconText: { fontFamily, color: colors.primary, fontSize: 16, fontWeight: '700' },
  statusCopy: { flex: 1 },
  statusTitle: { fontFamily, color: colors.text, ...typography.bodyBold },
  statusDetail: { fontFamily, color: colors.textMuted, marginTop: spacing.xs, ...typography.small },
  walletCard: { backgroundColor: colors.background },
  walletLowCard: { backgroundColor: colors.warningBg, borderColor: colors.warning },
  noDebitBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.successBg },
  noDebitTitle: { fontFamily, color: colors.success, ...typography.bodyBold },
  noDebitText: { fontFamily, color: colors.text, marginTop: spacing.xs, ...typography.small },
  warningText: { fontFamily, color: colors.warning, ...typography.small, fontWeight: '700' },
  actionDock: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, gap: spacing.sm, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  declineButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.md },
  declinePressed: { backgroundColor: colors.primaryTint },
  declineText: { fontFamily, color: colors.textMuted, ...typography.small, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  acceptedTitle: { fontFamily, color: colors.text, ...typography.h3 },
  muted: { fontFamily, color: colors.textMuted, ...typography.small },
  empty: { fontFamily, color: colors.textMuted, textAlign: 'center', ...typography.small },
  error: { fontFamily, color: colors.danger, ...typography.small },
});
