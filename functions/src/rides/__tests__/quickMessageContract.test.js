const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('ride quick message integration contracts', () => {
  it('exports the callable through the secure ride boundary', () => {
    const callables = source('src/rides/callables.js');
    const index = source('src/index.js');
    expect(callables).toContain("const { sendRideQuickMessage } = require('./sendQuickMessage')");
    expect(callables).toContain("sendRideQuickMessageSecure: bindLifecycle('sendRideQuickMessageSecure', sendRideQuickMessage)");
    expect(index).toContain('exports.sendRideQuickMessageSecure = rideCallables.sendRideQuickMessageSecure');
  });

  it('stores codes only and bounds history to six server slots', () => {
    const handler = source('src/rides/sendQuickMessage.js');
    expect(handler).toContain("rideRef.collection('quickMessages').doc(`slot_${slot}`)");
    expect(handler).toContain('QUICK_MESSAGE_HISTORY_LIMIT');
    expect(handler).toContain('messageCode');
    expect(handler).not.toContain('messageText');
    expect(handler).not.toContain('customMessage');
    expect(handler).not.toContain('phoneNumber');
  });

  it('allows participants to read safe messages without exposing the parent ride', () => {
    const rules = source('../backend/firebase/rules/firestore.rules');
    const rideStart = rules.indexOf('match /rideRequests/{rideId}');
    const offersStart = rules.indexOf('match /driverOffers/{offerId}', rideStart);
    const rideRules = rules.slice(rideStart, offersStart);

    expect(rideRules).toContain('match /quickMessages/{messageId}');
    expect(rideRules).toContain('isRidePassenger(rideId)');
    expect(rideRules).toContain('isAcceptedRideDriver(rideId)');
    expect(rideRules).toContain('allow create, update, delete: if false');
    expect(rideRules).toContain('resource.data.passengerId == request.auth.uid || isAdmin()');
    expect(rideRules).not.toContain('resource.data.acceptedDriverId == request.auth.uid');
  });

  it('carries a catalog code but no free text in notification events', () => {
    const events = source('src/notifications/events.js');
    const processor = source('src/notifications/processEvent.js');
    expect(events).toContain('...(p.messageCode ? { messageCode: p.messageCode } : {})');
    expect(processor).toContain('quickMessagePresentation(event.messageCode)');
    expect(processor).toContain('...(event.messageCode ? { messageCode: String(event.messageCode) } : {})');
    expect(processor).not.toContain('event.messageText');
  });
});
