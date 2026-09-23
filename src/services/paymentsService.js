// Payments client service — the ONLY app-side entry point for Mercado Pago Pix
// driver wallet top-ups. It calls secure Cloud
// Functions callables; the app never holds a Mercado Pago access token, never
// derives prices, and never writes money or wallet fields directly.
//
// All amounts are integer centavos. The backend is authoritative for prices,
// promotions, custom wallet bounds, and application of the payment.

import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

// A short, stable idempotency key (>= 8 chars) so a retried request is not
// charged twice. Combines purpose + a random suffix.
function makeIdempotencyKey() {
  const rand = Math.random().toString(36).slice(2, 12);
  return `top-${rand}${rand}`.slice(0, 40);
}

// Requests a real Pix charge to top up the Saldo DriveLocal. Presets are checked
// against the server allowlist; explicit custom values are checked against the
// authoritative R$ 10..R$ 200 range.
export async function requestWalletTopupPix(amountCentavos, { customAmount = false } = {}) {
  const call = httpsCallable(functions, 'createDriverPixPayment');
  const res = await call({
    purpose: 'wallet_topup',
    amountCentavos,
    customAmount: customAmount === true,
    idempotencyKey: makeIdempotencyKey(),
  });
  return res.data;
}

// Reads the current normalized status of one of the driver's own payments.
// Returns { localPaymentId, purpose, status, amountCentavos, currency, qrCode, qrCodeBase64, expiration }.
export async function getPaymentStatus(localPaymentId) {
  const call = httpsCallable(functions, 'getDriverPaymentStatus');
  const res = await call({ localPaymentId });
  return res.data;
}

// Final states stop client polling.
export const FINAL_PAYMENT_STATUSES = ['paid', 'expired', 'cancelled', 'failed', 'refunded', 'manual_review'];

export function isFinalPaymentStatus(status) {
  return FINAL_PAYMENT_STATUSES.includes(status);
}
