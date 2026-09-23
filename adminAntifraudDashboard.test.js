// Contract tests for the admin business/antifraud launch surface. These tests are
// intentionally source-level: they catch accidental removal of critical labels,
// secure callable boundaries and review-only actions without needing a native UI.

const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

describe('admin launch command center contracts', () => {
  test('business analytics, risk cases and ride summaries use secure callables', () => {
    const service = read('src/services/adminService.js');
    expect(service).toContain("call('getAdminBusinessAnalyticsSecure'");
    expect(service).toContain("call('listAdminRiskCasesSecure'");
    expect(service).toContain("call('decideAdminRiskCaseSecure'");
    expect(service).toContain("call('getAdminRideSummarySecure'");
    expect(service).toContain("call('listAdminDisputedRidesSecure'");
    expect(service).not.toContain("getDoc(doc(db, 'rideRequests'");
    expect(service).not.toContain("collection(db, 'rideRequests')");
  });

  test('dashboard separates commission revenue, promotion, vehicle mix and supply', () => {
    const dashboard = read('src/app/(admin)/dashboard.jsx');
    expect(dashboard).toContain('Receita DriveLocal');
    expect(dashboard).toContain('Comissões capturadas');
    expect(dashboard).toContain('title="Comissão promocional"');
    expect(dashboard).toContain('Moto — 0% ativo');
    expect(dashboard).toContain('Carro — 0% ativo');
    expect(dashboard).toContain('title="Picos e dias mais ativos"');
    expect(dashboard).toContain('title="Oferta x demanda"');
    expect(dashboard).toContain("openRoute('/antifraud'");
  });

  test('risk queue keeps permanent fraud confirmation behind an admin decision', () => {
    const screen = read('src/app/(admin)/antifraud.jsx');
    expect(screen).toContain('Fila de revisão explicável');
    expect(screen).toContain("submit('temporary_restriction')");
    expect(screen).toContain("submit('close_no_evidence')");
    expect(screen).toContain("submit('fraud_confirmed')");
    expect(screen).toContain('Confirmar fraude?');
  });

  test('ride detail displays the frozen commission settlement without Pix payload or coordinates', () => {
    const screen = read('src/app/(admin)/ride-detail.jsx');
    expect(screen).toContain('Retenção original');
    expect(screen).toContain('Comissão capturada');
    expect(screen).toContain('Estado financeiro');
    expect(screen).not.toContain('paymentPixPayload}');
    expect(screen).not.toContain('pickup.lat');
    expect(screen).not.toContain('destination.lat');
  });
});
