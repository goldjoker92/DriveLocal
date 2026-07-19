const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('registration and notification regressions', () => {
  it('allows only the validated initial driver profile written by registerDriver', () => {
    const rules = source('backend/firebase/rules/firestore.rules');

    expect(rules).toContain("'verificationStatus'");
    expect(rules).toContain("'documentsStatus'");
    expect(rules).toContain("'selfieStatus'");
    expect(rules).toContain("'duplicateCheckStatus'");
    expect(rules).toContain('driverInitialCreateValid(driverId)');
    expect(rules).toContain("request.resource.data.verificationStatus == 'draft'");
    expect(rules).toContain("request.resource.data.serviceAreaId == 'HORIZONTE_CE_BR'");
  });

  it('removes a new Auth user when its Firestore profile cannot be created', () => {
    const authService = source('src/services/authService.js');

    expect(authService).toContain('deleteUser');
    expect(authService).toContain('createAccountWithProfile');
    expect(authService).toContain('await deleteUser(user)');
    expect(authService).toContain('throw error');
  });

  it('keeps the Expo SDK 56 default-sound warning fixed', () => {
    const notifications = source('src/services/notificationsService.js');
    const passengerLogger = source('src/utils/clientRideLog.js');

    expect(notifications).not.toContain("sound: 'default'");
    expect(notifications).not.toContain('sound: "default"');
    expect(passengerLogger).toContain('export function logRideClientEvent');
  });
});
