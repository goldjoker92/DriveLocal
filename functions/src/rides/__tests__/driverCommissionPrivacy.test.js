// Exact commission amounts are backend/admin-only. Driver-facing projections may
// expose only the closed percentage vocabulary: 0, 1200 or 1500 basis points.

const {
  safeAcceptanceView,
  safeDriverAcceptanceView,
  safeCommissionDisplayBps,
  safeDriverLifecycleView,
} = require('../safeViews');
const { commissionDisplayBpsForOffer } = require('../offers');

const NOW = Date.UTC(2026, 6, 26, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function acceptedRide(overrides = {}) {
  return {
    status: 'assigned',
    vehicleType: 'moto',
    estimatedFareCentavos: 900,
    pickup: { lat: -4.1, lng: -38.5, label: 'Pickup exato' },
    commercialPolicySnapshot: { commissionBpsAtAcceptance: 1200 },
    ...overrides,
  };
}

describe('driver commission privacy boundary', () => {
  it('keeps exact hold only inside the backend acceptance result', () => {
    const internal = safeAcceptanceView('ride_1', acceptedRide(), 108);
    expect(internal.commissionHoldCentavos).toBe(108);

    const view = safeDriverAcceptanceView(internal);
    expect(view).toEqual({
      rideId: 'ride_1',
      status: 'assigned',
      vehicleType: 'moto',
      estimatedFareCentavos: 900,
      commissionDisplayBps: 1200,
      pickup: { lat: -4.1, lng: -38.5, label: 'Pickup exato' },
    });
    expect(view).not.toHaveProperty('commissionHoldCentavos');
    expect(JSON.stringify(view)).not.toContain('108');
  });

  it('maps a zero hold to zero percent without exposing the amount', () => {
    const internal = safeAcceptanceView('ride_2', acceptedRide(), 0);
    const view = safeDriverAcceptanceView(internal);
    expect(view.commissionDisplayBps).toBe(0);
    expect(view).not.toHaveProperty('commissionHoldCentavos');
  });

  it('strips capture and release amounts from the public completion response', () => {
    const view = safeDriverLifecycleView({
      rideId: 'ride_3',
      status: 'completed',
      commissionCapturedCentavos: 135,
      holdReleasedCentavos: 15,
    });

    expect(view).toEqual({ rideId: 'ride_3', status: 'completed' });
    expect(JSON.stringify(view)).not.toContain('135');
    expect(JSON.stringify(view)).not.toContain('15');
  });

  it('allows only 0, 1200 or 1500 basis points', () => {
    expect(safeCommissionDisplayBps(acceptedRide(), 1)).toBe(1200);
    expect(safeCommissionDisplayBps(acceptedRide({
      vehicleType: 'car',
      commercialPolicySnapshot: { commissionBpsAtAcceptance: 1500 },
    }), 1)).toBe(1500);
    expect(safeCommissionDisplayBps(acceptedRide(), 0)).toBe(0);
  });

  it('publishes zero percent during the 60-day free window', () => {
    const bps = commissionDisplayBpsForOffer(
      { vehicleType: 'moto', estimatedCommissionCentavos: 108 },
      {
        approvalNumber: 101,
        founderEligible: false,
        approvedAtMs: NOW - DAY_MS,
        commissionFreeUntil: NOW + DAY_MS,
        vehicleType: 'moto',
      },
      NOW
    );
    expect(bps).toBe(0);
  });

  it('publishes standard percentage after the free window without publishing centavos', () => {
    expect(commissionDisplayBpsForOffer(
      { vehicleType: 'moto', estimatedCommissionCentavos: 108 },
      { commissionFreeUntil: NOW - 1, vehicleType: 'moto' },
      NOW
    )).toBe(1200);

    expect(commissionDisplayBpsForOffer(
      { vehicleType: 'car', estimatedCommissionCentavos: 199 },
      { commissionFreeUntil: NOW - 1, vehicleType: 'car' },
      NOW
    )).toBe(1500);
  });

  it('publishes zero percent when the backend minimum guarantee removes commission', () => {
    expect(commissionDisplayBpsForOffer(
      { vehicleType: 'moto', estimatedCommissionCentavos: 0 },
      { commissionFreeUntil: NOW - 1, vehicleType: 'moto' },
      NOW
    )).toBe(0);
  });
});