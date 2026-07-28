import { safeAcceptedPassengerFirstName } from './passengerPublicIdentity';

export const DRIVER_ACTIVE_RIDE_CARD_VERSION = 'driver-active-ride-card-v1';

const HIDDEN_STATUSES = new Set(['completed', 'cancelled']);
const DESTINATION_RELEASED_STATUSES = new Set([
  'in_progress',
  'awaiting_payment',
  'payment_marked_sent',
  'disputed',
]);

function safeLabel(value, fallback) {
  const text = typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : '';
  return text || fallback;
}

export function driverActiveRideVehicle(vehicleType) {
  if (vehicleType === 'moto') return { type: 'moto', emoji: '🏍', label: 'Moto' };
  if (vehicleType === 'car') return { type: 'car', emoji: '🚗', label: 'Carro' };
  return { type: 'unknown', emoji: '🚘', label: 'Veículo' };
}

export function driverActiveRideStatus(offer, explicitStatus = null) {
  if (explicitStatus) return explicitStatus;
  if (offer?.driverRideStatus) return offer.driverRideStatus;
  return offer?.status === 'accepted' ? 'assigned' : null;
}

export function deriveDriverActiveRideCard(offer, explicitStatus = null) {
  const status = driverActiveRideStatus(offer, explicitStatus);
  const accepted = offer?.status === 'accepted' && typeof offer?.rideId === 'string' && offer.rideId;
  const visible = Boolean(accepted && status && !HIDDEN_STATUSES.has(status));
  const destinationReleased = DESTINATION_RELEASED_STATUSES.has(status);
  const passengerIdentity = offer?.acceptedPassengerPublic || null;
  const fareValue = offer?.estimatedFareCentavos;
  const fareCentavos = fareValue != null && Number.isFinite(Number(fareValue))
    ? Math.max(0, Math.round(Number(fareValue)))
    : null;

  return {
    version: DRIVER_ACTIVE_RIDE_CARD_VERSION,
    visible,
    rideId: visible ? offer.rideId : null,
    status,
    passengerFirstName: safeAcceptedPassengerFirstName(passengerIdentity),
    passengerIdentity,
    vehicle: driverActiveRideVehicle(offer?.vehicleType),
    pickupLabel: safeLabel(offer?.exactPickup?.label, 'Local de embarque'),
    destinationReleased,
    destinationLabel: destinationReleased
      ? safeLabel(offer?.exactDestination?.label, 'Destino em carregamento…')
      : 'Liberado após o embarque',
    fareCentavos,
  };
}
