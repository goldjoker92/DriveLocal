const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('admin positive business pulse contracts', () => {
  it('keeps the positive pulse visible under the automatic operational reading', () => {
    const primitives = source('src/components/admin/AdminDashboardPrimitives.jsx');

    expect(primitives).toContain("import AdminBusinessPulse from './AdminBusinessPulse'");
    expect(primitives).toContain('<AdminBusinessPulse />');
    expect(primitives.indexOf('LEITURA AUTOMÁTICA'))
      .toBeLessThan(primitives.indexOf('<AdminBusinessPulse />'));
  });

  it('offers rolling 7, 30, 45 and 90-day positive windows', () => {
    const pulse = source('src/components/admin/AdminBusinessPulse.jsx');
    const backend = source('functions/src/risk/adminAnalytics.js');

    expect(pulse).toContain("{ days: 7, label: '7 dias' }");
    expect(pulse).toContain("{ days: 30, label: '30 dias' }");
    expect(pulse).toContain("{ days: 45, label: '45 dias' }");
    expect(pulse).toContain("{ days: 90, label: '90 dias' }");
    expect(pulse).toContain('useState(7)');
    expect(pulse).toContain('getAdminBusinessAnalytics(selectedDays)');
    expect(backend).toContain('new Set([1, 7, 30, 45, 90])');
  });

  it('separates actual period revenue from a normalized 30-day estimate', () => {
    const pulse = source('src/components/admin/AdminBusinessPulse.jsx');

    expect(pulse).toContain('Receita confirmada · ${selectedDays}d');
    expect(pulse).toContain('Comissão capturada · ${selectedDays}d');
    expect(pulse).toContain('Média por corrida concluída');
    expect(pulse).toContain('Projeção bruta · 30 dias');
    expect(pulse).toContain('Math.round((confirmedRevenue / selectedDays) * 30)');
    expect(pulse).toContain('Média diária ${money(averageDailyRevenue)} × 30');
    expect(pulse).toContain('Janela móvel de {selectedDays} dias');
  });

  it('never presents projected revenue as net profit', () => {
    const pulse = source('src/components/admin/AdminBusinessPulse.jsx');

    expect(pulse).toContain('receita bruta estimada, não lucro líquido');
    expect(pulse).toContain('custos, impostos, marketing e retiradas não estão descontados');
    expect(pulse).toContain('accountingProfit: false');
    expect(pulse).not.toContain('lucro líquido estimado');
    expect(pulse).not.toContain('benefício líquido');
  });

  it('emits traceable period, pulse and projection logs without sensitive records', () => {
    const pulse = source('src/components/admin/AdminBusinessPulse.jsx');

    expect(pulse).toContain('[ADMIN_POSITIVE_PULSE]');
    expect(pulse).toContain("tracePulse('load.started'");
    expect(pulse).toContain("tracePulse('load.succeeded'");
    expect(pulse).toContain("tracePulse('load.failed'");
    expect(pulse).toContain("tracePulse('period.changed'");
    expect(pulse).toContain("tracePulse('projection.calculated'");
    expect(pulse).toContain('basisWindowDays: selectedDays');
    expect(pulse).not.toContain('paymentPixPayload');
    expect(pulse).not.toContain('pickup.lat');
    expect(pulse).not.toContain('destination.lat');
  });
});
