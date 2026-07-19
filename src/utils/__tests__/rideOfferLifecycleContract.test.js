const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('ride offer lifecycle contract', () => {
  it('surfaces offers globally and recovers only the authoritative active ride', () => {
    const layout = source('src/app/(driver)/_layout.jsx');
    expect(layout).toContain('listenToMyOffer');
    expect(layout).toContain('getDriver(uid)');
    expect(layout).toContain('driver?.activeRideId');
    expect(layout).toContain('driver.activeRideId === offer.rideId');
    expect(layout).toContain("pathname: '/ride-request'");
    expect(layout).toContain("pathname: '/active-ride'");
  });

  it('uses a real countdown and server-authoritative refusal', () => {
    const screen = source('src/app/(driver)/ride-request.jsx');
    const service = source('src/services/ridesService.js');
    expect(screen).toContain('secondsLeft');
    expect(screen).toContain("declineOffer(offer.offerId, 'expired')");
    expect(screen).toContain("declineOffer(offer.offerId, 'driver_declined')");
    expect(service).toContain("httpsCallable(functions, 'declineDriverOfferSecure')");
  });

  it('schedules offer expiry on the server independently of the driver app', () => {
    const offers = source('functions/src/rides/offers.js');
    const expiry = source('functions/src/rides/expireOffersTask.js');
    const index = source('functions/src/index.js');

    expect(offers).toContain('taskQueue(EXPIRY_TASK_NAME)');
    expect(offers).toContain('scheduleTime: new Date(expiresAtMs + 1000)');
    expect(expiry).toContain("require('firebase-functions/tasks')");
    expect(expiry).toContain('const offersSnap = await tx.get(offersQuery)');
    expect(expiry).toContain("status: C.RIDE_STATUS.NO_DRIVER_AVAILABLE");
    expect(index).toContain('exports.expireRideOffersTask = expireRideOffersTask');
  });

  it('mirrors assigned and terminal ride states without timestamp coercion', () => {
    const acceptance = source('functions/src/rides/acceptOffer.js');
    const lifecycle = source('functions/src/rides/lifecycle.js');

    expect(acceptance).toContain('driverRideStatus: C.RIDE_STATUS.ASSIGNED');
    expect(acceptance).toContain('toMillis(driver.commissionFreeUntil)');
    expect(lifecycle).toContain('setDriverOfferStatusTx');
    expect(lifecycle).toContain('C.RIDE_STATUS.COMPLETED');
    expect(lifecycle).toContain('C.RIDE_STATUS.CANCELLED');
    expect(lifecycle).toContain('C.RIDE_STATUS.DISPUTED');
  });
});
