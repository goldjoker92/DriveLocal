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

function sectionBy(view, key) {
  return view.ruleSections.find((section) => section.key === key);
}

function ruleBy(view, sectionKey, ruleKey) {
  return sectionBy(view, sectionKey)?.items.find((item) => item.key === ruleKey);
}

describe('real driver Pix subscription view', () => {
  it('explains every founder obligation during and after the 60-day window', () => {
    const view = deriveDriverSubscriptionView(approvedDriver({
      approvalNumber: 12,
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
      profileTitle: 'Motorista Fundador nº 1–100',
    });
    expect(view.statusDetail).toContain('Assinatura grátis até');
    expect(view.noSurpriseText).toContain('Depois, a assinatura mensal, a taxa normal da plataforma');
    expect(ruleBy(view, 'now', 'subscription')).toMatchObject({ value: 'Grátis' });
    expect(ruleBy(view, 'now', 'commission')).toMatchObject({ value: '0%' });
    expect(ruleBy(view, 'now', 'wallet')).toMatchObject({ value: 'Sem recarga' });
    expect(ruleBy(view, 'after_launch', 'subscription')).toMatchObject({
      value: 'Mensal obrigatória',
    });
    expect(ruleBy(view, 'after_launch', 'commission')).toMatchObject({
      value: '12% por corrida',
    });
    expect(ruleBy(view, 'after_launch', 'wallet')).toMatchObject({ value: 'Obrigatório' });
    expect(ruleBy(view, 'after_launch', 'wallet').detail).toContain('acima de R$ 3,00');
  });

  it('explains #101+ independent five-ride and 60-day counters', () => {
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
      profileTitle: 'Motorista nº 101+',
    });
    expect(view.noSurpriseText).toContain('São contadores independentes');
    expect(ruleBy(view, 'now', 'subscription')).toMatchObject({
      value: 'Sem pagamento',
    });
    expect(ruleBy(view, 'now', 'subscription').detail).toContain('2 corridas promocionais restantes');
    expect(ruleBy(view, 'after_fifth_ride', 'subscription')).toMatchObject({
      value: 'Mensal obrigatória',
    });
    expect(ruleBy(view, 'after_fifth_ride', 'commission')).toMatchObject({
      value: 'Continua 0%',
    });
    expect(ruleBy(view, 'after_launch', 'commission')).toMatchObject({
      value: '12% por corrida',
    });
  });

  it('requires subscription after ride five while preserving commission and wallet grace until day 60', () => {
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
    expect(view.statusDetail).toContain('Taxa da plataforma: 0% até');
    expect(sectionBy(view, 'now').title).toContain('5 corridas promocionais concluídas');
    expect(ruleBy(view, 'now', 'subscription')).toMatchObject({
      value: 'Mensal obrigatória',
    });
    expect(ruleBy(view, 'now', 'commission')).toMatchObject({ value: '0%' });
    expect(ruleBy(view, 'now', 'wallet')).toMatchObject({ value: 'Sem recarga' });
    expect(ruleBy(view, 'after_launch', 'commission')).toMatchObject({
      value: '12% por corrida',
    });
    expect(ruleBy(view, 'after_launch', 'wallet')).toMatchObject({ value: 'Obrigatório' });
  });

  it('applies the same post-day-60 structure to founders and #101+ drivers', () => {
    const founderMoto = deriveDriverSubscriptionView(approvedDriver({
      approvalNumber: 12,
      founderEligible: true,
      founderNumber: 12,
      subscriptionFreeUntil: NOW - 1,
      commissionFreeUntil: NOW - 1,
      freeRideCountUsed: 0,
      vehicleType: 'moto',
    }), NOW);
    const nonFounderCar = deriveDriverSubscriptionView(approvedDriver({
      approvalNumber: 101,
      commissionFreeUntil: NOW - 1,
      freeRideCountUsed: 2,
      vehicleType: 'car',
    }), NOW);

    expect(founderMoto).toMatchObject({
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
    expect(nonFounderCar).toMatchObject({
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

    for (const view of [founderMoto, nonFounderCar]) {
      expect(sectionBy(view, 'now').title).toBe('Agora — período promocional encerrado');
      expect(ruleBy(view, 'now', 'subscription')).toMatchObject({
        value: 'Mensal obrigatória',
      });
      expect(ruleBy(view, 'now', 'wallet')).toMatchObject({ value: 'Obrigatório' });
      expect(ruleBy(view, 'now', 'wallet').detail).toContain('acima de R$ 3,00');
    }
  });

  it('explains active subscription separately from the 60-day commission benefit', () => {
    const currentExpiry = NOW + 12 * DAY_MS;
    const view = deriveDriverSubscriptionView(approvedDriver({
      approvalNumber: 101,
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
    expect(ruleBy(view, 'now', 'subscription')).toMatchObject({ value: 'Ativa' });
    expect(ruleBy(view, 'now', 'commission')).toMatchObject({ value: '0%' });
    expect(ruleBy(view, 'now', 'wallet')).toMatchObject({ value: 'Sem recarga' });
    expect(ruleBy(view, 'after_launch', 'commission')).toMatchObject({
      value: '12% por corrida',
    });
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
    expect(ruleBy(view, 'now', 'subscription')).toMatchObject({
      value: 'Mensal obrigatória',
    });
    expect(ruleBy(view, 'now', 'commission')).toMatchObject({ value: 'Taxa indisponível' });
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
