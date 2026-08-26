import {
  deriveDriverWalletView,
  expandWalletTransaction,
  formatTopupPreset,
  mergeDriverWalletHistory,
  parseWalletTopupInput,
} from '../driverWallet';

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

describe('real driver wallet view', () => {
  it.each([
    ['10', 1000],
    ['10,5', 1050],
    ['10,50', 1050],
    ['12.34', 1234],
    ['R$ 200,00', 20000],
  ])('parses %s into exact integer centavos', (input, expected) => {
    expect(parseWalletTopupInput(input)).toEqual({
      valid: true,
      amountCentavos: expected,
      error: null,
    });
  });

  it.each([
    ['', 'Digite um valor entre R$ 10 e R$ 200.'],
    ['9,99', 'O valor mínimo é R$ 10,00.'],
    ['200,01', 'O valor máximo é R$ 200,00.'],
    ['10,999', 'Use no máximo duas casas decimais.'],
    ['abc', 'Use no máximo duas casas decimais.'],
  ])('rejects invalid custom value %s', (input, error) => {
    expect(parseWalletTopupInput(input)).toEqual({
      valid: false,
      amountCentavos: null,
      error,
    });
  });

  it('renders locked preset labels without changing the real amount', () => {
    expect(formatTopupPreset(1000, false)).toBe('R$ 10');
    expect(formatTopupPreset(1000, true)).toBe('🔒 R$ 10');
    expect(formatTopupPreset(5000, true)).toBe('🔒 R$ 50');
  });

  it('uses real available, held and total balances without a fake zero fallback', () => {
    const view = deriveDriverWalletView({
      serviceAreaId: 'HORIZONTE_CE_BR',
      vehicleType: 'moto',
      commissionFreeUntil: null,
      walletBalanceCentavos: 7250,
      walletAvailableCentavos: 6500,
      walletHeldCentavos: 750,
    }, {
      topupPolicy: {
        locked: false,
        presetCentavos: [1000, 2000, 3000, 5000],
        minCentavos: 1000,
        maxCentavos: 20000,
      },
      transactions: [],
      payments: [],
    }, NOW);

    expect(view).toMatchObject({
      balanceCentavos: 7250,
      availableCentavos: 6500,
      heldCentavos: 750,
      balancesReady: true,
      topupLocked: false,
    });

    const missing = deriveDriverWalletView({}, { transactions: [], payments: [] }, NOW);
    expect(missing.balanceCentavos).toBeNull();
    expect(missing.availableCentavos).toBeNull();
    expect(missing.heldCentavos).toBeNull();
    expect(missing.balancesReady).toBe(false);
  });

  it('locks top-ups during the commission-free window with the real unlock date', () => {
    const unlockAtMs = NOW + 20 * DAY_MS;
    const view = deriveDriverWalletView({
      serviceAreaId: 'HORIZONTE_CE_BR',
      vehicleType: 'car',
      commissionFreeUntil: unlockAtMs,
      walletBalanceCentavos: 0,
      walletAvailableCentavos: 0,
      walletHeldCentavos: 0,
    }, {
      topupPolicy: { locked: true, unlockAtMs },
      transactions: [],
      payments: [],
    }, NOW);

    expect(view.topupLocked).toBe(true);
    expect(view.topupUnlockAtMs).toBe(unlockAtMs);
  });

  it('unlocks a mounted wallet when the authoritative date has passed', () => {
    const unlockAtMs = NOW - 1;
    const view = deriveDriverWalletView({
      serviceAreaId: 'HORIZONTE_CE_BR',
      vehicleType: 'moto',
      commissionFreeUntil: unlockAtMs,
      walletBalanceCentavos: 1000,
      walletAvailableCentavos: 1000,
      walletHeldCentavos: 0,
    }, {
      // The last fetched server snapshot may still carry the pre-boundary flag.
      topupPolicy: { locked: true, unlockAtMs },
      transactions: [],
      payments: [],
    }, NOW);

    expect(view.topupLocked).toBe(false);
    expect(view.topupUnlockAtMs).toBe(unlockAtMs);
  });

  it('expands holds, captures and releases into understandable real history rows', () => {
    expect(expandWalletTransaction({
      id: 'hold',
      type: 'commission_hold',
      status: 'held',
      amountCentavos: 300,
      rideId: 'r1',
      createdAtMs: NOW - 100,
    })[0]).toMatchObject({
      kind: 'hold',
      title: 'Reserva da taxa da plataforma',
      amountLabel: '− R$ 3,00',
      status: 'Reservada',
    });

    const capture = expandWalletTransaction({
      id: 'capture',
      type: 'commission_capture',
      amountCentavos: 250,
      releasedCentavos: 50,
      rideId: 'r1',
      createdAtMs: NOW,
    });
    expect(capture).toHaveLength(2);
    expect(capture[0]).toMatchObject({ kind: 'capture', amountLabel: '− R$ 2,50' });
    expect(capture[1]).toMatchObject({ kind: 'release', amountLabel: '+ R$ 0,50' });
  });

  it('does not duplicate a paid Pix request once its ledger top-up exists', () => {
    const history = mergeDriverWalletHistory([
      {
        id: 'ledger-topup',
        type: 'topup',
        amountCentavos: 2000,
        paymentId: 'pay-paid',
        createdAtMs: NOW,
      },
    ], [
      {
        localPaymentId: 'pay-paid',
        purpose: 'wallet_topup',
        status: 'paid',
        amountCentavos: 2000,
        createdAtMs: NOW,
      },
      {
        localPaymentId: 'pay-pending',
        purpose: 'wallet_topup',
        status: 'pending',
        amountCentavos: 3000,
        createdAtMs: NOW + 1,
      },
    ]);

    expect(history.filter((row) => row.title.startsWith('Recarga Pix'))).toHaveLength(2);
    expect(history[0]).toMatchObject({
      kind: 'payment',
      status: 'Aguardando pagamento',
      amountLabel: 'R$ 30,00',
    });
    expect(history[1]).toMatchObject({
      kind: 'topup',
      status: 'Confirmada',
      amountLabel: '+ R$ 20,00',
    });
  });
});
