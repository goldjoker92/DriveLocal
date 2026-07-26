const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('driver commission privacy contract', () => {
  it('does not calculate exact commission in the mobile presentation layer', () => {
    const presentation = source('src/utils/rideOfferPresentation.js');

    expect(presentation).toContain('offer?.commissionDisplayBps');
    expect(presentation).toContain('SAFE_COMMISSION_DISPLAY_BPS');
    expect(presentation).toContain('driverReceivesCentavos: fare');
    expect(presentation).not.toContain('BPS_DENOMINATOR');
    expect(presentation).not.toContain('rawCommission');
    expect(presentation).not.toContain('commissionCentavos:');
    expect(presentation).not.toMatch(/fare\s*\*\s*standardBps/);
  });

  it('sanitizes the acceptance callable while retaining internal hold diagnostics', () => {
    const safeViews = source('functions/src/rides/safeViews.js');
    const callables = source('functions/src/rides/callables.js');

    expect(safeViews).toContain('safeDriverAcceptanceView');
    expect(safeViews).toContain('commissionDisplayBps: safeCommissionDisplayBps');
    expect(callables).toContain('acceptDriverOfferPublic');
    expect(callables).toContain('safeDriverAcceptanceView(result)');
    expect(callables).toContain('acceptDriverOfferPublic({ db: admin.firestore()');
  });

  it('sanitizes the driver completion callable while retaining internal settlement', () => {
    const callables = source('functions/src/rides/callables.js');
    const lifecycle = source('functions/src/rides/lifecycle.js');

    expect(callables).toContain('confirmDriverPixReceivedPublic');
    expect(callables).toContain('safeDriverLifecycleView(result)');
    expect(callables).toContain("bindLifecycle('confirmDriverPixReceivedSecure', confirmDriverPixReceivedPublic)");
    // Exact amounts remain available only to backend ledger/audit code.
    expect(lifecycle).toContain('commissionCapturedCentavos: settlement.captured');
    expect(lifecycle).toContain("type: 'commission_capture'");
  });

  it('stores only the closed percentage vocabulary on driver offers', () => {
    const offers = source('functions/src/rides/offers.js');

    expect(offers).toContain('commissionDisplayBps: commissionDisplayBpsForOffer');
    expect(offers).toContain('SAFE_DRIVER_COMMISSION_BPS');
    expect(offers).not.toContain('estimatedCommissionCentavos: ride.estimatedCommissionCentavos');
    expect(offers).not.toContain('commissionHoldCentavos:');
  });

  it('keeps forbidden driver-facing copy out of current driver screens', () => {
    const offerScreen = source('src/app/(driver)/ride-request.jsx');
    const activeRideScreen = source('src/app/(driver)/active-ride.jsx');
    const driverHome = source('src/app/(driver)/driver-home.jsx');
    const driverUi = `${offerScreen}\n${activeRideScreen}\n${driverHome}`;

    expect(driverUi).not.toContain('DriveLocal recebeu R$');
    expect(driverUi).not.toContain('Taxa da plataforma R$');
    expect(driverUi).not.toContain('Comissão cobrada R$');
    expect(driverUi).not.toContain('commissionHoldCentavos');
    expect(driverUi).not.toContain('commissionCapturedCentavos');
  });
});