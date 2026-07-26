const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('accepted passenger public identity contract', () => {
  it('keeps all pre-acceptance offers anonymous', () => {
    const offers = source('functions/src/rides/offers.js');
    expect(offers).not.toContain('acceptedPassengerPublic');
    expect(offers).not.toContain('passengerFirstName');
    expect(offers).not.toContain('passengerPhotoPublicPath');
  });

  it('exports retryable projection and account-cleanup triggers', () => {
    const index = source('functions/src/index.js');
    const projection = source('functions/src/rides/passengerIdentityProjection.js');
    const cleanup = source('functions/src/accounts/passengerPhotoCleanup.js');

    expect(index).toContain('exports.acceptedPassengerIdentityTrigger');
    expect(index).toContain('exports.passengerPublicPhotoCleanupTrigger');
    expect(projection).toContain('onDocumentUpdated');
    expect(cleanup).toContain('onDocumentDeleted');
    expect(projection).toContain('retry: true');
    expect(cleanup).toContain('retry: true');
    expect(projection).toContain('identityProjectionNeeded');
    expect(projection).toContain('duplicate_ignored');
  });

  it('limits the driver projection to first name and verified public photo metadata', () => {
    const identity = source('functions/src/rides/passengerPublicIdentity.js');
    const projection = source('functions/src/rides/passengerIdentityProjection.js');

    expect(identity).toContain('firstName: passengerFirstName(passenger)');
    expect(identity).toContain('photoStoragePath');
    expect(identity).toContain('photoVerified: Boolean(photoStoragePath)');
    expect(identity).toContain('publicPassengerPhotos/${version}.jpg');
    expect(identity).not.toContain('publicPassengerPhotos/${passengerId}');
    expect(projection).toContain("keys.join('|') !== 'firstName|photoStoragePath|photoVerified'");
    expect(projection).toContain('isPublicPassengerPhotoPath(value.photoStoragePath)');
  });

  it('keeps the source passenger profile private and photo approval server-owned', () => {
    const rules = source('backend/firebase/rules/firestore.rules');
    expect(rules).toContain('match /passengers/{uid}');
    expect(rules).toContain('allow read: if isOwner(uid) || isAdmin();');
    expect(rules).not.toMatch(/match \/passengers\/\{uid\}[\s\S]{0,250}isAcceptedRideDriver/);
    const passengerUpdateBlock = rules.match(/function passengerUpdateSafe\(\)[\s\S]*?\n    }/)[0];
    expect(passengerUpdateBlock).not.toContain('passengerPhotoPublicPath');
    expect(passengerUpdateBlock).not.toContain('passengerPhotoPublicVerified');
    expect(passengerUpdateBlock).not.toContain('passengerPhotoPublicVersion');
  });

  it('allows reads only for opaque approved photo objects and forbids client writes', () => {
    const storageRules = source('backend/firebase/rules/storage.rules');
    expect(storageRules).toContain('match /publicPassengerPhotos/{fileName}');
    expect(storageRules).toContain("fileName.matches('[A-Za-z0-9_-]{12,80}\\\\.jpg')");
    expect(storageRules).toContain('allow write: if false;');
  });

  it('keeps identity and cleanup logs free of the projected name, path and passenger uid', () => {
    const projection = source('functions/src/rides/passengerIdentityProjection.js');
    const cleanup = source('functions/src/accounts/passengerPhotoCleanup.js');
    const logCalls = `${projection}\n${cleanup}`;

    expect(logCalls).toContain('firstNameFallback');
    expect(logCalls).toContain('photoVerified');
    expect(logCalls).not.toMatch(/log(?:Info|Warning)\([^)]*(photoStoragePath|passengerId|firstName:)/);
  });

  it('keeps the reusable mobile card free of private passenger fields', () => {
    const card = source('src/components/AcceptedPassengerIdentityCard.jsx');
    const photoService = source('src/services/passengerPublicPhotoService.js');
    const combined = `${card}\n${photoService}`;

    expect(card).toContain('identity?.firstName');
    expect(card).toContain('identity?.photoVerified');
    expect(card).toContain('identity?.photoStoragePath');
    expect(card).toContain("normalized.split(' ')[0]");
    expect(combined).not.toMatch(/\b(email|whatsApp|cpf|fullName|passengerId|phone|telefone)\b/);
    expect(card).not.toContain('photoStoragePath,');
    expect(card).not.toContain('firstName,');
  });
});
