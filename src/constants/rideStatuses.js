// Ride lifecycle. Use these string constants everywhere — never raw strings.

export const RIDE_SEARCHING = 'searching';
export const RIDE_ACCEPTED = 'accepted';
export const RIDE_DRIVER_ARRIVED = 'driver_arrived';
export const RIDE_PASSENGER_BOARDED = 'passenger_boarded';
export const RIDE_IN_PROGRESS = 'in_progress';
export const RIDE_COMPLETED = 'completed';
export const RIDE_CANCELLED_BY_PASSENGER = 'cancelled_by_passenger';
export const RIDE_CANCELLED_BY_DRIVER = 'cancelled_by_driver';
export const RIDE_PAYMENT_DISPUTE = 'payment_dispute';
export const RIDE_EXPIRED = 'expired';

export const RIDE_STATUSES = [
  RIDE_SEARCHING,
  RIDE_ACCEPTED,
  RIDE_DRIVER_ARRIVED,
  RIDE_PASSENGER_BOARDED,
  RIDE_IN_PROGRESS,
  RIDE_COMPLETED,
  RIDE_CANCELLED_BY_PASSENGER,
  RIDE_CANCELLED_BY_DRIVER,
  RIDE_PAYMENT_DISPUTE,
  RIDE_EXPIRED,
];

// Ride events used for the rideEvents append-only log.
export const RIDE_EVENT_CREATED = 'ride_created';
export const RIDE_EVENT_DRIVER_ACCEPTED = 'driver_accepted';
export const RIDE_EVENT_COMMISSION_CHARGED = 'commission_charged';
export const RIDE_EVENT_DRIVER_ARRIVED = 'driver_arrived';
export const RIDE_EVENT_PASSENGER_BOARDED = 'passenger_boarded';
export const RIDE_EVENT_RIDE_STARTED = 'ride_started';
export const RIDE_EVENT_PASSENGER_CLAIMED_PAID = 'passenger_claimed_paid';
export const RIDE_EVENT_DRIVER_CONFIRMED_PAYMENT = 'driver_confirmed_payment';
export const RIDE_EVENT_RIDE_COMPLETED = 'ride_completed';
export const RIDE_EVENT_RIDE_CANCELLED = 'ride_cancelled';
export const RIDE_EVENT_REFUND_REQUESTED = 'refund_requested';
export const RIDE_EVENT_ADMIN_ADJUSTMENT = 'admin_adjustment';
