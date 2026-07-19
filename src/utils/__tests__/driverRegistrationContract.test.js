const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('driver registration contracts', () => {
  it('allows only the validated initial driver profile written by registerDriver', () => {
    const rules = source('backend/firebase/rules/firestore.rules');
    const authService = source('src/services/authService.js');

    for (const field of [
      'verificationStatus',
      'documentsStatus',
      'selfieStatus',
      'duplicateCheckStatus',
    ]) {
      expect(rules).toContain(`'${field}'`);
      expect(authService).toContain(field);
    }

    expect(rules).toContain('driverCreateValid(driverId)');
    expect(rules).toContain("request.resource.data.verificationStatus == 'draft'");
    expect(rules).toContain("request.resource.data.serviceAreaId == 'HORIZONTE_CE_BR'");
    expect(rules).toContain('request.resource.data.createdAt == request.time');
  });

  it('removes a newly created Auth user when Firestore profile creation fails', () => {
    const authService = source('src/services/authService.js');

    expect(authService).toContain('deleteUser');
    expect(authService).toContain('await deleteUser(user)');
    expect(authService).toContain('failed to rollback incomplete driver account');
  });
});
