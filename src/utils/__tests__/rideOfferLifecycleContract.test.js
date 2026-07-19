const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('ride offer lifecycle contract', () => {
  it('surfaces offers globally for the driver', () => {
    const layout = source('src/app/(driver)/_layout.jsx');
    expect(layout).toContain('listenToMyOffer');
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
});
