// Subscription rules.
//
// MVP 0.1: all newly approved drivers get a free subscription window.
// We do NOT auto-charge subscriptions in MVP 0.1. Activation is gated
// behind admin or a feature flag in a later step.

export const SUBSCRIPTION_DEFAULT_FREE_DAYS = 60;

// Helper: is the driver still in the subscription free window?
export function isSubscriptionFreeActive(driver, nowMs) {
  if (!driver || !driver.subscriptionFreeUntil) return false;
  return nowMs < driver.subscriptionFreeUntil;
}
