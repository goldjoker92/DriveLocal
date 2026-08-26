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
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (/\.(?:js|jsx)$/.test(entry.name)) {
        files.push(absolute);
      }
    }
  }

  walk(root);
  return files;
}

describe('block 18 real driver wallet contract', () => {
  it('removes every wallet mock from production source', () => {
    const offenders = productionSourceFiles('src')
      .filter((absolute) => /mockDrivers|MOCK_TX/.test(fs.readFileSync(absolute, 'utf8')))
      .map((absolute) => path.relative(process.cwd(), absolute));

    expect(offenders).toEqual([]);
    expect(fs.existsSync(path.join(process.cwd(), 'src/mock/mockDrivers.js'))).toBe(false);
  });

  it('renders real available, held and total balances without a fake zero default', () => {
    const screen = source('src/app/(driver)/wallet.jsx');
    const card = source('src/components/WalletCard.jsx');
    const service = source('src/services/driverWalletService.js');

    expect(screen).toContain('listenToDriverWallet');
    expect(screen).toContain('loadDriverWalletSnapshot');
    expect(screen).toContain('availableCents={balanceLoading ? null : wallet.availableCentavos}');
    expect(screen).toContain('heldCents={balanceLoading ? null : wallet.heldCentavos}');
    expect(screen).toContain('balanceCents={balanceLoading ? null : wallet.balanceCentavos}');
    expect(card).toContain('balanceCents = null');
    expect(card).toContain('availableCents = null');
    expect(card).toContain('heldCents = null');
    expect(card).toContain("return Number.isInteger(value) && value >= 0 ? formatBRL(value) : 'Carregando…'");
    expect(service).toContain("doc(db, 'drivers', driverId)");
    expect(service).toContain('{ includeMetadataChanges: true }');
  });

  it('uses one authenticated safe projection instead of exposing raw finance collections', () => {
    const mobileService = source('src/services/driverWalletService.js');
    const backend = source('functions/src/wallet/driverWalletSnapshot.js');
    const callables = source('functions/src/wallet/callables.js');
    const index = source('functions/src/index.js');
    const rules = source('backend/firebase/rules/firestore.rules');

    expect(mobileService).toContain("httpsCallable(functions, 'getDriverWalletSnapshot')");
    expect(mobileService).not.toContain("collection(db, 'walletTransactions'");
    expect(mobileService).not.toContain("collection(db, 'paymentRequests'");
    expect(backend).toContain('const driverId = request?.auth?.uid');
    expect(backend).toContain(".where('driverId', '==', driverId)");
    expect(backend).toContain(".where('purpose', '==', 'wallet_topup')");
    expect(backend).not.toContain('providerOrderId:');
    expect(backend).not.toContain('idempotencyKey:');
    expect(backend).not.toContain('adminUid:');
    expect(backend).not.toContain('note:');
    expect(callables).toContain("withCallableBoundary('getDriverWalletSnapshot'");
    expect(index).toContain('exports.getDriverWalletSnapshot = walletCallables.getDriverWalletSnapshot');
    expect(rules).toContain('match /walletTransactions/{docId}     { allow read, write: if false; }');
    expect(rules).toContain('match /paymentRequests/{docId}        { allow read, write: if false; }');
  });

  it('presents real top-ups, holds, releases, captures and payment statuses', () => {
    const view = source('src/utils/driverWallet.js');
    const screen = source('src/app/(driver)/wallet.jsx');
    const accept = source('functions/src/rides/acceptOffer.js');
    const lifecycle = source('functions/src/rides/lifecycle.js');
    const paymentApply = source('functions/src/payments/applyPayment.js');

    expect(view).toContain("case 'topup'");
    expect(view).toContain("case 'commission_hold'");
    expect(view).toContain("case 'commission_hold_release'");
    expect(view).toContain("case 'commission_capture'");
    expect(view).toContain("pending: 'Aguardando pagamento'");
    expect(view).toContain("manual_review: 'Pagamento em análise'");
    expect(screen).toContain('Recargas, reservas, liberações, capturas e status Pix reais.');
    expect(accept).toContain("type: 'commission_hold'");
    expect(lifecycle).toContain("type: 'commission_capture'");
    expect(lifecycle).toContain("type: 'commission_hold_release'");
    expect(paymentApply).toContain("type: 'topup'");
  });

  it('keeps all top-up choices visible but locked during the zero-percent window', () => {
    const screen = source('src/app/(driver)/wallet.jsx');
    const view = source('src/utils/driverWallet.js');
    const backend = source('functions/src/payments/createPixPayment.js');

    expect(screen).toContain('Nenhuma recarga é necessária enquanto sua taxa da plataforma estiver zerada.');
    expect(screen).toContain('As recargas serão liberadas em ${unlockDate}.');
    expect(screen).toContain('formatTopupPreset(amount, wallet.topupLocked)');
    expect(screen).toContain("? '🔒 Outro valor'");
    expect(screen).toContain('disabled={topupControlsDisabled}');
    expect(view).toContain('return locked ? `🔒 ${value}` : value');
    expect(view).toContain('const locked = policyLocked && (!unlockAtMs || unlockAtMs > nowMs)');
    expect(screen).toContain('setTimeout(() => setClockNowMs(Date.now()), delayMs)');

    const mobileGuard = screen.indexOf(
      'if (balanceLoading || !liveDriver || wallet.topupLocked || anyGenerating) return;'
    );
    const mobileProviderCall = screen.indexOf('requestWalletTopupPix(amountCentavos, { customAmount })');
    expect(mobileGuard).toBeGreaterThan(-1);
    expect(mobileProviderCall).toBeGreaterThan(mobileGuard);

    const backendGuard = backend.indexOf('if (commercial.freePeriodActive)');
    const providerCall = backend.indexOf('adapter.createPixOrder({');
    expect(backendGuard).toBeGreaterThan(-1);
    expect(providerCall).toBeGreaterThan(backendGuard);
  });

  it('shows Gerando only on the selected top-up action', () => {
    const screen = source('src/app/(driver)/wallet.jsx');

    expect(screen).toContain('const [generatingKey, setGeneratingKey] = useState(null)');
    expect(screen).toContain('title={generatingKey === key');
    expect(screen).toContain("generatingKey === 'custom'");
    expect(screen).toContain('setGeneratingKey(key)');
    expect(screen).toContain('setGeneratingKey(null)');
    expect(screen).not.toContain("title={busy ? 'Gerando…'");
  });

  it('validates Outro valor in exact centavos on both mobile and backend', () => {
    const screen = source('src/app/(driver)/wallet.jsx');
    const view = source('src/utils/driverWallet.js');
    const service = source('src/services/paymentsService.js');
    const constants = source('functions/src/payments/constants.js');
    const backend = source('functions/src/payments/createPixPayment.js');

    expect(screen).toContain('parseWalletTopupInput(customValue)');
    expect(screen).toContain('{ customAmount: true }');
    expect(screen).toContain('Mínimo R$ 10,00 • máximo R$ 200,00');
    expect(view).toContain('WALLET_TOPUP_MIN_CENTAVOS = 1000');
    expect(view).toContain('WALLET_TOPUP_MAX_CENTAVOS = 20000');
    expect(view).toContain('/^\\d+(?:\\.\\d{1,2})?$/');
    expect(service).toContain('customAmount: customAmount === true');
    expect(constants).toContain('WALLET_TOPUP_MIN_CENTAVOS: 1000');
    expect(constants).toContain('WALLET_TOPUP_MAX_CENTAVOS: 20000');
    expect(backend).toContain('function validateWalletTopupAmount(payload)');
    expect(backend).toContain('requested < C.WALLET_TOPUP_MIN_CENTAVOS');
    expect(backend).toContain('requested > C.WALLET_TOPUP_MAX_CENTAVOS');
    expect(backend).toContain('customAmount must be boolean');
  });

  it('keeps provider verification and exactly-once wallet credit unchanged', () => {
    const webhook = source('functions/src/payments/webhook.js');
    const verify = source('functions/src/payments/verifyAndApply.js');
    const apply = source('functions/src/payments/applyPayment.js');

    expect(webhook).toContain('verifyWebhookSignature');
    expect(verify).toContain('adapter.getOrder(providerOrderId)');
    expect(verify).toContain("if (pay.purpose === 'wallet_topup')");
    expect(apply).toContain('if (pay.status === C.STATUS.PAID && pay.appliedAtMs != null)');
    expect(apply).toContain('walletBalanceCentavos: balance');
    expect(apply).toContain('walletAvailableCentavos: available');
    expect(apply).toContain('walletHeldCentavos intentionally unchanged');
  });
});
