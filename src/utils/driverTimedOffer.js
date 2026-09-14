import { formatBRL, formatDistanceKm } from './format';
import { estimatePickupMinutes, formatPickupEta } from './rideOfferPresentation';

export const DRIVER_TIMED_OFFER_VERSION = 'driver-timed-offer-v2';
export const DRIVER_TIMED_OFFER_URGENT_SECONDS = 5;

function finiteNonNegative(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function safeLabel(value, fallback) {
  const text = typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : '';
  return text || fallback;
}

const SAFE_COMMISSION_DISPLAY_BPS = new Set([0, 1200, 1500]);

function formatRouteDuration(seconds) {
  const value = finiteNonNegative(seconds);
  if (value == null) return 'Tempo da corrida carregando';
  if (value === 0) return 'Agora';
  return `${Math.max(1, Math.ceil(value / 60))} min`;
}

function platformFeeLabel(offer, fallbackLabel, commissionStatus) {
  const displayBps = finiteNonNegative(offer?.commissionDisplayBps);
  if (displayBps != null && SAFE_COMMISSION_DISPLAY_BPS.has(displayBps)) {
    return displayBps === 0 ? 'Sem taxa' : `${displayBps / 100}%`;
  }

  const fallback = typeof fallbackLabel === 'string' ? fallbackLabel.trim() : '';
  if (fallback === '0%') return 'Sem taxa';
  if (fallback) return fallback;
  return commissionStatus === 'failed' ? 'Validada ao aceitar' : 'Carregando…';
}

export function timedOfferVehicle(vehicleType) {
  if (vehicleType === 'moto') return { type: 'moto', emoji: '🏍', label: 'MOTO' };
  if (vehicleType === 'car') return { type: 'car', emoji: '🚗', label: 'CARRO' };
  return { type: 'unknown', emoji: '🚘', label: 'VEÍCULO' };
}

export function deriveDriverTimedOffer({
  offer,
  secondsLeft = 0,
  commissionPercentLabel = null,
  commissionStatus = 'loading',
} = {}) {
  const distanceMeters = finiteNonNegative(offer?.distanceToPickupMeters);
  const fareCentavos = finiteNonNegative(offer?.estimatedFareCentavos);
  const routeDistanceMeters = finiteNonNegative(offer?.routeDistanceMeters);
  const vehicle = timedOfferVehicle(offer?.vehicleType);
  const seconds = Math.max(0, Math.ceil(Number(secondsLeft) || 0));
  const etaMinutes = distanceMeters != null && vehicle.type !== 'unknown'
    ? estimatePickupMinutes(distanceMeters, vehicle.type)
    : null;
  const fareLabel = fareCentavos == null ? 'Carregando valor…' : formatBRL(fareCentavos);
  const commissionLabel = platformFeeLabel(
    offer,
    commissionPercentLabel,
    commissionStatus
  );

  return {
    version: DRIVER_TIMED_OFFER_VERSION,
    visible: offer?.status === 'offered',
    offerId: offer?.offerId || null,
    rideId: offer?.rideId || null,
    secondsLeft: seconds,
    urgent: seconds <= DRIVER_TIMED_OFFER_URGENT_SECONDS,
    vehicle,
    pickupRegionLabel: safeLabel(offer?.pickupPreview?.label, 'Região do embarque'),
    distanceLabel: distanceMeters == null ? 'Distância carregando' : formatDistanceKm(distanceMeters),
    etaLabel: etaMinutes == null ? 'Tempo carregando' : formatPickupEta(etaMinutes),
    destinationRegionLabel: safeLabel(
      offer?.destinationPreview?.label,
      'Região do destino'
    ),
    routeDistanceLabel: routeDistanceMeters == null
      ? 'Distância da corrida carregando'
      : formatDistanceKm(routeDistanceMeters),
    routeDurationLabel: formatRouteDuration(offer?.routeDurationSeconds),
    fareCentavos,
    fareLabel,
    driverReceivesLabel: fareLabel,
    commissionLabel,
    paymentLabel: 'Pix direto',
    acceptTitle: fareCentavos == null ? 'ACEITAR' : `ACEITAR — ${fareLabel}`,
  };
}
