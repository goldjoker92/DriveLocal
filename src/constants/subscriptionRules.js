// Subscription rules.
//
// MVP 0.1: all newly approved drivers get a free subscription window.
// We do NOT auto-charge subscriptions in MVP 0.1. Activation is gated
// behind admin or a feature flag in a later step.

export const SUBSCRIPTION_DEFAULT_FREE_DAYS = 60;

// Iteration 2B: manual admin/test activation for approved non-founder drivers.
// An active subscription lasts 30 days and grants 0% commission for 60 days.
export const SUBSCRIPTION_ACTIVE_DAYS = 30;
export const SUBSCRIPTION_COMMISSION_FREE_DAYS = 60;

// subscriptionPaymentMode values written to drivers/{uid}.
//   manual_admin_test — admin/dev test activation (Iteration 2B, the only one used today).
//   manual_pix        — future MVP: driver pays via Pix, admin confirms manually.
//   pix_webhook       — future V2: automated Pix confirmation via webhook.
// Do NOT build manual_pix / pix_webhook flows now — they are documented for later only.
export const SUBSCRIPTION_PAYMENT_MODE = {
  MANUAL_ADMIN_TEST: 'manual_admin_test',
  MANUAL_PIX: 'manual_pix',
  PIX_WEBHOOK: 'pix_webhook',
};

// Helper: is the driver still in the subscription free window?
export function isSubscriptionFreeActive(driver, nowMs) {
  if (!driver || !driver.subscriptionFreeUntil) return false;
  return nowMs < driver.subscriptionFreeUntil;
}
