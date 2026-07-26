const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('minimal support center contracts', () => {
  it('uses authenticated callables and never reads supportTickets directly', () => {
    const service = source('src/services/supportService.js');
    expect(service).toContain("httpsCallable(functions, 'createSupportTicketSecure')");
    expect(service).toContain("httpsCallable(functions, 'listMySupportTicketsSecure')");
    expect(service).not.toContain("collection(db, 'supportTickets')");
    expect(service).not.toContain('TextInput');
  });

  it('contains categories only and no free-text/contact field', () => {
    const screen = source('src/app/support-center.jsx');
    expect(screen).toContain('supportCategoryOptions(actorRole, Boolean(rideId))');
    expect(screen).toContain('createSupportTicket({');
    expect(screen).toContain('rideId,');
    expect(screen).not.toContain('TextInput');
    expect(screen).not.toContain('Linking.openURL');
    expect(screen).not.toMatch(/tel:|mailto:|wa\.me|api\.whatsapp/i);
  });

  it('mounts ride-aware support without changing ride screens', () => {
    const layout = source('src/app/_layout.jsx');
    const shortcut = source('src/components/SupportShortcut.jsx');
    const driverShortcuts = source('src/components/AccountPrivacyShortcut.jsx');
    const passengerHome = source('src/app/(passenger)/passenger-home.jsx');

    expect(layout).toContain("import SupportShortcut from '../components/SupportShortcut'");
    expect(layout).toContain('<SupportShortcut route={pathname} />');
    expect(shortcut).toContain("path.includes('active-ride')");
    expect(shortcut).toContain("path.includes('driver-accepted')");
    expect(shortcut).toContain("path.includes('pix-payment')");
    expect(shortcut).toContain("...(rideId ? { rideId } : {})");
    expect(driverShortcuts).toContain("params: { source: 'driver_home' }");
    expect(passengerHome).toContain("params: { source: 'passenger_home' }");
  });

  it('keeps admin actions code-only and callable-backed', () => {
    const adminService = source('src/services/adminService.js');
    const adminScreen = source('src/app/(admin)/support-tickets.jsx');
    const adminLayout = source('src/app/(admin)/_layout.jsx');

    expect(adminService).toContain("call('listAdminSupportTicketsSecure'");
    expect(adminService).toContain("call('updateAdminSupportTicketSecure'");
    expect(adminScreen).toContain('SUPPORT_RESOLUTIONS');
    expect(adminScreen).toContain("update(ticket, 'resolved', code)");
    expect(adminScreen).not.toContain('TextInput');
    expect(adminScreen).not.toContain('note:');
    expect(adminLayout).toContain("router.push('/support-tickets')");
  });

  it('logs codes and references without contact or message content', () => {
    const service = source('src/services/supportService.js');
    expect(service).toContain('[SUPPORT]');
    expect(service).toContain('categoryCode');
    expect(service).toContain('hasRideContext');
    expect(service).not.toMatch(/fullName|passengerName|driverName|phone|email|cpf|pixKey/i);
  });
});