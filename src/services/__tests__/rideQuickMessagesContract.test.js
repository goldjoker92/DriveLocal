const fs = require('fs');
const path = require('path');
const source = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('legacy ride messages compatibility', () => {
  it('retains the secure legacy callable and six-slot reader for installed apps', () => {
    const service = source('src/services/ridesService.js');
    expect(service).toContain("callRide('sendRideQuickMessageSecure', rideId, { messageCode })");
    expect(service).toContain("collection(db, 'rideRequests', rideId, 'quickMessages')");
    expect(service).toContain('.slice(0, QUICK_MESSAGE_HISTORY_LIMIT)');
  });
  it('mounts one shared entry on both active ride routes', () => {
    expect(source('src/app/_layout.jsx')).toContain('<RideQuickMessagesGuard route={pathname} />');
    const component = source('src/components/RideQuickMessagesGuard.jsx');
    expect(component).toContain("path.includes('active-ride')");
    expect(component).toContain("path.includes('driver-accepted')");
  });
  it('uses the same conversation UI for both roles', () => {
    expect(source('src/app/(driver)/driver-ride-messages.jsx')).toContain('<RideConversationScreen role="driver" />');
    expect(source('src/app/(passenger)/passenger-ride-messages.jsx')).toContain('<RideConversationScreen role="passenger" />');
  });
});
