const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function productionSourceFiles(rootRelativePath) {
  const root = path.join(process.cwd(), rootRelativePath);
  const files = [];

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (/\.(?:js|jsx)$/.test(entry.name)) files.push(absolute);
    }
  }

  walk(root);
  return files;
}

describe('block 19 real Pix subscription contract', () => {
  it('removes every MVP placeholder and obsolete coming-soon activation', () => {
    const screen = source('src/app/(driver)/subscription-plans.jsx');
    const offenders = productionSourceFiles('src')
      .filter((absolute) => /Ativar assinatura\s*[—-]\s*em breve/.test(
        fs.readFileSync(absolute, 'utf8')
      ))
      .map((absolute) => path.relative(process.cwd(), absolute));

    expect(offenders).toEqual([]);
    expect(screen).not.toContain('Step 1 frontend only');
    expect(screen).not.toContain('grátis no MVP');
    expect(screen).not.toContain('SUBSCRIPTION_DEFAULT_FREE_DAYS');
    expect(screen).not.toContain('SubscriptionReminderBanner');
    expect(screen).toContain('listenToDriverSubscription');
    expect(screen).toContain('deriveDriverSubscriptionView');
  });

  it('keeps founder and five-ride grace payment controls visible but locked', () => {
    const model = source('src/utils/driverSubscription.js');
    const screen = source('src/app/(driver)/subscription-plans.jsx');

    expect(model).toContain("paymentButtonTitle = '🔒 Pagar assinatura'");
    expect(model).toContain('corridas sem assinatura utilizadas`');
    expect(model).toContain("paymentReason = 'founder_free_window'");
    expect(model).toContain("paymentReason = 'ride_grace_active'");
    expect(screen).toContain("title={busy ? 'GERANDO PIX…' : view.paymentButtonTitle}");
    expect(screen).toContain('disabled={paymentDisabled}');
    expect(screen).toContain('O pagamento de 30 dias será liberado após a quinta corrida');
  });

  it('states unmistakably that paid subscriptions last 30 days, not 60 days', () => {
    const pricing = source('src/constants/pricingConfig.js');
    const screen = source('src/app/(driver)/subscription-plans.jsx');

    expect(pricing).toContain('SUBSCRIPTION_PERIOD_DAYS = 30');
    expect(screen).toContain('Cada pagamento de assinatura vale 30 dias');
    expect(screen).toContain('Os 60 dias não são a duração da assinatura');
    expect(screen).toContain('Seu plano de 30 dias');
    expect(screen).toContain('Planos de 30 dias');
    expect(screen).toContain('Assinatura de 30 dias via Pix');
    expect(screen).toContain('30 dias de assinatura ativados');
    expect(screen).not.toContain('plano de 60 dias');
    expect(screen).not.toContain('assinatura de 60 dias');
  });

  it('shows the real plans, periods and standard commissions', () => {
    const pricing = source('src/constants/pricingConfig.js');
    const model = source('src/utils/driverSubscription.js');
    const screen = source('src/app/(driver)/subscription-plans.jsx');

    expect(pricing).toContain('[VEHICLE_MOTO]: 990');
    expect(pricing).toContain('[VEHICLE_CAR]: 1990');
    expect(pricing).toContain('normalCommissionBps: 1200');
    expect(pricing).toContain('normalCommissionBps: 1500');
    expect(pricing).toContain('SUBSCRIPTION_PERIOD_DAYS = 30');
    expect(model).toContain('priceLabel: formatBRL(priceCentavos)');
    expect(model).toContain('commissionLabel: `${commissionBps / 100}%`');
    expect(screen).toContain('Planos de 30 dias');
    expect(screen).toContain('Taxa da plataforma padrão: ${plan.commissionLabel}');
    expect(screen).toContain('plan.priceLabel');
  });

  it('requires server-confirmed policy and pending-payment restoration before creating Pix', () => {
    const screen = source('src/app/(driver)/subscription-plans.jsx');
    const service = source('src/services/driverSubscriptionService.js');

    const guardIndex = screen.indexOf('if (paymentDisabled || pendingPayment) return;');
    const callIndex = screen.indexOf('requestSubscriptionPix()');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(callIndex).toBeGreaterThan(guardIndex);
    expect(screen).toContain("const paymentContextReady = serverConfirmed && snapshotStatus === 'ready'");
    expect(screen).toContain("const activationPending = paymentStatus === 'paid'");
    expect(screen).toContain('|| activationPending');
    expect(service).toContain('{ includeMetadataChanges: true }');
    expect(service).toContain("httpsCallable(functions, 'getDriverSubscriptionSnapshot')");
  });

  it('uses the real Mercado Pago Pix flow without a client-provided subscription amount', () => {
    const screen = source('src/app/(driver)/subscription-plans.jsx');
    const paymentService = source('src/services/paymentsService.js');
    const paymentSheet = source('src/components/DriverPixPaymentSheet.jsx');
    const creation = source('functions/src/payments/createPixPayment.js');
    const subscriptionStart = paymentService.indexOf(
      'export async function requestSubscriptionPix()'
    );
    const walletStart = paymentService.indexOf(
      'export async function requestWalletTopupPix'
    );
    const subscriptionClientBlock = paymentService.slice(subscriptionStart, walletStart);

    expect(subscriptionStart).toBeGreaterThan(-1);
    expect(walletStart).toBeGreaterThan(subscriptionStart);
    expect(subscriptionClientBlock).toContain("purpose: 'driver_subscription'");
    expect(subscriptionClientBlock).not.toContain('amountCentavos');
    expect(screen).toContain('title="Assinatura de 30 dias via Pix"');
    expect(screen).toContain('Aguardando pagamento…');
    expect(screen).toContain('Pagamento confirmado — 30 dias de assinatura ativados!');
    expect(paymentSheet).toContain('getPaymentStatus(localPaymentId)');
    expect(paymentSheet).toContain('POLL_INTERVAL_MS = 5000');
    expect(creation).toContain('computeSubscriptionExtension(driver, nowMs)');
    expect(creation).toContain("purpose === 'driver_subscription'");
  });

  it('restores only an authenticated actionable subscription payment after restart', () => {
    const snapshot = source('functions/src/payments/subscriptionSnapshot.js');
    const callables = source('functions/src/payments/callables.js');
    const index = source('functions/src/index.js');
    const rules = source('backend/firebase/rules/firestore.rules');
    const screen = source('src/app/(driver)/subscription-plans.jsx');

    expect(snapshot).toContain('const driverId = request?.auth?.uid');
    expect(snapshot).toContain(".where('driverId', '==', driverId)");
    expect(snapshot).toContain(".where('purpose', '==', 'driver_subscription')");
    expect(snapshot).toContain("new Set([C.STATUS.PENDING, C.STATUS.MANUAL_REVIEW])");
    expect(snapshot).toContain('safePaymentView(latest.id, data)');
    expect(callables).toContain("withCallableBoundary('getDriverSubscriptionSnapshot'");
    expect(index).toContain('exports.getDriverSubscriptionSnapshot');
    expect(rules).toContain('match /paymentRequests/{docId}        { allow read, write: if false; }');
    expect(screen).toContain('RETOMAR PIX PENDENTE');
    expect(screen).toContain('loadDriverSubscriptionSnapshot');
  });

  it('preserves remaining paid days and commercial launch fields on activation', () => {
    const domain = source('functions/src/drivers/subscriptionDomain.js');
    const apply = source('functions/src/payments/applyPayment.js');

    expect(domain).toContain('const base = isActive ? currentExpiry : nowMs');
    expect(domain).toContain('const newExpiry = base + C.SUBSCRIPTION_DURATION_DAYS * C.DAY_MS');
    expect(apply).toContain('computeSubscriptionExtension(drv, effectiveMs)');
    expect(apply).toContain('subscriptionExpiresAt: newExpiry');
    expect(apply).toContain('approvedAt, founderNumber, commissionFreeUntil, freeRideCountUsed: untouched');
    expect(apply).toContain('if (pay.status === C.STATUS.PAID && pay.appliedAtMs != null)');
  });

  it('opens the real subscription route from the driver cockpit', () => {
    const cockpit = source('src/components/DriverCockpitDashboardCard.jsx');

    expect(cockpit).toContain("router.push('/subscription-plans')");
    expect(cockpit).toContain('title="Ver assinatura"');
  });

  it('refreshes an already-open screen at commercial and subscription boundaries', () => {
    const model = source('src/utils/driverSubscription.js');
    const screen = source('src/app/(driver)/subscription-plans.jsx');

    expect(model).toContain('transitionAtMs: firstFutureTimestamp');
    expect(screen).toContain('view.transitionAtMs - Date.now() + 250');
    expect(screen).toContain('setTimeout(() => setClockNowMs(Date.now()), delayMs)');
  });
});
