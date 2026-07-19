const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('notification runtime contracts', () => {
  it('uses Android system channel sound instead of a fake custom file named default', () => {
    const service = source('src/services/notificationsService.js');

    expect(service).toContain('setNotificationChannelAsync');
    expect(service).not.toContain("sound: 'default'");
    expect(service).toContain('Android system notification sound');
  });

  it('ships the client ride logger imported by passenger screens', () => {
    const logger = source('src/utils/clientRideLog.js');

    expect(logger).toContain('export function logRideClientEvent');
    expect(logger).toContain("scope: 'ride_client'");
    expect(logger).toContain('if (__DEV__)');
  });
});
