const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('admin alert inbox contracts', () => {
  it('uses authenticated callables and no direct adminAlerts access', () => {
    const service = source('src/services/adminService.js');
    expect(service).toContain("call('listAdminAlertsSecure'");
    expect(service).toContain("call('updateAdminAlertSecure'");
    expect(service).not.toContain("collection(db, 'adminAlerts')");
  });

  it('keeps the alert screen code-only and opens dedicated operational queues', () => {
    const screen = source('src/app/(admin)/admin-alerts.jsx');
    expect(screen).toContain('ADMIN_ALERT_RESOLUTIONS');
    expect(screen).toContain("updateStatus(resolutionAlert, 'resolved', code)");
    expect(screen).toContain('router.push({');
    expect(screen).toContain('targetRoute: alert.targetRoute');
    expect(screen).not.toContain('TextInput');
    expect(screen).not.toContain('note:');
    expect(screen).not.toMatch(/tel:|mailto:|wa\.me|api\.whatsapp/i);
  });

  it('exposes the alert inbox beside the support queue on the admin dashboard', () => {
    const layout = source('src/app/(admin)/_layout.jsx');
    expect(layout).toContain("router.push('/admin-alerts')");
    expect(layout).toContain("router.push('/support-tickets')");
    expect(layout).toContain('Abrir alertas operacionais');
  });

  it('does not define contact or identity labels in the presentation vocabulary', () => {
    const constants = source('src/constants/adminAlerts.js');
    expect(constants).toContain('ADMIN_ALERT_TITLES');
    expect(constants).not.toMatch(/fullName|passengerName|driverName|phone|email|cpf|pixKey|latitude|longitude/i);
  });
});
