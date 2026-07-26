import {
  DRIVER_SUBSCRIPTION_MODE,
  computeRenewedExpirationMs,
  deriveDriverSubscriptionView,
  driverSubscriptionPlan,
} from '../driverSubscription';

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function approvedDriver(overrides = {}) {
  return {
    verificationStatus: 'approved',
    serviceAreaId: 'HORIZONTE_CE_BR',
    vehicleType: 'moto',
    approvedAtMs: NOW - 10 * DAY_MS,
    commissionFreeUntil: NOW + 50 * DAY_MS,
    founderEligible: false,
    freeRideCountUsed: 0,
    subscriptionActive: false,
    subscriptionExpiresAt: null,
    ...overrides,
  };
}

describe('real driver Pix subscription view', () => {
  it('keeps founder payment visible and locked during the 60-day free window', () => {
    const view = deriveDriverSubscriptionView(approvedDriver({
      founderEligible: true,
      founderNumber: 12,
      subscriptionFreeUntil: NOW + 50 * DAY_MS,
    }), NOW);

    expect(view).toMatchObject({
      mode: DRIVER_SUBSCRIPTION_MODE.FOUNDER_FREE,
      statusTitle: 'Assinatura grátis',
      paymentEnabled: false,
      paymentButtonTitle: '🔒 Pagar assinatura',
      paymentReason: 'founder_free_window',
      commissionLabel: '0%',
    });
    expect(view.statusDetail).toContain('Assinatura grátis até');
  });

  it('shows the exact #101+ ride-grace progress and blocks premature payment', () => {
    const view = deriveDriverSubscriptionView(approvedDriver({
      approvalNumber: 101,
      freeRideCountUsed: 3,
    }), NOW);

    expect(view).toMatchObject({
      mode: DRIVER_SUBSCRIPTION_MODE.RIDE_GRACE,
      progressLabel: '3 de 5 corridas sem assinatura utilizadas',
      paymentEnabled: false,
      paymentButtonTitle: '🔒 Pagar assinatura',
      paymentReason: 'ride_grace_active',
      freeRidesRemaining: 2,
    });
  });

  it('requires subscription after ride five while preserving zero commission until day 60', () => {
    const view = deriveDriverSubscriptionView(approvedDriver({
      approvalNumber: 101,
      freeRideCountUsed: 5,
    }), NOW);

    expect(view).toMatchObject({
      mode: DRIVER_SUBSCRIPTION_MODE.REQUIRED_COMMISSION_FREE,
      statusTitle: 'Assinatura necessária',
      paymentEnabled: true,
      paymentButtonTitle: 'PAGAR COM PIX',
      commissionLabel: '0%',
      freeRidesRemaining: 0,
    });
    expect(view.statusDetail).toContain('Comissão 0% até');
  });

  it('shows authoritative vehicle prices and standard commissions after day 60', () => {
    const moto = deriveDriverSubscriptionView(approvedDriver({
      commissionFreeUntil: NOW - 1,
      freeRideCountUsed: 5,
      vehicleType: 'moto',
    }), NOW);
    const car = deriveDriverSubscriptionView(approvedDriver({
      commissionFreeUntil: NOW - 1,
      freeRideCountUsed: 5,
      vehicleType: 'car',
    }), NOW);

    expect(moto).toMatchObject({
      mode: DRIVER_SUBSCRIPTION_MODE.REQUIRED_STANDARD,
      paymentEnabled: true,
      commissionLabel: '12%',
      currentPlan: {
        vehicleType: 'moto',
        priceCentavos: 990,
        priceLabel: 'R$ 9,90',
        periodDays: 30,
        commissionLabel: '12%',
      },
    });
    expect(car).toMatchObject({
      mode: DRIVER_SUBSCRIPTION_MODE.REQUIRED_STANDARD,
      paymentEnabled: true,
      commissionLabel: '15%',
      currentPlan: {
        vehicleType: 'car',
        priceCentavos: 1990,
        priceLabel: 'R$ 19,90',
        periodDays: 30,
        commissionLabel: '15%',
      },
    });
  });

  it('allows early renewal and preserves all remaining paid days', () => {
    const currentExpiry = NOW + 12 * DAY_MS;
    const view = deriveDriverSubscriptionView(approvedDriver({
      freeRideCountUsed: 5,
      subscriptionActive: true,
      subscriptionStatus: 'active',
      subscriptionExpiresAt: currentExpiry,
    }), NOW);

    expect(view).toMatchObject({
      mode: DRIVER_SUBSCRIPTION_MODE.ACTIVE,
      paymentEnabled: true,
      paymentButtonTitle: 'RENOVAR COM PIX',
      paidSubscriptionActive: true,
    });
    expect(view.renewalDetail).toContain('Seus dias restantes são preservados');
    expect(computeRenewedExpirationMs({ subscriptionExpiresAt: currentExpiry }, NOW))
      .toBe(currentExpiry + 30 * DAY_MS);
  });

  it('never invents a price or commission for an unknown vehicle', () => {
    const view = deriveDriverSubscriptionView(approvedDriver({
      vehicleType: null,
      commissionFreeUntil: NOW - 1,
      freeRideCountUsed: 5,
    }), NOW);

    expect(view).toMatchObject({
      mode: DRIVER_SUBSCRIPTION_MODE.REQUIRED_STANDARD,
      currentPlan: null,
      paymentEnabled: false,
      paymentReason: 'vehicle_unknown',
      commissionLabel: null,
    });
    expect(driverSubscriptionPlan('other', 'HORIZONTE_CE_BR')).toBeNull();
  });

  it('exposes the next exact policy transition for an open screen to refresh itself', () => {
    const transitionAtMs = NOW + 2 * DAY_MS;
    const before = deriveDriverSubscriptionView(approvedDriver({
      founderEligible: true,
      subscriptionFreeUntil: transitionAtMs,
      commissionFreeUntil: transitionAtMs,
    }), NOW);
    const after = deriveDriverSubscriptionView(approvedDriver({
      founderEligible: true,
      subscriptionFreeUntil: transitionAtMs,
      commissionFreeUntil: transitionAtMs,
    }), transitionAtMs);

    expect(before.transitionAtMs).toBe(transitionAtMs);
    expect(after.mode).toBe(DRIVER_SUBSCRIPTION_MODE.REQUIRED_STANDARD);
    expect(after.paymentEnabled).toBe(true);
  });
});
