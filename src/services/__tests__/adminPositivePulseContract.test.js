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

  it('uses a real rolling 24-hour aggregate and separates actual revenue from estimates', () => {
    const pulse = source('src/components/admin/AdminBusinessPulse.jsx');

    expect(pulse).toContain('getAdminBusinessAnalytics(1)');
    expect(pulse).toContain('Receita confirmada · 24h');
    expect(pulse).toContain('Comissão capturada · 24h');
    expect(pulse).toContain('Média por corrida concluída');
    expect(pulse).toContain('Projeção bruta · 30 dias');
    expect(pulse).toContain('monthlyGrossProjection = confirmedRevenue > 0 ? confirmedRevenue * 30 : null');
    expect(pulse).toContain('Se o ritmo das últimas 24h se repetir');
  });

  it('never presents projected revenue as net profit', () => {
    const pulse = source('src/components/admin/AdminBusinessPulse.jsx');

    expect(pulse).toContain('receita bruta estimada, não lucro líquido');
    expect(pulse).toContain('custos, impostos, marketing e retiradas não estão descontados');
    expect(pulse).toContain('accountingProfit: false');
    expect(pulse).not.toContain('lucro líquido estimado');
    expect(pulse).not.toContain('benefício líquido');
  });

  it('emits traceable pulse and projection logs without sensitive records', () => {
    const pulse = source('src/components/admin/AdminBusinessPulse.jsx');

    expect(pulse).toContain('[ADMIN_POSITIVE_PULSE]');
    expect(pulse).toContain("tracePulse('load.started'");
    expect(pulse).toContain("tracePulse('load.succeeded'");
    expect(pulse).toContain("tracePulse('load.failed'");
    expect(pulse).toContain("tracePulse('projection.calculated'");
    expect(pulse).not.toContain('paymentPixPayload');
    expect(pulse).not.toContain('pickup.lat');
    expect(pulse).not.toContain('destination.lat');
  });
});
