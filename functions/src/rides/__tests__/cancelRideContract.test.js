const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('secure cancellation integration contracts', () => {
  it('binds cancelRideSecure to the strict cancellation module', () => {
    const callables = source('src/rides/callables.js');
    expect(callables).toContain("const { cancelRide } = require('./cancelRide')");
    expect(callables).toContain("cancelRideSecure: bindLifecycle('cancelRideSecure', cancelRide)");
    expect(callables).not.toContain("cancelRideSecure: bindLifecycle('cancelRideSecure', lifecycle.cancelRide)");
  });

  it('releases the entire commission hold and captures zero', () => {
    const handler = source('src/rides/cancelRide.js');
    expect(handler).toContain("type: 'commission_hold_release'");
    expect(handler).toContain("status: 'released'");
    expect(handler).toContain('commissionHoldCentavos: 0');
    expect(handler).toContain('holdReleasedCentavos: hold');
    expect(handler).toContain('commissionCapturedCentavos: 0');
    expect(handler).not.toContain("type: 'commission_capture'");
  });

  it('stores cancellation actor, reason, timing, stage and arrival context', () => {
    const handler = source('src/rides/cancelRide.js');
    for (const field of [
      'cancelledBy',
      'cancelReasonCode',
      'cancellationPriorStatus',
      'cancellationStage',
      'cancellationElapsedSinceCreatedMs',
      'cancellationElapsedSinceAssignedMs',
      'cancellationWaitAfterArrivalMs',
      'driverHadArrived',
      'driverArrivedAtMs',
      'passengerNoShowEligibleAtMs',
    ]) {
      expect(handler).toContain(field);
    }
  });

  it('records and projects the real notification delivery status', () => {
    const handler = source('src/rides/cancelRide.js');
    const projection = source('src/rides/cancellationNotificationStatus.js');
    const index = source('src/index.js');
    expect(handler).toContain('cancellationNotificationEventId');
    expect(handler).toContain('cancellationNotificationStatus');
    expect(projection).toContain('cancellationNotificationAttemptCount');
    expect(projection).toContain('retry: true');
    expect(index).toContain('cancellationNotificationStatusTrigger');
  });

  it('explicitly applies no automatic cancellation fee', () => {
    const handler = source('src/rides/cancelRide.js');
    const policy = source('src/rides/cancellationPolicy.js');
    expect(handler).toContain('cancellationFeeCentavos: 0');
    expect(policy).toContain("no-cancellation-fee-v1");
    expect(handler).not.toMatch(/chargeCancellation|captureCancellation|cancellation_fee_capture/);
  });
});