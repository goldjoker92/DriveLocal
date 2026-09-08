// Incoming targeted ride offer (route "/ride-request").
// Before acceptance only a generic/coarsened pickup region is shown. Acceptance,
// refusal and expiry remain server-authoritative; this screen only presents safe data.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AnimatedAcceptRideButton from '../../components/AnimatedAcceptRideButton';
import DriverTimedOfferCard from '../../components/DriverTimedOfferCard';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { fontFamily, typography } from '../../constants/typography';
import { deriveDriverTimedOffer } from '../../utils/driverTimedOffer';
import { deriveRideOfferPresentation } from '../../utils/rideOfferPresentation';
import { logRideClientEvent } from '../../utils/clientRideLog';
import { auth } from '../../config/firebase';
import { getDriver } from '../../services/driverService';
import { dismissRideOfferNotifications } from '../../services/notificationsService';
import { acceptOffer, declineOffer, listenToMyOffer } from '../../services/ridesService';
import { openGoogleMapsToPoint, openWazeToPoint } from '../../utils/maps';

const KNOWN_VEHICLE_TYPES = new Set(['moto', 'car']);

function hasFiniteOfferNumber(value) {
  return value != null && value !== '' && Number.isFinite(Number(value));
}

export default function RideRequest() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const requestedOfferId = typeof params.offerId === 'string' ? params.offerId : null;
  const [offer, setOffer] = useState(null);
  const [driver, setDriver] = useState(null);
  const [driverContextStatus, setDriverContextStatus] = useState('loading');
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [acceptError, setAcceptError] = useState('');
  const [accepted, setAccepted] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const lastLoggedOfferId = useRef(null);
  const lastPresentedOffer = useRef(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;

    let active = true;
    setDriverContextStatus('loading');
    const profileStartedAt = Date.now();

    getDriver(uid)
      .then((data) => {
        if (!active) return;
        if (data) {
          setDriver(data);
          setDriverContextStatus('ready');
        } else {
          setDriver(null);
          setDriverContextStatus('failed');
        }
        logRideClientEvent('ride.offer.business_context_loaded', {
          action: 'load_driver_context',
          status: data ? 'available' : 'missing',
          vehicleType: data?.vehicleType,
          durationMs: Date.now() - profileStartedAt,
        });
      })
      .catch((error) => {
        if (!active) return;
        setDriver(null);
        setDriverContextStatus('failed');
        logRideClientEvent('ride.offer.business_context_failed', {
          action: 'load_driver_context',
          durationMs: Date.now() - profileStartedAt,
          error,
        }, 'warning');
      });

    const unsubscribe = listenToMyOffer(uid, (nextOffer) => {
      if (
        requestedOfferId
        && nextOffer?.offerId !== requestedOfferId
        && nextOffer?.status !== 'accepted'
      ) return;

      const previousPresentedOffer = lastPresentedOffer.current;
      if (nextOffer?.status === 'offered') {
        lastPresentedOffer.current = {
          offerId: nextOffer.offerId,
          rideId: nextOffer.rideId,
        };
      } else if (previousPresentedOffer) {
        lastPresentedOffer.current = null;
        dismissRideOfferNotifications(previousPresentedOffer).catch(() => undefined);
      }

      setOffer(nextOffer);
      if (nextOffer?.offerId && lastLoggedOfferId.current !== nextOffer.offerId) {
        lastLoggedOfferId.current = nextOffer.offerId;
        logRideClientEvent('ride.offer.screen_opened', {
          action: 'show_targeted_offer',
          rideId: nextOffer.rideId,
          status: nextOffer.status,
          vehicleType: nextOffer.vehicleType,
          hasPickupRegion: Boolean(nextOffer.pickupPreview?.label),
          hasPickupDistance: hasFiniteOfferNumber(nextOffer.distanceToPickupMeters),
          hasFare: hasFiniteOfferNumber(nextOffer.estimatedFareCentavos),
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

    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
    };
  }, [requestedOfferId]);

  useEffect(() => {
    if (!offer?.expiresAtMs || offer.status !== 'offered') return undefined;
    let expiring = false;

    const tick = async () => {
      const remaining = Math.max(
        0,
        Math.ceil((Number(offer.expiresAtMs) - Date.now()) / 1000)
      );
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
      await dismissRideOfferNotifications({
        offerId: offer.offerId,
        rideId: offer.rideId,
      });
      setOffer(null);
      router.replace('/driver-home');
    };

    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [
    offer?.offerId,
    offer?.expiresAtMs,
    offer?.status,
    offer?.rideId,
    offer?.vehicleType,
    router,
  ]);

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
      await dismissRideOfferNotifications({
        offerId: offer.offerId,
        rideId: result?.rideId || offer.rideId,
      });
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
      await dismissRideOfferNotifications({
        offerId: offer.offerId,
        rideId: offer.rideId,
      });
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
    if (!accepted?.pickup || !KNOWN_VEHICLE_TYPES.has(accepted?.vehicleType)) return;
    setAcceptError('');
    try {
      if (which === 'waze') {
        await openWazeToPoint(accepted.pickup, accepted.vehicleType);
      } else {
        await openGoogleMapsToPoint(accepted.pickup, accepted.vehicleType);
      }
    } catch (_error) {
      setAcceptError(which === 'waze'
        ? 'Não foi possível abrir o Waze. Tente o Google Maps.'
        : 'Não foi possível abrir o Google Maps. Tente o Waze.');
    }
  }

  // The commercial projection is presentation-only. Unknown vehicle data never
  // falls back to a car percentage; the server validates eligibility on acceptance.
  const presentation = useMemo(() => (
    offer
    && driverContextStatus === 'ready'
    && driver
    && KNOWN_VEHICLE_TYPES.has(offer.vehicleType)
      ? deriveRideOfferPresentation(driver, offer, Date.now())
      : null
  ), [offer, driverContextStatus, driver]);

  const compactOffer = useMemo(() => deriveDriverTimedOffer({
    offer,
    secondsLeft,
    commissionPercentLabel: presentation?.commissionPercentLabel || null,
    commissionStatus: driverContextStatus,
  }), [offer, secondsLeft, presentation?.commissionPercentLabel, driverContextStatus]);

  const acceptDisabled = accepting
    || declining
    || secondsLeft <= 0
    || !compactOffer.visible;
  const acceptedNavigationDisabled = !accepted?.pickup
    || !KNOWN_VEHICLE_TYPES.has(accepted?.vehicleType);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {accepted ? (
            <>
              <Header title="Corrida aceita" subtitle="O embarque exato foi liberado" />
              <AppCard style={styles.acceptedCard}>
                <Text style={styles.acceptedTitle}>Corrida aceita!</Text>
                <Text style={styles.muted}>
                  Abra sua navegação ou entre na tela permanente da corrida.
                </Text>
                <View style={styles.stack}>
                  <AppButton
                    title="Abrir no Waze"
                    onPress={() => openNav('waze')}
                    disabled={acceptedNavigationDisabled}
                  />
                  <AppButton
                    title="Abrir no Google Maps"
                    variant="secondary"
                    onPress={() => openNav('gmaps')}
                    disabled={acceptedNavigationDisabled}
                  />
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
            </>
          ) : compactOffer.visible ? (
            <>
              <Text style={styles.screenEyebrow}>NOVA CORRIDA</Text>
              <DriverTimedOfferCard view={compactOffer} />
              <Text style={styles.privacyCopy}>
                O endereço exato e o destino permanecem protegidos até as etapas corretas da corrida.
              </Text>
            </>
          ) : (
            <AppCard>
              <Text style={styles.empty}>Nenhuma corrida disponível no momento.</Text>
            </AppCard>
          )}

          {acceptError ? <Text style={styles.error}>{acceptError}</Text> : null}
        </ScrollView>

        {!accepted && compactOffer.visible ? (
          <View style={styles.actionDock}>
            <AnimatedAcceptRideButton
              title={compactOffer.acceptTitle}
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
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  screenEyebrow: {
    fontFamily,
    color: colors.primary,
    ...typography.caption,
    fontWeight: '900',
    letterSpacing: 1,
  },
  acceptedCard: { gap: spacing.md },
  stack: { gap: spacing.sm },
  privacyCopy: {
    fontFamily,
    color: colors.textFaint,
    ...typography.caption,
    lineHeight: 16,
    textAlign: 'center',
  },
  actionDock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  declineButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
  },
  declinePressed: { backgroundColor: colors.primaryTint },
  declineText: {
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
    fontWeight: '700',
  },
  disabled: { opacity: 0.5 },
  acceptedTitle: { fontFamily, color: colors.text, ...typography.h3 },
  muted: { fontFamily, color: colors.textMuted, ...typography.small },
  empty: { fontFamily, color: colors.textMuted, textAlign: 'center', ...typography.small },
  error: { fontFamily, color: colors.danger, ...typography.small, textAlign: 'center' },
});
