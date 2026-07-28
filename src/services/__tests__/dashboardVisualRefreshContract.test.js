const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('dashboard visual refresh contract', () => {
  test('uses a dedicated passenger ride-request hero instead of the generic primary button', () => {
    const home = source('src/app/(passenger)/passenger-home.jsx');
    const cta = source('src/components/PassengerRideRequestCta.jsx');

    expect(home).toContain("import PassengerRideRequestCta from '../../components/PassengerRideRequestCta'");
    expect(home).toContain('<PassengerRideRequestCta');
    expect(home).not.toContain("title={profileLoading ? 'CARREGANDO CONTA…' : 'PEDIR CORRIDA'}");
    expect(cta).toContain("accessibilityLabel=\"Pedir corrida\"");
    expect(cta).toContain("Haptics.ImpactFeedbackStyle.Medium");
    expect(cta).toContain("minHeight: 104");
    expect(cta).toContain("backgroundColor: colors.primary");
    expect(cta).toContain("shadowOpacity: 0.26");
    expect(cta).toContain("NOVA CORRIDA");
    expect(cta).toContain("Informe embarque, destino e escolha moto ou carro.");
  });

  test('gives the admin command center solid status, elevated KPIs and cockpit sections', () => {
    const primitives = source('src/components/admin/AdminDashboardPrimitives.jsx');
    const dashboard = source('src/app/(admin)/dashboard.jsx');

    expect(dashboard).toContain('StatusBanner');
    expect(dashboard).toContain('KpiCard');
    expect(dashboard).toContain('DisclosureSection');
    expect(primitives).toContain('backgroundColor: selected.solid');
    expect(primitives).toContain('shadowOpacity: 0.2');
    expect(primitives).toContain('minHeight: 142');
    expect(primitives).toContain('borderLeftWidth: 5');
    expect(primitives).toContain('backgroundColor: expanded ? colors.primary : colors.background');
    expect(primitives).toContain('LEITURA AUTOMÁTICA');
    expect(primitives).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
