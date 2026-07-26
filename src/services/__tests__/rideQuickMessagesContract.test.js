const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('ride quick message mobile contracts', () => {
  it('calls only the secure callable and reads the six-slot subcollection', () => {
    const service = source('src/services/ridesService.js');
    expect(service).toContain("callRide('sendRideQuickMessageSecure', rideId, { messageCode })");
    expect(service).toContain("collection(db, 'rideRequests', rideId, 'quickMessages')");
    expect(service).toContain("orderBy('createdAtMs', 'desc')");
    expect(service).toContain('limit(QUICK_MESSAGE_HISTORY_LIMIT)');
    expect(service).toContain('Number(message.expiresAtMs) > nowMs');
  });

  it('mounts one shared panel on the active passenger and driver routes', () => {
    const layout = source('src/app/_layout.jsx');
    const component = source('src/components/RideQuickMessagesGuard.jsx');
    expect(layout).toContain("import RideQuickMessagesGuard from '../components/RideQuickMessagesGuard'");
    expect(layout).toContain('<RideQuickMessagesGuard route={pathname} />');
    expect(component).toContain("path.includes('active-ride')");
    expect(component).toContain("path.includes('driver-accepted')");
    expect(component).toContain("const MESSAGE_PHASES = new Set(['assigned', 'driver_arrived'])");
  });

  it('contains predefined choices and no free-text or contact action', () => {
    const component = source('src/components/RideQuickMessagesGuard.jsx');
    expect(component).toContain('quickMessageOptions(role, rideStatus)');
    expect(component).toContain('sendRideQuickMessage(rideId, messageCode)');
    expect(component).not.toContain('TextInput');
    expect(component).not.toContain('Linking.openURL');
    expect(component).not.toMatch(/tel:|mailto:|wa\.me|api\.whatsapp/i);
  });

  it('logs codes and roles without names, coordinates or visible message text', () => {
    const component = source('src/components/RideQuickMessagesGuard.jsx');
    const traceStart = component.indexOf('function traceQuickMessage');
    const actionEnd = component.indexOf('return (', traceStart);
    const traceAndActions = component.slice(traceStart, actionEnd);
    expect(traceAndActions).toContain('messageCode');
    expect(traceAndActions).toContain('senderRole');
    expect(traceAndActions).not.toMatch(/passengerName|driverName|fullName|phone|email|cpf/i);
    expect(traceAndActions).not.toMatch(/\blat\b|\blng\b|coordinates/i);
  });

  it('handles the server rate-limit metadata path', () => {
    const component = source('src/components/RideQuickMessagesGuard.jsx');
    expect(component).toContain('error?.details?.metadata?.remainingMs');
    expect(component).toContain('[RIDE_MESSAGE]');
    expect(component).toContain('send.requested');
    expect(component).toContain('send.succeeded');
    expect(component).toContain('send.failed');
  });
});
