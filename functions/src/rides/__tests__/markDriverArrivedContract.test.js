const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('driver arrival privacy boundary', () => {
  it('binds the callable to the safe arrival projection handler', () => {
    const callables = source('src/rides/callables.js');
    expect(callables).toContain("const { markDriverArrived } = require('./markDriverArrived')");
    expect(callables).toContain("markDriverArrivedSecure: bindLifecycle('markDriverArrivedSecure', markDriverArrived)");
    expect(callables).not.toContain("markDriverArrivedSecure: bindLifecycle('markDriverArrivedSecure', lifecycle.markDriverArrived)");
  });

  it('copies waiting timestamps but no passenger identity or destination to the offer', () => {
    const handler = source('src/rides/markDriverArrived.js');
    const offerStart = handler.indexOf('tx.set(offerRef');
    const offerEnd = handler.indexOf('}, { merge: true });', offerStart);
    const offerProjection = handler.slice(offerStart, offerEnd);

    expect(offerProjection).toContain('driverArrivedAtMs');
    expect(offerProjection).toContain('passengerNoShowEligibleAtMs');
    expect(offerProjection).toContain('passengerNoShowWaitMs');
    expect(offerProjection).not.toContain('destination');
    expect(offerProjection).not.toContain('passengerId');
    expect(offerProjection).not.toContain('passengerName');
    expect(offerProjection).not.toContain('phone');
  });

  it('does not broaden Firestore ride reads to the accepted driver', () => {
    const rules = source('../backend/firebase/rules/firestore.rules');
    const rideMatchStart = rules.indexOf('match /rideRequests/{rideId}');
    const offersStart = rules.indexOf('match /driverOffers/{offerId}', rideMatchStart);
    const rideRules = rules.slice(rideMatchStart, offersStart);

    expect(rideRules).toContain('resource.data.passengerId == request.auth.uid || isAdmin()');
    expect(rideRules).not.toContain('acceptedDriverId == request.auth.uid');
  });
});