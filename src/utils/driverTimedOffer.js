import { formatBRL, formatDistanceKm } from './format';
import { estimatePickupMinutes, formatPickupEta } from './rideOfferPresentation';

export const DRIVER_TIMED_OFFER_VERSION = 'driver-timed-offer-v1';
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
  const vehicle = timedOfferVehicle(offer?.vehicleType);
  const seconds = Math.max(0, Math.ceil(Number(secondsLeft) || 0));
  const etaMinutes = distanceMeters != null && vehicle.type !== 'unknown'
    ? estimatePickupMinutes(distanceMeters, vehicle.type)
    : null;
  const fareLabel = fareCentavos == null ? 'Carregando valor…' : formatBRL(fareCentavos);
  const commissionLabel = typeof commissionPercentLabel === 'string' && commissionPercentLabel.trim()
    ? commissionPercentLabel.trim()
    : commissionStatus === 'failed'
      ? 'Validada ao aceitar'
      : 'Carregando…';

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
    fareCentavos,
    fareLabel,
    driverReceivesLabel: fareLabel,
    commissionLabel,
    paymentLabel: 'Pix direto',
    acceptTitle: fareCentavos == null ? 'ACEITAR' : `ACEITAR — ${fareLabel}`,
  };
}
