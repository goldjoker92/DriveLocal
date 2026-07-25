// @ts-check

const {
  STALE_HOLD_MS,
  analyzeRideFinancialState,
  analyzeDriverWallet,
} = require('../risk/reconciliation');
const riskC = require('../risk/constants');

const NOW = Date.parse('2026-08-10T12:00:00.000Z');

function reasons(alerts) {
  return alerts.map((alert) => alert.reasonCode);
}

describe('financial reconciliation', () => {
  it('accepts a correctly captured commission', () => {
    const alerts = analyzeRideFinancialState({
      rideId: 'ride_ok',
      status: 'completed',
      commissionHoldCentavos: 150,
      finalCommissionCentavos: 150,
      commissionCapturedCentavos: 150,
      holdReleasedCentavos: 0,
      commissionPolicySnapshot: { commissionFreeAtAcceptance: false },
    }, NOW);
    expect(alerts).toEqual([]);
  });

  it('does not report a legitimate commission-free ride', () => {
    const alerts = analyzeRideFinancialState({
      rideId: 'ride_free',
      status: 'completed',
      commissionHoldCentavos: 0,
      finalCommissionCentavos: 150,
      commissionCapturedCentavos: 0,
      holdReleasedCentavos: 0,
      commissionPolicySnapshot: { commissionFreeAtAcceptance: true },
    }, NOW);
    expect(alerts).toEqual([]);
  });

  it('flags a completed ride with no settlement', () => {
    const alerts = analyzeRideFinancialState({
      rideId: 'ride_missing_capture',
      status: 'completed',
      commissionHoldCentavos: 200,
      finalCommissionCentavos: 200,
      commissionPolicySnapshot: { commissionFreeAtAcceptance: false },
    }, NOW);
    expect(reasons(alerts)).toContain(riskC.REASON.COMMISSION_NOT_SETTLED);
    expect(alerts.some((alert) => alert.severity === riskC.SEVERITY.CRITICAL)).toBe(true);
  });

  it('flags a capture greater than the frozen hold', () => {
    const alerts = analyzeRideFinancialState({
      rideId: 'ride_over_capture',
      status: 'completed',
      commissionHoldCentavos: 100,
      finalCommissionCentavos: 180,
      commissionCapturedCentavos: 180,
      holdReleasedCentavos: 0,
      commissionPolicySnapshot: { commissionFreeAtAcceptance: false },
    }, NOW);
    expect(reasons(alerts)).toContain(riskC.REASON.COMMISSION_CAPTURE_EXCEEDS_HOLD);
  });

  it('flags a payment hold older than 24 hours', () => {
    const alerts = analyzeRideFinancialState({
      rideId: 'ride_stale',
      status: 'awaiting_payment',
      commissionHoldCentavos: 120,
      awaitingPaymentAtMs: NOW - STALE_HOLD_MS - 1,
    }, NOW);
    expect(reasons(alerts)).toEqual([riskC.REASON.COMMISSION_HOLD_STALE]);
    expect(alerts[0].amountAtRiskCentavos).toBe(120);
  });

  it('flags wallet summary values that cannot reconcile', () => {
    const alerts = analyzeDriverWallet({
      driverId: 'driver_bad_wallet',
      walletBalanceCentavos: 1000,
      walletAvailableCentavos: 700,
      walletHeldCentavos: 200,
    });
    expect(reasons(alerts)).toContain(riskC.REASON.WALLET_LEDGER_MISMATCH);
    expect(alerts[0].amountAtRiskCentavos).toBe(100);
  });

  it('accepts wallet balance = available + held', () => {
    expect(analyzeDriverWallet({
      driverId: 'driver_ok_wallet',
      walletBalanceCentavos: 1000,
      walletAvailableCentavos: 800,
      walletHeldCentavos: 200,
    })).toEqual([]);
  });
});
