const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.cwd());

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const {
  REQUIRED_CONFIRMATION,
  REQUIRED_SECRET_NAMES,
  validateStaticConfiguration,
} = require('../../scripts/release/release-check');
const {
  OPERATIONAL_PHASES,
  validateProductionSourceAudit,
} = require('../../scripts/release/production-source-audit');

describe('production release gate', () => {
  it('exposes one non-mutating command with a valid monotonic Android versionCode', () => {
    const packageJson = JSON.parse(source('package.json'));
    const appJson = JSON.parse(source('app.json'));

    expect(packageJson.scripts['release:check']).toBe('node scripts/release/release-check.js');
    expect(appJson.expo.version).toBe(packageJson.version);
    expect(Number.isInteger(appJson.expo.android.versionCode)).toBe(true);
    expect(appJson.expo.android.versionCode).toBeGreaterThanOrEqual(3);
  });

  it('uses only the two requested manual confirmations', () => {
    const releaseCheck = source('scripts/release/release-check.js');
    const envExample = source('.env.example');

    expect(REQUIRED_CONFIRMATION).toBe('YES');
    expect(releaseCheck).toContain('RELEASE_CONFIRM_PROD_SECRETS');
    expect(releaseCheck).toContain('RELEASE_CONFIRM_DEV_APK');
    expect(envExample).toContain('RELEASE_CONFIRM_PROD_SECRETS=');
    expect(envExample).toContain('RELEASE_CONFIRM_DEV_APK=');
    expect(releaseCheck).not.toMatch(/TWO_PHONE|TWO_DEVICE|DEUX_TELEPHONE/i);
    expect(envExample).not.toMatch(/TWO_PHONE|TWO_DEVICE|DEUX_TELEPHONE/i);
  });

  it('runs source audit, tests and config validation without deploy, build or submit', () => {
    const releaseCheck = source('scripts/release/release-check.js');

    expect(releaseCheck).toContain("require('./production-source-audit')");
    expect(releaseCheck).toContain('validateProductionSourceAudit({ root: ROOT })');
    expect(releaseCheck).toContain("runCommand('Tests application', ['test'])");
    expect(releaseCheck).toContain("runCommand('Tests Firebase Functions', ['--prefix', 'functions', 'test'])");
    expect(releaseCheck).toContain("runCommand('Configuration Firebase PROD', ['run', 'validate:env:prod'])");
    expect(releaseCheck).not.toContain('firebase deploy');
    expect(releaseCheck).not.toContain('eas build');
    expect(releaseCheck).not.toContain('eas submit');
    expect(releaseCheck).not.toContain("runCommand('Lint'");
    expect(releaseCheck).not.toContain("runCommand('Preview'");
  });

  it('keeps the production source audit green on the committed codebase', () => {
    expect(OPERATIONAL_PHASES).toEqual([
      'requested',
      'started',
      'succeeded',
      'failed',
      'restored',
      'duplicate_ignored',
    ]);
    expect(validateProductionSourceAudit({ root: ROOT })).toEqual([]);
  });

  it('declares the three required backend secret names without reading their values', () => {
    expect(REQUIRED_SECRET_NAMES).toEqual([
      'ROUTING_PROVIDER_API_KEY',
      'MERCADO_PAGO_ACCESS_TOKEN',
      'MERCADO_PAGO_WEBHOOK_SECRET',
    ]);
  });

  it('fails closed when manual production evidence is absent', () => {
    const problems = validateStaticConfiguration({});
    expect(problems).toEqual(expect.arrayContaining([
      'Confirmer les secrets PROD avec RELEASE_CONFIRM_PROD_SECRETS=YES.',
      'Confirmer l’APK DEV validé avec RELEASE_CONFIRM_DEV_APK=YES.',
      'GOOGLE_MAPS_ANDROID_API_KEY est requis pour la production.',
      'GOOGLE_SERVICES_JSON doit pointer vers le fichier Firebase drivelocal-prod.',
    ]));
  });

  it('keeps the legacy top-up route free of fake people and wallet mutations', () => {
    const topups = source('src/app/(admin)/topups-pending.jsx');
    expect(topups).not.toMatch(/MOCK_TOPUPS|Ana Pereira|Pedro Alves/);
    expect(topups).toContain("router.replace('/admin-alerts')");
    expect(topups).not.toMatch(/updateDoc|httpsCallable|walletBalanceCentavos/);
  });
});
