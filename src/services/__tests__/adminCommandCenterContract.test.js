const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('admin command center contracts', () => {
  it('places urgent work before live status and historical analysis', () => {
    const dashboard = source('src/app/(admin)/dashboard.jsx');

    const urgent = dashboard.indexOf('title="À tratar agora"');
    const live = dashboard.indexOf('title="Agora"');
    const result = dashboard.indexOf('title={`Resultado · ${periodLabel}`}');

    expect(urgent).toBeGreaterThan(-1);
    expect(live).toBeGreaterThan(urgent);
    expect(result).toBeGreaterThan(live);
    expect(dashboard).toContain('useState(1)');
    expect(dashboard).not.toContain('Painel resumido');
  });

  it('loads actionable queues without making the business analytics screen fragile', () => {
    const dashboard = source('src/app/(admin)/dashboard.jsx');

    expect(dashboard).toContain('Promise.allSettled');
    expect(dashboard).toContain("listAdminAlerts('open', 'all', 100)");
    expect(dashboard).toContain("listAdminSupportTickets('open', 100)");
    expect(dashboard).toContain('listDisputedRides(100)');
    expect(dashboard).toContain('partialFailures');
    expect(dashboard).toContain('Atualização parcial');
  });

  it('generates dynamic operational commentary and traceable interactions', () => {
    const dashboard = source('src/app/(admin)/dashboard.jsx');
    const primitives = source('src/components/admin/AdminDashboardPrimitives.jsx');

    expect(dashboard).toContain('buildAutomaticComment');
    expect(primitives).toContain('LEITURA AUTOMÁTICA');
    expect(dashboard).toContain("traceDashboard('comment.generated'");
    expect(dashboard).toContain("traceDashboard('action.opened'");
    expect(dashboard).toContain("traceDashboard('period.changed'");
    expect(dashboard).toContain("traceDashboard('section.toggled'");
  });

  it('distinguishes loading, unavailable and real zero values', () => {
    const dashboard = source('src/app/(admin)/dashboard.jsx');

    expect(dashboard).toContain("loading ? '…' : '—'");
    expect(dashboard).toContain('generatedLabel');
    expect(dashboard).toContain('relativeAge(data.generatedAtMs, clockMs)');
  });

  it('uses icons, semantic tones and expandable analysis with existing color tokens only', () => {
    const dashboard = source('src/app/(admin)/dashboard.jsx');
    const primitives = source('src/components/admin/AdminDashboardPrimitives.jsx');

    expect(dashboard).toContain('StatusBanner');
    expect(dashboard).toContain('InsightCard');
    expect(dashboard).toContain('ActionRow');
    expect(dashboard).toContain('DisclosureSection');
    expect(dashboard).toContain('ProgressMetric');
    expect(primitives).toContain('colors.successBg');
    expect(primitives).toContain('colors.warningBg');
    expect(primitives).toContain('colors.dangerBg');
    expect(primitives).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('uses the secure aggregate for admin-home ride KPIs without changing driver moderation', () => {
    const home = source('src/app/(admin)/admin-home.jsx');

    expect(home).toContain('getAdminBusinessAnalytics(rideRangeDays)');
    expect(home).toContain('deriveAdminRideMetrics');
    expect(home).toContain('label="Solicitações"');
    expect(home).toContain('label="Sem motorista"');
    expect(home).toContain('label="Concluídas"');
    expect(home).toContain('label="Comissão capturada"');
    expect(home).toContain('title="PICOS E DEMANDA"');
    expect(home).toContain('label="Hora com mais solicitações"');
    expect(home).toContain('label="Hora crítica sem motorista"');
    expect(home).toContain('label="Dia mais ativo"');
    expect(home).toContain('label="Pressão máxima"');
    expect(home).toContain('label="Solicitações Moto"');
    expect(home).toContain('label="Solicitações Carro"');
    expect(home).toContain('↻ ATUALIZAR');
    expect(home).not.toContain('setInterval(');
    expect(home).not.toContain("collection(db, 'rideRequests')");
    expect(home).not.toContain('RIDE_REQUEST_PENDING');
    expect(home).not.toContain('label="Hoje" value="0"');
    expect(home).not.toContain('Comissões hoje" value="R$0,00"');

    // Driver approval keeps its existing listener, status filters and routes.
    expect(home).toContain("collection(db, 'drivers')");
    expect(home).toContain('VERIFICATION_STATUS.PENDING_REVIEW');
    expect(home).toContain("pathname: '/(admin)/drivers'");
  });

  it('labels one day as rolling 24 hours and removes the legacy fake ride screens', () => {
    const dashboard = source('src/app/(admin)/dashboard.jsx');
    const requests = source('src/app/(admin)/ride-requests.jsx');
    const rides = source('src/app/(admin)/rides.jsx');

    expect(dashboard).toContain("{ days: 1, label: '24 h' }");
    expect(dashboard).not.toContain("{ days: 1, label: 'Hoje' }");
    expect(requests).toContain('<Redirect href="/(admin)/dashboard" />');
    expect(requests).not.toContain("collection(db, 'rideRequests')");
    expect(rides).toContain('<Redirect href="/(admin)/dashboard" />');
    expect(rides).not.toContain('mockRides');
  });
});
