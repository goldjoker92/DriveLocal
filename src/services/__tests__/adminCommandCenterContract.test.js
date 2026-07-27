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

    expect(dashboard).toContain('buildAutomaticComment');
    expect(dashboard).toContain('LEITURA AUTOMÁTICA');
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
});
