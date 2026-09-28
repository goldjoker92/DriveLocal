// Ride live location presentation. Pure functions, no React, no Firebase.
//
// Why this exists (field incident 2026-09-27): passengers cancelled because the
// car stayed frozen on their map with a vague "sinal temporariamente
// desatualizado", and the driver never noticed his position was not shared.
// Every state below says what is happening and what to do, in plain words:
//  - the driver card distinguishes "the app is repairing by itself" from
//    "you must act" (permission, GPS off);
//  - the passenger map never blames the driver for the passenger's own missing
//    connection, says when the driver is simply waiting at the pickup, and keeps
//    the ride reassuring ("continua confirmada") when the signal is lost.

import { timestampToMillis } from './rideTracking';

// Passenger map: past this age the car is presented as "no signal" (dimmed
// marker, message shortcut). Below it, a short gap is normal between two points.
export const PASSENGER_SIGNAL_LOST_AFTER_MS = 60_000;
// A phone clock slightly behind the server makes a brand-new point look like it
// comes "from the future". Up to this skew it is simply a fresh point.
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;

// --- Driver card --------------------------------------------------------------

// The app repairs these by itself (supervisor): no driver action is required.
const DRIVER_RECONNECTING = new Set([
  'waiting_gps',
  'service_not_started',
  'error',
  'session_mismatch',
  'no_ride_session',
]);

const DRIVER_ACTION_MESSAGES = Object.freeze({
  services_disabled: 'Ative o GPS do telefone para compartilhar sua posição.',
  foreground_required: 'Autorize a localização precisa para continuar.',
  background_required: 'Autorize “Permitir o tempo todo” para manter a posição durante a corrida.',
  foreground_denied: 'A localização precisa foi recusada.',
  background_denied: 'A localização em segundo plano foi recusada.',
  invalid_session: 'Não foi possível iniciar a localização ao vivo.',
});

const DRIVER_RECONNECTING_DETAIL = Object.freeze({
  waiting_gps: 'Aguardando sinal de GPS. O app tenta de novo sozinho.',
  service_not_started: 'Deixe o DriveLocal aberto alguns segundos para retomar o envio.',
});

/**
 * @param {string} trackingStatus result status of attach/supervise, or 'checking'
 * @returns {{ tone: 'active'|'checking'|'reconnecting'|'action', title: string,
 *   message: string, actionKind: 'retry'|'enable'|null, actionTitle: string|null }}
 */
export function driverRideTrackingPresentation(trackingStatus) {
  if (trackingStatus === 'active') {
    return {
      tone: 'active',
      title: 'Ativa',
      message: 'Ativa — o passageiro pode acompanhar seu deslocamento.',
      actionKind: null,
      actionTitle: null,
    };
  }
  if (trackingStatus === 'checking') {
    return {
      tone: 'checking',
      title: 'Verificando',
      message: 'Verificando o GPS…',
      actionKind: null,
      actionTitle: null,
    };
  }
  if (DRIVER_RECONNECTING.has(trackingStatus)) {
    return {
      tone: 'reconnecting',
      title: 'Reconectando',
      message: DRIVER_RECONNECTING_DETAIL[trackingStatus]
        || 'Reconectando a localização. O app tenta de novo sozinho.',
      actionKind: 'retry',
      actionTitle: 'Tentar agora',
    };
  }
  return {
    tone: 'action',
    title: 'Ação necessária',
    message: DRIVER_ACTION_MESSAGES[trackingStatus] || DRIVER_ACTION_MESSAGES.invalid_session,
    actionKind: 'enable',
    actionTitle: 'Ativar localização da corrida',
  };
}

// --- Passenger map ------------------------------------------------------------

/** Server time of a ride point, the same source the freshness check uses. */
export function trackingPointMs(location) {
  return timestampToMillis(location?.updatedAt) || Number(location?.updatedAtMs || 0);
}

/**
 * Age of a ride point on the passenger's phone. A point up to
 * CLOCK_SKEW_TOLERANCE_MS "in the future" is a phone clock slightly behind the
 * server: it is age 0, not an outdated point.
 */
export function trackingPointAgeMs(location, nowMs) {
  const pointMs = trackingPointMs(location);
  if (!(pointMs > 0)) return null;
  const age = nowMs - pointMs;
  if (age < 0) return age >= -CLOCK_SKEW_TOLERANCE_MS ? 0 : null;
  return age;
}

export function ageLabel(ageMs) {
  if (!Number.isFinite(ageMs)) return 'sem atualização';
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 5) return 'agora';
  if (seconds < 60) return `há ${seconds}s`;
  return `há ${Math.floor(seconds / 60)} min`;
}

/**
 * One caption for the passenger map, in priority order.
 *
 * @param {{ rideStatus?: string, hasDriverPoint: boolean, ageMs: number|null,
 *   staleAfterMs: number, passengerOffline?: boolean, ownPositionVisible?: boolean }} input
 * @returns {{ tone: 'fresh'|'stale'|'lost'|'waiting'|'arrived'|'offline', text: string,
 *   dimDriver: boolean, offerMessage: boolean }}
 */
export function passengerTrackingPresentation({
  rideStatus,
  hasDriverPoint,
  ageMs,
  staleAfterMs,
  passengerOffline = false,
  ownPositionVisible = false,
}) {
  const fresh = hasDriverPoint && Number.isFinite(ageMs) && ageMs <= staleAfterMs;
  const lost = hasDriverPoint && (!Number.isFinite(ageMs) || ageMs >= PASSENGER_SIGNAL_LOST_AFTER_MS);

  // The passenger's own phone is offline: never blame the driver for it.
  if (passengerOffline) {
    return {
      tone: 'offline',
      text: 'Sem conexão no seu celular. A posição do motorista volta assim que a internet voltar.',
      dimDriver: hasDriverPoint && !fresh,
      offerMessage: false,
    };
  }
  if (!hasDriverPoint) {
    return {
      tone: 'waiting',
      text: 'Aguardando a primeira posição do motorista…',
      dimDriver: false,
      offerMessage: false,
    };
  }
  // Waiting at the pickup is not a lost signal: the car is where it should be.
  if (rideStatus === 'driver_arrived') {
    return { tone: 'arrived', text: 'Motorista no local de embarque.', dimDriver: false, offerMessage: false };
  }
  if (fresh) {
    return {
      tone: 'fresh',
      text: `Posição atualizada ${ageLabel(ageMs)}.`,
      dimDriver: false,
      offerMessage: false,
    };
  }
  if (!lost) {
    return {
      tone: 'stale',
      text: `Última posição ${ageLabel(ageMs)}. Atualizando…`,
      dimDriver: false,
      offerMessage: false,
    };
  }
  if (rideStatus === 'in_progress') {
    return {
      tone: 'lost',
      text: ownPositionVisible
        ? `Sem sinal do celular do motorista ${ageLabel(ageMs)}. O ponto azul mostra onde você está.`
        : `Sem sinal do celular do motorista ${ageLabel(ageMs)}.`,
      dimDriver: true,
      offerMessage: false,
    };
  }
  return {
    tone: 'lost',
    text: `Sem sinal do motorista ${ageLabel(ageMs)}. A corrida continua confirmada.`,
    dimDriver: true,
    offerMessage: rideStatus === 'assigned',
  };
}
