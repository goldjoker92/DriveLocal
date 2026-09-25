const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.cwd());

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function versionFrom(text) {
  const match = text.match(/COMMERCIAL_POLICY_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

describe('commercial policy integration contract', () => {
  it('keeps one identical policy version on backend and mobile', () => {
    const backend = source('functions/src/drivers/commercialPolicy.js');
    const mobile = source('src/utils/commercialPolicy.js');

    expect(versionFrom(backend)).toBeTruthy();
    expect(versionFrom(mobile)).toBe(versionFrom(backend));
  });

  it('keeps the founder badge and approval-based 60-day commission explicit', () => {
    const backend = source('functions/src/drivers/commercialPolicy.js');
    const entry = source('src/app/(auth)/driver-auth.jsx');
    const onboarding = source('src/app/(driver)/onboarding.jsx');

    expect(backend).toContain('FOUNDER_LIMIT');
    expect(backend).toContain('approvedAtMs + C.FREE_PERIOD_DAYS * C.DAY_MS');
    expect(backend).toContain('commissionBps = freePeriodActive ? 0 : standardBps');
    expect(backend).not.toContain('freeRideCountUsed');
    expect(entry).toContain('Todos os motoristas aprovados têm 0% de comissão por 60 dias a partir da aprovação.');
    expect(entry).not.toMatch(/60 dias para os 100 primeiros/);
    expect(onboarding).not.toContain('100% do valor da corrida');
  });

  it('routes dispatch and acceptance through the authoritative backend policy', () => {
    const eligibility = source('functions/src/drivers/eligibility.js');
    const acceptance = source('functions/src/rides/acceptOffer.js');

    expect(eligibility).toContain("require('./commercialPolicy')");
    expect(eligibility).toContain('resolveCommercialPolicy(d, now)');
    expect(acceptance).toContain('buildCommercialPolicySnapshot(driver, nowMs)');
    expect(acceptance).toContain('commercialPolicySnapshot');
    expect(acceptance).toContain('ride.accept.commercial_policy_frozen');
    expect(acceptance).toContain('ride.accept.duplicate_ignored');
  });

  it('rejects the historical purchase before creating any new charge', () => {
    const payment = source('functions/src/payments/createPixPayment.js');

    expect(payment).toContain("payload.purpose === 'driver_subscription'");
    expect(payment).toContain('ERROR_CODES.APP_UPDATE_REQUIRED');
    expect(payment.indexOf('ERROR_CODES.APP_UPDATE_REQUIRED')).toBeLessThan(payment.indexOf('adapter.createPixOrder('));
  });

  it('keeps offer commission copy restricted to safe server-projected percentages', () => {
    const offer = source('src/utils/rideOfferPresentation.js');
    const pricing = source('src/constants/pricingConfig.js');

    expect(pricing).toContain('normalCommissionBps: 1200');
    expect(pricing).toContain('normalCommissionBps: 1500');
    expect(offer).toContain('offer?.commissionDisplayBps');
    expect(offer).toContain('SAFE_COMMISSION_DISPLAY_BPS');
    expect(offer).toContain('commissionPercentLabel: `${displayPercent}%`');
    expect(offer).not.toContain('BPS_DENOMINATOR');
    expect(offer).not.toContain('rawCommission');
    expect(offer).not.toContain('commissionCentavos:');
    expect(offer).not.toContain('effectivePercent');
    expect(offer).not.toContain('DriveLocal recebeu');
    expect(offer).not.toContain('Comissão cobrada');
    expect(offer).not.toContain('Taxa da plataforma');
  });

  it('keeps commercial logs free of obvious contact and Pix payload fields', () => {
    const backendPolicy = source('functions/src/drivers/commercialPolicy.js');
    const payment = source('functions/src/payments/createPixPayment.js');
    const acceptance = source('functions/src/rides/acceptOffer.js');
    const combined = `${backendPolicy}\n${payment}\n${acceptance}`;

    expect(combined).not.toMatch(/logInfo\([^)]*(cpf|phone|telefone|email|pixKey|qrCode)/i);
    expect(backendPolicy).not.toContain('console.log');
  });
});
