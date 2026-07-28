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

  it('keeps the final #100/#101, five-ride and day-60 rules explicit', () => {
    const backend = source('functions/src/drivers/commercialPolicy.js');

    expect(backend).toContain('FOUNDER_LIMIT');
    expect(backend).toContain('FREE_RIDE_LIMIT');
    expect(backend).toContain('freePeriodActive && freeRidesRemaining > 0');
    expect(backend).toContain('commissionBps = freePeriodActive ? 0 : standardBps');
    expect(backend).toContain('subscriptionRequired: !subscriptionCovered');
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

  it('routes subscription and wallet Pix decisions through the same policy', () => {
    const payment = source('functions/src/payments/createPixPayment.js');

    expect(payment).toContain("require('../drivers/commercialPolicy')");
    expect(payment).toContain('resolveCommercialPolicy(driver, nowMs)');
    expect(payment).toContain('subscriptionPaymentBlockedByGrace');
    expect(payment).toContain('commercial.freePeriodActive');
    expect(payment).toContain('payment.create.commercial_policy_resolved');
    expect(payment).toContain('payment.create.not_required');
    expect(payment).toContain('payment.create.duplicate_ignored');
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