const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('block 16 rebuilt active ride screen contract', () => {
  it('keeps the operational hierarchy on the secured active ride screen', () => {
    const screen = source('src/app/(driver)/active-ride.jsx');

    expect(screen).toContain("listenToMyOffer(");
    expect(screen).toContain('rideId\n    );');
    expect(screen).toContain('<DriverActiveRideStageCard');
    expect(screen).toContain('<DriverActiveRideNavigationCard');
    expect(screen).toContain('<PixPaymentSummary');
    expect(screen).toContain('Localização ao vivo');
    expect(screen).toContain('driver.active_ride.primary_action_pressed');
  });

  it('renders one fixed primary action after the scrollable content', () => {
    const screen = source('src/app/(driver)/active-ride.jsx');
    const footer = source('src/components/DriverActiveRidePrimaryFooter.jsx');

    expect((screen.match(/<DriverActiveRidePrimaryFooter/g) || [])).toHaveLength(1);
    expect(screen.indexOf('<DriverActiveRidePrimaryFooter')).toBeGreaterThan(screen.indexOf('</ScrollView>'));
    expect(screen).toContain("edges={['top', 'bottom']}");
    expect(footer).toContain('driver-active-ride-primary-footer');
    expect(footer).toContain('minHeight: 56');
    expect(footer).toContain('paddingBottom: spacing.md');
  });

  it('maps the footer to the existing secure lifecycle actions', () => {
    const screen = source('src/app/(driver)/active-ride.jsx');
    const policy = source('src/utils/driverActiveRideScreen.js');

    expect(policy).toContain("label: 'CHEGUEI AO LOCAL'");
    expect(policy).toContain("label: 'PASSAGEIRO EMBARCOU'");
    expect(policy).toContain("label: 'FINALIZAR CORRIDA'");
    expect(policy).toContain("label: 'PAGAMENTO RECEBIDO'");
    expect(screen).toContain("arrive: () => act('arrive', markDriverArrived)");
    expect(screen).toContain("start: () => act('start', startRide)");
    expect(screen).toContain("finish: () => act('finish', finishRide)");
    expect(screen).toContain("confirm: () => act('confirm', confirmDriverPixReceived)");
  });

  it('does not duplicate primary lifecycle buttons inside the scroll view', () => {
    const screen = source('src/app/(driver)/active-ride.jsx');

    expect(screen).not.toContain('title={busy === \'arrive\'');
    expect(screen).not.toContain('title={busy === \'start\'');
    expect(screen).not.toContain('title={busy === \'finish\'');
    expect(screen).not.toContain('title={busy === \'confirm\'');
    expect(screen).toContain('title="Problema no pagamento"');
    expect(screen).toContain('title="Cancelar corrida"');
  });

  it('navigates to pickup before boarding and destination after boarding', () => {
    const screen = source('src/app/(driver)/active-ride.jsx');
    const policy = source('src/utils/driverActiveRideScreen.js');
    const maps = source('src/utils/maps.js');

    expect(policy).toContain("status === 'assigned' || status === 'driver_arrived'");
    expect(policy).toContain("kind: 'pickup'");
    expect(policy).toContain("status === 'in_progress'");
    expect(policy).toContain("kind: 'destination'");
    expect(screen).toContain("openNav(navigation?.point, 'waze', navigation?.kind)");
    expect(screen).toContain("openNav(navigation?.point, 'gmaps', navigation?.kind)");
    expect(maps).toContain("vehicleType === 'moto' ? 'two-wheeler' : 'driving'");
    expect(maps).toContain("vehicleType === 'moto' ? 'motorcycle' : 'private'");
  });

  it('represents GPS attention and intentional shutdown without inventing state', () => {
    const screen = source('src/app/(driver)/active-ride.jsx');
    const stage = source('src/components/DriverActiveRideStageCard.jsx');

    expect(screen).toContain("? 'stopped'");
    expect(screen).toContain("? 'checking'");
    expect(screen).toContain(": 'attention'");
    expect(stage).toContain("stopped: 'GPS ENCERRADO'");
    expect(stage).toContain("attention: 'GPS REQUER ATENÇÃO'");
  });

  it('keeps payment failure visible and terminal states without a primary footer action', () => {
    const screen = source('src/app/(driver)/active-ride.jsx');
    const policy = source('src/utils/driverActiveRideScreen.js');

    expect(screen).toContain("const paymentFailed = status === 'disputed'");
    expect(screen).toContain('A tela permanece aberta e o valor continua registrado');
    expect(policy).not.toMatch(/completed:\s*{\s*key:/);
    expect(policy).not.toMatch(/disputed:\s*{\s*key:/);
    expect(policy).not.toMatch(/cancelled:\s*{\s*key:/);
  });
});
