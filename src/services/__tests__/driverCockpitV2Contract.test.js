const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('compact real driver cockpit contract', () => {
  it('mounts the compact profile, availability and real dashboard hierarchy', () => {
    const screen = source('src/app/(driver)/driver-home.jsx');

    expect(screen).toContain('DriverCockpitProfileCard');
    expect(screen).toContain('DriverCockpitDashboardCard');
    expect(screen).toContain('Começar a trabalhar');
    expect(screen).toContain('Parar de trabalhar');
    expect(screen).toContain("router.replace({ pathname: '/active-ride'");
    expect(screen).not.toContain('Ativar assinatura — em breve');
    expect(screen).not.toContain('Após ativar sua assinatura, você terá 0% de comissão por 60 dias.');
    expect(screen).not.toContain('Comissão padrão: 15%');
    expect(screen).not.toContain('MOCK_');
  });

  it('renders only real summary fields and safe commission percentage copy', () => {
    const dashboard = source('src/components/DriverCockpitDashboardCard.jsx');
    const summary = source('src/utils/driverCockpitSummary.js');

    expect(dashboard).toContain('summary.todayRideCount');
    expect(dashboard).toContain('summary.todayReceivedCentavos');
    expect(dashboard).toContain('summary.weekRideCount');
    expect(dashboard).toContain('summary.weekReceivedCentavos');
    expect(dashboard).toContain('commission.label');
    expect(dashboard).not.toContain('commissionCentavos');
    expect(dashboard).not.toContain('DriveLocal recebeu');
    expect(dashboard).not.toContain('42,80');
    expect(dashboard).not.toContain('186,40');
    expect(summary).not.toContain('Math.random');
  });

  it('lets the commercial policy override stale wallet presentation state', () => {
    const dashboard = source('src/components/DriverCockpitDashboardCard.jsx');

    expect(dashboard).toContain("commission?.mode === 'free'");
    expect(dashboard).toContain("summary.walletState === 'blocked'");
    expect(dashboard).toContain('nenhuma recarga necessária');
    expect(dashboard).toContain('recarga necessária');
  });

  it('keeps display name and photo loading free of email and private-path fallbacks', () => {
    const profile = source('src/components/DriverCockpitProfileCard.jsx');
    const summary = source('src/utils/driverCockpitSummary.js');

    expect(profile).toContain('getDriverPhotoDownloadUrl(approvedPath)');
    expect(profile).toContain('driverCockpitDisplayName(driver)');
    expect(summary).toContain("normalized.includes('@')");
    expect(profile).not.toContain('driver.email');
    expect(profile).not.toContain('profilePhotoUrl');
  });

  it('exports an idempotent completion trigger for real daily and weekly counters', () => {
    const index = source('functions/src/index.js');
    const trigger = source('functions/src/drivers/cockpitStatsTrigger.js');
    const policy = source('functions/src/drivers/cockpitStats.js');

    expect(index).toContain('exports.driverCockpitStatsTrigger');
    expect(trigger).toContain('onDocumentUpdated');
    expect(trigger).toContain('retry: true');
    expect(trigger).toContain('cockpitStatsAppliedVersion');
    expect(trigger).toContain('duplicate_ignored');
    expect(trigger).toContain('finalFareCentavos');
    expect(policy).toContain("COCKPIT_TIME_ZONE = 'America/Fortaleza'");
    expect(policy).toContain('todayRideCount');
    expect(policy).toContain('weekRideCount');
    expect(policy).toContain('eventKey > priorKey');
    expect(policy).toContain('An older event must');
  });

  it('keeps cockpit aggregates server-owned in Firestore rules', () => {
    const rules = source('backend/firebase/rules/firestore.rules');
    const updateMatch = rules.match(/function driverUpdateSafe\(\)[\s\S]*?\n    }/);
    expect(updateMatch).not.toBeNull();
    expect(updateMatch[0]).not.toContain('cockpitStats');
  });

  it('keeps cockpit traces free of names, plates and financial balances', () => {
    const screen = source('src/app/(driver)/driver-home.jsx');
    const traceBlock = screen.match(/const entry = \{[\s\S]*?\n    \};/);
    expect(traceBlock).not.toBeNull();
    expect(traceBlock[0]).not.toMatch(/displayName|fullName|vehiclePlate|walletBalanceCentavos|walletAvailableCentavos/);
    expect(traceBlock[0]).toContain('todayRideCount');
    expect(traceBlock[0]).toContain('weekRideCount');
  });
});